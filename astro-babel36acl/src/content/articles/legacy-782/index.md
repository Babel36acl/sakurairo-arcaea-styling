---
title: "bsp_adc 深度解析：ADC1 DMA 采样与多任务协作"
description: "系列文章 S4 · 2026-05-29 1. 概述 本篇文章深入分析 bsp_adc 模块的实现——基于 STM32F103 的 ..."
published: "2026-05-29"
updated: "2026-08-18"
permalink: "/2026/05/29/bsp_adc-深度解析：adc1-dma-采样与多任务协作/"
draft: false
categories: ["嵌入式实战"]
tags: []
legacyId: 782
---

<article class="arcaea-article">
<header class="arcaea-header">
<p class="arcaea-meta">系列文章 S4 · 2026-05-29</p>
</header>
<section class="arcaea-section">
<h2 class="arcaea-h2">1. 概述</h2>
<p class="arcaea-p">
本篇文章深入分析 <code>bsp_adc</code> 模块的实现——基于 STM32F103 的 ADC1 单通道 DMA 循环采样，专为功率测量链路的源头（分流电压采样）设计。这不是一篇 HAL 库 API 的罗列，而是围绕「采样触发 — DMA 搬运 — ISR 通知 — 上下文保护 — 错误恢复 — 数据上送」全链路的实战拆解。
</p>
<p class="arcaea-p">
所有对外接口已脱敏为 <code>GENERIC_DEVICE_CONTROLLER</code> 命名风格，内部保留 STM32F103、ADC1、DMA 等真实硬件细节。
</p>
</section>
<section class="arcaea-section">
<h2 class="arcaea-h2">2. 硬件连接与设计约束</h2>
<ul class="arcaea-ul">
<li><strong>ADC 外设</strong>：ADC1</li>
<li><strong>采样通道</strong>：ADC1_IN4 → GPIO PA4（模拟输入）</li>
<li><strong>采样对象</strong>：分流电阻两端电压（shunt voltage），后续经 Service 层换算为电流 → 功率</li>
<li><strong>转换结果</strong>：12 位右对齐，原始 ADC counts（0–4095）</li>
<li><strong>触发方式</strong>：软件触发（HAL_ADC_Start_DMA），DMA 循环模式持续搬运</li>
<li><strong>DMA 通道</strong>：DMA1 Channel1（ADC1 的固定映射）</li>
<li><strong>缓冲区</strong>：16 × uint16_t 环形缓冲，DMA 循环写</li>
</ul>
</section>
<section class="arcaea-section">
<h2 class="arcaea-h2">3. 模块架构：Context 对象模式</h2>
<p class="arcaea-p">
整个 <code>bsp_adc</code> 模块不依赖全局变量，而是通过一个 Context 结构体封装所有运行时状态。这是嵌入式 C 中一种轻量级的「伪 OOP」模式，特别适合裸机或 RTOS 混合环境。
</p>
<pre class="arcaea-pre"><code class="language-c">/* bsp_adc.h */
typedef struct {
    ADC_HandleTypeDef    hadc;            /* HAL ADC 句柄（大对象，放在末尾避免栈溢出） */
    DMA_HandleTypeDef    hdma_adc;        /* DMA 句柄                                    */
    volatile uint16_t    dma_buf[16];     /* DMA 循环缓冲区    16 样本                   */
    volatile uint8_t     buf_idx;         /* 当前可读的最新样本索引（ISR 中更新）         */
    uint32_t             last_sample_raw; /* 上一次读取的原始 ADC 值                      */
    uint32_t             sum;             /* 累加和（供均值计算，暂未启用）                */
    uint8_t              initialized;     /* 初始化标志                                    */
} bsp_adc_ctxt_t;
</code></pre>
<p class="arcaea-p">
关键设计决策：<code>dma_buf</code> 与 <code>buf_idx</code> 以 <code>volatile</code> 声明，保证 ISR 与主循环间数据可见性。<code>hadc</code> 和 <code>hdma_adc</code> 虽然体积大（~100+ bytes），但作为结构体成员而非指针，省去了动态分配和生命周期管理。
</p>
</section>
<section class="arcaea-section">
<h2 class="arcaea-h2">4. 初始化流程</h2>
<pre class="arcaea-pre"><code class="language-c">GENERIC_DEVICE_CONTROLLER_Status bsp_adc_init(bsp_adc_ctxt_t *ctxt)
{
    GPIO_InitTypeDef  gpio_init = {0};

    if (ctxt == NULL) return GENERIC_DEVICE_CONTROLLER_ERROR;

    /* ---- GPIO: PA4 analog ---- */
    __HAL_RCC_GPIOA_CLK_ENABLE();
    gpio_init.Pin  = GPIO_PIN_4;
    gpio_init.Mode = GPIO_MODE_ANALOG;
    HAL_GPIO_Init(GPIOA, &amp;gpio_init);

    /* ---- ADC1 clock ---- */
    __HAL_RCC_ADC1_CLK_ENABLE();
    __HAL_RCC_DMA1_CLK_ENABLE();

    /* ---- ADC1 handle ---- */
    ctxt-&gt;hadc.Instance           = ADC1;
    ctxt-&gt;hadc.Init.ClockPrescaler = ADC_CLOCK_SYNC_PCLK_DIV4;   /* ≤ 14 MHz on 72 MHz */
    ctxt-&gt;hadc.Init.Resolution    = ADC_RESOLUTION_12B;
    ctxt-&gt;hadc.Init.ScanConvMode  = ADC_SCAN_DISABLE;            /* 单通道 */
    ctxt-&gt;hadc.Init.ContinuousConvMode = DISABLE;                 /* 由 DMA 触发转换 */
    ctxt-&gt;hadc.Init.DiscontinuousConvMode = DISABLE;
    ctxt-&gt;hadc.Init.ExternalTrigConv = ADC_SOFTWARE_START;
    ctxt-&gt;hadc.Init.DataAlign      = ADC_DATAALIGN_RIGHT;
    ctxt-&gt;hadc.Init.NbrOfConversion = 1;
    HAL_ADC_Init(&amp;ctxt-&gt;hadc);

    /* ---- ADC channel config: IN4 ---- */
    ADC_ChannelConfTypeDef ch_cfg = {0};
    ch_cfg.Channel      = ADC_CHANNEL_4;
    ch_cfg.Rank         = ADC_REGULAR_RANK_1;
    ch_cfg.SamplingTime = ADC_SAMPLETIME_55CYCLES_5;  /* ~1 µs per sample @72MHz */
    HAL_ADC_ConfigChannel(&amp;ctxt-&gt;hadc, &amp;ch_cfg);

    /* ---- DMA: circular mode ---- */
    ctxt-&gt;hdma_adc.Instance                 = DMA1_Channel1;
    ctxt-&gt;hdma_adc.Init.Direction           = DMA_PERIPH_TO_MEMORY;
    ctxt-&gt;hdma_adc.Init.PeriphInc           = DMA_PINC_DISABLE;
    ctxt-&gt;hdma_adc.Init.MemInc              = DMA_MINC_ENABLE;
    ctxt-&gt;hdma_adc.Init.PeriphDataAlignment = DMA_PDATAALIGN_HALFWORD;
    ctxt-&gt;hdma_adc.Init.MemDataAlignment    = DMA_MDATAALIGN_HALFWORD;
    ctxt-&gt;hdma_adc.Init.Mode                = DMA_CIRCULAR;       /* 循环模式！ */
    ctxt-&gt;hdma_adc.Init.Priority            = DMA_PRIORITY_HIGH;
    HAL_DMA_Init(&amp;ctxt-&gt;hdma_adc);

    __HAL_LINKDMA(&amp;ctxt-&gt;hadc, DMA_Handle, ctxt-&gt;hdma_adc);

    /* ---- DMA interrupt ---- */
    HAL_NVIC_SetPriority(DMA1_Channel1_IRQn, 5, 0);
    HAL_NVIC_EnableIRQ(DMA1_Channel1_IRQn);

    /* ---- ADC interrupt ---- */
    HAL_NVIC_SetPriority(ADC1_IRQn, 5, 0);
    HAL_NVIC_EnableIRQ(ADC1_IRQn);

    ctxt-&gt;initialized = 1;
    return GENERIC_DEVICE_CONTROLLER_OK;
}
</code></pre>
<p class="arcaea-p">
几点值得注意：</p>
<ul class="arcaea-ul">
<li>预分频选择 <code>ADC_CLOCK_SYNC_PCLK_DIV4</code>：APB2 为 72 MHz → ADC 时钟 18 MHz（≤ 14 MHz 可更可靠，这里留有余量）。</li>
<li><code>ContinuousConvMode = DISABLE</code> 但配合 DMA 循环模式，效果等价于连续转换——每次 DMA 传输完成触发下一次转换。</li>
<li>采样时间 55.5 周期，每样本约 1 µs，16 个缓冲约 16 µs 填满一轮。</li>
<li>DMA 中断优先级 5，ADC 中断优先级 5——ADC 中断用于错误处理，DMA 中断用于半满/全满通知（本模块未开启，后续可扩展）。</li>
</ul>
</section>
<section class="arcaea-section">
<h2 class="arcaea-h2">5. 启动采样与 DMA 循环</h2>
<pre class="arcaea-pre"><code class="language-c">GENERIC_DEVICE_CONTROLLER_Status bsp_adc_start(bsp_adc_ctxt_t *ctxt)
{
    if (ctxt == NULL || !ctxt-&gt;initialized)
        return GENERIC_DEVICE_CONTROLLER_ERROR;

    ctxt-&gt;buf_idx = 0;
    ctxt-&gt;sum     = 0;

    HAL_StatusTypeDef hal_ret = HAL_ADC_Start_DMA(
        &amp;ctxt-&gt;hadc,
        (uint32_t *)ctxt-&gt;dma_buf,
        16
    );

    return (hal_ret == HAL_OK)
        ? GENERIC_DEVICE_CONTROLLER_OK
        : GENERIC_DEVICE_CONTROLLER_BUSY;
}
</code></pre>
<p class="arcaea-p">
<code>HAL_ADC_Start_DMA</code> 内部做了这三件事：</p>
<ol class="arcaea-ol">
<li>使能 ADC 并启动一次软件转换</li>
<li>配置 DMA 从 ADC DR 寄存器搬运到 <code>dma_buf</code></li>
<li>DMA 在 16 次传输后产生传输完成中断（半满/全满均可配置）</li>
</ol>
<p class="arcaea-p">
由于是 <strong>DMA_CIRCULAR</strong>，DMA 填满 16 个元素后会自动绕回地址 0 继续写，无需人工干预。这意味着 <code>dma_buf[0..15]</code> 始终是最近的 16 个 ADC 样本。</p>
</section>
<section class="arcaea-section">
<h2 class="arcaea-h2">6. 数据读取：Critical Section 保护</h2>
<pre class="arcaea-pre"><code class="language-c">GENERIC_DEVICE_CONTROLLER_Status bsp_adc_read_raw(bsp_adc_ctxt_t *ctxt,
                                                    uint32_t *raw_out)
{
    uint32_t raw;
    uint8_t  idx;

    if (ctxt == NULL || raw_out == NULL)
        return GENERIC_DEVICE_CONTROLLER_ERROR;

    /* ---- Enter critical section: disable IRQ with PRIMASK ---- */
    uint32_t primask = __get_PRIMASK();
    __disable_irq();

    idx = ctxt-&gt;buf_idx;
    raw = ctxt-&gt;dma_buf[idx];

    ctxt-&gt;last_sample_raw = raw;

    /* ---- Exit critical section ---- */
    if (!primask) {
        __enable_irq();
    }

    *raw_out = raw;
    return GENERIC_DEVICE_CONTROLLER_OK;
}
</code></pre>
<p class="arcaea-p">
关于 PRIMASK 关键区：</p>
<ul class="arcaea-ul">
<li><strong>为什么不用关 DMA 或 ADC 中断？</strong>——因为 <code>buf_idx</code> 由 DMA 传输完成 ISR 更新。如果读取时不屏蔽中断，ISR 可能在我们读 <code>buf_idx</code> 和 <code>dma_buf[idx]</code> 之间改变 <code>buf_idx</code>，导致读到过期数据。</li>
<li><strong>为什么不用 mutex？</strong>——ISR 中不能获取 mutex。PRIMASK 关中断是 Cortex-M3 上最轻量的互斥手段，仅阻塞 ISR 几个 CPU 周期。</li>
<li><strong>保存恢复</strong>：<code>__get_PRIMASK()</code> 保存调用前的状态，防止嵌套关中断导致意外开启。</li>
</ul>
</section>
<section class="arcaea-section">
<h2 class="arcaea-h2">7. DMA 传输完成通知：ISR → Task 唤醒</h2>
<pre class="arcaea-pre"><code class="language-c">/* 通知回调类型（在 bsp_adc.h 中声明） */
typedef void (*bsp_adc_notify_cb_t)(bsp_adc_ctxt_t *ctxt, uint8_t flags);
/* flags: 1 = half transfer, 2 = full transfer */

static bsp_adc_notify_cb_t s_notify_cb = NULL;

void bsp_adc_register_notify_cb(bsp_adc_notify_cb_t cb)
{
    s_notify_cb = cb;
}

/* HAL 的 DMA 传输完成回调 */
void HAL_ADC_ConvCpltCallback(ADC_HandleTypeDef *hadc)
{
    /* 从 hadc 反推 context（依赖 container_of 或结构体首地址一致） */
    bsp_adc_ctxt_t *ctxt = (bsp_adc_ctxt_t *)hadc;

    /* 更新最新样本索引：buf_idx 始终指向最后写入的位置 */
    /* DMA 当前传输位置可由 __HAL_DMA_GET_COUNTER 获取，但为简洁此处用溢出指示 */
    ctxt-&gt;buf_idx = (ctxt-&gt;buf_idx + 1) &amp; 0x0F;

    /* 通知注册的回调（通常唤醒 AdcTask） */
    if (s_notify_cb) {
        s_notify_cb(ctxt, 2);  /* full transfer */
    }
}
</code></pre>
<p class="arcaea-p">
这里有一个巧妙的强制转换：<code>(bsp_adc_ctxt_t *)hadc</code> 之所以成立，是因为 <code>hadc</code> 是 <code>bsp_adc_ctxt_t</code> 的第一个成员——结构体地址就是 <code>hadc</code> 的地址。这种手法在 HAL 库回调中非常常见。</p>
<p class="arcaea-p">
通知回调的典型用法：</p>
<pre class="arcaea-pre"><code class="language-c">/* 在 AdcTask 中注册 */
static void on_adc_data_ready(bsp_adc_ctxt_t *ctxt, uint8_t flags)
{
    (void)flags;
    /* 发信号量/通知给 AdcTask，使其从等待中恢复 */
    osSemaphoreRelease(adc_sem);
}

/* AdcTask 主循环 */
void AdcTask(void *arg)
{
    bsp_adc_ctxt_t *adc = (bsp_adc_ctxt_t *)arg;
    uint32_t raw;

    while (1) {
        osSemaphoreAcquire(adc_sem, osWaitForever);  /* 等待通知 */
        bsp_adc_read_raw(adc, &amp;raw);
        /* raw 上送给 Service 层做 mV 换算 */
        service_power_feed_raw(raw);
    }
}
</code></pre>
</section>
<section class="arcaea-section">
<h2 class="arcaea-h2">8. 错误恢复：HAL_ADC_ErrorCallback</h2>
<pre class="arcaea-pre"><code class="language-c">void HAL_ADC_ErrorCallback(ADC_HandleTypeDef *hadc)
{
    bsp_adc_ctxt_t *ctxt = (bsp_adc_ctxt_t *)hadc;
    uint32_t        error_code = HAL_ADC_GetError(hadc);

    if (error_code &amp; HAL_ADC_ERROR_DMA) {
        /* DMA 传输出错，最常见的场景是总线争用或 DMA 配置被意外覆盖 */

        /* 1. 停止 ADC + DMA */
        HAL_ADC_Stop_DMA(hadc);

        /* 2. 清除硬件挂起标志位 */
        __HAL_ADC_CLEAR_FLAG(hadc, ADC_FLAG_EOC);
        __HAL_ADC_CLEAR_FLAG(hadc, ADC_FLAG_OVR);

        /* 3. 关键！清除 HAL 层的 ADC_STATE_BUSY 标志 */
        /*    否则下次 Start_DMA 会返回 HAL_BUSY */
        hadc-&gt;State = HAL_ADC_STATE_REGULAR_READY;

        /* 4. 重新启动 */
        ctxt-&gt;buf_idx = 0;
        HAL_ADC_Start_DMA(hadc, (uint32_t *)ctxt-&gt;dma_buf, 16);

        /* 5. 通知上层发生了恢复 */
        if (s_notify_cb) {
            s_notify_cb(ctxt, 0xFF);  /* 错误标志 */
        }
    }
}
</code></pre>
<p class="arcaea-p">
<strong>为什么需要清除 <code>hadc-&gt;State</code>？</strong></p>
<p class="arcaea-p">
HAL 库中 <code>HAL_ADC_Start_DMA</code> 入口会检查 <code>hadc-&gt;State</code> 是否为 <code>HAL_ADC_STATE_REGULAR_READY</code>。当 DMA 错误触发 error callback 后，HAL 状态机停留在 <code>HAL_ADC_STATE_BUSY</code>，如果不手动复位，下次调用 <code>HAL_ADC_Start_DMA</code> 会直接返回 <code>HAL_BUSY</code>，ADC 模块永久失效。</p>
<p class="arcaea-p">
这个 Bug 在 STM32 HAL 的早期版本中容易踩到，而且错误不明显——系统 ADC 读数会恒为 0，排查时第一反应往往怀疑硬件而非状态机。手动清除 <code>hadc-&gt;State</code> 是生产环境中的标准修复手法。</p>
</section>
<section class="arcaea-section">
<h2 class="arcaea-h2">9. 停止与反初始化</h2>
<pre class="arcaea-pre"><code class="language-c">GENERIC_DEVICE_CONTROLLER_Status bsp_adc_stop(bsp_adc_ctxt_t *ctxt)
{
    if (ctxt == NULL) return GENERIC_DEVICE_CONTROLLER_ERROR;

    uint32_t primask = __get_PRIMASK();
    __disable_irq();

    HAL_ADC_Stop_DMA(&amp;ctxt-&gt;hadc);

    if (!primask) __enable_irq();

    ctxt-&gt;buf_idx    = 0;
    ctxt-&gt;initialized = 0;
    return GENERIC_DEVICE_CONTROLLER_OK;
}

GENERIC_DEVICE_CONTROLLER_Status bsp_adc_deinit(bsp_adc_ctxt_t *ctxt)
{
    if (ctxt == NULL) return GENERIC_DEVICE_CONTROLLER_ERROR;

    bsp_adc_stop(ctxt);

    HAL_ADC_DeInit(&amp;ctxt-&gt;hadc);
    HAL_DMA_DeInit(&amp;ctxt-&gt;hdma_adc);

    HAL_NVIC_DisableIRQ(DMA1_Channel1_IRQn);
    HAL_NVIC_DisableIRQ(ADC1_IRQn);

    memset(ctxt, 0, sizeof(bsp_adc_ctxt_t));
    return GENERIC_DEVICE_CONTROLLER_OK;
}
</code></pre>
</section>
<section class="arcaea-section">
<h2 class="arcaea-h2">10. 上層使用示例：Service 层的功率计算</h2>
<pre class="arcaea-code"><code class="language-c">/* service_power.c —— 位于 Service 层，非 BSP 模块 */

static bsp_adc_ctxt_t s_adc_ctxt;

void service_power_init(void)
{
    bsp_adc_init(&amp;s_adc_ctxt);
    bsp_adc_register_notify_cb(on_adc_data_ready);
    bsp_adc_start(&amp;s_adc_ctxt);
}

static void on_adc_data_ready(bsp_adc_ctxt_t *ctxt, uint8_t flags)
{
    (void)flags;
    osSemaphoreRelease(g_adc_sem);
}

/* 在 AdcTask 中被调用 */
void service_power_feed_raw(uint32_t raw_counts)
{
    /* BSP 层只输出原始 ADC counts，mV 换算在 Service 层完成 */
    /* 当前为占位——硬件校准系数待标定 */
    uint32_t voltage_mv = (raw_counts * 3300UL) / 4095UL;

    packer_power_limit_feed_shunt_mv(voltage_mv);
}
</code></pre>
<p class="arcaea-p">
注意这里 <strong>BSP 层不做单位换算</strong>——它只返回原始 counts。mV 转换公式 <code>(counts × 3300) / 4095</code> 目前是占位实现，实际板上会有分压电阻比例系数、ADC 参考电压偏移等校准参数，由 Service 层在板级配置中维护。</p>
</section>
<section class="arcaea-section">
<h2 class="arcaea-h2">11. 4 点滑动平均（在 packer 层）</h2>
<pre class="arcaea-code"><code class="language-c">/* packer_power_limit.c —— 4 点滑动平均，不在 BSP 中 */

static uint32_t s_ma_buf[4];
static uint8_t  s_ma_idx = 0;

void packer_power_limit_feed_shunt_mv(uint32_t mv)
{
    uint32_t sum = 0;

    s_ma_buf[s_ma_idx] = mv;
    s_ma_idx = (s_ma_idx + 1) &amp; 0x03;

    for (int i = 0; i &lt; 4; i++) {
        sum += s_ma_buf[i];
    }

    uint32_t avg_mv = sum / 4;

    /* 用 avg_mv 计算电流 = avg_mv / shunt_resistance_mOhm */
    /* 然后计算功率 = current_mA * bus_voltage_mV / 1000000 */
    power_limit_update(avg_mv);
}
</code></pre>
<p class="arcaea-p">
4 点滑动平均是一个极为轻量的数字滤波方案，在 DMA 已提供 16 样本硬件缓冲的基础上再做一层软件平均，进一步抑制随机噪声。放在 packer 层而非 BSP 层，体现了「BSP 保持纯净」的分层哲学——BSP 只管「怎么采」，不管「怎么算」。</p>
</section>
<section class="arcaea-section">
<h2 class="arcaea-h2">12. 数据流全景</h2>
<pre class="arcaea-pre"><code class="language-c">┌──────────────────────────────────────────────────────────┐
│                   数据流链路总览                         │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  PA4 (shunt)                                             │
│    │                                                     │
│    ▼                                                     │
│  ADC1 (12-bit, 55.5 cycles)                              │
│    │                                                     │
│    ▼  DMA 搬运                                           │
│  dma_buf[16]  (循环覆盖)                                 │
│    │                                                     │
│    ├── DMA_IT_TC ──→ HAL_ADC_ConvCpltCallback            │
│    │                  → 更新 buf_idx                     │
│    │                  → 调用 notify_cb                   │
│    │                    → osSemaphoreRelease(adc_sem)    │
│    │                                                      │
│    ▼  AdcTask 被唤醒                                      │
│  bsp_adc_read_raw()  (PRIMASK 保护)                      │
│    │                                                     │
│    ▼                                                     │
│  service_power_feed_raw(raw_counts)                      │
│    │  mV = (counts × 3300) / 4095                       │
│    ▼                                                     │
│  packer_power_limit_feed_shunt_mv(mv)                    │
│    │  4-point moving average                             │
│    │  → I = V / R_shunt                                  │
│    │  → P = I × V_bus                                    │
│    ▼                                                     │
│  power_limit_update()                                    │
│                                                          │
└──────────────────────────────────────────────────────────┘

错误恢复路径:
  HAL_ADC_ErrorCallback → Stop_DMA → 清 State → Restart
</code></pre>
</section>
<section class="arcaea-section">
<h2 class="arcaea-h2">13. 常见问题与排查指南</h2>
<div class="arcaea-table-wrap" data-bac-table-shell="1"><table class="arcaea-table">
<thead>
<tr>
<th>现象</th>
<th>可能原因</th>
<th>排查点</th>
</tr>
</thead>
<tbody>
<tr>
<td>ADC 读数恒为 0</td>
<td>DMA 未搬运；HAL State 卡在 BUSY</td>
<td>检查 DMA 中断是否使能；检查 ErrorCallback 是否重置 State</td>
</tr>
<tr>
<td>ADC 读数恒为 4095</td>
<td>PA4 浮空；GPIO 未配为 Analog</td>
<td>万用表量 PA4 电平；检查 GPIO_MODE_ANALOG</td>
</tr>
<tr>
<td>采样值跳跃</td>
<td>采样时间过短；参考电压不稳</td>
<td>增大 SamplingTime；检查 VREF 引脚</td>
</tr>
<tr>
<td>DMA 中断不触发</td>
<td>NVIC 优先级分组冲突；中断标志未清</td>
<td>检查 HAL_NVIC_SetPriority 调用；检查 HAL_DMA_IRQHandler 是否被调用</td>
</tr>
<tr>
<td>重新启动返回 HAL_BUSY</td>
<td>ErrorCallback 未清除 hadc-&gt;State</td>
<td>在 ErrorCallback 中加 hadc-&gt;State = HAL_ADC_STATE_REGULAR_READY</td>
</tr>
</tbody>
</table></div>
</section>
<section class="arcaea-section">
<h2 class="arcaea-h2">14. 总结</h2>
<p class="arcaea-p">
<code>bsp_adc</code> 模块的核心理念可以概括为：</p>
<ul class="arcaea-ul">
<li><strong>Context 模式</strong> —— 无全局变量，所有状态通过指针传递</li>
<li><strong>DMA 循环采样</strong> —— 硬件自动化，零 CPU 开销搬运数据</li>
<li><strong>PRIMASK 关键区</strong> —— ISR 与主循环共享数据的安全访问</li>
<li><strong>回调通知</strong> —— ISR 到 Task 的轻量级信号传递</li>
<li><strong>自动错误恢复</strong> —— 即使在 DMA 异常后也能透明恢复</li>
<li><strong>分层清晰</strong> —— BSP 只出 counts，Service 做换算，Packer 做滤波与算法</li>
</ul>
<p class="arcaea-p">
这种设计让 BSP 层保持硬件驱动的高内聚性，上层逻辑可以灵活替换标定系数或滤波策略而不影响采样链路。下一篇 S5 将深入 ADC 多通道序列采样与注入通道的应用。欢迎留言讨论。</p>
</section>
</article>
