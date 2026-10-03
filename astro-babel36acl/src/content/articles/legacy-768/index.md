---
title: "嵌入式子状态机协作：5个流程的协同设计"
description: "发表于 2026-05-29 · 分类：嵌入式实战 · 预计阅读 12 分钟 一、问题的提出 在一个典型的工业控制器项目中，我们面 ..."
published: "2026-05-29"
updated: "2026-08-18"
permalink: "/2026/05/29/嵌入式子状态机协作：5个流程的协同设计/"
draft: false
categories: ["嵌入式实战"]
tags: []
legacyId: 768
---

<p><!-- Arcaea CSS -->
<link rel="stylesheet" href="https://arcaea.babel36acl.xyz/static/css/arcaea.css">
</p><div class="arcaea-article">
<p class="arcaea-meta">发表于 2026-05-29 · 分类：嵌入式实战 · 预计阅读 12 分钟</p>
<hr>
<h2>一、问题的提出</h2>
<p>在一个典型的工业控制器项目中，我们面对的往往不是单一的状态机，而是多个彼此独立的物理流程并存：物料输送、热压合、自检、工具定位、外围服务触发。如果把这些流程塞进一个巨大的状态机，代码会迅速膨胀到不可维护。</p>
<p>更好的做法是：<strong>每个流程独立为一个子状态机（Sub-State-Machine）</strong>，通过一个中央调度器统一驱动。本文以 INDL_CONTROLLER 平台上的 5 个协作子状态机为例，深入剖析这种架构的注册—回调—协作机制。</p>
<hr>
<h2>二、总体架构：回调注册中心</h2>
<p>整个系统的核心是 <code>packer_state_handler</code>（以下简称 PSH）——一个回调注册中心。每个子状态机在初始化时调用 <code>psh_register_module()</code>，注册三组回调：</p>
<ul>
<li><strong>on_enter(state)</strong> — 进入某个状态时执行一次</li>
<li><strong>on_run(state)</strong> — 每个调度周期执行，可发起状态迁移</li>
<li><strong>on_exit(state)</strong> — 离开状态前的清理</li>
</ul>
<p>上层的 <code>StateMachineTask</code>（FreeRTOS 任务）以固定周期遍历 PSH 注册表，依次调用每个模块的 <code>on_run</code>，形成协作式调度。</p>
<pre class="arcaea-code-block"><code class="language-c">// 注册接口示意
typedef struct {
    psh_state_t  state;
    psh_cb_t     on_enter;
    psh_cb_t     on_run;
    psh_cb_t     on_exit;
    uint32_t     timeout_ms;
} psh_module_t;

void psh_register_module(psh_module_t *mod);

// StateMachineTask 主循环
void StateMachineTask(void *param) {
    while (1) {
        psh_run_all();   // 遍历所有注册模块，调用 on_run
        vTaskDelay(pdMS_TO_TICKS(10));
    }
}</code></pre>
<hr>
<h2>三、5 个模块全景</h2>
<p>本项目包含 5 个协作单元，其中 4 个是子状态机，1 个是工具库：</p>
<div class="arcaea-table-wrap" data-bac-table-shell="1"><table class="arcaea-table">
<thead>
<tr>
<th>模块名</th>
<th>类型</th>
<th>状态数</th>
<th>职责</th>
</tr>
</thead>
<tbody>
<tr>
<td><code>sm_phase1_flow</code></td>
<td>子状态机</td>
<td>8</td>
<td>阶段一物料输送流程（原 bag flow）</td>
</tr>
<tr>
<td><code>sm_phase2_flow</code></td>
<td>子状态机</td>
<td>7</td>
<td>阶段二接合/热压流程（原 seal flow）</td>
</tr>
<tr>
<td><code>sm_self_check</code></td>
<td>子状态机</td>
<td>2 主态 + 7 子阶段</td>
<td>上电自检与校准</td>
</tr>
<tr>
<td><code>sm_cylinder_util</code></td>
<td>工具库（非状态机）</td>
<td>—</td>
<td>气缸运动曲线、脉冲限幅、超时底限</td>
</tr>
<tr>
<td><code>sm_printer_service</code></td>
<td>异步服务</td>
<td>—</td>
<td>按物料位置触发的打印触发（async arm/cancel/poll）</td>
</tr>
</tbody>
</table></div>
<hr>
<h2>四、sm_phase1_flow：8 态阶段一流转</h2>
<p>阶段一（物料从料仓到工位）包含 8 个状态：</p>
<pre class="arcaea-code-block"><code class="language-c">typedef enum {
    CALIB_CHECK,       // 校准条件检查
    CALIB_CLEAR,       // 校准前归零
    CALIB_SEEK,        // 寻找物理零点
    CALIB_BACKOFF,     // 零点后退避让
    PHASE1_DISPENSE,   // 物料输出（原 bag_out）
    PREHEAT,           // 预热等待
    PHASE2_FORWARD,    // 将物料送入接合位（原 seal_forward）
    CONVEYOR_RUN       // 输送带运转
} sm_phase1_state_t;</code></pre>
<p>核心逻辑在 <code>PHASE1_DISPENSE</code> 状态：它根据步进电机配置参数动态计算输送长度，加上 800ms 安全余量作为超时时间，然后触发步进电机脉冲序列。完成信号来自编码器反馈或 Home 传感器。</p>
<pre class="arcaea-code-block"><code class="language-c">static psh_event_t on_run_phase1_dispense(psh_state_t state) {
    // 动态超时 = 步进脉冲总数 × 脉冲周期 + 800ms 余量
    uint32_t total_pulses = param_get_u32(PARAM_STEPPER_TOTAL);
    uint32_t period_us    = param_get_u32(PARAM_STEPPER_PERIOD);
    uint32_t timeout_ms   = (total_pulses * period_us) / 1000 + 800;

    psh_transition(state, timeout_ms);

    stepper_start(total_pulses, period_us);
    return PSH_EVENT_BUSY;
}</code></pre>
<hr>
<h2>五、sm_phase2_flow：7 态阶段二接合</h2>
<p>阶段二（热压接合与分离）包含 7 个状态：</p>
<pre class="arcaea-code-block"><code class="language-c">typedef enum {
    PHASE2_BACKWARD,     // 接合头后退
    CYLINDER_EXTEND,     // 气缸伸出（原 press_retract）
    CYLINDER_CLOSE,      // 气缸夹紧（原 press_close）
    PHASE2_HOLD,         // 保压保持
    TEAR_OFF,            // 撕裂分离
    CYLINDER_RETRACT,    // 气缸收回（原 press_open）
    RESET                // 复位
} sm_phase2_state_t;</code></pre>
<p>关键依赖：<code>CYLINDER_RETRACT</code> 状态并不是自己完成的——它<strong>委托</strong>给 <code>sm_self_check</code> 模块中的轴回退逻辑。这种跨模块的状态委派是本文的核心设计模式之一。</p>
<pre class="arcaea-code-block"><code class="language-c">static psh_event_t on_run_cylinder_retract(psh_state_t state) {
    // 跨模块委托：让 self_check 的轴2回退逻辑来执行
    if (sm_self_check_delegate_axis2_retract() == PSH_EVENT_COMPLETE) {
        return PSH_EVENT_COMPLETE;
    }
    return PSH_EVENT_BUSY;
}</code></pre>
<hr>
<h2>六、sm_self_check：带 7 个子阶段的自检状态机</h2>
<p>自检状态机只有 2 个主要状态（<code>POWER_ON</code>、<code>SELF_CHECK</code>），但 <code>SELF_CHECK</code> 内部通过一个隐藏的 <code>sub_stage</code> 枚举推进 7 个子阶段：</p>
<pre class="arcaea-code-block"><code class="language-c">typedef enum {
    SUB_FLAP_PHASE,              // 挡板测试
    SUB_PRINTER_CHECK,           // 打印头检查
    SUB_BOOT_CALIB,              // 引导校准（委托 sm_phase1_flow）
    SUB_POST_CALIB_RETURN,       // 校准后回退
    SUB_PRESS_AXIS2_RETURN,      // 压头轴2回退（依赖 sm_cylinder_util）
    SUB_PRESS_DUAL_TEST,         // 双轴联动测试
    SUB_DC1_BACKWARD             // DC1 反转归位
} self_check_sub_stage_t;</code></pre>
<p>其中 <code>SUB_BOOT_CALIB</code> 阶段<strong>委托</strong>给 <code>sm_phase1_flow</code> 执行开环校准——无超时保护，完成后返回 <code>PSH_EVENT_BOOT_BAG_CALIB_COMPLETE</code> 事件。</p>
<pre class="arcaea-code-block"><code class="language-c">static psh_event_t run_sub_boot_calib(void) {
    // 开环校准：无超时，等待完成事件
    sm_phase1_flow_start_boot_calib();

    // 让出调度，等待 sm_phase1_flow 发回完成信号
    return PSH_EVENT_BUSY;
}

// sm_phase1_flow 校准完成后调用
void sm_phase1_flow_on_boot_calib_done(void) {
    psh_post_event(PSH_EVENT_BOOT_BAG_CALIB_COMPLETE);
    // sm_self_check 的 on_run 检测到此事件后推进子阶段
}</code></pre>
<hr>
<h2>七、sm_cylinder_util：无状态的工具库</h2>
<p><code>sm_cylinder_util</code> 不是状态机，而是一个纯工具库，提供 6 种预定义的气缸运动曲线：</p>
<pre class="arcaea-code-block"><code class="language-c">typedef enum {
    PROFILE_RETRACT,              // 收回曲线
    PROFILE_CLOSE,                // 夹紧曲线
    PROFILE_OPEN_AXIS2_RETURN,    // 轴2回退
    PROFILE_OPEN_DUAL_RETURN,     // 双轴回退
    PROFILE_SELF_CHECK_AXIS2_RET, // 自检轴2回退
    PROFILE_SELF_CHECK_MOVE_OPEN  // 自检移开
} cylinder_profile_t;

typedef struct {
    uint32_t pulse_count;
    uint32_t pulse_period_us;
    uint32_t acceleration_steps;
    uint32_t timeout_floor_ms;
} cylinder_motion_t;

const cylinder_motion_t *cylinder_get_profile(cylinder_profile_t profile);</code></pre>
<p>每个运动曲线包含：脉冲总数、脉冲周期、加速步数、超时底限。调用者拿到参数后传给步进驱动层执行。这样做的好处是：<strong>运动参数集中管理</strong>，<code>sm_phase2_flow</code> 和 <code>sm_self_check</code> 共享同一组曲线定义，避免参数不一致。</p>
<hr>
<h2>八、sm_printer_service：异步打印触发服务</h2>
<p>打印机触发与物料位置联动——在 <code>PHASE1_DISPENSE</code> 即将完成时预触发打印，确保打印在接合前完成。这是一个典型的异步服务模式：</p>
<pre class="arcaea-code-block"><code class="language-c">// 服务接口
void printer_arm(uint32_t delay_ms);       // 预装备，设置延迟触发
void printer_cancel(void);                  // 取消（用于异常回退）
printer_status_t printer_poll(void);        // 查询完成状态

// sm_phase1_flow 中调用
static psh_event_t on_run_phase1_dispense(psh_state_t state) {
    // ... 步进电机开始输送后 ...
    printer_arm(200);  // 200ms 后触发打印
    // 打印机异步工作，不影响状态机推进
    return PSH_EVENT_BUSY;
}</code></pre>
<p>打印状态通过 <code>printer_poll()</code> 查询，结果被映射为标准 PSH 事件（<code>PSH_EVENT_COMPLETE</code> 或 <code>PSH_EVENT_ERROR</code>）。</p>
<hr>
<h2>九、跨模块协作关系图</h2>
<p>各个子状态机之间的依赖关系如下：</p>
<pre class="arcaea-code-block"><code class="language-text">┌─────────────────────────────────────────────────────┐
│                   StateMachineTask                   │
│              (10ms 周期调度 PSH 注册表)               │
└──────┬──────────┬──────────┬──────────┬──────────────┘
       │          │          │          │
       ▼          ▼          ▼          ▼
┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐
│ sm_phase1│ │ sm_phase2│ │sm_self   │ │sm_printer    │
│ _flow    │◄┤ _flow    │◄┤_check    │ │_service      │
│ (8态)    │ │ (7态)    │ │(2+7态)   │ │ (async)      │
└────┬─────┘ └────┬─────┘ └────┬─────┘ └──────┬───────┘
     │            │            │               │
     │            │    ┌───────┘               │
     │            │    │                       │
     │            ▼    ▼                       │
     │     ┌──────────────────┐                │
     └────►│ sm_cylinder_util │◄───────────────┘
           │  (6 profiles)    │
           └──────────────────┘

依赖关系：
  sm_phase2_flow  ──depends on──► sm_cylinder_util
  sm_self_check   ──depends on──► sm_cylinder_util
  sm_self_check   ──delegates to─► sm_phase1_flow (boot calib)
  sm_phase2_flow  ──delegates to─► sm_self_check   (cylinder_retract)
  sm_phase1_flow  ──uses──► sm_printer_service</code></pre>
<hr>
<h2>十、超时与错误处理机制</h2>
<p>每个子状态迁移都伴随一个软件定时器：</p>
<pre class="arcaea-code-block"><code class="language-text">psh_result_t psh_transition(psh_state_t next_state, uint32_t timeout_ms);

// 超时后自动进入错误状态
void psh_enter_error(uint16_t alarm_code);</code></pre>
<p>IN1 位置传感器用于轴 2 回退监控，支持防抖（debounced）和原始（raw）两种读取模式，带运动检测门控：</p>
<pre class="arcaea-code-block"><code class="language-c">typedef struct {
    uint8_t  raw_level;         // 原始电平
    uint8_t  debounced_level;   // 防抖后电平
    uint8_t  motion_seen;       // 是否检测到边沿跳变
    uint32_t stable_ticks;      // 稳定持续时间
} in1_sensor_t;

// 超时计算示例：从运动曲线取参数，加上安全余量
uint32_t calc_axis2_timeout(const cylinder_motion_t *m) {
    uint32_t base = (m-&gt;pulse_count * m-&gt;pulse_period_us) / 1000;
    return MAX(base + 500, m-&gt;timeout_floor_ms);
}</code></pre>
<hr>
<h2>十一、跨状态机事件系统</h2>
<p>子状态机之间的通信不依赖直接函数调用，而是通过 PSH 的事件总线（event bus）进行发布/订阅。这是实现松耦合跨模块协作的关键基础设施。</p>
<h3>11.1 事件类型定义</h3>
<pre class="arcaea-code-block"><code class="language-c">// PSH 事件枚举（部分）
typedef enum {
    PSH_EVENT_NONE,                     // 无事件
    PSH_EVENT_COMPLETE,                 // 状态完成（通用）
    PSH_EVENT_BUSY,                     // 执行中
    PSH_EVENT_ERROR,                    // 通用错误
    PSH_EVENT_TIMEOUT,                  // 超时触发

    // 跨 SM 专用事件
    PSH_EVENT_BOOT_BAG_CALIB_COMPLETE,  // sm_phase1_flow 引导校准完成
    PSH_EVENT_PRINTER_READY,            // 打印就绪
    PSH_EVENT_AXIS2_RETRACT_DONE,       // 轴2回退完成
    PSH_EVENT_DUAL_TEST_PASS,           // 双轴联动测试通过
    PSH_EVENT_CALIB_SEEK_DONE,          // 零点寻找完成
} psh_event_t;</code></pre>
<h3>11.2 事件发布与订阅机制</h3>
<p>事件总线的核心是 <code>psh_post_event()</code> 和 <code>psh_wait_event()</code>：</p>
<pre class="arcaea-code-block"><code class="language-c">// 事件总线接口
void      psh_post_event(psh_event_t evt);           // 发布事件（非阻塞）
psh_event_t psh_wait_event(uint32_t timeout_ms);      // 阻塞等待事件
bool      psh_peek_event(psh_event_t evt);            // 查询事件是否已发生（非阻塞）
void      psh_clear_event(psh_event_t evt);           // 清除已消费的事件

// 典型用法：sm_self_check 等待引导校准完成
static psh_event_t run_sub_boot_calib(void) {
    sm_phase1_flow_start_boot_calib();
    // 非阻塞轮询，每周期检查事件状态
    if (psh_peek_event(PSH_EVENT_BOOT_BAG_CALIB_COMPLETE)) {
        psh_clear_event(PSH_EVENT_BOOT_BAG_CALIB_COMPLETE);
        return PSH_EVENT_COMPLETE;
    }
    return PSH_EVENT_BUSY;
}</code></pre>
<h3>11.3 事件传播路径</h3>
<p>以引导校准为例，事件流的完整路径如下：</p>
<pre class="arcaea-code-block"><code class="language-text">sm_self_check                  sm_phase1_flow               事件总线
     │                              │                          │
     │  sm_phase1_flow_start_       │                          │
     │  _boot_calib() ─────────────►│                          │
     │                              │                          │
     │                              │  开环校准执行...         │
     │                              │                          │
     │                              │  psh_post_event(         │
     │                              │    BOOT_BAG_CALIB_       │
     │                              │    COMPLETE) ────────────► 事件入队
     │                              │                          │
     │  psh_peek_event(             │                          │
     │    BOOT_BAG_CALIB_           │                          │
     │    COMPLETE) ◄─────────────────────────────────────────── 事件可读
     │                              │                          │
     │  psh_clear_event(...)        │                          │
     │  推进到下一子阶段             │                          │</code></pre>
<p>这种事件总线机制使得：</p>
<ul>
<li><strong>生产者与消费者完全解耦</strong>——<code>sm_phase1_flow</code> 不需要知道谁在监听校准完成事件</li>
<li><strong>支持一对多广播</strong>——同一事件可被多个模块订阅（如 <code>PSH_EVENT_ERROR</code> 可同时触发日志记录和急停）</li>
<li><strong>非阻塞查询</strong>——接收方在 on_run 中轮询事件，不影响调度周期</li>
<li><strong>事件优先级</strong>——错误事件（<code>PSH_EVENT_ERROR</code>）在总线中有最高优先级，优先于普通完成事件被消费</li>
</ul>
<hr>
<h2>十二、压头运动曲线详解</h2>
<p><code>sm_cylinder_util</code> 中的 6 条运动曲线服务于压头组件，每条曲线定义了完整的脉冲序列参数。以下逐一拆解其设计意图和超时策略。</p>
<h3>12.1 PROFILE_RETRACT（收回曲线）</h3>
<div class="arcaea-table-wrap" data-bac-table-shell="1"><table class="arcaea-table">
<thead>
<tr>
<th>参数</th>
<th>典型值</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td><code>pulse_count</code></td>
<td>3200</td>
<td>全行程收回脉冲数</td>
</tr>
<tr>
<td><code>pulse_period_us</code></td>
<td>50</td>
<td>20kHz 脉冲频率</td>
</tr>
<tr>
<td><code>acceleration_steps</code></td>
<td>200</td>
<td>前 200 步线性加速到目标频率</td>
</tr>
<tr>
<td><code>timeout_floor_ms</code></td>
<td>300</td>
<td>超时下限，防止参数误设为 0</td>
</tr>
</tbody>
</table></div>
<p>收回曲线是压头的标准归位动作，从任意位置执行软限位内的安全回退。超时计算：<code>(3200 × 50) / 1000 = 160ms</code>，取超时底限 300ms，最终超时 = <code>MAX(160 + 500, 300) = 660ms</code>。</p>
<h3>12.2 PROFILE_CLOSE（夹紧曲线）</h3>
<div class="arcaea-table-wrap" data-bac-table-shell="1"><table class="arcaea-table">
<thead>
<tr>
<th>参数</th>
<th>典型值</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td><code>pulse_count</code></td>
<td>1800</td>
<td>热压夹紧行程</td>
</tr>
<tr>
<td><code>pulse_period_us</code></td>
<td>80</td>
<td>12.5kHz，夹紧需较低速度以保持力矩</td>
</tr>
<tr>
<td><code>acceleration_steps</code></td>
<td>150</td>
<td>柔和加速，防止冲击</td>
</tr>
<tr>
<td><code>timeout_floor_ms</code></td>
<td>500</td>
<td>偏大的底限，允许物料厚度波动</td>
</tr>
</tbody>
</table></div>
<p>夹紧曲线在热压阶段使用，要求平稳接触。注意 <code>timeout_floor_ms</code> 设为 500ms 而非 300ms，因为夹紧过程中物料厚度变化会导致实际行程偏移。</p>
<h3>12.3 PROFILE_OPEN_AXIS2_RETURN（轴2回退）</h3>
<div class="arcaea-table-wrap" data-bac-table-shell="1"><table class="arcaea-table">
<thead>
<tr>
<th>参数</th>
<th>典型值</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td><code>pulse_count</code></td>
<td>4000</td>
<td>轴2从极限位置回退到安全区</td>
</tr>
<tr>
<td><code>pulse_period_us</code></td>
<td>60</td>
<td>16.6kHz</td>
</tr>
<tr>
<td><code>acceleration_steps</code></td>
<td>300</td>
<td>较长加速段，减少急停风险</td>
</tr>
<tr>
<td><code>timeout_floor_ms</code></td>
<td>800</td>
<td>最长的底限，应对长行程</td>
</tr>
</tbody>
</table></div>
<p>轴2回退用于热压完成后将压头从物料表面分离。这是整个系统中脉冲数量最大的运动，因此 <code>timeout_floor_ms</code> 设为 800ms，配合 IN1 传感器位置反馈做双重保险。</p>
<h3>12.4 PROFILE_OPEN_DUAL_RETURN（双轴回退）</h3>
<p>双轴回退在自检双轴联动测试后使用，参数与轴2单轴回退类似，但两轴交替执行步进脉冲序列以避免共振：</p>
<pre class="arcaea-code-block"><code class="language-c">static void dual_return_sequence(void) {
    // 轴1、轴2交替步进，每轴 2 步为一次交换
    for (uint32_t i = 0; i &lt; 2000; i++) {
        stepper_step(AXIS1, 1);   // 轴1走1步
        stepper_step(AXIS2, 1);   // 轴2走1步
        delay_us(30);             // 交错延迟防共振
    }
}</code></pre>
<p>双轴回退的超时计算为单轴的两倍加上 200ms 交错延迟：<code>((4000 × 60) / 1000 × 2) + 200 = 680ms</code>，取超时底限 1000ms。</p>
<h3>12.5 自检专用曲线</h3>
<p><code>PROFILE_SELF_CHECK_AXIS2_RET</code> 和 <code>PROFILE_SELF_CHECK_MOVE_OPEN</code> 是自检阶段专有的低功率版本：脉冲周期更长（100μs，10kHz），加速度更柔和，避免在校准过程中对机械结构造成冲击。</p>
<pre class="arcaea-code-block"><code class="language-text">// 自检轴2回退——低速保护模式
const cylinder_motion_t self_check_axis2_ret = {
    .pulse_count       = 2000,
    .pulse_period_us   = 100,       // 10kHz 低速
    .acceleration_steps = 400,      // 更长加速段
    .timeout_floor_ms  = 1200,      // 宽松超时
};</code></pre>
<hr>
<h2>十三、动态超时机制深度分析</h2>
<p>静态超时（固定 <code>timeout_ms</code>）不足以应对步进电机负载变化、物料规格差异等运行时因素。动态超时机制根据当前配置参数和传感器反馈实时计算超时值，是系统鲁棒性的核心保障。</p>
<h3>13.1 三级超时模型</h3>
<p>PSH 的超时系统采用三级模型：</p>
<pre class="arcaea-code-block"><code class="language-text">// 第一级：计算超时（基于运动参数）
uint32_t timeout_calc = (pulse_count * pulse_period_us) / 1000 + SAFETY_MARGIN_MS;

// 第二级：底限保护（防止参数误设为 0 或极小值）
uint32_t timeout_clamped = MAX(timeout_calc, profile-&gt;timeout_floor_ms);

// 第三级：全局硬上限（防止无限等待）
uint32_t timeout_final = MIN(timeout_clamped, GLOBAL_TIMEOUT_MAX_MS);</code></pre>
<div class="arcaea-table-wrap" data-bac-table-shell="1"><table class="arcaea-table">
<thead>
<tr>
<th>级别</th>
<th>名称</th>
<th>计算方式</th>
<th>保护场景</th>
</tr>
</thead>
<tbody>
<tr>
<td>L1</td>
<td>计算超时</td>
<td><code>脉冲数 × 周期 + 安全余量</code></td>
<td>正常负载、标准物料</td>
</tr>
<tr>
<td>L2</td>
<td>底限保护</td>
<td><code>MAX(L1, timeout_floor_ms)</code></td>
<td>参数配置错误（脉冲数=0 等）</td>
</tr>
<tr>
<td>L3</td>
<td>全局硬上限</td>
<td><code>MIN(L2, GLOBAL_MAX)</code></td>
<td>传感器故障导致无完成信号</td>
</tr>
</tbody>
</table></div>
<p><code>GLOBAL_TIMEOUT_MAX_MS</code> 在系统中统一设置为 5000ms（5秒），任何状态都不会无限制等待。</p>
<h3>13.2 动态超时的自适应调整</h3>
<p>某些场景下，首次超时后系统会自动放宽限制并重试：</p>
<pre class="arcaea-code-block"><code class="language-c">// 带重试的超时策略
typedef struct {
    uint32_t base_timeout_ms;     // 基础超时
    uint32_t retry_multiplier;    // 重试倍率（默认 1.5x）
    uint8_t  max_retries;         // 最大重试次数（默认 2）
    uint32_t retry_delta_ms;      // 每次附加增量（默认 200ms）
} dynamic_timeout_strategy_t;

static psh_event_t on_run_with_retry(psh_state_t state) {
    static uint8_t  retry_count = 0;
    static uint32_t current_timeout;

    if (psh_is_first_entry(state)) {
        // 首次进入：使用基础超时
        current_timeout = calc_dynamic_timeout(PARAM_STEPPER_TOTAL,
                                                PARAM_STEPPER_PERIOD);
        retry_count = 0;
    }

    if (sensor_feedback_received()) {
        retry_count = 0;
        return PSH_EVENT_COMPLETE;
    }

    if (psh_timeout_elapsed()) {
        if (retry_count &lt; MAX_RETRIES) {
            retry_count++;
            // 放宽超时限制
            current_timeout = current_timeout * 1.5 + 200;
            psh_reset_timeout(current_timeout);
            log_warn("Timeout retry %d, new timeout=%d ms",
                     retry_count, current_timeout);
            return PSH_EVENT_BUSY;
        }
        // 累计超时次数超限，上报错误
        return PSH_EVENT_ERROR;
    }
    return PSH_EVENT_BUSY;
}</code></pre>
<h3>13.3 传感器辅助的超时判定</h3>
<p>动态超时的完成判定不仅仅依赖于定时器到期，还结合硬件传感器做早停（early termination）：</p>
<pre class="arcaea-code-block"><code class="language-c">static bool is_motion_complete(cylinder_profile_t profile) {
    const cylinder_motion_t *m = cylinder_get_profile(profile);

    switch (profile) {
    case PROFILE_RETRACT:
        // Home 传感器变高 → 已回到原点
        return sensor_read(IN1_DEBOUNCED) == SENSOR_HIGH;

    case PROFILE_CLOSE:
        // 编码器脉冲计数达到目标值 → 夹紧到位
        return encoder_get_count() &gt;= m-&gt;pulse_count;

    case PROFILE_OPEN_AXIS2_RETURN:
        // IN1 边缘未检测到 + 已走完脉冲 → 认为到位
        return !in1_sensor.motion_seen &amp;&amp;
               stepper_get_remaining() == 0;

    default:
        // 通用判定：脉冲队列为空
        return stepper_is_idle();
    }
}</code></pre>
<p>这种传感器辅助判定使得超时值是真正的"最坏情况保护"，在正常情况下是通过传感器信号提前完成，而不是等到超时到期。</p>
<h3>13.4 动态超时参数表</h3>
<div class="arcaea-table-wrap" data-bac-table-shell="1"><table class="arcaea-table">
<thead>
<tr>
<th>状态</th>
<th>计算超时公式</th>
<th>底限</th>
<th>重试策略</th>
<th>传感器早停</th>
</tr>
</thead>
<tbody>
<tr>
<td><code>PHASE1_DISPENSE</code></td>
<td><code>N_pulse × T_period + 800ms</code></td>
<td>1200ms</td>
<td>1.5x × 2 次</td>
<td>编码器脉冲计数</td>
</tr>
<tr>
<td><code>CYLINDER_CLOSE</code></td>
<td><code>N_pulse × T_period + 500ms</code></td>
<td>500ms</td>
<td>无重试（保护物料）</td>
<td>编码器脉冲计数</td>
</tr>
<tr>
<td><code>CYLINDER_RETRACT</code></td>
<td><code>N_pulse × T_period + 500ms</code></td>
<td>800ms</td>
<td>1.5x × 1 次</td>
<td>IN1 Home 传感器</td>
</tr>
<tr>
<td><code>SUB_BOOT_CALIB</code></td>
<td>无超时（开环等待事件）</td>
<td>3000ms</td>
<td>—</td>
<td>事件 <code>PSH_EVENT_BOOT_BAG_CALIB_COMPLETE</code></td>
</tr>
<tr>
<td><code>TEAR_OFF</code></td>
<td>固定 2000ms</td>
<td>2000ms</td>
<td>无重试</td>
<td>撕裂检测传感器跳变</td>
</tr>
</tbody>
</table></div>
<p>注意 <code>SUB_BOOT_CALIB</code> 是唯一的"无计算超时"状态——它完全依赖事件总线传递完成信号，只设一个宽松的全局底限 3 秒作为防死锁保护。</p>
<hr>
<h2>十四、设计模式总结</h2>
<ol>
<li><strong>回调注册中心</strong>（PSH）：每个子状态机独立注册，中央调度器统一驱动。新增流程 = 新增 .c 文件 + 注册回调，零侵入。</li>
<li><strong>状态委托</strong>：一个状态机的某个状态可以委托另一个状态机完成工作，通过事件发布/订阅通信。</li>
<li><strong>工具库模式</strong>：共享运动参数通过无状态库提供，避免重复定义和参数漂移。</li>
<li><strong>异步服务</strong>：外围设备（打印机）通过 arm/cancel/poll 接口与服务对象解耦。</li>
<li><strong>事件总线</strong>：跨模块事件发布/订阅机制，支持一对多广播、事件优先级、非阻塞轮询，是实现松耦合的核心。</li>
<li><strong>压头曲线集中管理</strong>：6 条预定义运动曲线封装脉冲参数、加速轮廓和超时底限，各模块通过 <code>cylinder_get_profile()</code> 统一获取。</li>
<li><strong>三级超时模型</strong>：计算超时 → 底限保护 → 全局硬上限，结合传感器早停和自适应重试，在鲁棒性和响应速度之间取得平衡。</li>
<li><strong>动态超时</strong>：根据配置参数实时计算超时值（如 phase1_dispense 的步进电机超时），适应不同物料规格。</li>
</ol>
<hr>
<h2>十五、适用场景与局限</h2>
<p>这套架构特别适合：</p>
<ul>
<li>多个物理流程并行或交错运行的工业控制器</li>
<li>状态数量中等（单机 5~15 态），但流程间有协作需求</li>
<li>需要支持热插拔式流程增删</li>
<li>涉及步进电机运动控制，需要精确超时计算和传感器辅助完成判定</li>
</ul>
<p>局限：</p>
<ul>
<li>所有子状态机运行在同一个 FreeRTOS 任务中，不适合计算密集型子模块</li>
<li>跨模块委托引入隐式耦合，需要通过事件接口严格隔离</li>
<li>调试时需同时追踪多个子状态机的状态，建议配合 <code>psh_dump_state()</code> 日志工具</li>
<li>事件总线为单线程模型，不适合高吞吐量的跨核心通信</li>
</ul>
<blockquote class="arcaea-blockquote">
<p><strong>下篇预告</strong>：我们将深入 <code>sm_self_check</code> 的自检子阶段调度器，看看子阶段如何优雅地嵌套、暂停和恢复——一种「状态机中的状态机」实现。</p>
</blockquote>
</div>
