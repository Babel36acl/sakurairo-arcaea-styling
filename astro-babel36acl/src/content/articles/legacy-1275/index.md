---
title: "HMIS-BAM V3 分片传输协议设计与并发 Bug 诊治复盘"
description: "本文拆解了在 20 字节固定串口协议通道上，通过设计 HMIS-BAM V3 分片传输协议（Window = 1，Stop-and-Wait ACK/NACK，32 位 TID）解决大报文传输难题的实践。同时深度复"
published: "2026-06-09"
updated: "2026-08-18"
permalink: "/2026/06/09/hmis-bam-v3-protocol-design-and-concurrency-bug-postmortem-2/"
draft: false
categories: ["嵌入式实战","工程复盘","架构与重构"]
tags: []
legacyId: 1275
---

<p><strong>TL;DR：</strong>本文拆解了在 20 字节固定串口协议通道上，通过设计 HMIS-BAM V3 分片传输协议（Window = 1，Stop-and-Wait ACK/NACK，32 位 TID）解决大报文传输难题的实践。同时深度复盘了因 <code>CommTask</code> 与 <code>ProtoTask</code> 双任务并发操作全局单实例 BAM 状态机导致的系统性超时 Bug 诊断过程，并给出了 Per-Port 状态隔离 of 重构方案。</p>
<blockquote>
<p><strong>系列阅读说明</strong>：本文是包装机项目通信协议演进系列的最后一篇，聚焦于 HMIS-BAM V3 协议的具体落地及并发时序冲突诊断。若要全面了解协议的来龙去脉与历史架构演进，请参阅前置文章：<br>
        1. 历史变量屏归档：<a href="/?p=788">SA3｜遗留 DGUS 串口屏驱动：从裸协议到推送引擎的归档解读</a><br>
        2. 协议架构演化：<a href="/?p=542">HMI 串口会话协议进化史：从 DGUS 到 HMIS 再到 HMIS-BAM</a></p>
</blockquote>
<h2>一、背景：为什么需要大报文分片传输协议？</h2>
<p>在 STM32 包装机项目联调中，我们遭遇了一个诡异的通信故障：握手命令（1 分片）与设备信息查询（3 分片）100% 成功，但一旦拉取 190 字节的参数目录（16 分片），系统便陷入无限超时，最终导致上位机断连重启。日志推送与水位监控全盘瘫痪。</p>
<p>包装机在物理控制流程（如出袋、投料、压口、封口、复位）以及高频状态轮询上极为依赖实时性表现。对外 RS485 链路沿用了 20 字节固定物理帧协议（数据功能码范围 0x40 ~ 0x4C）。这套协议在控制物理流程上极为高效。</p>
<p>然而，随着人机界面（Flutter HMI 上位机）的接入，系统对大数据量传输的需求呈爆发式增长：</p>
<ul>
<li><strong>参数目录同步</strong>：上位机启动时需要从固件拉取完整的参数元数据（包括参数名、范围、单位、分组等），数据量达数百至上千字节。</li>
<li><strong>大容量参数读写</strong>：需要支持几十个参数值的批量读取与设置。</li>
<li><strong>实时日志与诊断推送</strong>：固件实时产生的调试信息与诊断文本往往在几十到上百字节之间。</li>
</ul>
<p>如果直接扩充物理帧的长度，不仅需要推翻所有现行成熟的主控系统链路，更会破坏串口在半双工 RS485 总线下的实时响应表现。因此，一个「运行在 20 字节固定帧之上，负责大报文拆包、分片发送、接收重组与差错控制」的轻量传输协议势在必行，这就是 HMIS-BAM（HMI Session Block Acknowledgement Mode）协议的诞生背景。</p>
<h2>二、系统总体架构与四层协议栈模型</h2>
<p>为了让控制逻辑、通信协议与底层驱动完全解耦，项目采用了严格的三层架构。其中，大报文分片传输协议属于 Service 层。整个通信系统的协议栈模型可分为以下四层：</p>
<div class="arcaea-table-wrap" data-bac-table-shell="1"><table>
<thead>
<tr>
<th>层级</th>
<th>协议实体</th>
<th>数据格式与流向</th>
<th>层级职责</th>
</tr>
</thead>
<tbody>
<tr>
<td><strong>1. HMI 业务层</strong></td>
<td>参数管理、日志服务、快捷控制</td>
<td>高级业务结构体 / 类对象</td>
<td>在 APP 任务上下文执行，不直接接触串口</td>
</tr>
<tr>
<td><strong>2. HMI Session 层</strong></td>
<td>逻辑会话帧</td>
<td>0x55 0xAA | VER | TYPE | SEQ | CMD | LEN | PAYLOAD | CRC16 (多达 512B / 1024B)</td>
<td>规定了请求-响应、主动推送、心跳及订阅语义，不直接操作串口</td>
</tr>
<tr>
<td><strong>3. BAM 分片层</strong></td>
<td>HMIS-BAM V3</td>
<td>FUNC = 0x7F | TID[4] | FRAG_INDEX[1] | FRAG_COUNT[1] | FRAG_LEN[1] | PAYLOAD[9] (固定 20B 载荷)</td>
<td>将大 Session 逻辑帧拆成 9 B 载荷小包分片收发，逐片 Stop-and-Wait ACK，防 ID 回绕</td>
</tr>
<tr>
<td><strong>4. 物理承载层</strong></td>
<td>20B 固定帧层 / UART 硬件</td>
<td>ADDR[1] | FUNC[1] | DATA[16] | CRC16[2] (总长 20 字节)</td>
<td>底层的物理收发层。USART1 (RS232) 与 USART3 (RS485) 均工作在 9600 bps 8N1 下</td>
</tr>
</tbody>
</table></div>
<blockquote data-bac-callout="note"><p class="bac-callout-title">说明</p><p>
        <strong>职责分离原则</strong>：上位机运行 HMI Session 协议，而物理串口 USART1 和 USART3 只负责收发 20 字节固定帧。当收到 FUNC = 0x7F 的 BAM 分片时，交由 Service 层的 BAM 模块进行重组，重组完后才暴露出一个完整的逻辑会话帧给 APP 层的 Session 解析引擎，彻底隐藏了串口分片的琐碎细节。
    </p></blockquote>
<h2>三、HMIS-BAM V3 协议规范设计</h2>
<p>HMIS-BAM 目前已升级至非兼容的 V3 版本。为了在只有 16 字节 DATA数据域的 20B 串口物理帧中工作，BAM V3 进行了极其紧凑的头部编排，单片最多容纳 9 字节有效载荷。</p>
<h3>1. 20B 数据分片帧格式</h3>
<div class="arcaea-table-wrap" data-bac-table-shell="1"><table>
<thead>
<tr>
<th>偏移 (Byte)</th>
<th>字段名</th>
<th>长度</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>0</td>
<td>ADDR</td>
<td>1B</td>
<td>目标节点地址，默认 0xFA</td>
</tr>
<tr>
<td>1</td>
<td>FUNC</td>
<td>1B</td>
<td>功能码，固定为 0x7F</td>
</tr>
<tr>
<td>2..5</td>
<td>TID</td>
<td>4B</td>
<td>Transaction ID（事务标识），小端格式。0 为非法。用于标识一次完整的大包收发事务</td>
</tr>
<tr>
<td>6</td>
<td>FRAG_INDEX</td>
<td>1B</td>
<td>分片序号，首片必须为 0。0xFE 为 ACK，0xFF 为 NACK</td>
</tr>
<tr>
<td>7</td>
<td>FRAG_COUNT</td>
<td>1B</td>
<td>当前事务的总分片数</td>
</tr>
<tr>
<td>8</td>
<td>FRAG_LEN</td>
<td>1B</td>
<td>当前分片的有效数据长度（最大为 9）</td>
</tr>
<tr>
<td>9..17</td>
<td>PAYLOAD</td>
<td>9B</td>
<td>HMI Session 逻辑帧片段，不足时补 0</td>
</tr>
<tr>
<td>18..19</td>
<td>CRC16</td>
<td>2B</td>
<td>CRC16-Modbus 校验，低字节在前</td>
</tr>
</tbody>
</table></div>
<h3>2. 控制帧格式（ACK 与 NACK）</h3>
<p>为了保证传输的稳定性，BAM V3 使用 Stop-and-Wait（停等）确认模式，滑动窗口（Window）固定为 1。发送方发完一片后必须等待接收方的 ACK 帧才可发送下一片。控制帧的 <code>FRAG_INDEX</code> 字段会被设为 <code>0xFE</code> (ACK) 或 <code>0xFF</code> (NACK)，且 <code>PAYLOAD</code> 规定如下：</p>
<ul>
<li><strong>PAYLOAD[0]</strong>：被确认或拒绝的分片序号（FRAG_INDEX）。</li>
<li><strong>PAYLOAD[1]</strong>：状态码（Status Code）。</li>
<li><strong>PAYLOAD[2]</strong>：下一片期望序号（NEXT_EXPECTED_INDEX）。</li>
</ul>
<h3>3. 核心传输状态机与重传规则</h3>
<p>BAM 的运行语义极其严密。首片必须为 <code>FRAG_INDEX = 0</code>；非最后片的 <code>FRAG_LEN</code> 必须等于 <code>9</code>；最后一片长度为 <code>1..9</code>。重传与超时规则如下：</p>
<ul>
<li>发送方发出分片后启动定时器，如果在 1500 ms 内未收到对应的 ACK (ACCEPTED / OK)，触发超时重发。</li>
<li>接收方校验 CRC16。若 CRC 错误则直接丢弃，不予回复。</li>
<li>如果接收到的分片序号不等于期望的 <code>next_expected</code>，接收方回复 NACK，携带对应的状态码与下一期望序号。</li>
<li>同一事务最多允许重试 3 次，超过限制则废弃该事务，向上层报告传输失败。</li>
</ul>
<h2>四、并发冲突诊断：单实例 BAM 状态机的严重缺陷</h2>
<p>在对包装机固件进行重构和压力测试时，我们遇到了一个诡异的问题：HMI 握手和设备基本参数读取（大小在 1 ~ 3 分片内）全部正常；但是，一旦读取参数目录（GET_GROUP_LIST，长度约 190 字节，16 分片）就会频繁发生超时重试，并最终导致 HMI 断连重启，而此时日志推送和栈水位推送全部失效。</p>
<h3>1. 时序竞争分析</h3>
<p>经过抓包和深入静态代码审计，我们发现了核心根因。早期的 BAM 模块在 <code>packer_hmis_bam.c</code> 中只实现了一组全局静态状态实例：</p>
<pre><code class="language-c">static uint8_t s_bam_payload[512];     // 全局共享的 payload 缓冲区
static bam_rx_state_t s_rx;            // 全局共享的接收状态
static bam_tx_state_t s_tx;            // 全局共享的发送状态</code></pre>
<p>然而，包装机系统为了保证不同的职责，分配了两个独立的 FreeRTOS 任务使用不同的物理串口并行处理通信：</p>
<ul>
<li><strong>CommTask</strong>：运行在 <code>USART1 (RS232)</code> 链路上，负责 HMI 的长报文会话、日志推送和监控。</li>
<li><strong>ProtoTask</strong>：运行在 <code>USART3 (RS485)</code> 链路上，处理正式主控命令，但也兼容处理 <code>FUNC = 0x7F</code> 的 BAM 逻辑。</li>
</ul>
<p>虽然 FreeRTOS 在单核 MCU 上是时间片轮转的，但由于任务切换的不可控性，两个任务会在后台并发且交错地调用 BAM 模块的代码。问题时序如下：</p>
<blockquote data-bac-callout="important"><p class="bac-callout-title">重要</p><p>
        <strong>BAM 全局单实例状态损坏时序</strong><br>
        1. HMI 通过 <strong>CommTask (USART1)</strong> 请求 190 字节的参数目录。BAM 接收成功，<code>s_rx.complete = 1</code>，<code>s_rx.active = 0</code>。<br>
        2. CommTask 解析出请求并生成 190 字节响应，调用 <code>submit_tx_frame(SCREEN)</code> 准备发送，此时设置全局状态 <code>s_tx.active = 1</code>。<br>
        3. CommTask 串行发送第 0 片数据并等待其 ACK。就在此时，系统发生 Tick 中断，切换至优先级相同的 <strong>ProtoTask</strong>。<br>
        4. ProtoTask 恰好扫描到 <strong>USART3</strong> 上的空闲或小流量数据，调用了 <code>accept_frame(PACKER)</code>，由于共享同一个全局状态，此时直接将全局 <code>s_rx.active</code> 改写为了 1。<br>
        5. 时间片切回 CommTask。当 CommTask 收到 HMI 对第 0 片回复的 ACK 控制帧时，调用内部函数 <code>submit_tx_frame</code> 时检查全局 <code>s_rx.active</code>，发现其值竟然为 1（表明另一个端口的接收活跃）！<br>
        6. 基于物理总线避免双向冲突的原则，BAM 直接拒绝了发送，TX 事务异常退出。<br>
        7. MCU 从此静默，HMI 无法收到后续分片，并在等待 3 秒后超时，判定链路损坏，发起重连。
    </p></blockquote>
<h3>2. 「长包必死，短包偶过」的竞态解析</h3>
<p>这也合理解释了为什么短数据帧不易出问题。1 片的传输窗口非常短（约几毫秒），在此期间被另一个任务调度打断并污染全局状态的概率极低。而 16 片长帧的完整收发时延高达 300 ms 以上，在这期间发生任务调度竞争的概率高出数倍，几乎 100% 会被打断，造成通信通道系统性瘫痪。</p>
<h2>五、彻底重构：Per-Port BAM 状态的数组隔离设计</h2>
<p>解决这套并发冲突的核心策略是<strong>物理端口级（Per-Port）的资源与状态完全隔离</strong>。让 CommTask 和 ProtoTask 各自操作独立的内存槽位，互不干扰。</p>
<h3>1. 引入 Port 数组与内存索引映射</h3>
<p>我们首先定义最大支持的 BAM 端口数为 2，并将共享 payload 缓冲区、RX 状态 and TX 状态全部数组化，存放在 BSS 段中以免侵占原本就紧张的系统堆栈：</p>
<pre><code class="language-c">#define BAM_PORT_COUNT ((uint8_t)2U)

/* ── Per-port 静态存储（BSS 段，不占任务栈） ── */
static uint8_t s_bam_payload[BAM_PORT_COUNT][PACKER_HMIS_BAM_MAX_PAYLOAD_SIZE];
static bam_rx_state_t s_rx[BAM_PORT_COUNT];
static bam_tx_state_t s_tx[BAM_PORT_COUNT];
static uint32_t s_next_tid = 1UL;

/**
 * @brief 串口硬件端口 → 数组下标映射。
 * SCREEN (USART1) -&gt; 0, PACKER (USART3) -&gt; 1
 */
static uint8_t bam_port_idx(bsp_uart_port_t port)
{
    return (port == BSP_UART_PORT_PACKER) ? 1U : 0U;
}</code></pre>
<h3>2. BAM 接收数据分片的独立确认逻辑</h3>
<p>在接收解析函数中，我们根据端口映射出对应的数组槽位 <code>idx</code>，使得不同的 UART 逻辑帧各归其位：</p>
<pre><code class="language-c">packer_hmis_bam_rx_result_t packer_hmis_bam_accept_frame(
    bsp_uart_port_t port, const packer_serial_frame_t *frame)
{
    if ((frame == NULL) || (frame-&gt;func != PACKER_HMIS_BAM_FUNC)) {
        return PACKER_HMIS_BAM_RX_IGNORED;
    }

    uint8_t idx = bam_port_idx(port);
    uint32_t tid = bam_get_u32_le(&amp;frame-&gt;data.raw[BAM_FIELD_TID_OFFSET]);
    uint8_t frag_index = frame-&gt;data.raw[BAM_FIELD_FRAG_INDEX_OFFSET];
    uint8_t frag_count = frame-&gt;data.raw[BAM_FIELD_FRAG_COUNT_OFFSET];
    uint8_t frag_len = frame-&gt;data.raw[BAM_FIELD_FRAG_LEN_OFFSET];

    // 校验是否为控制帧
    if (frag_index == PACKER_HMIS_BAM_FRAG_INDEX_ACK || 
        frag_index == PACKER_HMIS_BAM_FRAG_INDEX_NACK) {
        bam_handle_control(idx, frame);
        return PACKER_HMIS_BAM_RX_CONTROL;
    }

    // 基础校验
    if (bam_rx_header_valid(frag_count, frag_index, frag_len) == 0U || tid == 0UL) {
        (void)bam_send_nack(port, frame-&gt;addr, tid, frag_index, PACKER_HMIS_BAM_CTRL_BAD_FRAGMENT, 0U);
        return PACKER_HMIS_BAM_RX_REJECTED;
    }

    // 处理冲突：如果有正在接收的其它 TID 事务
    if (s_rx[idx].active &amp;&amp; (s_rx[idx].tid != tid)) {
        (void)bam_send_nack(port, frame-&gt;addr, tid, frag_index, PACKER_HMIS_BAM_CTRL_BUSY, 0U);
        return PACKER_HMIS_BAM_RX_REJECTED;
    }

    // 首次接收初始化
    if (s_rx[idx].active == 0U) {
        if (frag_index != 0U) {
            (void)bam_send_nack(port, frame-&gt;addr, tid, frag_index, PACKER_HMIS_BAM_CTRL_OUT_OF_ORDER, 0U);
            return PACKER_HMIS_BAM_RX_REJECTED;
        }
        bam_rx_reset(idx);
        s_rx[idx].active = 1U;
        s_rx[idx].tid = tid;
        s_rx[idx].port = port;
        s_rx[idx].addr = frame-&gt;addr;
        s_rx[idx].frag_count = frag_count;
    }

    // 保存分片数据
    uint16_t offset = (uint16_t)frag_index * (uint16_t)PACKER_HMIS_BAM_FRAGMENT_PAYLOAD_SIZE;
    if ((offset + frag_len) &gt; PACKER_HMIS_BAM_MAX_PAYLOAD_SIZE) {
        (void)bam_send_nack(port, frame-&gt;addr, tid, frag_index, PACKER_HMIS_BAM_CTRL_QUEUE_FULL, 0U);
        bam_rx_reset(idx);
        return PACKER_HMIS_BAM_RX_REJECTED;
    }

    if (bam_bit_is_set(idx, frag_index) == 0U) {
        (void)memcpy(&amp;s_bam_payload[idx][offset], &amp;frame-&gt;data.raw[BAM_FIELD_PAYLOAD_OFFSET], frag_len);
        bam_bit_set(idx, frag_index);
        s_rx[idx].received_count++;
        s_rx[idx].total_len = (uint16_t)(s_rx[idx].total_len + frag_len);
    }
    s_rx[idx].last_tick = xTaskGetTickCount();

    // 检查是否全部收齐
    if (s_rx[idx].received_count == s_rx[idx].frag_count) {
        s_rx[idx].complete = 1U;
        s_rx[idx].active = 0U; // 接收完成，释活
        (void)bam_send_ack(idx, frag_index, PACKER_HMIS_BAM_CTRL_OK, (uint8_t)(frag_index + 1U));
        return PACKER_HMIS_BAM_RX_COMPLETE;
    }

    s_rx[idx].next_expected = (uint8_t)(frag_index + 1U);
    (void)bam_send_ack(idx, frag_index, PACKER_HMIS_BAM_CTRL_ACCEPTED, s_rx[idx].next_expected);
    return PACKER_HMIS_BAM_RX_ACCEPTED;
}</code></pre>
<h3>3. 重构后的收益与测试表现</h3>
<p>经过数组隔离重构，固件虽然在 BSS 段上微增了 552 字节内存占用，但换来了显著的系统稳定性提升：</p>
<ul>
<li><strong>彻底解决通道干扰</strong>：USART1 与 USART3 相互彻底隔离。SCREEN 接口在拉取 190 字节大目录包时，即使 USART3 瞬间爆发出数十个主协议状态包，其发送事务也完全不受影响。</li>
<li><strong>解决大包接收瓶颈</strong>：GET_GROUP_LIST 等长报文传输的重发概率降低为 0，彻底根治了上位机的异常重连。</li>
<li><strong>宿主单元测试验证</strong>：新增了针对端口并发独立性（<code>test_concurrent_ports_independent</code>）与长报文拼装（<code>test_tx_190_byte_response</code>）的 27 个本地宿主测试，全面封锁退化可能。</li>
</ul>
<h2>六、工程反思与总结</h2>
<p>通过设计和迭代包装机的整个 HMIS-BAM 分片传输协议，我们总结出以下关键的嵌入式开发经验：</p>
<ol>
<li><strong>RTOS 协作不等于绝对安全</strong>：FreeRTOS 单核系统的任务调度是基于 Tick 中断或事件阻塞随时可能发生的。只要函数非重入且操作全局静态变量，在没有互斥锁保护的情况下进行长时间跨串口通信，就是埋下时序炸弹。</li>
<li><strong>「长包必死，短包偶过」是经典竞态特征</strong>：如果看到短帧百分百通过，长帧必然超时卡死，不要在逻辑层面修改边际参数，而要立刻审视底层物理接收与内存缓冲的并发冲突。</li>
<li><strong>隔离优于互斥锁</strong>：对于资源敏感且对响应速度有要求的工控通信，使用「按通道隔离数组索引」的性能与稳定性远高于引入 FreeRTOS Mutex。这不仅规避了优先级反转，还从根本上做到了无锁并发，实现了真正的零开销时序解耦。</li>
</ol>
