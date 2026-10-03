---
title: "看门狗双层策略：IWDG + 通信看门狗组合"
description: "IWDG 保证死机后能重启。通信看门狗保证没死但聋了时能报警。两层互补覆盖嵌入式设备最常见的两类无声故障。"
published: "2026-05-28"
updated: "2026-08-18"
permalink: "/2026/05/28/iwdg-comm-watchdog-combo-strategy/"
draft: false
categories: ["嵌入式实战","方法与工具"]
tags: []
legacyId: 535
---

<div class="arcaea-wrap">
<p><span class="tag">嵌入式实战</span> <span class="tag">可靠性设计</span></p>
<p>一个常见问题：<strong>MCU 在跑、FreeRTOS 在调度、但通信已经断了</strong>。设备没有死机，但不响应任何命令。IWDG 不会触发（主循环还在喂狗），操作员以为设备坏了。</p>
<p>这就是双层看门狗的必要性：一层保 MCU 不死，一层保通信不断。</p>
<h2>第一层：IWDG（硬件独立看门狗）</h2>
<p>STM32F103 内置独立看门狗，使用独立的 40kHz LSI 时钟，即使主时钟失效也能触发复位。</p>
<pre><code class="language-c">// 初始化：4 秒超时
void MX_IWDG_Init(void) {
    IWDG-&gt;KR = 0x5555;       // 解锁写保护
    IWDG-&gt;PR = IWDG_PRESCALER_64;  // 64 分频
    IWDG-&gt;RLR = 2500;        // 重装载: 4 秒 (64*2500/40kHz)
    IWDG-&gt;KR = 0xCCCC;       // 启动
}

// Service 层包装，APP 层通过此接口喂狗
void packer_watchdog_kick(void) {
    IWDG-&gt;KR = 0xAAAA;       // 喂狗
}</code></pre>
<p>喂狗位置：MonitorTask 每 500ms 周期喂一次。如果 MonitorTask 卡死（被高优先级任务饿死、死锁等），IWDG 在 4 秒后触发 MCU 复位。</p>
<h2>第二层：通信看门狗（软件）</h2>
<p>IWDG 只能检测 MCU 级故障——程序完全卡死或跑飞。它检测不到"程序正常运转但通信链路断开"的情况。</p>
<pre><code class="language-c">// MonitorTask 每 500ms 检查一次
void monitor_comm_watchdog(void) {
    uint32_t now = xTaskGetTickCount();
    uint32_t last_rx = packer_serial_frame_get_last_rx_tick();

    if ((now - last_rx) &gt; APP_CFG_COMM_WATCHDOG_TIMEOUT_MS) {
        // 通信超时 → 锁存报警，但不复位 MCU
        packer_fault_latch_set(APP_ALARM_COMM_TIMEOUT);
    }
}</code></pre>
<p>通信看门狗的参数通过运行时配置管理：</p>
<pre><code class="language-c">// app_runtime_config_defaults.h
#define RCFG_DEFAULT_COMM_WATCHDOG_TIMEOUT_MS  5000u  // 5 秒</code></pre>
<h2>层级对比</h2>
<div class="arcaea-table-wrap" data-bac-table-shell="1"><table>
<tr>
<th>维度</th>
<th>IWDG（硬件）</th>
<th>通信看门狗（软件）</th>
</tr>
<tr>
<td>检测范围</td>
<td>MCU 级卡死、时钟失效</td>
<td>通信链路中断</td>
</tr>
<tr>
<td>超时值</td>
<td>4 秒（硬件固定）</td>
<td>5 秒（运行时可调）</td>
</tr>
<tr>
<td>触发动作</td>
<td>MCU 硬件复位</td>
<td>锁存报警码 + 状态快照标记</td>
</tr>
<tr>
<td>恢复方式</td>
<td>复位后重新初始化</td>
<td>收到新命令后自动清除</td>
</tr>
<tr>
<td>喂狗者</td>
<td>MonitorTask（500ms 周期）</td>
<td>ProtoTask 收到合法帧时自动更新</td>
</tr>
<tr>
<td>依赖</td>
<td>独立 LSI 时钟</td>
<td>FreeRTOS tick</td>
</tr>
</table></div>
<h2>为什么是两层不是一层</h2>
<p>单层看门狗（无论硬件还是软件）都无法覆盖全部故障场景：</p>
<ul>
<li><strong>只有 IWDG</strong>：通信断了 30 秒 MCU 也不会复位——主循环还在正常喂狗。设备变成"活死人"。</li>
<li><strong>只有通信看门狗</strong>：FreeRTOS tick 失效或高优先级任务死循环，通信看门狗自己都跑不了。</li>
</ul>
<p>两层互补：一层保系统不彻底死亡，一层保通信不静默断开。</p>
<h2>实现细节</h2>
<p>通信看门狗的时间戳更新位置：</p>
<pre><code class="language-c">// ProtoTask 解码一帧合法协议后：
static void on_valid_frame(void) {
    s_last_rx_tick = xTaskGetTickCount();  // 更新时间戳
    // ... 正常协议处理
}

// MonitorTask 检查：
uint32_t elapsed = now - s_last_rx_tick;
if (elapsed &gt; comm_watchdog_timeout_ms) {
    // 通信超时报警
}</code></pre>
<p>喂狗路径的层级隔离：</p>
<pre><code class="language-text">MonitorTask
  → packer_watchdog_kick()          // Service 层
    → bsp_watchdog_kick()           // BSP 层
      → IWDG-&gt;KR = 0xAAAA          // 硬件寄存器</code></pre>
<p>APP 层不直接写 IWDG 寄存器，通过 Service 层包装调用。这是分层约束的一个具体体现。</p>
<blockquote>
<p>IWDG 保证死机后能重启。通信看门狗保证"没死但聋了"时能报警。两个一起用才能覆盖嵌入式设备最常见的两类无声故障。</p>
</blockquote>
</div>
