---
title: "嵌入式执行器架构：统一动作表实现与两阶段执行深度解析"
description: "一张声明式表格描述每个状态对应的全部执行器输出。MotorTask 周期遍历，一次性下发。新增状态只需加一行表。"
published: "2026-05-28"
updated: "2026-08-18"
permalink: "/2026/05/28/unified-actuator-action-table-pattern/"
draft: false
categories: ["嵌入式实战","架构与重构"]
tags: []
legacyId: 529
---

<div class="arcaea-wrap">
<p>一张声明式表格描述每个状态对应的全部执行器输出。MotorTask 周期遍历，一次性下发。新增状态只需加一行表。</p>
<h2>一、问题：散落 switch 的代价</h2>
<p>重构前的执行器层有 7+ 张独立的查找表，分布在 packer_actuator.c 的不同位置：</p>
<div class="arcaea-mermaid-box"><pre class="mermaid">flowchart TB
    subgraph TABLE[统一动作表]
        T1[状态 → 执行器输出]
        T2[声明式二维表]
    end
    subgraph TASK[MotorTask]
        M1[周期遍历动作表]
        M2[批量下发]
    end
    subgraph ACT[执行器]
        A1[步进电机]
        A2[加热器]
        A3[阀门]
    end
    TABLE --&gt; TASK --&gt; ACT
    style TABLE fill:transparent,stroke:#8dc7ff,color:#eaf4ff
    style TASK fill:transparent,stroke:#8dc7ff,color:#eaf4ff</pre></div>
<ul>
<li>一张表把状态映射到 LED 闪烁周期</li>
<li>一张表把状态映射到直流电机动作</li>
<li>一张表把状态映射到步进电机单轴动作</li>
<li>一张表把状态映射到步进电机双轴动作</li>
<li>一张表把状态映射到加热使能</li>
<li>一张表把状态映射到风机请求</li>
<li>一张表把状态映射到功率总使能</li>
</ul>
<p>每次状态切换，MotorTask 要依次遍历 7 张表。新增一个状态就要改 7 个地方。遗漏任何一张表都会导致该状态下的执行器输出与预期不符。</p>
<p>更糟糕的是，这些表散落在 packer_actuator_task_once() 函数中，以 if-else-if 链条或 switch-case 的形式存在，阅读和维护都十分困难。</p>
<h2>二、统一动作描述表</h2>
<p>重构后的核心是一张 <code>s_state_actions[]</code> 表，每个状态一个条目，字段涵盖所有执行器输出：</p>
<pre><code class="language-c">typedef struct {
    packer_state_t state;
    pact_stepper_mode_t stepper_mode;
    bsp_dc_motor_id_t dc_motor;
    bsp_dc_motor_dir_t dc_motor_dir;
    uint8_t hopper_conveyor : 1;
    uint8_t power_on : 1;
    uint8_t heater_toggle : 1;
} packer_state_action_t;</code></pre>
<p>查找函数 <code>pact_find()</code> 极为简单——一次线性遍历即可定位：</p>
<pre><code class="language-c">static const packer_state_action_t *pact_find(packer_state_t state) {
    uint8_t i;
    for (i = 0U; i &lt; (uint8_t)(sizeof(s_state_actions) / sizeof(s_state_actions[0])); i++) {
        if (s_state_actions[i].state == state) return &amp;s_state_actions[i];
    }
    return NULL;
}</code></pre>
<h2>三、动作表内容</h2>
<p>完整的状态动作映射如下（步进模式字段决定后续的步进解析路径）：</p>
<pre><code class="language-text">static const packer_state_action_t s_state_actions[] = {
    {POWER_ON,    PACT_STEPPER_NONE,   DC_ID_COUNT, DIR_STOP, 0, 0, 0},
    {SELF_CHECK,  PACT_STEPPER_NONE,   PUSHER_ST2,  FORWARD,  0, 0, 0},
    {IDLE,        PACT_STEPPER_NONE,   DC_ID_COUNT, DIR_STOP, 0, 0, 0},
    {BAG_CALIB_CHECK,  PACT_STEPPER_NONE,       PUSHER_ST2, FORWARD, 0, 0, 1},
    {BAG_CALIB_CLEAR,  PACT_STEPPER_BAG_RUNTIME, PUSHER_ST2, FORWARD, 0, 0, 1},
    {BAG_CALIB_SEEK,   PACT_STEPPER_BAG_RUNTIME, PUSHER_ST2, FORWARD, 0, 0, 1},
    {BAG_CALIB_BACKOFF,PACT_STEPPER_BAG_RUNTIME, PUSHER_ST2, FORWARD, 0, 0, 1},
    {BAG_OUT,    PACT_STEPPER_BAG_RUNTIME, DC_ID_COUNT, DIR_STOP, 0, 0, 1},
    {PREHEAT,    PACT_STEPPER_NONE,   DC_ID_COUNT, DIR_STOP, 0, 1, 1},
    {SEAL_FORWARD,   PACT_STEPPER_NONE,   PUSHER_ST2, FORWARD, 0, 0, 1},
    {CONVEYOR_RUN,   PACT_STEPPER_NONE,   DC_ID_COUNT, DIR_STOP, 1, 0, 0},
    {SEAL_BACKWARD,  PACT_STEPPER_NONE,   PUSHER_ST2, FORWARD, 0, 0, 0},
    {PRESS_RETRACT,  PACT_STEPPER_DUAL,   DC_ID_COUNT, DIR_STOP, 0, 0, 0},
    {PRESS_CLOSE,    PACT_STEPPER_NONE,   DC_ID_COUNT, DIR_STOP, 0, 1, 0},
    {SEAL_HOLD,      PACT_STEPPER_NONE,   DC_ID_COUNT, DIR_STOP, 0, 1, 0},
    {TEAR_OFF,       PACT_STEPPER_SINGLE, DC_ID_COUNT, DIR_STOP, 0, 1, 0},
    {PRESS_OPEN,     PACT_STEPPER_DUAL,   DC_ID_COUNT, DIR_STOP, 0, 1, 0},
    {RESET,          PACT_STEPPER_NONE,   DC_ID_COUNT, DIR_STOP, 0, 0, 0},
    {ERROR,          PACT_STEPPER_NONE,   DC_ID_COUNT, DIR_STOP, 0, 0, 0},
};</code></pre>
<p>步进模式字段（<code>PACT_STEPPER_NONE/SINGLE/DUAL/BAG_RUNTIME</code>）充当二级路由，将步进动作解析委托给对应的运行时函数，构成"一次定位 + 二次分发"的两级查找结构。</p>
<h2>四、状态机 + 动作表 = 正交架构</h2>
<p>状态机（<code>app_packer_sm</code>）负责"什么时候该切状态"，执行器动作表（<code>s_state_actions[]</code>）负责"当前状态硬件该干什么"。两个表是正交的。一个决定"什么时候该切状态"，一个决定"当前状态硬件该干什么"。</p>
<p><!-- ================================================================ --><br>
<!-- 以下为追加的深度实现细节：五 ~ 十二                              --><br>
<!-- ================================================================ --></p>
<h2>五、统一动作表实现：s_state_actions[]</h2>
<p>重构的核心是将 7+ 张独立查找表合并为单一 <code>s_state_actions[]</code> 统一动作描述表。每张旧表都曾独立维护、独立遍历，新增一个状态就要改 7 处。合并后，状态 → 执行器映射只在一个地方定义。</p>
<p>实际的结构体 <code>packer_state_action_t</code> 字段如下：</p>
<pre><code class="language-c">typedef struct {
    packer_state_t      state;           /**&lt; 打包机流程状态 */
    pact_stepper_mode_t stepper_mode;    /**&lt; NONE/SINGLE/DUAL/BAG_RUNTIME */
    bsp_dc_motor_id_t   dc_motor;       /**&lt; BSP_DC_MOTOR_ID_COUNT 表示无 */
    bsp_dc_motor_dir_t  dc_motor_dir;   /**&lt; STOP 表示不启动 */
    uint8_t hopper_conveyor : 1;        /**&lt; 投料传送带继电器 */
    uint8_t power_on : 1;               /**&lt; 功率总使能 */
    uint8_t heater_toggle : 1;          /**&lt; 兼容保留位，实际加热已下沉到 HeaterTask */
} packer_state_action_t;</code></pre>
<p>各字段解读：</p>
<ul>
<li><strong>stepper_mode</strong>：步进电机动作模式。NONE 表示无步进动作；SINGLE 查 <code>s_stepper_flow_actions[]</code> 编译期表；DUAL 查 <code>s_dual_stepper_flow_actions[]</code>；BAG_RUNTIME 由运行时袋长/速度参数在状态进入时换算脉冲数和频率。</li>
<li><strong>dc_motor + dc_motor_dir</strong>：直流电机（推杆挡板）的启动请求。DIR_STOP 表示不启动。实际启动时还会经过 <code>packer_power_limit</code> 功率限制准入检查。</li>
<li><strong>hopper_conveyor</strong>：投料传送带继电器的控制位。仅在 CONVEYOR_RUN 状态置 1。</li>
<li><strong>power_on</strong>：功率总使能（MOSFET 大功率输出）。PREHEAT、PRESS_CLOSE、SEAL_HOLD、TEAR_OFF、PRESS_OPEN 等需要加热或压杆保持的状态置 1。</li>
<li><strong>heater_toggle</strong>：兼容保留位。实际加热控制已在 HeaterTask 中独立实现，此位保留用于日志和未来扩展。</li>
</ul>
<p>原来的 7 张独立表是：</p>
<ol>
<li>状态 → LED 闪烁周期</li>
<li>状态 → 直流电机动作</li>
<li>状态 → 步进单轴动作（s_stepper_flow_actions）</li>
<li>状态 → 步进双轴动作（s_dual_stepper_flow_actions）</li>
<li>状态 → 加热使能</li>
<li>状态 → 风机请求</li>
<li>状态 → 功率总使能</li>
</ol>
<p>合并后，单次 <code>pact_find()</code> 线性查找替代了原先 7+ 次独立表遍历。步进模式的二次分发通过 <code>stepper_mode</code> 字段路由到对应的运行时解析函数（<code>pad_get_stepper_action</code>、<code>pad_get_dual_stepper_action</code>、<code>pad_get_bag_runtime_action</code>），形成"一次定位 + 按模式二次分发"的两级查找结构。</p>
<h2>六、两阶段执行：On-Enter vs Per-Cycle</h2>
<p>执行器逻辑显式拆分为两个阶段，分别由两个函数承担：</p>
<h3>6.1 pact_apply_state_action() — 状态进入时一次下发</h3>
<p>每次状态切换时调用。执行以下操作：</p>
<ul>
<li>解析步进电机动作（SINGLE/DUAL/BAG_RUNTIME），计算目标脉冲和频率</li>
<li>通过增量启停机制启动/停止/重启步进轴</li>
<li>下发直流电机动作（推杆挡板）</li>
<li>控制投料传送带继电器</li>
<li>设置功率总使能</li>
<li>更新风机请求状态</li>
</ul>
<p>典型的调用链——在 <code>packer_actuator_task_once()</code> 中检测到状态变化后执行：</p>
<pre><code class="language-text">if ((state != s_last_applied_state) || (s_state_entry_tick == 0U) ||
    (press_profile != s_last_press_profile)) {
    s_state_entry_tick = now;
    state_elapsed_ms = 0U;
    pact_apply_state_action(state);
    s_last_applied_state = state;
    s_last_press_profile = press_profile;
}</code></pre>
<h3>6.2 pact_apply_per_cycle_actions() — 每周期维护</h3>
<p>每个 MotorTask 周期（通常 50ms）无条件调用。处理以下定时子阶段：</p>
<ul>
<li><strong>SELF_CHECK 挡板与推杆驱动</strong>：读取自检子阶段的驱动命令（<code>sm_self_check_get_flap_drive</code>、<code>sm_self_check_get_dc1_drive</code>），发生跳变时下发直流电机动作。</li>
<li><strong>PREHEAT 出袋预备时序</strong>：BAG 流程进入 PREHEAT 后，按 <code>dc_motor2_bag_prepare_close_time_ms</code> 划分 CLOSE/PRE_OPEN 两个子阶段，先合挡板再预开。</li>
<li><strong>SEAL_FORWARD 封口收尾时序</strong>：BAG 流程进入 SEAL_FORWARD 后，按 <code>dc_motor2_return_settle_time_ms</code> 划分 CLOSE/OPEN 两个子阶段，先保持合拢再开挡板。</li>
<li><strong>RESET 推杆 5 相位节拍</strong>：DELAY → FORWARD → HOLD → BACKWARD → IDLE，每个相位时长由运行时配置参数控制。</li>
</ul>
<h3>6.3 为什么需要两个阶段</h3>
<p>状态切换（On-Enter）需要一次性的硬件配置：步进电机启动/停止、功率总使能开关、风机请求变更。这些操作只应在状态进入时执行一次，不应在每个周期重复。</p>
<p>稳态运行（Per-Cycle）需要周期性的维护：自检阶段的挡板驱动随子阶段变化、出袋预备中挡板需按时间切换合/开、复位推杆需按节拍前进/后退/停止。这些操作的触发条件是时间流逝或子阶段变化，而非状态切换本身。</p>
<p>两阶段分离的好处：</p>
<ul>
<li>On-Enter 阶段可安全执行 stop/start 轴操作，无需担心被周期重复执行</li>
<li>Per-Cycle 阶段可以使用跳变检测（比较当前值与上次值），只在变化时执行操作</li>
<li>故障恢复时只需重置 Per-Cycle 的阶段状态变量，不影响 On-Enter 的动作表</li>
</ul>
<h2>七、增量启动/停止（避免机械噪声）</h2>
<p>早期版本在每次状态切换时执行全局 <code>stop_all</code> + <code>start_all</code>，即使轴上一次已经在运行且方向和速度没变。这导致不必要的机械噪声和磨损。</p>
<p>重构后引入 <code>s_last_*</code> 缓存和位图比较逻辑：</p>
<pre><code class="language-text">static uint8_t s_last_plan_valid = 0U;
static uint8_t s_last_has_stepper = 0U;
static uint8_t s_last_has_dual_stepper = 0U;
static uint8_t s_last_axis_mask = 0U;
static uint32_t s_last_stepper_resolved_hz = 0U;
static uint32_t s_last_dual_resolved_hz = 0U;
static app_stepper_flow_action_t s_last_stepper_action;
static app_dual_stepper_flow_action_t s_last_dual_action;</code></pre>
<p>每次 <code>pact_apply_state_action()</code> 执行时，先计算当前动作画像（轴、方向、频率、目标脉冲），然后与缓存的上一帧画像逐字段比较：</p>
<pre><code class="language-text">if ((s_last_plan_valid != 0U) &amp;&amp;
    (has_stepper != 0U) &amp;&amp;
    (s_last_has_stepper != 0U) &amp;&amp;
    (s_last_stepper_action.axis == stepper_action.axis) &amp;&amp;
    (s_last_stepper_action.direction == stepper_action.direction) &amp;&amp;
    (s_last_stepper_resolved_hz == stepper_resolved_hz) &amp;&amp;
    (s_last_stepper_action.target_pulses == stepper_action.target_pulses) &amp;&amp;
    (s_last_stepper_action.finite_stop_mode == stepper_action.finite_stop_mode)) {
    single_action_same = 1U;
}</code></pre>
<p>基于比较结果分三种情况处理：</p>
<ul>
<li><strong>新增轴</strong>（add_mask）：当前需要启动但上一帧未运行的轴 → 直接启动</li>
<li><strong>变更轴</strong>（restart_mask）：当前与上一帧都运行但参数变化 → 先停止再启动</li>
<li><strong>移除轴</strong>（remove_mask）：上一帧在运行但当前不需要的轴 → 停止</li>
</ul>
<p>位图计算逻辑：</p>
<pre><code class="language-c">uint8_t old_mask = s_running_axis_mask;
uint8_t add_mask = (uint8_t)(axis_mask &amp; (uint8_t)(~old_mask));
uint8_t remove_mask = (uint8_t)(old_mask &amp; (uint8_t)(~axis_mask));

// 仅停止需要变更的轴
if (restart_mask != 0U) {
    pact_stepper_stop_axes_by_mask(restart_mask);
}
// 仅启动新增和变更后的轴
start_mask = (uint8_t)(add_mask | restart_mask);
if (start_mask != 0U) {
    pact_stepper_start_actions_by_mask(&amp;stepper_action, has_stepper,
                                       &amp;dual_stepper_action, has_dual_stepper,
                                       start_mask);
}
// 仅停止不再需要的轴
if (remove_mask != 0U) {
    pact_stepper_stop_axes_by_mask(remove_mask);
}</code></pre>
<p>四个轴分别对应位图中的 bit 0~3。全局 <code>s_running_axis_mask</code> 持续追踪当前运行轴集合，增量操作仅作用于变化的部分。</p>
<p>效果：SEAL_FORWARD → SEAL_BACKWARD 切换时轴 1（出袋轴）已在 BAG_OUT 完成后停止，不会再次被 stop；PRESS_CLOSE → PRESS_OPEN 切换时轴 2（压杆轴）已在 PRESS_CLOSE 中停止，轴 3/4（扒口轴）持续运行方向不变时不中断。</p>
<h2>八、4 轴步进子系统</h2>
<p>系统管理 4 个步进轴，分别对应不同的物理执行器：</p>
<div class="arcaea-table-wrap" data-bac-table-shell="1"><table>
<tr>
<th>逻辑轴</th>
<th>BSP 映射</th>
<th>默认频率 (Hz)</th>
<th>运行时配置键</th>
<th>用途</th>
</tr>
<tr>
<td>轴 1</td>
<td>BSP_STEPPER_AXIS_1</td>
<td>105039</td>
<td>speed_bag_out_hz</td>
<td>出袋、校准、扯断</td>
</tr>
<tr>
<td>轴 2</td>
<td>BSP_STEPPER_AXIS_2</td>
<td>40000</td>
<td>speed_seal_move_hz</td>
<td>压杆下压/回位</td>
</tr>
<tr>
<td>轴 3</td>
<td>BSP_STEPPER_AXIS_3</td>
<td>30000</td>
<td>speed_seal_return_hz</td>
<td>扒口正转</td>
</tr>
<tr>
<td>轴 4</td>
<td>BSP_STEPPER_AXIS_4</td>
<td>30000</td>
<td>speed_seal_return_hz</td>
<td>扒口正转</td>
</tr>
</table></div>
<p>配置表定义：</p>
<pre><code class="language-text">static const app_stepper_motor_cfg_t s_stepper_motors[] = {
    {APP_AXIS_1, BSP_STEPPER_AXIS_1, 105039U, 0U, 0U, 0U},
    {APP_AXIS_2, BSP_STEPPER_AXIS_2, 40000U,  0U, 0U, 0U},
    {APP_AXIS_3, BSP_STEPPER_AXIS_3, 30000U,  0U, 0U, 0U},
    {APP_AXIS_4, BSP_STEPPER_AXIS_4, 30000U,  0U, 0U, 0U},
};</code></pre>
<p><strong>TIM4 共享 ARR 约束</strong>：四轴共用 TIM4 的四个通道，共享同一个 ARR 寄存器，因此同一时刻四轴只能运行在<strong>同一脉冲频率</strong>。当需要不同轴以不同速度运行时（如 PRESS_OPEN 中的轴 2 回位和轴 3/4 扒口），通过脉冲数比例自动换算频率，使行程短的轴先到位，行程长的轴以 IN1 传感器收尾。</p>
<p>多轴同步启动通过 <code>bsp_stepper_group_command_t</code> 实现：</p>
<pre><code class="language-c">typedef struct {
    bsp_stepper_command_t commands[APP_AXIS_COUNT];
    uint8_t command_count;
} bsp_stepper_group_command_t;</code></pre>
<p>典型场景——<code>pact_stepper_start_actions_by_mask()</code> 中组合同步启动：</p>
<ul>
<li><strong>PRESS_RETRACT</strong>：仅轴 2 单轴启动（压杆下压），脉冲数由运行时配置的压杆行程长度换算。</li>
<li><strong>PRESS_OPEN</strong>：轴 3/4 双轴同步启动（扒口打开）+ 轴 2 连续模式回 IN1。三轴共用频率，轴 2 频率根据行程比例自动缩放。</li>
</ul>
<h2>九、运行时动作解析器</h2>
<p>6 个解析器函数负责在状态进入时根据运行时配置动态生成步进动作参数：</p>
<h3>9.1 bag_action — 出袋系列动作</h3>
<pre><code class="language-text">static uint8_t pact_fill_runtime_bag_action(packer_state_t state,
                                             app_stepper_flow_action_t *out);</code></pre>
<p>处理 BAG_CALIB_CLEAR/SEEK/BACKOFF、BAG_OUT 四个状态。从 <code>packer_bag_runtime_config</code> 读取袋长和速度参数，换算目标脉冲数和频率。校准清空（CALIB_CLEAR）和校准寻找（CALIB_SEEK）为连续模式（target_pulses=0），校准回退（CALIB_BACKOFF）和出袋（BAG_OUT）为有限脉冲模式。</p>
<h3>9.2 press_action — 压杆下压</h3>
<pre><code class="language-text">static uint8_t pact_fill_runtime_press_action(packer_state_t state,
                                               app_stepper_flow_action_t *out);</code></pre>
<p>仅处理 PRESS_RETRACT 状态。从 <code>packer_press_runtime_config</code> 读取 <code>press_retract_len_mm_x1000</code>，独立换算下压脉冲数。方向由 <code>pact_get_press_axis2_retract_dir()</code> 根据编译期宏决定。</p>
<h3>9.3 tear_off_action — 扯断</h3>
<pre><code class="language-text">static uint8_t pact_fill_runtime_tear_off_action(packer_state_t state,
                                                  app_stepper_flow_action_t *out);</code></pre>
<p>处理 TEAR_OFF 状态。从 rcfg 读取 <code>tear_off_len_mm_x1000</code> 和 <code>speed_tear_off_hz</code>，独立频率参数使扯断速度可与出袋速度不同。</p>
<h3>9.4 press_dual_action — 扒口双轴（含自动频率缩放）</h3>
<pre><code class="language-text">static uint8_t pact_fill_runtime_press_dual_action(packer_state_t state,
                                                    app_dual_stepper_flow_action_t *out);</code></pre>
<p>处理所有涉及轴 3/4 双轴同步的场景，包括自检扒口、PRESS_CLOSE（扒口闭合）、PRESS_OPEN 双轴回位（DUAL_RETURN）。对于 OPEN_DUAL_RETURN 场景，根据轴 2 回位脉冲数与轴 3/4 脉冲数的比例自动缩放频率，确保"双轴先到位、轴 2 以 IN1 收尾"的节拍不变。</p>
<h3>9.5 axis2_return_action — 轴 2 回 IN1（连续模式）</h3>
<pre><code class="language-text">static uint8_t pact_try_fill_press_axis2_return_action(
    packer_state_t state, sm_press_profile_t profile,
    app_stepper_flow_action_t *out);</code></pre>
<p>处理轴 2 回 IN1 传感器的高优先动作。以连续模式（target_pulses=0）运行，IN1 物理传感器命中为主完成条件，脉冲保护上限仅用于超时检测。自检回位和正常回位可使用不同的速度参数。</p>
<h3>9.6 press_open_wrapper — PRESS_OPEN 入口包装器</h3>
<pre><code class="language-text">static uint8_t pact_fill_press_open_axis2_action(packer_state_t state,
                                                  app_stepper_flow_action_t *out);</code></pre>
<p>专门处理 PRESS_OPEN 状态下轴 2 回 IN1 的入口。通过 <code>sm_press_get_profile()</code> 获取当前压杆画像，判断是否需要启动轴 2，然后委托给 <code>pact_try_fill_press_axis2_return_action()</code> 完成具体填充。</p>
<h2>十、协议点动支持</h2>
<p>协议层提供两种独立于状态机的点动机制，用于调试和手动操作：</p>
<h3>10.1 步进点动</h3>
<pre><code class="language-text">uint8_t packer_actuator_start_protocol_stepper_jog(uint8_t motor_id,
                                                    uint8_t forward,
                                                    uint16_t target_pulses);</code></pre>
<p>协议层指定 1~4 号步进电机、正/反向、目标脉冲数。点动使用该轴的默认频率（轴 1 从运行时袋长配置取值，轴 2~4 从 motor 表默认值取值）。启动前自动 <code>stop_all</code> 所有步进和直流电机，关断功率输出。</p>
<h3>10.2 直流电机点动</h3>
<pre><code class="language-text">uint8_t packer_actuator_start_protocol_dc_motor_jog(uint8_t motor_id,
                                                     uint8_t forward,
                                                     uint16_t duration_ms);</code></pre>
<p>协议层指定 1~2 号直流电机、正/反向、持续时长（毫秒）。通过 <code>packer_power_limit</code> 准入后下发到 BSP。</p>
<h3>10.3 互锁与生命周期</h3>
<p>两种点动互相 busy-locked：</p>
<pre><code class="language-text">if ((s_protocol_stepper_jog_active != 0U) ||
    (s_protocol_dc_motor_jog_active != 0U)) {
    return 2U;  // 忙
}</code></pre>
<p>启动时记录 deadline tick，在 <code>packer_actuator_task_once()</code> 的每个 MotorTask 周期中检查是否超时，超时后自动停止并清除 busy 标志。一旦触发点动，协议层不再通过状态机控制执行器，直到点动完成。</p>
<h2>十一、LED 状态映射</h2>
<p>每种状态或状态组对应一个固定的 LED 闪烁周期：</p>
<div class="arcaea-table-wrap" data-bac-table-shell="1"><table>
<tr>
<th>状态组</th>
<th>LED 闪烁周期常量</th>
<th>典型值</th>
</tr>
<tr>
<td>POWER_ON、SELF_CHECK</td>
<td>APP_CFG_LED_BOOT_BLINK_MS</td>
<td>800 ms</td>
</tr>
<tr>
<td>IDLE</td>
<td>APP_CFG_LED_IDLE_BLINK_MS</td>
<td>500 ms</td>
</tr>
<tr>
<td>BAG_CALIB_*、BAG_OUT</td>
<td>APP_CFG_LED_CALIB_BLINK_MS</td>
<td>200 ms</td>
</tr>
<tr>
<td>SEAL_HOLD</td>
<td>APP_CFG_LED_HOLD_BLINK_MS</td>
<td>100 ms</td>
</tr>
<tr>
<td>ERROR</td>
<td>APP_CFG_LED_ERROR_BLINK_MS</td>
<td>80 ms</td>
</tr>
<tr>
<td>其他运行状态</td>
<td>APP_CFG_LED_RUN_BLINK_MS</td>
<td>150 ms</td>
</tr>
</table></div>
<pre><code class="language-c">static uint32_t pact_get_led_blink_ms(packer_state_t state)
{
    switch (state) {
    case PACKER_STATE_POWER_ON:
    case PACKER_STATE_SELF_CHECK:
        return APP_CFG_LED_BOOT_BLINK_MS;
    case PACKER_STATE_IDLE:
        return APP_CFG_LED_IDLE_BLINK_MS;
    case PACKER_STATE_BAG_CALIB_CHECK:
    case PACKER_STATE_BAG_CALIB_CLEAR:
    case PACKER_STATE_BAG_CALIB_SEEK:
    case PACKER_STATE_BAG_CALIB_BACKOFF:
    case PACKER_STATE_BAG_OUT:
        return APP_CFG_LED_CALIB_BLINK_MS;
    case PACKER_STATE_SEAL_HOLD:
        return APP_CFG_LED_HOLD_BLINK_MS;
    case PACKER_STATE_ERROR:
        return APP_CFG_LED_ERROR_BLINK_MS;
    default:
        return APP_CFG_LED_RUN_BLINK_MS;
    }
}</code></pre>
<p>LED 切换时输出日志：</p>
<pre><code class="language-text">if ((state != s_last_led_state) || (blink_period != s_last_led_period_ms)) {
    BSP_LOG_INF("LED_MAP state=%s period=%lums", psh_state_name(state),
                (unsigned long)blink_period);
    s_last_led_state = state;
    s_last_led_period_ms = blink_period;
}</code></pre>
<h2>十二、已知 Bug 修复</h2>
<h3>12.1 Per-Cycle 阶段状态残留</h3>
<p>在早期版本中，<code>pact_apply_per_cycle_actions()</code> 内部的 6 个阶段跟踪变量声明为 <code>static</code> 局部变量，作用域仅限于函数内部。当故障发生时，<code>psh_enter_error()</code> 直接切换状态到 ERROR，MotorTask 可能尚未执行到重置这些变量的 else 分支，导致阶段状态残留。</p>
<p><strong>根因</strong>：故障恢复后新出袋进入 PREHEAT 时，<code>s_bag_prep_phase</code> 仍然保持 CLOSE 值，而新周期的 elapsed_ms=0 也计算出 CLOSE，跳变检测 <code>phase != s_bag_prep_phase</code> 判定为假，风机请求被跳过。</p>
<p><strong>修复</strong>：将 6 个 static 局部变量提升为文件作用域：</p>
<pre><code class="language-c">typedef enum {
    PACT_BAG_PREP_PHASE_IDLE = 0,
    PACT_BAG_PREP_PHASE_CLOSE,
    PACT_BAG_PREP_PHASE_PRE_OPEN
} pact_bag_prep_phase_t;

static pact_bag_prep_phase_t s_bag_prep_phase = PACT_BAG_PREP_PHASE_IDLE;
static pact_bag_finish_phase_t s_bag_finish_phase = PACT_BAG_FINISH_PHASE_IDLE;
static pact_reset_phase_t s_reset_last_phase = PACT_RESET_PHASE_IDLE;
static uint8_t s_reset_pusher_active = 0U;
static sm_self_check_flap_drive_t s_self_check_flap_drive =
    SM_SELF_CHECK_FLAP_DRIVE_STOP;
static sm_self_check_dc1_drive_t s_self_check_dc1_drive =
    SM_SELF_CHECK_DC1_DRIVE_STOP;</code></pre>
<p>新增显式重置函数：</p>
<pre><code class="language-c">void packer_actuator_reset_per_cycle_phases(void)
{
    s_bag_prep_phase      = PACT_BAG_PREP_PHASE_IDLE;
    s_bag_finish_phase    = PACT_BAG_FINISH_PHASE_IDLE;
    s_reset_last_phase    = PACT_RESET_PHASE_IDLE;
    s_reset_pusher_active = 0U;
    s_self_check_flap_drive = SM_SELF_CHECK_FLAP_DRIVE_STOP;
    s_self_check_dc1_drive  = SM_SELF_CHECK_DC1_DRIVE_STOP;
}</code></pre>
<p>在 <code>psh_enter_error()</code> 中同步调用：</p>
<pre><code class="language-c">void psh_enter_error(uint8_t alarm_code) {
    // ... 停止所有执行器 ...
    packer_actuator_stop_all_release_all();
    packer_actuator_reset_per_cycle_phases();  // 确保阶段状态归零
    // ...
}</code></pre>
<h3>12.2 静态指针跨周期覆盖</h3>
<p>早期版本中，<code>pact_apply_state_action()</code> 使用静态指针指向当前步进动作结构体。当多个状态快速切换（特别是在 stop→start 之间被其他调用中断）时，静态指针可能被覆盖，导致 PRESS_OPEN 阶段的轴 3/4 双轴动作丢失。</p>
<p><strong>修复</strong>：动作结构体从静态指针改为栈上分配：</p>
<pre><code class="language-text">// 栈上分配动作结构体，消除静态指针覆盖风险
app_stepper_flow_action_t stepper_action;
app_dual_stepper_flow_action_t dual_stepper_action;</code></pre>
<p>每次调用 <code>pact_apply_state_action()</code> 都使用新的栈内存，彻底消除了跨调用覆盖的可能性。</p>
</div>
