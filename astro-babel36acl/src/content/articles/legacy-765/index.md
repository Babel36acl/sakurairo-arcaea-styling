---
title: "状态机引擎与故障管理系统：回调注册表、报警锁存与监控任务"
description: "本文将一个工业控制器状态机子系统拆解为两大模块协同运作：packer_state_handler（状态切换引擎 + 事件系统）和  ..."
published: "2026-05-29"
updated: "2026-08-18"
permalink: "/2026/05/29/工业控制器故障锁存与报警监控系统-packer_fault_latch-设计/"
draft: false
categories: ["嵌入式实战"]
tags: []
legacyId: 765
---

<div class="arcaea-wrap">
<blockquote>
<p>本文将一个工业控制器状态机子系统拆解为两大模块协同运作：packer_state_handler（状态切换引擎 + 事件系统）和 packer_fault_latch（报警锁存 + 监控任务 + 运行标志 + 状态快照）。前者决定"下一步该做什么"，后者决定"出问题了怎么处理"。两部分通过运行时标志和报警码紧密衔接。</p>
<div class="arcaea-mermaid-box"><pre class="mermaid">stateDiagram-v2
    state packer_state_handler {
        [*] --&gt; Idle
        Idle --&gt; Running : 启动
        Running --&gt; FaultDetected : 报警
        FaultDetected --&gt; Locked : 锁存
        Locked --&gt; Idle : 人工复位
    }
    state packer_fault_latch {
        [*] --&gt; Monitoring
        Monitoring --&gt; Latched : 故障条件成立
        Latched --&gt; Monitoring : 条件消除
    }</pre></div>
</blockquote>
<hr>
<h2>一、整体架构</h2>
<p>状态机子系统由以下模块组成：</p>
<ul>
<li><strong>packer_state_handler</strong> — 回调注册表引擎。维护 18 个状态的处理函数注册表，负责状态切换、超时管理、事件分发</li>
<li><strong>packer_fault_latch</strong> — 报警仲裁器。三源竞争锁存，两级优先级仲裁</li>
<li><strong>app_monitor</strong> — 监控任务。喂狗、限位冲突检测、栈水位统计</li>
<li><strong>packer_runtime_flags</strong> — 16 位运行标志位图。跨任务协调</li>
<li><strong>packer_status_snapshot</strong> — 状态快照聚合层。为协议响应提供统一数据</li>
</ul>
<p>StateMachineTask 每个周期调用 psh_task_once()，该函数按固定顺序执行：输入更新 → 标志同步 → 边界命令消费 → 报警检查 → 停止命令 → 当前状态 on_run。</p>
<hr>
<h2>二、packer_state_handler — 回调注册表引擎</h2>
<h3>2.1 为什么不要 switch-case</h3>
<p>传统状态机用 switch(state) 分发，状态多了以后单个函数膨胀到上千行，分支预测效率下降，新增状态需要修改已有代码。回调注册表把每个状态的处理函数独立成模块，运行时动态注册。</p>
<h3>2.2 核心数据结构</h3>
<pre><code class="language-c">typedef struct {
    packer_state_t state;              // 状态枚举
    psh_on_enter_t on_enter;           // 进入回调
    psh_on_run_t   on_run;             // 周期运行回调
    psh_on_exit_t  on_exit;            // 退出回调
    const char    *name;               // 日志用名称
} packer_state_handler_t;              // 注册表最大 24 项

static packer_state_handler_t s_handlers[PSH_MAX_HANDLERS];
static packer_state_t         s_state;           // 当前状态
static uint32_t               s_state_deadline;  // 超时 tick</code></pre>
<h3>2.3 注册机制</h3>
<p>psh_register() 插入第一个空槽，psh_register_batch() 循环注册数组。各子状态机（sm_bag_flow、sm_seal_flow、sm_self_check）在初始化时批量注册自己的状态处理函数：</p>
<pre><code class="language-c">void sm_bag_flow_init(void) {
    static const packer_state_handler_t handlers[] = {
        {STATE_BAG_CALIB_CHECK,  on_bag_calib_check_enter,  on_bag_calib_check_run,  NULL},
        {STATE_BAG_CALIB_CLEAR,  on_bag_calib_clear_enter,  on_bag_calib_clear_run,  NULL},
        // ... 共 8 个状态
    };
    psh_register_batch(handlers, sizeof(handlers)/sizeof(handlers[0]));
}</code></pre>
<h3>2.4 psh_transition — 状态切换</h3>
<pre><code class="language-c">void psh_transition(packer_state_t next_state, uint32_t delay_ms) {
    packer_state_handler_t *old = psh_find_handler(s_state);
    packer_state_handler_t *new = psh_find_handler(next_state);
    if (old-&gt;on_exit) old-&gt;on_exit(next_state);          // 退出旧状态
    s_state = next_state;                                   // 更新状态
    s_state_deadline = osKernelGetTickCount() + delay_ms;   // 设置超时
    if (new-&gt;on_enter) new-&gt;on_enter(prev_state);           // 进入新状态
}</code></pre>
<p>delay_ms=0 表示无超时，状态将无限期停留直到外部事件驱动切换。</p>
<h3>2.5 超时检测 — 回绕安全</h3>
<pre><code class="language-c">int psh_is_timed_out(void) {
    return ((int32_t)(osKernelGetTickCount() - s_state_deadline) &gt;= 0);
}</code></pre>
<p>用 int32_t 有符号比较，正确处理 32 位 tick 计数器的回绕。当 now 回绕到 0 而 deadline 还在高位时，差值负转正，检测仍然正确。</p>
<h3>2.6 事件系统 — 子流程解耦</h3>
<p>预定义事件：</p>
<ul>
<li>PSH_EVENT_BOOT_BAG_CALIB_COMPLETE — 开机校准完成，sm_self_check 接手后续步骤</li>
<li>PSH_EVENT_PRESS_OPEN_DELEGATE — 进入压杆打开，询问 sm_self_check 是否优先处理</li>
</ul>
<pre><code class="language-text">typedef int (*psh_event_handler_t)(psh_event_t event);
int psh_fire_event(psh_event_t event) {
    return s_event_handlers[event]
        ? s_event_handlers[event](event)
        : 0;
}</code></pre>
<h3>2.7 psh_task_once — 主循环 7 步</h3>
<pre><code class="language-c">void psh_task_once(void) {
    packer_input_update();                          // 1. 输入更新
    psh_sync_runtime_flags();                       // 2. 标志同步
    psh_try_consume_control_command();              // 3. 边界命令消费
    if (fault_active &amp;&amp; !in_error)                  // 4. 报警检查
        { psh_enter_error(); return; }
    if (stop_pending)                               // 5. 停止命令
        { force_idle(); return; }
    psh_find_handler(s_state)-&gt;on_run();            // 6. 运行当前状态
    psh_fire_event(PSH_EVENT_PRESS_OPEN_DELEGATE);  // 7. 尝试事件
}</code></pre>
<h3>2.8 psh_enter_error — 错误处理</h3>
<p>当报警被触发时，psh_enter_error() 执行：停止所有步进电机（保持使能）→ 停止所有直流电机 → 设置停止标志 → 清除流程标志 → 触发报警锁存 → 取消打印机 → 重置子状态机 → 切换到 ERROR 状态。ERROR 状态有超时倒计时，超时后通过 POWER_ON → SELF_CHECK 自动尝试恢复。</p>
<h3>2.9 IDLE 状态与流程启动</h3>
<p>IDLE 是唯一的"空闲"状态。psh_idle_run() 设置 task_status=0，检查 run_enabled 标志，然后调用 psh_try_start_pending_flow() 消费命令网关中的动作命令：</p>
<pre><code class="language-c">void psh_try_start_pending_flow(void) {
    packer_command_t cmd;
    if (!packer_command_gateway_pop_action(&amp;cmd)) return;
    switch (cmd.type) {
        case COMMAND_TRIGGER_BAG:    start_bag_flow();    break;
        case COMMAND_TRIGGER_SEAL:   start_seal_flow();   break;
        case COMMAND_TRIGGER_DELIVER: start_deliver_flow(); break;
    }
}</code></pre>
<h3>2.10 18 个状态一览</h3>
<div class="arcaea-table-wrap" data-bac-table-shell="1"><table>
<tr>
<th>状态</th>
<th>值</th>
<th>所属子 SM</th>
<th>说明</th>
</tr>
<tr>
<td>POWER_ON</td>
<td>0</td>
<td>sm_self_check</td>
<td>上电等待，超时后进入自检</td>
</tr>
<tr>
<td>SELF_CHECK</td>
<td>1</td>
<td>sm_self_check</td>
<td>含 7 个子阶段（打印检测→校准→压杆测试→DC 测试）</td>
</tr>
<tr>
<td>IDLE</td>
<td>2</td>
<td>内置</td>
<td>等待主机命令，唯一可接收动作指令的状态</td>
</tr>
<tr>
<td>BAG_CALIB_CHECK</td>
<td>3</td>
<td>sm_bag_flow</td>
<td>检测校准传感器状态</td>
</tr>
<tr>
<td>BAG_CALIB_CLEAR</td>
<td>4</td>
<td>sm_bag_flow</td>
<td>等待传感器复位</td>
</tr>
<tr>
<td>BAG_CALIB_SEEK</td>
<td>5</td>
<td>sm_bag_flow</td>
<td>步进找校准位置</td>
</tr>
<tr>
<td>BAG_CALIB_BACKOFF</td>
<td>6</td>
<td>sm_bag_flow</td>
<td>从校准位后退</td>
</tr>
<tr>
<td>BAG_OUT</td>
<td>7</td>
<td>sm_bag_flow</td>
<td>主出袋脉冲，定时触发打印</td>
</tr>
<tr>
<td>PREHEAT</td>
<td>8</td>
<td>sm_bag_flow</td>
<td>预热等待（密封前加热）</td>
</tr>
<tr>
<td>SEAL_FORWARD</td>
<td>9</td>
<td>sm_bag_flow</td>
<td>前送阶段</td>
</tr>
<tr>
<td>CONVEYOR_RUN</td>
<td>10</td>
<td>sm_bag_flow</td>
<td>输送机运行（投料）</td>
</tr>
<tr>
<td>SEAL_BACKWARD</td>
<td>11</td>
<td>sm_seal_flow</td>
<td>密封后退准备</td>
</tr>
<tr>
<td>PRESS_RETRACT</td>
<td>12</td>
<td>sm_seal_flow</td>
<td>压杆下压（3 轴联动）</td>
</tr>
<tr>
<td>PRESS_CLOSE</td>
<td>13</td>
<td>sm_seal_flow</td>
<td>合拢（即过）</td>
</tr>
<tr>
<td>SEAL_HOLD</td>
<td>14</td>
<td>sm_seal_flow</td>
<td>保持密封压力，超时后脱离</td>
</tr>
<tr>
<td>TEAR_OFF</td>
<td>15</td>
<td>sm_seal_flow</td>
<td>撕断（轴 1 脉冲）</td>
</tr>
<tr>
<td>PRESS_OPEN</td>
<td>16</td>
<td>sm_seal_flow+sm_self_check</td>
<td>压杆回位（2 阶段：双轴回 + 轴 2 回 IN1）</td>
</tr>
<tr>
<td>RESET</td>
<td>17</td>
<td>sm_seal_flow</td>
<td>复位关风机，回到 IDLE</td>
</tr>
<tr>
<td>ERROR</td>
<td>18</td>
<td>内置</td>
<td>报警状态，超时自动尝试恢复</td>
</tr>
</table></div>
<hr>
<h2>三、packer_fault_latch — 报警锁存与优先级仲裁</h2>
<h3>3.1 为什么需要专用锁存模块</h3>
<p>多源报警（协议层、状态机、监控任务）同时触发时，需要一套仲裁规则决定哪个报警优先显示和处理。此外，"是否发生过报警"这个状态需要在报警条件消失后继续保持（锁存），直到操作员确认清除。</p>
<h3>3.2 三源竞争架构</h3>
<p>三个报警源具有不同优先级：</p>
<ul>
<li>协议层：优先级 1（最低）— 来自主机命令</li>
<li>状态机：优先级 2 — 来自流程超时/故障</li>
<li>监控任务：优先级 3（最高）— 安全监控</li>
</ul>
<h3>3.3 两级优先级仲裁</h3>
<p>packer_fault_latch_raise(alarm_code, source) 执行：</p>
<ol>
<li>如果当前无报警 → 接受新报警</li>
<li>如果已有报警 → 先比报警严重度（severity 数值越高越严重）</li>
<li>严重度相同 → 比源优先级（source 数值越高越权威）</li>
<li>更低的报警或源被拒绝（记录日志 PACKER_ALARM_KEEP）</li>
</ol>
<h3>3.4 13 个报警码</h3>
<div class="arcaea-table-wrap" data-bac-table-shell="1"><table>
<tr>
<th>码</th>
<th>名称</th>
<th>严重度组</th>
<th>来源</th>
</tr>
<tr>
<td>0x00</td>
<td>NORMAL</td>
<td>0</td>
<td>无报警</td>
</tr>
<tr>
<td>0x01</td>
<td>MATERIAL_EMPTY</td>
<td>3</td>
<td>状态机</td>
</tr>
<tr>
<td>0x02</td>
<td>STAGE_TIMEOUT</td>
<td>1</td>
<td>状态机</td>
</tr>
<tr>
<td>0x05</td>
<td>CLAMP_ERR</td>
<td>4</td>
<td>监控任务</td>
</tr>
<tr>
<td>0x06-0x0D</td>
<td>STEP_TIMEOUT / PULSE_OVERFLOW 等</td>
<td>4</td>
<td>状态机</td>
</tr>
<tr>
<td>0x0A</td>
<td>PRINTER_ERR</td>
<td>2</td>
<td>状态机</td>
</tr>
<tr>
<td>0x0E</td>
<td>POWER_OVER_LIMIT</td>
<td>4（预留）</td>
<td>功率限制框架</td>
</tr>
</table></div>
<p>严重度分组：0=NORMAL，1=平台超时，2=打印机错误，3=材料空，4=步进超时/夹具错误。</p>
<h3>3.5 锁存语义</h3>
<p>锁存标志一旦置 1 就保持，直到 packer_fault_latch_clear_latch() 被显式调用。这允许系统回答"刚才发生过报警吗？"即使瞬态条件已消失。清除锁存和清除当前报警码是两个独立操作——RESET_FAULT 命令先清锁存，再清码。</p>
<pre><code class="language-c">void packer_fault_latch_raise(uint8_t alarm_code, uint8_t source) {
    if (s_alarm_code == APP_ALARM_NONE) {
        accept_new(alarm_code, source);
    } else {
        if (severity(alarm_code) &gt; severity(s_alarm_code) ||
           (severity(alarm_code) == severity(s_alarm_code) &amp;&amp;
            source &gt; s_alarm_source)) {
            replace_alarm(alarm_code, source);
        }
    }
    s_alarm_latched = 1;  // 锁存
}</code></pre>
<hr>
<h2>四、app_monitor — 监控任务</h2>
<h3>4.1 职责</h3>
<p>MonitorTask 是 FreeRTOS 任务（优先级 osPriorityNormal1，20ms 周期，2KB 栈），负责与业务逻辑解耦的"系统生存"监控：</p>
<ul>
<li><strong>喂狗 (IWDG)</strong> — 通过 packer_watchdog_kick() 刷新独立看门狗，周期钳位到 IWDG_TIMEOUT_MS-500ms 保证安全余量</li>
<li><strong>限位冲突检测</strong> — 检测压杆限位开关冲突（同轴两个限位同时激活）→ APP_ALARM_CLAMP_ERR</li>
<li><strong>栈水位统计</strong> — 编译可选，查询所有 7 个任务的 uxTaskGetStackHighWaterMark</li>
<li><strong>CPU 占用统计</strong> — 编译可选，调用 vTaskGetRunTimeStats() 输出</li>
</ul>
<h3>4.2 跨重启诊断（.noinit）</h3>
<p>MonitorTask 在 .noinit 段维护诊断结构（魔数 0x57444744），记录 last_kick_tick、kick_count、max_kick_gap_ms。boot_report() 在启动时打印上次运行的诊断数据，帮助分析看门狗复位原因。</p>
<hr>
<h2>五、packer_runtime_flags — 16 位运行标志位图</h2>
<p>9 个标志位的轻量级位图，用于跨任务协调。所有 RMW 操作在 taskENTER_CRITICAL()/EXIT_CRITICAL() 下完成：</p>
<div class="arcaea-table-wrap" data-bac-table-shell="1"><table>
<tr>
<th>位</th>
<th>标志</th>
<th>含义</th>
</tr>
<tr>
<td>0x0001</td>
<td>RUN_ENABLED</td>
<td>主机已发送 CONTROL start</td>
</tr>
<tr>
<td>0x0002</td>
<td>FLOW_BUSY</td>
<td>流程进行中</td>
</tr>
<tr>
<td>0x0004</td>
<td>READY_FOR_SEAL</td>
<td>密封就绪（历史保留）</td>
</tr>
<tr>
<td>0x0008</td>
<td>ALARM_ACTIVE</td>
<td>有活跃报警</td>
</tr>
<tr>
<td>0x0010-0x0040</td>
<td>BAG/SEAL/CONVEYOR_DONE</td>
<td>各流程完成标志（锁存）</td>
</tr>
<tr>
<td>0x0080</td>
<td>JOG_BUSY</td>
<td>点动操作进行中</td>
</tr>
<tr>
<td>0x0100</td>
<td>BOOT_SEQUENCE_ACTIVE</td>
<td>开机自检未完成</td>
</tr>
</table></div>
<p>关键设计：单个 volatile 16 位读取在 ARM Cortex-M3 上天然原子，因此 is_set() 不需要临界区。只有 set()/clear() 这种 RMW 操作需要临界区保护。</p>
<hr>
<h2>六、packer_status_snapshot — 状态快照聚合</h2>
<p>为 STATUS（0x41）协议响应提供聚合数据。每个写操作同时更新缓存变量和 runtime_flags 相应位：</p>
<ul>
<li>run_state（uint8_t 0/1）→ RUN_ENABLED</li>
<li>task_status（uint8_t 0/1）= FLOW_BUSY || JOG_BUSY（计算值）</li>
<li>bag/seal/conveyor_done 各自映射到对应标志位</li>
<li>busy_flags 位掩码：bit0=bag_done, bit1=seal_done, bit3=alarm_active, bit4=jog_busy</li>
</ul>
<p>clear_process_flags() 批量清除 bag/seal/conveyor_done + ready_for_seal，在 CONTROL stop 和 RESET_FAULT scope=2 时调用。</p>
<hr>
<h2>七、模块协作全景</h2>
<pre><code class="language-text">Protocol (0x41 STATUS query)
        ↓
packer_status_snapshot  ← reads ← packer_runtime_flags
        ↓                           (16-bit bitmap, CRIT on writes)
app_monitor → packer_fault_latch (priority arbitration)
        ↓           ↓
   watchdog kick    packer_runtime_flags (ALARM_ACTIVE bit)
        ↓           ↓
   stack stats    StateMachineTask checks each cycle
                     → psh_enter_error() on active alarm</code></pre>
<hr>
<h2>八、设计要点与踩坑记录</h2>
<ol>
<li><strong>注册表 vs switch-case</strong>：注册表模式让每个状态独立成模块，新增状态不需要修改已有代码。但调试时状态跳转不能从单一 switch 看到，需要配合日志分析</li>
<li><strong>超时回绕安全</strong>：(int32_t) 比较正确处理 tick 回绕，但 delay_ms 最大值不能超过 int32_t 正半（约 24 天）</li>
<li><strong>事件系统 vs 直接调用</strong>：事件系统解耦了子状态机，但也增加了间接性。只在真正需要跨模块交互时使用，内部子状态使用直接函数调用</li>
<li><strong>报警锁存 vs 瞬态清除</strong>：锁存标志在报警消失后仍然保持，操作员必须主动清除。这防止了瞬态故障被忽略</li>
<li><strong>临界区粒度</strong>：BSP 层用 PRIMASK（关全局中断），APP 层用 taskENTER_CRITICAL（仅关调度器）。混用可能导致优先级反转</li>
<li><strong>task_status 计算</strong>：task_status = FLOW_BUSY || JOG_BUSY，这是一个合成值而不是存储值，避免了双源不一致</li>
</ol>
<hr>
<p style="color:#888;font-size:0.9em;">INDL_CONTROLLER · STM32F103 · FreeRTOS · Keil MDK-ARM</p>
</div>
