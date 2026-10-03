---
title: "同定时器多轴联动：四路步进共享一个 TIM 的工程实践"
description: "TIM4 只有一个 ARR，四个通道共享同一频率。运行位图、start_group 同步启动、手动通道关闭避坑、二次挂轴不重置软起步——来自 1121 行步进驱动的真实工程经验。"
published: "2026-05-28"
updated: "2026-08-18"
permalink: "/2026/05/28/shared-timer-multi-axis-stepper/"
draft: false
categories: ["嵌入式实战"]
tags: ["ARCH"]
legacyId: 547
---

<div class="arcaea-wrap">
<p><span class="tag">嵌入式实战</span> <span class="tag">步进电机</span></p>
<p>STM32F103 的 TIM4 只有一个 ARR（自动重装载寄存器），但四个通道各自有独立的 CCR（比较寄存器）。这意味着四个步进轴共享同一个脉冲频率——要么同频运行，要么停。这就是"共享 ARR"架构。</p>
<h2>硬件约束</h2>
<pre><code class="language-yaml">TIM4: 1 MHz 计数时钟
  ┌─ CH1 (TIM_CHANNEL_1) → ST1 PUL  轴1
  ├─ CH2 (TIM_CHANNEL_2) → ST2 PUL  轴2
  ├─ CH3 (TIM_CHANNEL_3) → ST3 PUL  轴3
  └─ CH4 (TIM_CHANNEL_4) → ST4 PUL  轴4

ARR = tim_tick_hz / pulse_hz - 1     ← 共享（4 轴同频）
CCR = period_ticks / 2               ← 独立（每轴 50% 占空比）</code></pre>
<p>四个通道的使能位在 CCER 寄存器中是独立的，所以可以单独开关每个通道的 PWM 输出。但 ARR 只有一个——频率对所有人一样。</p>
<h2>硬件映射表</h2>
<p>逻辑轴编号到物理引脚的映射集中在一张表里：</p>
<pre><code class="language-text">static const bsp_stepper_hw_map_t s_maps[BSP_STEPPER_AXIS_COUNT] = {
    {ST1_EN_GPIO_Port, ST1_EN_Pin, ST1_DIR_GPIO_Port, ST1_DIR_Pin, TIM_CHANNEL_1},
    {ST2_EN_GPIO_Port, ST2_EN_Pin, ST2_DIR_GPIO_Port, ST2_DIR_Pin, TIM_CHANNEL_2},
    {ST3_EN_GPIO_Port, ST3_EN_Pin, ST3_DIR_GPIO_Port, ST3_DIR_Pin, TIM_CHANNEL_3},
    {ST4_EN_GPIO_Port, ST4_EN_Pin, ST4_DIR_GPIO_Port, ST4_DIR_Pin, TIM_CHANNEL_4},
};</code></pre>
<p>每个轴三根信号线：EN（使能）、DIR（方向）、PUL（脉冲）。PUL 来自 TIM4 的 PWM 输出，EN 和 DIR 是普通 GPIO。</p>
<h2>运行位图</h2>
<p>系统通过一个 8 位的 <code>s_stepper_running_mask</code> 跟踪哪些轴在运行。bit0=轴1，bit1=轴2，bit2=轴3，bit3=轴4：</p>
<pre><code class="language-c">static volatile uint8_t s_stepper_running_mask = 0U;
// bit0=轴1, bit1=轴2, bit2=轴3, bit3=轴4

static uint8_t bsp_stepper_axis_mask(bsp_stepper_axis_t axis) {
    return (uint8_t)(1U << (uint32_t)axis);  // axis=0 → 0x01, axis=1 → 0x02
}</code></pre>
<p>启动新轴时，把对应位置 1。停止时清 0。位图全 0 时关闭 TIM4 以减少功耗。</p>
<h2>start_group：多轴同步启动</h2>
<p>关键 API——一条命令启动一组轴，确保它们从同一时刻开始运行：</p>
<pre><code class="language-c">typedef struct {
    bsp_stepper_axis_t  axis;
    bsp_stepper_dir_t   direction;
    uint32_t            pulse_hz;          // 目标频率
    uint32_t            tim_tick_hz;       // TIM 计数时钟
    uint32_t            target_pulses;     // 0=连续
    uint32_t            start_pulse_hz;    // 起步频率（抛物线）
    uint32_t            accel_hz_per_s;
    uint32_t            decel_hz_per_s;
    GPIO_PinState       enable_inactive_level;
    bsp_stepper_finite_stop_mode_t stop_mode;
} bsp_stepper_command_t;

typedef struct {
    uint8_t                  command_count;    // 组内轴数
    const bsp_stepper_command_t *commands;     // 命令数组
} bsp_stepper_group_command_t;

bsp_stepper_result_t bsp_stepper_start_group(const bsp_stepper_group_command_t *group);</code></pre>
<p>内部校验逻辑：</p>
<pre><code class="language-text">// 1. 所有命令的 pulse_hz 必须相同（共享 ARR 约束）
// 2. 所有命令的 tim_tick_hz、start_hz、accel、decel 必须相同
// 3. 不能有重复的轴编号
// 4. 如果已有轴在运行，新轴的频率必须匹配当前频率</code></pre>
<p>使用示例（轴3和轴4同时以 60000 Hz 启动闭合）：</p>
<pre><code class="language-text">bsp_stepper_command_t cmds[2] = {
    {AXIS_3, DIR_FORWARD, 60000, 1000000, 3333,
     2000, 90000, 90000, GPIO_PIN_SET, STOP_IMMEDIATE},
    {AXIS_4, DIR_FORWARD, 60000, 1000000, 3333,
     2000, 90000, 90000, GPIO_PIN_SET, STOP_IMMEDIATE},
};
bsp_stepper_group_command_t group = {2, cmds};
bsp_stepper_start_group(&group);
// 轴3和轴4同时开始发射脉冲，频率一致</code></pre>
<h2>停单轴：不能用 HAL</h2>
<p>一个坑：HAL 的 <code>HAL_TIM_PWM_Stop()</code> 会调用 <code>HAL_TIM_PWM_Stop_IT()</code>，最终执行 <code>__HAL_TIM_DISABLE()</code>——这个宏会关闭整个 TIM 的计数器，所有通道一起停。</p>
<p>解决方案：手动操作通道寄存器，只关闭指定通道的 CCER 位：</p>
<pre><code class="language-c">static void bsp_stepper_disable_axis_channel(bsp_stepper_axis_t axis,
                                              uint8_t disable_irq) {
    uint32_t channel = bsp_stepper_get_axis_map(axis).tim_channel;

    if (disable_irq) {
        __HAL_TIM_DISABLE_IT(&htim4, info->it_mask);    // 关本通道中断
    }
    __HAL_TIM_CLEAR_FLAG(&htim4, info->flag_mask);       // 清中断标志
    TIM_CCxChannelCmd(htim4.Instance, channel, TIM_CCx_DISABLE);  // 关本通道 PWM
    TIM_CHANNEL_STATE_SET(&htim4, channel, READY);

    // 仅在所有通道都关闭后才停 TIM 计数器
    if (bsp_stepper_any_channel_enabled() == 0U) {
        __HAL_TIM_DISABLE(&htim4);
    }
}

// 判断是否还有任何通道使能
static uint8_t bsp_stepper_any_channel_enabled(void) {
    return ((htim4.Instance->CCER & TIM_CCER_CCxE_MASK) != 0U) ? 1U : 0U;
}</code></pre>
<h2>加减速时的同频约束</h2>
<p>加速和减速阶段，四个轴绑定在同一频率上。如果一个轴已经到了 target 需要停，另一个轴还在跑——停一个轴不影响其他轴的频率：</p>
<pre><code class="language-text">// 收尾单个轴：
bsp_stepper_finish_finite_axis(axis) {
    bsp_stepper_disable_axis_channel(axis, 1U);  // 只关本通道
    s_stepper_running_mask &= ~axis_mask;         // 清运行位

    if (s_stepper_running_mask == 0U) {
        // 所有轴都停了，关 TIM4
        s_stepper_active_pulse_hz = 0U;
        bsp_stepper_soft_start_clear();
    }
    // 还有轴在跑——什么都不做，共享频率继续有效
}</code></pre>
<h2>已在运行的轴上挂新轴</h2>
<pre><code class="language-text">if (was_running != 0U) {
    // 已有轴在跑 → 新轴直接挂入当前共享频率
    // 不重置软起步窗口，避免"二次起步"造成顿挫
    for (每个命令) {
        bsp_stepper_apply_channel_pulse(cmd->axis, ...);
        bsp_stepper_write_enable(cmd->axis, level);
        // 写入方向 + 启动 PWM 通道
    }
    new_running_mask |= 原运行位图;
    s_stepper_running_mask = new_running_mask;
}</code></pre>
<p>这个场景发生在 PRESS_CLOSE 阶段：轴2先下压到达后停，然后轴3/4启动闭合——两者频率相同（60000 Hz），直接挂入。</p>
<h2>频率协商</h2>
<p>当所有轴需要同频时，由上层选择最高频率作为共享频率。例如轴1要 10504 Hz、轴2要 60000 Hz——上层必须决定用哪个。当前实现中等同频率才能同组启动，不同频率需要先后分步启动。</p>
<blockquote>
<p>四路共享 ARR 是硬件约束，不是设计缺陷。它迫使你在设计阶段就考虑"哪些轴会同时跑"——并在接口层用 start_group 多轴命令显式表达。</p>
</blockquote>
