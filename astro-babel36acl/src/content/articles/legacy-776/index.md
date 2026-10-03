---
title: "bsp_uart UART DMA+IDLE 深度解析"
description: "系列文章 S2 · GENERIC_DEVICE_CONTROLLER 嵌入式实战 · 2026 1. 概述 GENERIC_DE ..."
published: "2026-05-29"
updated: "2026-08-18"
permalink: "/2026/05/29/bsp_uart-uart-dmaidle-深度解析/"
draft: false
categories: ["嵌入式实战"]
tags: []
legacyId: 776
---

<div class="arcaea-article">
<p class="arcaea-meta">系列文章 S2 · GENERIC_DEVICE_CONTROLLER 嵌入式实战 · 2026</p>
<hr class="arcaea-divider">
<h2 class="arcaea-h2">1. 概述</h2>
<p class="arcaea-p">
GENERIC_DEVICE_CONTROLLER 的 BSP 层提供了一套基于 STM32F103 的 3 端口 UART 驱动框架，核心设计围绕 <strong>DMA 循环缓冲区</strong>、<strong>IDLE 空闲中断</strong>、<strong>软件尾指针</strong> 和 <strong>两级 TX 发送队列</strong> 展开。三个 USART 端口分工明确：
</p>
<ul class="arcaea-ul">
<li><strong>USART1</strong> (SCREEN/RS232, 9600 bps) — 人机交互</li>
<li><strong>USART2</strong> (PRINTER/RS232, 115200 bps) — 日志/打印</li>
<li><strong>USART3</strong> (PACKER/RS485, 9600 bps) — 工业协议封包</li>
</ul>
<p class="arcaea-p">
其中仅有 USART3 (PACKER 端口) 启用了 <strong>IDLE 空闲中断</strong> 用于帧边界检测，其余端口依赖 DMA 半传输/完成中断触发的轮询读取。
</p>
<hr class="arcaea-divider">
<h2 class="arcaea-h2">2. RX 路径：DMA 循环缓冲区 + 软件尾指针</h2>
<h3 class="arcaea-h3">2.1 数据结构</h3>
<p class="arcaea-p">
每个端口维护一个静态分配的 DMA 接收循环缓冲区 (256 字节)，配合一个 <strong>软件尾指针 (tail)</strong> 记录应用层已读取的位置，而 <strong>头指针 (head)</strong> 通过 DMA 的 <code>CNDTR</code> 寄存器反推得到：
</p>
<pre class="arcaea-code"><code class="language-c">/* bsp_uart_defs.h — 端口上下文结构 */
typedef struct {
    USART_TypeDef      *Instance;
    DMA_Stream_TypeDef *rx_dma_stream;
    
    /* 接收循环缓冲区 */
    uint8_t             rx_buf[BSP_UART_RX_BUF_SIZE];  /* 256 bytes */
    uint16_t            rx_tail;                        /* 软件尾指针 */
    
    /* DMA 传输完成回调 */
    void              (*rx_activity_cb)(void *ctx);
    void               *rx_activity_ctx;
    
    /* 发送环形队列 */
    uint8_t             tx_queue[BSP_UART_TX_QUEUE_SIZE]; /* 256 bytes */
    uint16_t            tx_q_head;
    uint16_t            tx_q_tail;
    uint8_t             tx_dma_seg[BSP_UART_TX_SEG_SIZE]; /* 64 bytes */
    volatile uint8_t    tx_busy;
    SemaphoreHandle_t   tx_mutex;
    
    /* FreeRTOS Stream Buffer (仅 PACKER 端口) */
    StaticStreamBuffer_t rx_stream_buf_static;
    StreamBufferHandle_t rx_stream_buf;
    uint8_t             rx_stream_buf_storage[BSP_UART_PACKER_STREAM_SIZE]; /* 257 bytes */
    
    /* 错误恢复 */
    volatile uint32_t   error_flags;
} bsp_uart_ctx_t;</code></pre>
<h3 class="arcaea-h3">2.2 Head 指针推导</h3>
<p class="arcaea-p">
DMA 配置为循环模式 (Circular Mode)，从 <code>rx_buf[0]</code> 开始向 <code>rx_buf[255]</code> 写入。DMA 的 <code>CNDTR</code> 寄存器记录 <strong>剩余待传输的字节数</strong>，因此当前写入位置 (head) 为：
</p>
<pre class="arcaea-code"><code class="language-c">static uint16_t bsp_uart_get_head(bsp_uart_ctx_t *ctx)
{
    uint16_t remain = __HAL_DMA_GET_COUNTER(ctx-&gt;rx_dma_stream);
    uint16_t head = BSP_UART_RX_BUF_SIZE - remain;
    if (head &gt;= BSP_UART_RX_BUF_SIZE) {
        head = 0;
    }
    return head;
}</code></pre>
<p class="arcaea-p">
应用层通过 <code>tail</code> 和 <code>head</code> 之间的差值判断可读数据量。由于缓冲区是循环的，当 head 回绕到小于 tail 时，可读数据分为两段：<code>[tail, buf_end]</code> + <code>[0, head)</code>。
</p>
<div class="arcaea-note">
<strong>设计要点：</strong> 软件 tail 指针使得应用层可以在 DMA 持续写入的同时安全地消费数据，无需关闭 DMA 或复制整个缓冲区。代价是应用层必须在 head - tail 达到阈值前消费完毕，否则 DMA 写入会覆盖未读取的数据。
</div>
<hr class="arcaea-divider">
<h2 class="arcaea-h2">3. IDLE 空闲中断 — 帧边界检测</h2>
<h3 class="arcaea-h3">3.1 为什么只用 USART3？</h3>
<p class="arcaea-p">
USART1 和 USART2 是面向人/日志的流式数据，没有明确的"帧"概念，应用层按需轮询读取即可。USART3 (PACKER/RS485) 承载工业协议数据，每个报文有明确帧边界，IDLE 中断能够在接收完一帧后立即通知应用层唤醒处理，降低响应延迟。
</p>
<h3 class="arcaea-h3">3.2 IDLE 中断处理</h3>
<pre class="arcaea-code"><code class="language-c">/* stm32f1xx_it.c — USART3 IDLE 中断 */
void USART3_IRQHandler(void)
{
    if (__HAL_UART_GET_FLAG(&amp;huart3, UART_FLAG_IDLE)) {
        __HAL_UART_CLEAR_IDLEFLAG(&amp;huart3);
        
        /* 计算当前帧长度 */
        uint16_t head = bsp_uart_get_head(&amp;bsp_uart_ctx[BSP_UART_PORT_PACKER]);
        uint16_t avail;
        if (head &gt;= bsp_uart_ctx[BSP_UART_PORT_PACKER].rx_tail) {
            avail = head - bsp_uart_ctx[BSP_UART_PORT_PACKER].rx_tail;
        } else {
            avail = (BSP_UART_RX_BUF_SIZE - bsp_uart_ctx[BSP_UART_PORT_PACKER].rx_tail)
                    + head;
        }
        
        /* 将可用数据推入 Stream Buffer */
        if (avail &gt; 0) {
            /* 处理回绕情况，分两段拷贝 */
            uint16_t first_len = (head &gt; bsp_uart_ctx[BSP_UART_PORT_PACKER].rx_tail)
                ? avail
                : (BSP_UART_RX_BUF_SIZE - bsp_uart_ctx[BSP_UART_PORT_PACKER].rx_tail);
            
            xStreamBufferSendFromISR(
                bsp_uart_ctx[BSP_UART_PORT_PACKER].rx_stream_buf,
                &amp;bsp_uart_ctx[BSP_UART_PORT_PACKER].rx_buf[
                    bsp_uart_ctx[BSP_UART_PORT_PACKER].rx_tail],
                first_len, NULL);
            
            if (first_len &lt; avail) {
                uint16_t second_len = avail - first_len;
                xStreamBufferSendFromISR(
                    bsp_uart_ctx[BSP_UART_PORT_PACKER].rx_stream_buf,
                    bsp_uart_ctx[BSP_UART_PORT_PACKER].rx_buf,
                    second_len, NULL);
            }
            
            /* 更新 tail */
            bsp_uart_ctx[BSP_UART_PORT_PACKER].rx_tail = head;
        }
        
        /* 通知任务有数据 */
        bsp_uart_notify_rx_activity(BSP_UART_PORT_PACKER);
    }
    
    HAL_UART_IRQHandler(&amp;huart3);
}</code></pre>
<hr class="arcaea-divider">
<h2 class="arcaea-h2">4. DMA 半传输 / 完成中断</h2>
<h3 class="arcaea-h3">4.1 统一回调</h3>
<p class="arcaea-p">
三个端口均使能了 DMA 半传输中断 (HT) 和传输完成中断 (TC)。HAL 库提供的两个回调函数均调用同一个通知函数，确保应用层不会错过任何数据到达事件：
</p>
<pre class="arcaea-code"><code class="language-c">/* 两个回调 → 同一个通知入口 */
void HAL_UART_RxHalfCpltCallback(UART_HandleTypeDef *huart)
{
    bsp_uart_notify_rx_activity(bsp_uart_get_port_from_handle(huart));
}

void HAL_UART_RxCpltCallback(UART_HandleTypeDef *huart)
{
    bsp_uart_notify_rx_activity(bsp_uart_get_port_from_handle(huart));
}</code></pre>
<p class="arcaea-p">
<code>bsp_uart_notify_rx_activity()</code> 内部根据端口不同执行不同逻辑：对于 PACKER 端口，IDLE 中断已经处理了数据入队，所以该函数仅用于唤醒等待任务；对于非 PACKER 端口，由于没有 IDLE 中断，该函数是应用层知晓有新数据的唯一信号。
</p>
<hr class="arcaea-divider">
<h2 class="arcaea-h2">5. 应用层读取策略</h2>
<h3 class="arcaea-h3">5.1 PACKER 端口：Stream Buffer 阻塞读取</h3>
<p class="arcaea-p">
USART3 使用 FreeRTOS Stream Buffer (静态分配 257 字节)，应用任务可以直接阻塞等待数据：
</p>
<pre class="arcaea-code"><code class="language-c">/* app_packer.c — 阻塞等待完整帧 */
void packer_task(void *param)
{
    uint8_t frame_buf[256];
    size_t  received;
    
    for (;;) {
        /* 阻塞等待至少 1 字节，直到超时或完整帧 */
        received = xStreamBufferReceive(
            bsp_uart_get_rx_stream_buf(BSP_UART_PORT_PACKER),
            frame_buf, sizeof(frame_buf),
            pdMS_TO_TICKS(100));
        
        if (received &gt; 0) {
            process_incoming_frame(frame_buf, received);
        }
    }
}</code></pre>
<p class="arcaea-p">
IDLE 中断确保每帧数据完整写入 Stream Buffer 后才唤醒任务，避免应用层读到半帧。
</p>
<h3 class="arcaea-h3">5.2 非 PACKER 端口：Polling + vTaskDelay(1)</h3>
<p class="arcaea-p">
USART1 和 USART2 使用轮询读取，由 CommTask (周期 ~10ms) 统一调度：
</p>
<pre class="arcaea-code"><code class="language-c">/* app_comm.c — CommTask 轮询读取 */
void comm_task(void *param)
{
    uint8_t buf[64];
    int16_t len;
    
    for (;;) {
        bsp_uart_task_once();  /* 处理 TX 队列 */
        
        /* 轮询非 PACKER 端口 */
        for (int port = BSP_UART_PORT_SCREEN;
             port &lt;= BSP_UART_PORT_PRINTER; port++) {
            do {
                len = bsp_uart_receive_poll(port, buf, sizeof(buf));
                if (len &gt; 0) {
                    forward_to_upper_layer(port, buf, len);
                }
            } while (len &gt; 0);
        }
        
        vTaskDelay(pdMS_TO_TICKS(10));
    }
}</code></pre>
<p class="arcaea-p">
<code>bsp_uart_receive_poll()</code> 内部使用 <code>vTaskDelay(1)</code> 在无数据时让出 CPU，避免忙等。
</p>
<hr class="arcaea-divider">
<h2 class="arcaea-h2">6. TX 路径：两级发送队列</h2>
<h3 class="arcaea-h3">6.1 总体设计</h3>
<p class="arcaea-p">
发送路径分为两层：
</p>
<ul class="arcaea-ul">
<li><strong>软件环形队列</strong> (tx_queue, 256 字节) — 应用层写入的原始数据</li>
<li><strong>线性 DMA 段缓冲区</strong> (tx_dma_seg, 64 字节) — 从环形队列拷贝到连续内存后启动 DMA 发送</li>
</ul>
<h3 class="arcaea-h3">6.2 两阶段发送</h3>
<pre class="arcaea-code"><code class="language-c">/* 阶段一：应用层写入环形队列 */
int bsp_uart_transmit(bsp_uart_port_t port, const uint8_t *data, uint16_t len)
{
    bsp_uart_ctx_t *ctx = &amp;bsp_uart_ctx[port];
    uint16_t space;
    int ret = -1;
    
    taskENTER_CRITICAL();
    space = bsp_uart_tx_queue_space(ctx);
    if (space &gt;= len) {
        /* 整包入队 — 保证要么全进要么不进 */
        for (uint16_t i = 0; i &lt; len; i++) {
            ctx-&gt;tx_queue[ctx-&gt;tx_q_head] = data[i];
            ctx-&gt;tx_q_head = (ctx-&gt;tx_q_head + 1) &amp; (BSP_UART_TX_QUEUE_SIZE - 1);
        }
        ret = 0;
    }
    taskEXIT_CRITICAL();
    
    return ret;
}

/* 阶段二：bsp_uart_task_once() 启动 DMA 发送 */
void bsp_uart_task_once(void)
{
    for (int port = 0; port &lt; BSP_UART_PORT_COUNT; port++) {
        bsp_uart_ctx_t *ctx = &amp;bsp_uart_ctx[port];
        
        if (ctx-&gt;tx_busy) {
            continue;  /* DMA 正在发送，跳过 */
        }
        
        /* 从环形队列搬运到 DMA 段缓冲区 */
        uint16_t q_len = bsp_uart_tx_queue_len(ctx);
        if (q_len == 0) {
            continue;
        }
        
        uint16_t copy_len = (q_len &gt; BSP_UART_TX_SEG_SIZE)
            ? BSP_UART_TX_SEG_SIZE : q_len;
        
        for (uint16_t i = 0; i &lt; copy_len; i++) {
            ctx-&gt;tx_dma_seg[i] = ctx-&gt;tx_queue[ctx-&gt;tx_q_tail];
            ctx-&gt;tx_q_tail = (ctx-&gt;tx_q_tail + 1) &amp; (BSP_UART_TX_QUEUE_SIZE - 1);
        }
        
        ctx-&gt;tx_busy = 1;
        HAL_UART_Transmit_DMA(ctx-&gt;huart, ctx-&gt;tx_dma_seg, copy_len);
    }
}</code></pre>
<h3 class="arcaea-h3">6.3 TX 完成中断</h3>
<p class="arcaea-p">
DMA 传输完成中断中不清除 busy 标志后立即启动下一段——因为中断中调用 HAL_UART_Transmit_DMA 可能造成重入问题。正确的做法是仅设置 <code>tx_busy = 0</code> 并标记"有数据待发"，由 <code>bsp_uart_task_once()</code> 在任务上下文中触发下一段发送：
</p>
<pre class="arcaea-code"><code class="language-c">void HAL_UART_TxCpltCallback(UART_HandleTypeDef *huart)
{
    bsp_uart_port_t port = bsp_uart_get_port_from_handle(huart);
    bsp_uart_ctx_t *ctx = &amp;bsp_uart_ctx[port];
    
    ctx-&gt;tx_busy = 0;                    /* DMA 通道释放 */
    bsp_uart_set_tx_pending(port);       /* 标记有待发数据 */
    /* 不在此处调用 bsp_uart_task_once() —
       由 CommTask 在 ~10ms 周期中统一处理 */
}</code></pre>
<hr class="arcaea-divider">
<h2 class="arcaea-h2">7. 整包入队保证</h2>
<p class="arcaea-p">
发送 API 的关键设计约束：<strong>要么整包进入环形队列，要么一字节都不进</strong>。如果环形队列剩余空间不足，<code>bsp_uart_transmit()</code> 返回负值，调用方需要自行决定重试或丢弃。这避免了半包发送导致协议解析错误。
</p>
<pre class="arcaea-code"><code class="language-c">/* 调用方示例 — 确保整包发送 */
int uart_send_packet(bsp_uart_port_t port,
                     const uint8_t *pkt, uint16_t pkt_len)
{
    int ret;
    
    /* 持有 TX 互斥锁，防止多任务竞争 */
    if (xSemaphoreTake(bsp_uart_get_tx_mutex(port),
                       pdMS_TO_TICKS(100)) != pdTRUE) {
        return -1;  /* 获取锁超时 */
    }
    
    ret = bsp_uart_transmit(port, pkt, pkt_len);
    
    xSemaphoreGive(bsp_uart_get_tx_mutex(port));
    
    return ret;
}</code></pre>
<hr class="arcaea-divider">
<h2 class="arcaea-h2">8. TX 互斥锁</h2>
<p class="arcaea-p">
每个端口维护一个静态分配的 FreeRTOS 互斥锁 (<code>StaticSemaphore_t</code>)，防止多个任务同时写入同一端口的 TX 队列造成数据交错。锁的粒度是"每次 enqueue 操作"，而非"整个传输完成"——因为实际的 DMA 发送是异步的。
</p>
<pre class="arcaea-code"><code class="language-c">/* bsp_uart_init.c — 静态创建 TX 互斥锁 */
static StaticSemaphore_t tx_mutex_buf[BSP_UART_PORT_COUNT];

void bsp_uart_init(void)
{
    for (int i = 0; i &lt; BSP_UART_PORT_COUNT; i++) {
        bsp_uart_ctx[i].tx_mutex =
            xSemaphoreCreateMutexStatic(&amp;tx_mutex_buf[i]);
    }
}</code></pre>
<hr class="arcaea-divider">
<h2 class="arcaea-h2">9. 错误恢复机制</h2>
<h3 class="arcaea-h3">9.1 错误回调</h3>
<pre class="arcaea-code"><code class="language-c">void HAL_UART_ErrorCallback(UART_HandleTypeDef *huart)
{
    bsp_uart_port_t port = bsp_uart_get_port_from_handle(huart);
    uint32_t err = huart-&gt;ErrorCode;
    
    /* 累积错误标志 */
    bsp_uart_ctx[port].error_flags |= err;
    
    /* 通知应用层 */
    bsp_uart_notify_error(port);
}</code></pre>
<h3 class="arcaea-h3">9.2 应用层消费与恢复</h3>
<pre class="arcaea-code"><code class="language-c">/* app_main.c — CommTask 周期性消费错误标志并恢复 */
void app_main_consume_uart_recovery_flags(void)
{
    for (int port = 0; port &lt; BSP_UART_PORT_COUNT; port++) {
        uint32_t flags = bsp_uart_ctx[port].error_flags;
        if (flags) {
            bsp_uart_ctx[port].error_flags = 0;
            
            LOG_ERROR("UART port %d error: 0x%08lX, restarting RX", port, flags);
            bsp_uart_port_rx_restart(port);
        }
    }
}

/* 重启 RX：重置 tail、清空缓冲区、重新启动 DMA */
void bsp_uart_port_rx_restart(bsp_uart_port_t port)
{
    bsp_uart_ctx_t *ctx = &amp;bsp_uart_ctx[port];
    uint32_t primask;
    
    /* 临界区保护 */
    __disable_irq();
    primask = __get_PRIMASK();
    
    /* 停止 DMA */
    HAL_DMA_Abort(ctx-&gt;rx_dma_stream);
    
    /* 重置软件状态 */
    memset(ctx-&gt;rx_buf, 0, BSP_UART_RX_BUF_SIZE);
    ctx-&gt;rx_tail = 0;
    
    /* 重启 DMA 接收 */
    HAL_UART_Receive_DMA(ctx-&gt;huart, ctx-&gt;rx_buf, BSP_UART_RX_BUF_SIZE);
    
    __set_PRIMASK(primask);
}</code></pre>
<hr class="arcaea-divider">
<h2 class="arcaea-h2">10. 调度器未启动时的回退方案</h2>
<p class="arcaea-p">
在 FreeRTOS 调度器启动之前 (<code>vTaskStartScheduler()</code> 之前)，不能使用任何 FreeRTOS API。为此 BSP 层提供一个阻塞发送模式：
</p>
<pre class="arcaea-code"><code class="language-c">/* bsp_uart.c — 调度器未启动时的回退 */
void bsp_uart_early_putc(bsp_uart_port_t port, uint8_t c)
{
    HAL_UART_Transmit(bsp_uart_ctx[port].huart, &amp;c, 1, HAL_MAX_DELAY);
}

void bsp_uart_early_puts(bsp_uart_port_t port, const char *str)
{
    HAL_UART_Transmit(bsp_uart_ctx[port].huart,
                      (uint8_t *)str, strlen(str), HAL_MAX_DELAY);
}</code></pre>
<p class="arcaea-p">
该函数在硬件初始化阶段、调度器启动前使用，用于输出启动日志。调度器启动后，应用层应切换至 <code>bsp_uart_transmit()</code> 非阻塞接口。
</p>
<hr class="arcaea-divider">
<h2 class="arcaea-h2">11. 静态分配与零 malloc</h2>
<p class="arcaea-p">
整个 BSP 层和 APP 层的所有数据结构均为静态分配，无任何动态内存分配。包括：
</p>
<ul class="arcaea-ul">
<li>端口上下文 (<code>bsp_uart_ctx_t</code>)</li>
<li>DMA 接收缓冲区 (256 字节 × 3)</li>
<li>TX 环形队列 (256 字节 × 3)</li>
<li>TX DMA 段缓冲区 (64 字节 × 3)</li>
<li>FreeRTOS Stream Buffer (257 字节，仅 PACKER 端口)</li>
<li>FreeRTOS 互斥锁静态内存 (<code>StaticSemaphore_t</code>)</li>
<li>Stream Buffer 静态控制块 (<code>StaticStreamBuffer_t</code>)</li>
</ul>
<p class="arcaea-p">
静态分配使得内存使用完全可预测，避免了堆碎片、内存泄漏和 malloc 失败等运行时风险，适用于对可靠性要求严格的嵌入式系统。
</p>
<hr class="arcaea-divider">
<h2 class="arcaea-h2">12. 临界区策略：PRIMASK vs taskENTER_CRITICAL</h2>
<h3 class="arcaea-h3">12.1 BSP 层：PRIMASK</h3>
<p class="arcaea-p">
BSP 层的临界区直接操作 <code>PRIMASK</code> (全局关中断)，不依赖 FreeRTOS。这是因为 BSP 层可能在调度器启动前被调用，且需要绝对保证时序敏感的寄存器操作不被任何中断打断：
</p>
<pre class="arcaea-code"><code class="language-c">/* BSP 层 — 使用 PRIMASK 临界区 */
void bsp_uart_port_rx_restart(bsp_uart_port_t port)
{
    uint32_t primask = __get_PRIMASK();
    __disable_irq();
    
    /* 执行关键操作：停止 DMA、重置缓冲区、重启 DMA */
    
    __set_PRIMASK(primask);  /* 恢复原始状态 */
}</code></pre>
<h3 class="arcaea-h3">12.2 APP 层：taskENTER_CRITICAL</h3>
<p class="arcaea-p">
应用层使用 FreeRTOS 的 <code>taskENTER_CRITICAL()</code> / <code>taskEXIT_CRITICAL()</code>，仅禁止当前 CPU 的中断和任务切换，效率更高且不会影响另一个核 (如果有)。在单核 STM32F103 上，两者的实际效果差异主要在于 <strong>嵌套调用计数</strong> 和 <strong>与 FreeRTOS 调度器的交互</strong>：
</p>
<pre class="arcaea-code"><code class="language-c">/* APP 层 — 使用 taskENTER_CRITICAL */
void app_layer_operation(void)
{
    taskENTER_CRITICAL();
    /* 操作应用层共享数据 */
    taskEXIT_CRITICAL();
}</code></pre>
<div class="arcaea-table-wrap" data-bac-table-shell="1"><table class="arcaea-table">
<tr>
<th>层级</th>
<th>临界区机制</th>
<th>影响范围</th>
<th>调度器需要？</th>
</tr>
<tr>
<td>BSP</td>
<td><code>__disable_irq()</code> / PRIMASK</td>
<td>全局关中断</td>
<td>否</td>
</tr>
<tr>
<td>APP</td>
<td><code>taskENTER_CRITICAL()</code></td>
<td>挂起调度器 + 关中断</td>
<td>是</td>
</tr>
</table></div>
<hr class="arcaea-divider">
<h2 class="arcaea-h2">13. 总结</h2>
<p class="arcaea-p">
GENERIC_DEVICE_CONTROLLER 的 bsp_uart 驱动框架在 STM32F103 上实现了以下关键设计：
</p>
<ol class="arcaea-ol">
<li><strong>3 端口差异化设计</strong>：PACKER 端口使用 IDLE 中断 + Stream Buffer 实现帧感知接收；非 PACKER 端口使用 DMA HT/TC + 轮询读取，降低中断负载。</li>
<li><strong>软件 tail 指针 + DMA CNDTR head</strong>：在不停止 DMA 的前提下实现安全的数据消费，内存效率高。</li>
<li><strong>两级 TX 发送</strong>：环形队列 + 线性 DMA 段，避免 DMA 分散/聚集所需的复杂链表管理。</li>
<li><strong>整包入队保证</strong>：避免半包被 DMA 发送出去导致协议错误。</li>
<li><strong>两阶段发送</strong>：中断仅释放 busy 标志，任务上下文启动下一次 DMA，避免重入问题。</li>
<li><strong>静态零 malloc</strong>：所有资源编译期确定，运行时无堆操作，高可靠性。</li>
<li><strong>分层临界区</strong>：BSP PRIMASK 隔离硬件操作，APP taskENTER_CRITICAL 轻量同步。</li>
<li><strong>错误恢复</strong>：中断记录错误标志，任务上下文统一恢复，避免在 ISR 中执行耗时操作。</li>
</ol>
<p class="arcaea-p">
这套设计在多个工业现场已验证运行，能够稳定处理 9600 bps ~ 115200 bps 的并发收发。下一篇文章将深入分析 USART3 的 RS485 方向控制与自动换向的硬件/软件协同设计。
</p>
<hr class="arcaea-divider">
<h2 class="arcaea-h2">附录：完整代码清单</h2>
<p class="arcaea-p">
以下为 bsp_uart 核心文件的快速索引 (路径基于 GENERIC_DEVICE_CONTROLLER 仓库结构)：
</p>
<pre class="arcaea-code"><code class="language-text">bsp/
├── inc/
│   ├── bsp_uart.h            — 公共 API 声明
│   └── bsp_uart_defs.h       — 端口上下文结构体、宏定义
├── src/
│   ├── bsp_uart.c            — 核心实现 (init, transmit, receive_poll, task_once)
│   ├── bsp_uart_dma.c        — DMA 配置与 HAL 回调
│   ├── bsp_uart_idle.c       — IDLE 中断处理 (仅 USART3)
│   └── bsp_uart_early.c      — 调度器未启动时的早期 I/O
app/
├── app_comm.c                — CommTask (周期 10ms，轮询非 PACKER 端口)
├── app_packer.c              — PackerTask (阻塞读取 Stream Buffer)
└── app_main.c                — 错误恢复消费、启动初始化</code></pre>
</div>
