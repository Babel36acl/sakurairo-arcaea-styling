---
title: "HMI 串口会话协议进化史：从 DGUS 到 HMIS 再到 HMIS-BAM"
description: "V1.1 废弃 DGUS 5A A5，改为 HMI Session Protocol。SEQ 序号匹配、能力位图、参数目录动态发现、日志事件独立推送。"
published: "2026-05-28"
updated: "2026-08-18"
permalink: "/2026/05/28/hmis-session-protocol-replaces-dgus/"
draft: false
categories: ["嵌入式实战","方法与工具"]
tags: ["ARCH"]
legacyId: 542
---

<blockquote>
<p><strong>TL;DR</strong> —— HMI 串口通信从 5A A5 逐变量轮询到 HMIS 会话逻辑帧，再到 HMIS-BAM 20B 分片承载，经历了三次重大演进。本文从架构设计与工程约束出发还原这一演化路径，深入剖析变量地址耦合缺陷、会话机制落地过程，以及分片协议如何解决 20B 固定帧总线限制。</p>
</blockquote>
<h2>一、起点：DGUS 5A A5 变量协议的三座大山</h2>
<p>最早的系统使用基于变量地址（VP）的 HMI 串口协议。MCU 侧维护着两套解析路径——20B 固定帧协议栈和 DGUS 5A A5 可变长度协议栈并行运行在同一路 UART 上，共享同一片串口接收中断上下文，通过报文起始特征（0x5A 0xA5 vs 固定帧地址字节）来区分路由。</p>
<p>该方案在初期阶段尚可运转，但随业务复杂化显现出三个严重的结构性缺陷。</p>
<h3>1. 两套协议栈，三处耦合</h3>
<p>第一，协议解析层和业务逻辑层之间没有清晰的会话边界。DGUS 帧的读写操作直接映射到屏端 VP 地址（如 0x1000 存温度、0x3000 存状态），而 MCU 内各功能模块的参数 ID 与屏端地址之间是一份手动维护的地址映射表。一旦 HMI 界面布局调整了变量存储映射，MCU 固件也必须同步修改，两边的发布窗口必须同时对齐。</p>
<p>第二，日志和事件推送通过 DGUS 0x82 写变量帧来「伪装」成常规变量写入。这意味着屏端必须为日志条目开辟专用的 VP 缓冲区，而 MCU 侧每产生一条日志都要构造一帧完整的 5A A5 帧（包含头、长度、VP 地址、数据体），再由 UART DMA 发送出去。日志内容稍有变化就要修改 VP 映射。</p>
<p>第三，无会话管理。MCU 和 HMI 之间不存在握手或状态同步机制。MCU 上电后就开始向 VP 地址轮询写入初始化参数，HMI 如果尚未完成启动，前几帧数据直接丢失，没有任何重发机制。</p>
<p>关于 DGUS 协议底层的具体实现与历史归档，可参考专文：<a href="/?p=788">SA3｜遗留 DGUS 串口屏驱动：从裸协议到推送引擎的归档解读</a>。</p>
<h3>2. Service 层的轮询包袱</h3>
<p>在 Service 层，packer 模块承担着轮询驱动器的角色。每个周期需要遍历参数 ID 映射表，将固件内部参数逐项打包为 DGUS 0x82 写变量帧发送出去。一条典型的写帧大约 60 字节，在 9600 波特率下传输耗时约 6 ms。如果参数表有 30 项，一轮轮询就需要近 200 ms——而此时其他协议帧只能排队等待同一个 UART 发送缓冲区。</p>
<p>用一句话总结 DGUS 时代的痛点：<strong>变量地址把通信协议和 UI 布局耦合在了一起，而缺少会话层又把所有消息去风险能力压到了物理帧上。</strong></p>
<p>下图展示了从 DGUS 到 HMIS-BAM 的协议栈演进——每一层解决的是什么问题：</p>
<div class="arcaea-mermaid-box"><pre class="mermaid">flowchart TB
    subgraph DGUS_ERA["DGUS 5A A5 Era (V1)"]
        direction TB
        A1["DGUS 0x82/0x83
变量读写帧"] --&gt; A2["VP 地址映射表
MCU ↔ HMI 硬编码"]
        A2 --&gt; A3["逐参数轮询
30 items × 6ms = 180ms"]
        A3 --&gt; A4["无握手 / 无重试
启动竞争丢失"]
    end

    subgraph HMIS_ERA["HMIS Session Protocol Era (V2)"]
        direction TB
        B1["HMIS 会话帧
10B header + payload"] --&gt; B2["SEQ 序号匹配
请求-应答关联"]
        B2 --&gt; B3["HELLO 握手 +
DEVICE_INFO 能力声明"]
        B3 --&gt; B4["控制桥接 0x30-0x37
复用 legacy 20B 指令"]
    end

    subgraph BAM_ERA["HMIS-BAM Fragmentation Era (V3)"]
        direction TB
        C1["HMIS 帧
max 512B"] --&gt; C2["9B 分片切割
ceil(len/9) 片"]
        C2 --&gt; C3["20B 固定帧封装
FUNC=0x7F | TID 绑定"]
        C3 --&gt; C4["位图重组 +
Per-Port 状态隔离 + 重发"]
    end

    A4 -.-&gt;|"耦合无法扩展"| B1
    B4 -.-&gt;|"帧超长 140B &gt; 20B"| C1

    style DGUS_ERA fill:#1a1a2e,stroke:#9db4ff,stroke-width:1px,color:#e4ecf8
    style HMIS_ERA fill:#1a1a2e,stroke:#8ad8ff,stroke-width:1px,color:#e4ecf8
    style BAM_ERA fill:#1a1a2e,stroke:#c7b6ff,stroke-width:1px,color:#e4ecf8</pre></div>
<h2>二、HMIS 会话协议：给串口装上「请求 - 应答」</h2>
<p>DGUS 的经验告诉我们，解决耦合问题的最好方法不是继续加固轮询框架，而是重新定义协议的抽象层级。HMIS（HMI Session）协议的设计目标很明确：把无连接的变量读写改成有状态的会话帧交换。</p>
<h3>1. 帧格式</h3>
<p>HMIS 帧抛弃了 5A A5 的起始符—长度—VP 三段式，改用固定头部 + 可变载荷的格式：</p>
<div class="arcaea-table-wrap" data-bac-table-shell="1"><table>
<thead>
<tr>
<th>偏移</th>
<th>字段</th>
<th>长度</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>0-1</td>
<td>SOF</td>
<td>2B</td>
<td>帧起始符 <code>0x55AA</code></td>
</tr>
<tr>
<td>2</td>
<td>VER</td>
<td>1B</td>
<td>协议版本号</td>
</tr>
<tr>
<td>3</td>
<td>TYPE</td>
<td>1B</td>
<td>帧类型（Request / Response / Event / Log / Heartbeat）</td>
</tr>
<tr>
<td>4-5</td>
<td>SEQ</td>
<td>2B</td>
<td>序列号，用于请求 - 应答匹配</td>
</tr>
<tr>
<td>6</td>
<td>CMD</td>
<td>1B</td>
<td>命令字</td>
</tr>
<tr>
<td>7</td>
<td>FLAGS</td>
<td>1B</td>
<td>标志位</td>
</tr>
<tr>
<td>8-9</td>
<td>LEN</td>
<td>2B</td>
<td>载荷长度</td>
</tr>
<tr>
<td>10..</td>
<td>PAYLOAD</td>
<td>N</td>
<td>有效数据（最大 512B）</td>
</tr>
<tr>
<td>-2..-1</td>
<td>CRC16</td>
<td>2B</td>
<td>校验，Modbus 多项式 0xA001</td>
</tr>
</tbody>
</table></div>
<p>帧头部固定 10 字节，加上 2 字节 CRC，实际协议开销 12 字节。相比于 DGUS 每次写变量都必须携带完整的 VP 地址（2B）+ 长度（2B）+ 数据体，HMIS 的头部开销在短报文场景下有一定增加，但它换来了类型区分、序号匹配、版本协商三个关键能力。</p>
<h3>2. 能力声明与版本协商</h3>
<p>HMIS 最重要的一项新增是能力声明机制。MCU 和 HMI 建立通信后首先交换 <code>DEVICE_INFO</code> 帧，双方各返回一个 16 位的功能位图，告知对方支持哪些命令类别和特性。握手阶段的流程大致如下：</p>
<pre><code class="language-c">HMI → MCU: DEVICE_INFO_REQUEST (SEQ=1)
MCU → HMI: DEVICE_INFO_RESPONSE (SEQ=1, capabilities=0x03FF)
HMI → MCU: HELLO (ack=1, ver_major=2, ver_minor=0)
MCU → HMI: HELLO_ACK (status=OK)
// 从此进入 IDLE 状态，可以正常交互</code></pre>
<p>这套握手取代了 DGUS 时代「谁先发谁就赢」的上电竞争，从根本上解决了启动时序问题。如果 HMI 尚未就绪，MCU 简单地不响应 DEVICE_INFO，HMI 端超时重试即可。</p>
<h3>3. 25 个命令的三层分类</h3>
<p>HMIS 将 25 个命令字分为三个功能域：</p>
<p><strong>Session 层（0x01 – 0x03）：</strong> 包括 HELLO、HELLO_ACK、DEVICE_INFO。这些命令只在连接建立阶段出现，用于握手和版本协商。</p>
<p><strong>参数访问（0x10 – 0x16）：</strong> 参数读/写/查询等操作。关键约束是参数修改只在 IDLE 状态下允许——握手完成前和脱机状态下都拒绝写入。这比 DGUS 的「任何时刻都可以写 VP」更安全。</p>
<p><strong>控制桥接（0x30 – 0x37）：</strong> 这组命令是将传入的参数包下发给原有的 20B 固定协议处理器。这种 Bridge Pattern 让 HMIS 协议可以复用已有的上百条控制指令，无需为会话协议重写一遍业务逻辑。</p>
<pre><code class="language-c">// 控制桥接的伪逻辑示意
case CMD_BRIDGE_20B:
    // 从 HMIS 帧载荷中提取 20B 帧内容
    memcpy(&amp;twenty_byte_frame, payload, 20);
    // 交给原有的 20B 协议处理函数
    legacy_20b_handler(&amp;twenty_byte_frame);
    // 将处理结果封装为 HMIS Response 帧返回
    build_hmis_response(SEQ, bridge_result);
    break;</code></pre>
<p><strong>订阅推送（0x22 – 0x23）与事件（0x40 – 0x42）：</strong> 日志和事件不再通过 DGUS 0x82 错乱写入，而是使用 HMIS 自身的事件帧类型推送。HMI 端可以按需选择订阅哪些类别，MCU 侧则使用限流策略——每个 task_once 周期最多推送 1 条日志，避免日志风暴阻塞正常协议交互。</p>
<h2>三、HMIS-BAM：给 HMIS 穿上 20B 的「小鞋子」</h2>
<p>HMIS 会话协议解决了业务层面的问题，但引入了一个新矛盾：HMIS 帧最大载荷 512 字节，加上 10 字节头部和 2 字节 CRC，完整帧最长可达 524 字节。而系统的物理串口帧是固定 20 字节——这是由长年积累的 20B 协议生态决定的。PLC、上位机、传感器等所有串口设备都工作在 20B 固定帧总线上，不允许引入第二种可变长度帧格式。</p>
<p>解决思路很直接：<strong>把 HMIS 的长帧切成 9 字节一块的小片，塞进 20B 帧的数据域里，在对端重组。</strong> 这就是 HMIS-BAM（Bulk Aggregation Multiplex）层的由来。</p>
<h3>1. 20B BAM V3 帧格式</h3>
<p>BAM V3 帧复用了系统的 20B 固定帧的物理封装（地址 + 功能码 + 16 字节数据 + CRC16），指定保留功能码 <code>0x7F</code> 作为 BAM 的协议标识。数据域的 16 字节被重新解释为分片头部（包含 4B TID）和载荷：</p>
<div class="arcaea-table-wrap" data-bac-table-shell="1"><table>
<thead>
<tr>
<th>偏移</th>
<th>字段</th>
<th>长度</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>0</td>
<td>ADDR</td>
<td>1B</td>
<td>20B 帧的地址字段（不变）</td>
</tr>
<tr>
<td>1</td>
<td>FUNC</td>
<td>1B</td>
<td><code>0x7F</code> = HMIS-BAM</td>
</tr>
<tr>
<td>2..5</td>
<td>TID</td>
<td>4B</td>
<td>Transaction ID，事务标识（小端）</td>
</tr>
<tr>
<td>6</td>
<td>FRAG_INDEX</td>
<td>1B</td>
<td>分片序号（0xFE=ACK, 0xFF=NACK）</td>
</tr>
<tr>
<td>7</td>
<td>FRAG_COUNT</td>
<td>1B</td>
<td>总分片数</td>
</tr>
<tr>
<td>8</td>
<td>FRAG_LEN</td>
<td>1B</td>
<td>本片有效载荷字节数（最大 9）</td>
</tr>
<tr>
<td>9..17</td>
<td>PAYLOAD</td>
<td>9B</td>
<td>HMIS 帧的分片数据</td>
</tr>
<tr>
<td>18–19</td>
<td>CRC16</td>
<td>2B</td>
<td>Modbus CRC16（覆盖偏移 0–17）</td>
</tr>
</tbody>
</table></div>
<p>关键常量：</p>
<pre><code class="language-c">// 来自 packer_hmis_bam.h
#define PACKER_HMIS_BAM_FUNC               ((uint8_t)0x7FU)
#define PACKER_HMIS_BAM_FRAGMENT_PAYLOAD_SIZE ((uint8_t)9U)
#define PACKER_HMIS_BAM_MAX_PAYLOAD_SIZE    ((uint16_t)512U)
#define PACKER_HMIS_BAM_MAX_RETRY_COUNT     ((uint8_t)3U)
#define PACKER_HMIS_BAM_MAX_FRAG_COUNT      ((uint8_t)57U)  // ceil(512 / 9)</code></pre>
<p>一个典型的 140 字节 HMIS 帧在 V3 下会被切为 16 个分片（前 15 片各 9 字节 + 最后一片 5 字节），依次以 20B 固定帧发送。物理线路上看见的始终是 20 字节一个包，与系统中的任何其他 20B 协议帧没有区别。</p>
<p>下图展示了 HMIS 帧经过 BAM 层分片、20B 固定帧承载、接收端重组和 ACK 确认的完整生命周期：</p>
<div class="arcaea-mermaid-box"><pre class="mermaid">sequenceDiagram
    participant TX as HMIS-BAM 发送端
    participant BUS as 20B 固定帧总线
    participant RX as HMIS-BAM 接收端
    participant APP as 应用层 (HMIS Session)

    TX-&gt;&gt;TX: 140B HMIS 帧写入 s_bam_payload
    TX-&gt;&gt;TX: 计算 frag_count = ceil(140/9) = 16
    loop 每一片 (Stop-and-Wait)
        TX-&gt;&gt;BUS: 发送当前分片
        BUS--&gt;&gt;TX: 等待 ACK (0xFE) 确认后推进下一片
    end
    TX-&gt;&gt;TX: 发送完成重置发送状态

    RX-&gt;&gt;RX: 校验并累积所有分片
    RX-&gt;&gt;BUS: 最后一包完成重组回复 ACK OK
    RX-&gt;&gt;APP: 只读 peek 数据包
    APP-&gt;&gt;RX: 释放接收区缓存 release_completed</pre></div>
<h3>2. 从单缓冲并发冲突到 Per-Port 状态隔离</h3>
<p>在 BAM V1/V2 早期开发中，系统为模块只分配了一个 512 字节的静态缓冲区 <code>s_bam_payload[512]</code>，以及单实例接收状态 <code>s_rx</code> 与发送状态 <code>s_tx</code>。该设计在双任务（CommTask 操作 USART1，ProtoTask 操作 USART3）同时访问时，引发了系统性的时序冲突：由于状态和缓冲区被两路串口任务并发覆盖，大包传输（如拉取 190B 目录数据）在面临任务切换时必定会被另一个串口的 <code>accept_frame</code> 判定冲突并强行中断，表现为大包 100% 超时损坏。</p>
<p>在最新落地的 **BAM V3** 版本中，固件对这一缺陷进行了重构，通过 <code>bsp_uart_port_t</code> 端口索引将缓冲及状态隔离为数组空间，实现了<strong>无锁并发的物理端口状态隔离</strong>：</p>
<pre><code class="language-c">#define BAM_PORT_COUNT 2
static uint8_t s_bam_payload[BAM_PORT_COUNT][512];
static bam_rx_state_t s_rx[BAM_PORT_COUNT];
static bam_tx_state_t s_tx[BAM_PORT_COUNT];

static inline uint8_t bam_port_idx(bsp_uart_port_t port) {
    return (port == BSP_UART_PORT_PACKER) ? 1U : 0U;
}</code></pre>
<p>重构后的双端口在并发运行时完全隔离，不再由于共享状态引发重入超时故障。针对并发冲突的完整诊断和重构历程，请参见专文复盘：<a href="/?p=1275">HMIS-BAM V3 分片传输协议设计与并发 Bug 诊治复盘</a>。</p>
<h2>四、一些工程反思与总结</h2>
<p>回看整个演进过程，以下是关键的设计取舍与反思：</p>
<ol>
<li><strong>功能码复用</strong>：BAM 选择 <code>0x7F</code> 作为唯一功能码封装大包分片，省去了在 20B 数据帧内另外拆分标志位的复杂性，一次过滤即可判定。</li>
<li><strong>分层校验合一</strong>：BAM 帧去除了多余的内部校验，完全信赖底层 20B 帧提供的 CRC16（Modbus 多项式 0xA001），降低了 CPU 编解码负担和物理带宽损耗。</li>
<li><strong>隔离优于互斥锁</strong>：在多串口、多任务并发的工控 RTOS 中，为资源引入 Port 数组进行物理隔离，其可靠性和零锁开销远胜于依赖 FreeRTOS Mutex，彻底消除了优先级反转的风险。</li>
</ol>
<p>从 DGUS 5A A5 的逐变量轮询，到 HMIS 的会话化改造，再到 HMIS-BAM 的 20B 状态隔离分片，每一步演进都对应着明确的工程约束和取舍。没有万能协议，只有最匹配当前总线宽度、内存预算和业务耦合度的方案。</p>
