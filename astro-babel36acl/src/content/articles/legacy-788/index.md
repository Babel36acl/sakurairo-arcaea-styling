---
title: "SA3｜遗留 DGUS 串口屏驱动：从裸协议到推送引擎的归档解读"
description: "技术归档说明：本文是包装机项目早期基于 DWIN DGUS 内核的串口屏驱动（V1/V2）的技术实现归档。该系统目前已被更安全的  ..."
published: "2026-05-29"
updated: "2026-08-18"
permalink: "/2026/05/29/sa3｜遗留-dgus-串口屏驱动：从裸协议到推送引擎的归档/"
draft: false
categories: ["方法与工具"]
tags: []
legacyId: 788
---

<blockquote>
<p><strong>技术归档说明</strong>：本文是包装机项目早期基于 DWIN DGUS 内核的串口屏驱动（V1/V2）的技术实现归档。该系统目前已被更安全的 <strong>HMIS Session 会话协议</strong> 及 <strong>HMIS-BAM V3 分片传输协议</strong> 取代。关于协议的完整演进历程，请参阅 <a href="/?p=542">HMI 串口会话协议进化史：从 DGUS 到 HMIS 再到 HMIS-BAM</a>。</p>
</blockquote>
<p class="excerpt">在 HMIS 会话协议替换之前，这套基于 DWIN DGUS 内核的串口屏驱动支撑了整整两代产品的运行。本文从源文件出发，完整拆解其协议层、流解码器、实例上下文与推送引擎的设计，作为遗留系统的技术归档。</p>
<div class="arcaea-mermaid-box"><pre class="mermaid">flowchart TB
    subgraph DGUS[DGUS 串口屏协议]
        D1[裸帧发送]
        D2[流解码器]
        D3[实例上下文]
    end
    subgraph PUSH[推送引擎]
        P1[定时刷新]
        P2[变量同步]
    end
    D1 --&gt; D2 --&gt; PUSH
    D3 --&gt; PUSH
    style DGUS fill:transparent,stroke:#8dc7ff,color:#eaf4ff
    style PUSH fill:transparent,stroke:#8dc7ff,color:#eaf4ff</pre></div>
<h2>1. 背景：为什么归档</h2>
<p>GENERIC_DEVICE_CONTROLLER 项目早期的人机交互界面依赖 DWIN 品牌的 DGUS 串口屏，协议层基于 DGUS 内核的 <code>0x82</code> / <code>0x83</code> 指令实现变量读写。这套驱动经历了两个大版本的迭代——从裸的串口收发演进到带状态机的流解码器，再到上层封装了参数自动同步与文本日志输出引擎。</p>
<p>后来系统整体切换至 HMIS 会话协议（基于带 Session ID 的请求 - 应答模型），原 DGUS 驱动不再用于新设计，但其协议适配层、状态机设计、参数打包策略仍有参考价值，因此以本文归档。</p>
<blockquote data-bac-callout="warning"><p class="bac-callout-title">警告</p><p>
        <strong>安全说明</strong>：以下代码均已脱敏，所有产品级名称替换为 <code>GENERIC_DEVICE_CONTROLLER</code>，具体硬件地址与参数枚举已泛化。
    </p></blockquote>
<h2>2. DGUS 协议帧结构</h2>
<p>DWIN DGUS 协议运行在 USART1（物理层为 RS232），帧格式统一为：</p>
<pre><code class="language-text">帧头: 0x5A 0xA5
长度: LEN（1 字节，后续字节数）
命令: CMD（1 字节）
数据: [data ... n 字节]
CRC : [CRC_H CRC_L]（可选，从 CMD 到 data 末尾）</code></pre>
<p>关键特性：</p>
<ul>
<li><strong>大端序</strong>：多字节数据（VP 地址、数值）统一采用 Big-Endian。</li>
<li><strong>字地址</strong>：DGUS 变量存储以 16-bit word 为单元，地址连续。</li>
<li><strong>CRC 范围</strong>：从 CMD 字节开始到数据末尾（<em>不</em>包含 <code>0x5A 0xA5 LEN</code>）。</li>
<li><strong>典型波特率</strong>：115200 bps。</li>
</ul>
<h2>3. 实例上下文：packer_screen_dgus_t</h2>
<p>驱动核心数据结构 <code>packer_screen_dgus_t</code> 封装了实例级别的协议上下文：</p>
<pre><code class="language-c">typedef struct {
    uint8_t  tx_buf[PACKER_SCREEN_TX_BUF_SIZE]; /* 发送缓冲区 */
    uint8_t  rx_buf[PACKER_SCREEN_RX_BUF_SIZE]; /* 接收缓冲区 */

    /* 配置 */
    uint32_t baudrate;
    uint8_t  has_crc;       /* 是否启用 CRC */
    uint16_t vp_addr_base;  /* DGUS VP 基地址 */

    /* 流解码器状态 */
    dgus_decoder_state_t decoder_state;
    uint8_t  frame_buf[PACKER_SCREEN_FRAME_MAX];
    uint16_t frame_len;
    uint16_t frame_cursor;

    /* 回调 */
    void (*on_frame)(packer_screen_dgus_t *ctx, uint8_t *frame, uint16_t len);
    void (*on_error)(packer_screen_dgus_t *ctx, int err_code);
} packer_screen_dgus_t;</code></pre>
<p>这种设计将协议状态（解码器、缓冲区）与配置（波特率、CRC 使能、VP 基址）绑定在同一个实例中，支持多个 DGUS 屏并存——虽然实际产品中只会用一个。</p>
<h2>4. 帧构建：写变量与读变量</h2>
<p>DGUS 变量操作的核心两条指令：</p>
<div class="arcaea-table-wrap" data-bac-table-shell="1"><table>
<thead>
<tr>
<th>指令</th>
<th>CMD</th>
<th>功能</th>
</tr>
</thead>
<tbody>
<tr>
<td><code>write_var</code></td>
<td>0x82</td>
<td>从指定 VP 地址开始写入 N 个字的数据</td>
</tr>
<tr>
<td><code>read_var</code></td>
<td>0x83</td>
<td>从指定 VP 地址开始读取 N 个字的数据</td>
</tr>
</tbody>
</table></div>
<p>帧构建函数示例：</p>
<pre><code class="language-c">/**
 * 构建写变量帧（0x82）
 * @param vp_addr  DGUS 变量地址（字地址）
 * @param data     待写入数据（大端序）
 * @param word_cnt 字数
 * @param[out] frame  输出帧（含 5A A5 帧头）
 * @return 帧长度
 */
uint16_t dgus_build_write_var(packer_screen_dgus_t *ctx,
                               uint16_t vp_addr,
                               const uint16_t *data,
                               uint8_t word_cnt,
                               uint8_t *frame)
{
    uint16_t idx = 0;
    uint8_t payload_len = 2 + word_cnt * 2; /* VP_addr(2) + data(2*word_cnt) */
    uint8_t len_byte = 1 + 1 + payload_len; /* CMD(1) + LEN(1) -&gt; 实际协议中的 LEN 是剩余长度 */

    /* 帧头 */
    frame[idx++] = 0x5A;
    frame[idx++] = 0xA5;
    frame[idx++] = payload_len + 1; /* LEN = CMD(1) + payload */
    frame[idx++] = 0x82;            /* CMD */
    frame[idx++] = (vp_addr &gt;&gt; 8) &amp; 0xFF;
    frame[idx++] = vp_addr &amp; 0xFF;

    for (uint8_t i = 0; i &lt; word_cnt; i++) {
        frame[idx++] = (data[i] &gt;&gt; 8) &amp; 0xFF;
        frame[idx++] = data[i] &amp; 0xFF;
    }

    if (ctx-&gt;has_crc) {
        uint16_t crc = dgus_calc_crc(&amp;frame[3], idx - 3); /* 从 CMD 算起 */
        frame[idx++] = (crc &gt;&gt; 8) &amp; 0xFF;
        frame[idx++] = crc &amp; 0xFF;
    }

    return idx;
}</code></pre>
<p>读变量帧（0x83）结构类似，数据部分仅需 VP 地址 + 字数，无需写入值。DGUS 屏收到后以 <code>0x83</code> 响应帧返回数据。</p>
<h2>5. 流解码器：状态机与 CRC 校验</h2>
<p>串口收数据是字节流，需要从无头流中正确切分帧。驱动使用四级状态机：</p>
<pre><code class="language-c">typedef enum {
    DECODER_IDLE,      /* 等待 0x5A */
    DECODER_SYNC1,    /* 已收到 0x5A，等待 0xA5 */
    DECODER_LEN,      /* 已收到 0xA5，等待 LEN */
    DECODER_DATA      /* 已收到 LEN，累积后续数据 */
} dgus_decoder_state_t;</code></pre>
<p>解码流程（每收到 1 字节调用一次）：</p>
<pre><code class="language-c">void dgus_decoder_feed(packer_screen_dgus_t *ctx, uint8_t byte)
{
    switch (ctx-&gt;decoder_state) {
    case DECODER_IDLE:
        if (byte == 0x5A) {
            ctx-&gt;decoder_state = DECODER_SYNC1;
            ctx-&gt;frame_cursor = 0;
            ctx-&gt;frame_buf[ctx-&gt;frame_cursor++] = byte;
        }
        break;

    case DECODER_SYNC1:
        if (byte == 0xA5) {
            ctx-&gt;decoder_state = DECODER_LEN;
            ctx-&gt;frame_buf[ctx-&gt;frame_cursor++] = byte;
        } else {
            ctx-&gt;decoder_state = DECODER_IDLE; /* 失步 */
        }
        break;

    case DECODER_LEN:
        ctx-&gt;frame_buf[ctx-&gt;frame_cursor++] = byte;
        ctx-&gt;frame_len = byte; /* LEN = 剩余字节数 */
        ctx-&gt;decoder_state = DECODER_DATA;
        break;

    case DECODER_DATA:
        ctx-&gt;frame_buf[ctx-&gt;frame_cursor++] = byte;
        /* 已收齐 CMD + 数据 + [CRC] */
        if (ctx-&gt;frame_cursor &gt;= (3 + ctx-&gt;frame_len)) {
            dgus_decoder_frame_ready(ctx);
            ctx-&gt;decoder_state = DECODER_IDLE;
        }
        break;
    }
}</code></pre>
<p>帧就绪时的校验逻辑：</p>
<ol>
<li>检查 <code>frame_cursor == 3 + LEN</code>（3 = 5A + A5 + LEN 已占用）。</li>
<li>若 <code>ctx-&gt;has_crc</code>，取末尾两字节为 CRC，从 CMD 到数据末尾重新计算并比较。</li>
<li>校验通过则调用 <code>on_frame</code> 回调；失败调用 <code>on_error</code> 并丢弃该帧。</li>
</ol>
<blockquote data-bac-callout="important"><p class="bac-callout-title">重要</p><p>
        <strong>设计要点</strong>：CRC 校验范围 <em>不</em> 包含帧头 5A A5 和 LEN 字段。这是 DWIN 官方协议的定义，解码器实现时必须注意区分。
    </p></blockquote>
<h2>6. 变量寄存器映射</h2>
<p>DGUS 屏内部维护一个 16-bit 宽的变量寄存器空间（VP），地址范围为 0x0000 ~ 0xFFFF。产品中用到的关键系统信息区：</p>
<div class="arcaea-table-wrap" data-bac-table-shell="1"><table>
<thead>
<tr>
<th>VP 地址</th>
<th>名称</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>0x1000</td>
<td>VAR_SYS_STATE</td>
<td>系统状态字</td>
</tr>
<tr>
<td>0x1001</td>
<td>VAR_SYS_RUNNING</td>
<td>运行计数 / 心跳</td>
</tr>
<tr>
<td>0x1002</td>
<td>VAR_SYS_SELF_CHECK</td>
<td>自检结果位图</td>
</tr>
<tr>
<td>0x1003</td>
<td>VAR_SYS_ALARM</td>
<td>报警标志</td>
</tr>
</tbody>
</table></div>
<p>其他变量地址（如参数区 0x2000 ~ 0x20FF）由 DGUS 工程配置决定，驱动通过 <code>vp_addr_base</code> 偏移访问。</p>
<h2>7. 推送引擎：packer_screen_engine</h2>
<p>在底层协议驱动之上，<code>packer_screen_engine</code> 封装了一个定时推送引擎：</p>
<pre><code class="language-c">typedef struct {
    packer_screen_dgus_t *dgus;
    uint32_t tick_ms;

    /* 周期任务 */
    uint32_t sysinfo_interval_ms;   /* 系统信息推送间隔 */
    uint32_t paramsync_interval_ms; /* 参数同步间隔 */
    uint32_t log_flush_interval_ms; /* 日志刷新间隔 */

    /* 内部定时器 */
    uint32_t last_sysinfo_tick;
    uint32_t last_paramsync_tick;
    uint32_t last_log_tick;
} packer_screen_engine_t;</code></pre>
<p>引擎主循环（通常在 <code>1 ms</code> 或 <code>10 ms</code> 定时器中调用）：</p>
<pre><code class="language-c">void packer_screen_engine_poll(packer_screen_engine_t *eng, uint32_t now_ms)
{
    if (now_ms - eng-&gt;last_sysinfo_tick &gt;= eng-&gt;sysinfo_interval_ms) {
        update_system_info(eng-&gt;dgus);
        eng-&gt;last_sysinfo_tick = now_ms;
    }

    if (now_ms - eng-&gt;last_paramsync_tick &gt;= eng-&gt;paramsync_interval_ms) {
        sync_params(eng-&gt;dgus);
        eng-&gt;last_paramsync_tick = now_ms;
    }

    if (now_ms - eng-&gt;last_log_tick &gt;= eng-&gt;log_flush_interval_ms) {
        flush_log(eng-&gt;dgus);
        eng-&gt;last_log_tick = now_ms;
    }
}</code></pre>
<h2>8. 参数同步机制</h2>
<p>参数同步是引擎中最核心也是最复杂的部分。它将运行时参数表（GENERIC_DEVICE_CONTROLLER 的全局 <code>runtime_params[]</code>）批量写入 DGUS VP 地址。</p>
<p>关键逻辑：</p>
<pre><code class="language-c">static void sync_params(packer_screen_dgus_t *dgus)
{
    for (int i = 0; i &lt; runtime_param_count; i++) {
        runtime_param_t *rp = &amp;runtime_params[i];
        if (!rp-&gt;dirty)
            continue;

        uint32_t val = rp-&gt;value;
        uint16_t words[2];

        /* uint32 拆成两个 DGUS word（大端序） */
        words[0] = (uint16_t)(val &gt;&gt; 16);  /* 高 16 位 */
        words[1] = (uint16_t)(val &amp; 0xFFFF); /* 低 16 位 */

        uint16_t vp_addr = dgus-&gt;vp_addr_base + rp-&gt;vp_offset;
        dgus_build_write_var(dgus, vp_addr, words, 2, dgus-&gt;tx_buf);
        bsp_uart_port_transmit(USART1, dgus-&gt;tx_buf, ...);

        rp-&gt;dirty = false;
    }
}</code></pre>
<p>处理细节：</p>
<ul>
<li><code>dirty</code> 标志由外部业务代码在修改参数时置位，避免无效写入。</li>
<li>单次 <code>write_var</code> 最多写入 64 个字（受 DGUS 协议限制）。</li>
<li>32-bit 参数拆成两个连续的 16-bit word，DGUS 屏在 UI 端组合显示。</li>
<li>写入间隔由 <code>paramsync_interval_ms</code> 控制（通常 50 ~ 200 ms）。</li>
</ul>
<h2>9. 文本输出 API</h2>
<p>调试与状态信息输出是串口屏的常见需求。驱动封装了三级文本 API：</p>
<div class="arcaea-table-wrap" data-bac-table-shell="1"><table>
<thead>
<tr>
<th>函数</th>
<th>行为</th>
</tr>
</thead>
<tbody>
<tr>
<td><code>write_text(col, row, str)</code></td>
<td>在指定行列写入字符串</td>
</tr>
<tr>
<td><code>write_line(line, str)</code></td>
<td>写入整行文本（自动换行）</td>
</tr>
<tr>
<td><code>log_printf(fmt, ...)</code></td>
<td>格式化日志追加到滚动缓冲区</td>
</tr>
</tbody>
</table></div>
<p>三者底层最终都映射到 <code>bsp_uart_port_transmit(USART1, data, len)</code>，但差异在于数据组织方式：</p>
<ul>
<li><code>write_text</code> / <code>write_line</code> 直接操纵 DGUS 的文本显示 VP 区（如 0x3000+ 映射到文本控件）。</li>
<li><code>log_printf</code> 维护一个 FIFO 日志环，通过 <code>flush_log</code> 定时将积压日志写入 DGUS 的日志显示区。</li>
</ul>
<p>注意：文本写入是单向推送（write-only），DGUS 侧不做应答确认——串口屏接收后直接在 UI 刷新。</p>
<h2>10. 配置变更与解码器重置</h2>
<p>DGUS 驱动支持运行时切换 <code>has_crc</code> 标志，但这是一个破坏性操作：CRC 启/禁用会改变帧结构（新增/删除尾部两字节），已部分接收的帧将全部无效。因此配置变更时必须重置解码器：</p>
<pre><code class="language-c">void packer_screen_dgus_reconfig(packer_screen_dgus_t *ctx,
                                  uint32_t baudrate,
                                  uint8_t has_crc)
{
    /* 1. 停止屏幕通信 */
    bsp_uart_port_stop(USART1);

    /* 2. 重置解码器状态机 */
    dgus_decoder_reset(ctx);

    /* 3. 清空 RX FIFO 中的残留字节 */
    bsp_uart_port_flush_rx(USART1);

    /* 4. 更新配置 */
    ctx-&gt;baudrate = baudrate;
    ctx-&gt;has_crc  = has_crc;

    /* 5. 重新初始化 UART（波特率可能改变） */
    bsp_uart_port_init(USART1, ctx-&gt;baudrate);

    /* 6. 发送空 NOP 帧等待屏端就绪 */
    dgus_send_nop(ctx);
}</code></pre>
<p><code>dgus_decoder_reset</code> 只需将状态机置回 <code>DECODER_IDLE</code> 并清空帧计数器：</p>
<pre><code class="language-c">static inline void dgus_decoder_reset(packer_screen_dgus_t *ctx) {
    ctx-&gt;decoder_state = DECODER_IDLE;
    ctx-&gt;frame_cursor = 0;
    ctx-&gt;frame_len = 0;
}</code></pre>
<h2>11. 总结：归档的价值</h2>
<p>虽然 DGUS 驱动在项目中已被 HMIS 协议取代，但它的设计模式在今天仍有参考意义：</p>
<ol>
<li><strong>状态机流解码器</strong>：串口无帧边界，状态机同步 + CRC 校验是通用范式。</li>
<li><strong>实例上下文隔离</strong>：<code>packer_screen_dgus_t</code> 将协议栈所有状态封装在结构体内，天然支持多实例。</li>
<li><strong>分层引擎</strong>：协议驱动（字节级）→ 推送引擎（消息级）→ 业务调用（参数/日志），每一层职责清晰。</li>
<li><strong>批量参数同步</strong>：dirty 标志 + 定时刷新的模式，避免了 N 个独立定时器分别写入的碎片化。</li>
<li><strong>配置变更安全</strong>：重置解码器 + 清空 FIFO 的做法是处理「流协议参数切换」的标准动作。</li>
</ol>
<p>这套代码从最初的原型验证到量产服役历时 2.5 年，经过 4 次重构。归档不代表废弃——对于理解「如何为一个没有标准协议栈的串口设备编写可靠驱动」，它仍是最好的教材。</p>
<hr>
<p class="arcaea-signature"><em>GENERIC_DEVICE_CONTROLLER · 遗留系统归档 · SA3</em></p>
