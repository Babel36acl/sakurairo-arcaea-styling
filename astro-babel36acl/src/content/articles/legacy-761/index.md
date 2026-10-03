---
title: "加热器软件 PWM 设计"
description: "关键词：STM32F103、IR2104 H-Bridge、NMOS 继电器、软件 PWM、packer_power_limit、 ..."
published: "2026-05-29"
updated: "2026-08-18"
permalink: "/2026/05/29/加热器软件-pwm-设计/"
draft: false
categories: ["嵌入式实战"]
tags: []
legacyId: 761
---

<div class="arcaea-wrap">
<blockquote>
<p>关键词：STM32F103、IR2104 H-Bridge、NMOS 继电器、软件 PWM、packer_power_limit、FreeRTOS、功率管理框架</p>
<div class="arcaea-mermaid-box"><pre class="mermaid">flowchart TB
    subgraph TASK[packer_heater_task_once]
        T1[读取目标温度]
        T2{PID 计算}
        T2 --&gt;|需加热| T3[翻转 GPIO]
        T2 --&gt;|关闭| T4[GPIO 低]
    end
    subgraph PWM[软件 PWM]
        P1[100ms 周期]
        P2[占空比调节]
    end
    TASK --&gt; PWM --&gt;|TIM5 CH1 已禁用| GPIO[加热继电器]
    style TASK fill:transparent,stroke:#8dc7ff,color:#eaf4ff
    style PWM fill:transparent,stroke:#8dc7ff,color:#eaf4ff</pre></div>
</blockquote>
<hr>
<h2>1. 背景：为什么需要统一功率控制？</h2>
<p>在 DEVICE_CO 的 INDL_CONTROLLER 系列工业控制器中，一块控制板上同时存在多种功率负载：大功率阻性加热器、两台有刷直流电机、散热风扇、料斗输送电机等。早期版本中，每个负载的启动和关闭是分散处理的——上层应用直接调用 GPIO 操作或继电器驱动。这种架构在功能简单时足够，但一旦需要引入过流保护、功率统计和动态限流时，问题立刻暴露：<strong>没有一个统一的入口点可以拦截和控制所有功率操作</strong>。</p>
<p>加热器使用电磁继电器（非固态继电器，无硬件 PWM 能力），最初尝试用 TIM5 CH1 硬件 PWM 直接驱动，结果继电器机械吸合/释放时间远超 PWM 载波周期，导致触点抖动、电弧、寿命急剧缩短，并产生严重的 EMI 干扰。</p>
<p>DC 电机方面，系统使用 IR2104 半桥驱动芯片驱动 4 个 NMOS 构成全 H 桥，需要在 BSP 层精确控制启动时序、停止时序、方向切换。每类负载有自己的硬件特性和安全约束，但又共享同一电源总线——因此需要一个统一的功率管理框架来协调。</p>
<p>这就是本文要阐述的三层体系：<strong>加热器软件 PWM、DC 电机 BSP 驱动、统一功率限幅框架 packer_power_limit</strong>。</p>
<hr>
<h2>2. 硬件基础</h2>
<h3>2.1 负载总览</h3>
<p>整个系统包含 6 类功率负载，每类通过独立硬件通道控制：</p>
<div class="arcaea-table-wrap" data-bac-table-shell="1"><table>
<tr>
<th>负载类型</th>
<th>数量</th>
<th>驱动方式</th>
<th>GPIO / 定时器</th>
</tr>
<tr>
<td>DC 电机 1 (MOTOR_1)</td>
<td>1</td>
<td>IR2104 H-Bridge (TIM1 CH1/CH1N)</td>
<td>INH/INL/SD + 互补 PWM</td>
</tr>
<tr>
<td>DC 电机 2 (MOTOR_2)</td>
<td>1</td>
<td>IR2104 H-Bridge (TIM8 CH1/CH1N)</td>
<td>INH/INL/SD + 互补 PWM</td>
</tr>
<tr>
<td>加热器 (Heater)</td>
<td>1</td>
<td>NMOS 继电器 (PA0)</td>
<td>GPIO 电平翻转</td>
</tr>
<tr>
<td>散热风扇 (Fan)</td>
<td>1</td>
<td>NMOS 继电器 (PA1)</td>
<td>GPIO 电平翻转</td>
</tr>
<tr>
<td>料斗输送 (Hopper Conveyor)</td>
<td>1</td>
<td>NMOS 继电器 (PA6)</td>
<td>GPIO 电平翻转</td>
</tr>
<tr>
<td>备用继电器 (Spare)</td>
<td>1</td>
<td>NMOS 继电器 (PB1)</td>
<td>GPIO 电平翻转</td>
</tr>
</table></div>
<h3>2.2 GPIO 映射</h3>
<p>所有 GPIO 来自 STM32CubeMX 生成的 <code>main.h</code> 宏定义，BSP 层只引用宏、不硬编码引脚值：</p>
<pre><code class="language-text">/* 继电器 GPIO 资源表（静态表驱动） */
static const relay_gpio_t s_relay_gpios[RELAY_COUNT] = {
    [RELAY_HEATER]  = { .port = GPIOA, .pin = GPIO_PIN_0 },
    [RELAY_FAN]     = { .port = GPIOA, .pin = GPIO_PIN_1 },
    [RELAY_HOPPER]  = { .port = GPIOA, .pin = GPIO_PIN_6 },
    [RELAY_SPARE]   = { .port = GPIOB, .pin = GPIO_PIN_1 },
};</code></pre>
<h3>2.3 DC 电机 IR2104 H-Bridge 硬件拓扑</h3>
<p>每路电机采用 IR2104 半桥驱动 + 4 个 NMOS 构成全 H 桥。IR2104 使用 3 线控制：INH（高侧输入）、INL（低侧输入）、SD（关断/使能）。STM32 输出经 IR2104 转换为高侧/低侧栅极信号。TIM1/TIM8 输出互补 PWM（含死区插入）。</p>
<div class="arcaea-table-wrap" data-bac-table-shell="1"><table>
<tr>
<th>信号</th>
<th>电机 1</th>
<th>电机 2</th>
<th>定时器</th>
</tr>
<tr>
<td>PWM (CH1/CH1N)</td>
<td>TIM1 CH1 / CH1N</td>
<td>TIM8 CH1 / CH1N</td>
<td>互补输出 + 死区</td>
</tr>
<tr>
<td>INH (GPIO)</td>
<td>GPIO 输出</td>
<td>GPIO 输出</td>
<td>高侧逻辑输入</td>
</tr>
<tr>
<td>INL (GPIO)</td>
<td>GPIO 输出</td>
<td>GPIO 输出</td>
<td>低侧逻辑输入</td>
</tr>
<tr>
<td>SD (GPIO)</td>
<td>GPIO 输出</td>
<td>GPIO 输出</td>
<td>关断信号，低电平有效</td>
</tr>
</table></div>
<hr>
<h2>3. 加热器软件 PWM —— 继电器 + 100ms 窗口翻转</h2>
<h3>3.1 为什么不用硬件 PWM</h3>
<p>加热器执行机构为一枚普通电磁继电器。早期版本错误地使用 TIM5 CH1 硬件 PWM 输出模式直接驱动——继电器触点的机械动作时间约为 5~10ms，远高于 PWM 载波周期（~1ms），高频开关只会导致触点抖动、电蚀、电磁干扰，最终烧毁继电器和保温层。</p>
<p><strong>正确方案</strong>：废除 TIM5 的 PWM 配置，改为 GPIO 电平翻转 + 软件窗口计时，以 100ms 为基准窗口做 ON/OFF 分配。这才是本文所谓"软件 PWM"的本质。</p>
<h3>3.2 基本参数</h3>
<div class="arcaea-table-wrap" data-bac-table-shell="1"><table>
<tr>
<th>参数</th>
<th>值</th>
<th>说明</th>
</tr>
<tr>
<td>基准周期</td>
<td>100ms（可运行时配置）</td>
<td>软件窗口总时长</td>
</tr>
<tr>
<td>最小 ON 宽度</td>
<td>1ms</td>
<td>零占空比保护</td>
</tr>
<tr>
<td>占空比上限</td>
<td>200‰（20.0%）</td>
<td>硬编码安全限幅——不可逾越</td>
</tr>
<tr>
<td>任务周期</td>
<td>10ms</td>
<td>HeaterTask 专用任务</td>
</tr>
</table></div>
<h3>3.3 HeaterTask 独立任务</h3>
<p>加热器控制由一个独立的 FreeRTOS 任务 HeaterTask 负责，运行周期固定为 <strong>10ms</strong>。该任务不与执行机构（actuator）混合在同一循环中，保证了加热控制的实时性不受其他逻辑拖累。</p>
<p>同期在同一任务中还处理了 <strong>散热风扇控制</strong>，通过跨任务标志位 <code>indl_controller_heater_fan_request()</code> 驱动。</p>
<h3>3.4 窗口化 PWM 计算算法</h3>
<p>核心思想：将一个完整的 PWM 周期（例如 100ms）等分为 10ms 窗口，在每个窗口决定是否输出 ON。使用累加器进行滚动判断，<strong>无浮点运算</strong>，适合嵌入式环境：</p>
<pre><code class="language-c">static uint8_t compute_target_output(uint16_t duty_per_mille,
                                     uint16_t period_ms)
{
    uint16_t on_window_ms;
    static uint16_t acc_window_ms = 0;

    /* 限幅：不超过 200‰ */
    if (duty_per_mille &gt; HEATER_MAX_DUTY_PER_MILLE) {
        duty_per_mille = HEATER_MAX_DUTY_PER_MILLE;
    }

    /* 计算 ON 时间（ms），最小 1ms 保护 */
    on_window_ms = (period_ms * duty_per_mille) / 1000;
    if (on_window_ms == 0 &amp;&amp; duty_per_mille &gt; 0) {
        on_window_ms = 1;
    }

    /* 窗口滚动判断 */
    if (acc_window_ms &lt; on_window_ms) {
        acc_window_ms += HEATER_TASK_PERIOD_MS; /* 10ms */
        return 1; /* ON */
    } else {
        acc_window_ms += HEATER_TASK_PERIOD_MS;
        if (acc_window_ms &gt;= period_ms) {
            acc_window_ms = 0; /* 周期复位 */
        }
        return 0; /* OFF */
    }
}</code></pre>
<h3>3.5 20% 安全限幅的来历</h3>
<p><code>RCFG_ID_HEATER_DUTY_PER_MILLE</code> 的取值范围为 0~200，超过 200 的值会被 <strong>硬编码限幅</strong> 到 200（即 20.0%）。该限幅来自一次真实现场事故——因配置错误导致 100% 占空比持续加热，继电器粘连、保温层烧穿、机台起火。此后所有产品强制上限为 20.0%。</p>
<blockquote>
<p>安全限幅必须硬编码，不可由运行时参数覆盖。一次真实起火事故让整个产品线加上了 <code>HEATER_MAX_DUTY_PER_MILLE</code> 这个不可逾越的上限。</p>
</blockquote>
<h3>3.6 跨任务标志与临界区</h3>
<p>风扇请求、强制加热等信号来自其他任务（如通信任务、状态机任务），通过 <strong>volatile 全局标志 + 临界区保护</strong> 传入 HeaterTask：</p>
<pre><code class="language-c">/* 跨任务标志定义 */
static volatile uint8_t heater_fan_request;
static volatile uint8_t heater_force_on;

/* 临界区访问 */
void indl_controller_heater_fan_request(void)
{
    taskENTER_CRITICAL();
    heater_fan_request = 1;
    taskEXIT_CRITICAL();
}

uint8_t indl_controller_heater_fan_consume(void)
{
    uint8_t ret;
    taskENTER_CRITICAL();
    ret = heater_fan_request;
    heater_fan_request = 0;
    taskEXIT_CRITICAL();
    return ret;
}</code></pre>
<h3>3.7 强制加热与预热逻辑</h3>
<p>工业流程中某些步骤需要在开始前将温度快速提升到目标值（预热），此时 PWM 算法的渐近调功不适用。为此设计了跨任务强制加热机制，可在任意任务中调用 <code>indl_controller_heater_force_on_now()</code>，立即全功率输出，无需等待 PWM 周期对齐。</p>
<h3>3.8 功率限制门控</h3>
<p>继电器输出受 <strong>功率限制门控</strong> 控制。当系统处于功率限制模式（如电源过载、紧急降功率），即使 PWM 计算结果为 ON，实际也不允许吸合继电器：</p>
<pre><code class="language-c">static void write_relay(uint8_t target_on)
{
    /* 功率限制门控 */
    if (indl_controller_power_limit_request_relay_read()) {
        GPIO_ResetBits(HEATER_RELAY_GPIO_PORT, HEATER_RELAY_PIN);
        return;
    }

    /* 系统状态检查：ERROR / RESET 时自动关闭 */
    if (sys_state == SYS_STATE_ERROR ||
        sys_state == SYS_STATE_RESET) {
        GPIO_ResetBits(HEATER_RELAY_GPIO_PORT, HEATER_RELAY_PIN);
        return;
    }

    if (target_on) {
        GPIO_SetBits(HEATER_RELAY_GPIO_PORT, HEATER_RELAY_PIN);
    } else {
        GPIO_ResetBits(HEATER_RELAY_GPIO_PORT, HEATER_RELAY_PIN);
    }
}</code></pre>
<hr>
<h2>4. DC 电机 BSP 驱动 —— IR2104 H-Bridge + NMOS Relay</h2>
<h3>4.1 IR2104 前级反相特性（最容易踩坑的地方）</h3>
<p>IR2104 的输入逻辑是 <strong>反相的</strong>：MCU 输出 HIGH 到 IR2104 的 INH/INL 引脚时，IR2104 实际输出 LOW 给 MOS 管栅极（即关断）。反之，MCU 输出 LOW 时，IR2104 才输出 HIGH 开启 MOS 管。</p>
<p><strong>关键推论</strong>：当 MCU 将 INH 和 INL 都置为 HIGH 时，IR2104 两侧均输出 LOW → H 桥上下管全部关闭 → <strong>安全状态</strong>。不仅如此，这种状态还允许自举电容充电，为下次 PWM 启动做准备。这就是 <strong>"Pre-stage HIGH is safe + bootstrap charge"</strong> 的设计原则。</p>
<h3>4.2 停止时序 (Stop Sequence)</h3>
<p>正确的停止顺序分为三步：</p>
<pre><code class="language-text">1. 停止 PWM 输出                → TIM_Cmd(TIMx, DISABLE)
2. 拉低 SD 引脚                 → GPIO_ResetBits(SD_PORT, SD_PIN)
3. 将 INH 和 INL 均置 HIGH     → 进入安全状态 + 自举充电</code></pre>
<p><strong>为什么先停 PWM 再拉 SD？</strong> 如果先拉 SD 再停 PWM，在 SD 拉低到 PWM 停止的间隙内，IR2104 可能处于不确定状态，导致 MOS 管直通（shoot-through）。严格时序：PWM 停止 → SD 拉低 → 强制 INH/INL HIGH。</p>
<h3>4.3 启动时序 (Start Sequence)</h3>
<p><strong>正转 (Forward)：</strong></p>
<pre><code class="language-text">1. INL 强制 HIGH(MCU) = IR2104 INL LOW  → 低侧 MOS 关断
2. INH 输出 PWM 波形                   → IR2104 INH 跟随 PWM
3. SD 置 HIGH（使能）                   → 启动 TIM CH1N 互补通道
→ 电流路径：电源 → 高侧 MOS → 电机 → 低侧 MOS (通过另一侧半桥)</code></pre>
<p><strong>反转 (Reverse)：</strong></p>
<pre><code class="language-text">1. INH 强制 HIGH(MCU) = IR2104 INH LOW  → 高侧 MOS 关断
2. INL 输出 PWM 波形                   → IR2104 INL 跟随 PWM
3. SD 置 HIGH（使能）                   → 启动 TIM CH1 主通道
→ 电流路径反向</code></pre>
<h3>4.4 PWM 占空比限制 —— 96% 上限</h3>
<p>IR2104 使用自举电容为上管驱动供电。当占空比接近 100% 时，自举电容没有足够的充电时间，导致上管驱动电压不足而关断。实际限制：PWM 占空比上限为 <strong>96%</strong>，下限取决于开关频率和死区。在驱动层通过 <code>__HAL_TIM_SET_COMPARE()</code> 之前对占空比进行钳位。</p>
<blockquote>
<p>任何时候都不应输出 0% 或 100% 的占空比。0% 意味着长期无 PWM 翻转，自举电容放电殆尽；100% 意味着无低侧导通时间，无法充电。</p>
</blockquote>
<h3>4.5 方向切换 —— Stop-Then-Start</h3>
<p>方向切换 <strong>不允许直接反转</strong>。必须执行完整的 Stop Sequence → 等待安全状态 → 再执行新方向的 Start Sequence：</p>
<pre><code class="language-text">bsp_dc_motor_stop(motor_id);
delay_ms(5);           /* 等待 MOS 完全关断 + 自举充电 */
bsp_dc_motor_start(motor_id, direction, speed);</code></pre>
<p>这 5ms 的延迟窗口确保了 H 桥不会出现瞬间直通。</p>
<h3>4.6 继电器重复写入抑制</h3>
<p>继电器写入函数实现了 <strong>重复写入抑制</strong> 机制，使用 8-bit 位掩码 <code>s_relay_active_mask</code> 实时记录各继电器当前状态，重复写入时直接返回 OK：</p>
<pre><code class="language-c">static int relay_write_checked(uint8_t relay_id, uint8_t state)
{
    /* 重复抑制：检查当前状态是否已经是目标状态 */
    uint8_t current = (s_relay_active_mask &gt;&gt; relay_id) &amp; 0x01U;
    if (current == state)
        return BSP_DC_MOTOR_OK;   /* 跳过 GPIO 写入 */

    /* 更新屏蔽字并写入 GPIO */
    if (state) {
        s_relay_active_mask |=  (1U &lt;&lt; relay_id);
        GPIO_SetBits(s_relay_gpios[relay_id].port, s_relay_gpios[relay_id].pin);
    } else {
        s_relay_active_mask &amp;= ~(1U &lt;&lt; relay_id);
        GPIO_ResetBits(s_relay_gpios[relay_id].port, s_relay_gpios[relay_id].pin);
    }
    return BSP_DC_MOTOR_OK;
}</code></pre>
<h3>4.7 停止策略：两种 Stop API</h3>
<div class="arcaea-table-wrap" data-bac-table-shell="1"><table>
<tr>
<th>API</th>
<th>停止内容</th>
<th>继电器状态</th>
<th>使用场景</th>
</tr>
<tr>
<td><code>stop_all()</code></td>
<td>所有电机 + 所有继电器</td>
<td>全部关闭</td>
<td>紧急停止、系统复位</td>
</tr>
<tr>
<td><code>stop_all_motors()</code></td>
<td>仅停止电机</td>
<td>保持当前状态</td>
<td>工艺暂停、轻故障恢复</td>
</tr>
</table></div>
<hr>
<h2>5. 统一功率限幅框架 —— packer_power_limit</h2>
<h3>5.1 框架定位</h3>
<p><code>packer_power_limit</code> 框架的核心思路：<strong>给所有功率操作加一个统一的前置评估层</strong>。所有电机启动和继电器写入都必须经过 <code>packer_power_limit_request_*</code> 系列函数，没有任何旁路路径。</p>
<p>框架定义了 6 种负载类型，每种独立跟踪功率：</p>
<pre><code class="language-c">typedef enum {
    LOAD_DC_MOTOR1  = 0,
    LOAD_DC_MOTOR2  = 1,
    LOAD_HEATER     = 2,
    LOAD_FAN        = 3,
    LOAD_HOPPER_CONVEYOR = 4,
    LOAD_RELAY4     = 5,
    LOAD_TYPE_COUNT = 6
} load_type_t;</code></pre>
<h3>5.2 核心数据流：measure → predict → latch → limit</h3>
<p>框架采用四段式流水线架构：</p>
<pre><code class="language-text">ADC 采样 → 滑动平均滤波 → 实测功率更新
                    │
         预测功率 = 当前值 + 新负载增量
         （饱和加法）
                    │
          ┌──────────────────────────┐
          │  是否超过动态限值？        │
          │  (measured &gt; dynamic_limit)│
          └─────────────┬────────────┘
                    │
            是 ────┴──── 否
          ┌─────────┐   ┌─────────┐
          │ 触发锁存  │   │ 正常通过  │
          │ latched=1│   │ latch不变│
          └─────────┘   └─────────┘</code></pre>
<h3>5.3 测量链路</h3>
<ul>
<li><strong>ADC 通道</strong>：ADC1_IN4（PA4 引脚），分流电阻上的压降 → 差分放大 → ADC 采样</li>
<li><strong>4 点滑动平均滤波器</strong>：ADC 读数经过 4 点滑动平均滤波去噪。4 点的选择是典型的<strong>实时性与平滑度的折中</strong>——太长会延迟过流响应，太短则噪声抑制不足</li>
<li><strong>饱和安全加法</strong>：功率预计算使用饱和加法，避免意外溢出导致错误判断：<code>static uint32_t sat_add(uint32_t a, uint32_t b) { uint32_t sum = a + b; if (sum &lt; a) sum = UINT32_MAX; return sum; }</code></li>
</ul>
<h3>5.4 锁存机制与迟滞</h3>
<p>锁存（latch）一旦触发，不会在功率回落到阈值以下时立即释放。它使用<strong>迟滞（hysteresis）</strong>：</p>
<ul>
<li><strong>触发阈值</strong>：<code>dynamic_limit_mw</code>（动态限值）</li>
<li><strong>释放阈值</strong>：<code>dynamic_limit_mw × 0.8</code>（80% 回退）</li>
<li><strong>锁定标记</strong>：<code>load_power_state_t.latched</code></li>
<li>只有滤波后的功率低于释放阈值时，锁存才会清除</li>
</ul>
<blockquote>
<p>这种设计防止了在阈值边界处反复触发/释放的"抖动"问题，是工业控制中标准做法。</p>
</blockquote>
<h3>5.5 动态限值：按流程类型切换</h3>
<p>不同工作流程有不同的功率预算：</p>
<pre><code class="language-c">typedef enum {
    FLOW_TYPE_BAG       = 0,   /* 灌装流程 */
    FLOW_TYPE_SELF_CHECK = 1,  /* 自检流程 */
    FLOW_TYPE_SEAL      = 2,   /* 封口流程 */
    FLOW_TYPE_RESET     = 3,   /* 复位流程 */
    FLOW_TYPE_COUNT     = 4
} flow_type_t;

static uint32_t get_flow_limit_mw(flow_type_t flow) {
    static const uint32_t limits[FLOW_TYPE_COUNT] = {
        [FLOW_TYPE_BAG]       = 500000,  /* 500W */
        [FLOW_TYPE_SELF_CHECK] = 500000, /* 500W */
        [FLOW_TYPE_SEAL]      = 500000,  /* 500W */
        [FLOW_TYPE_RESET]     = 500000,  /* 500W */
    };
    return limits[flow];
}</code></pre>
<h3>5.6 "阈值全部设为最大值，当前表现为直通模式"——先搭骨架，再校准</h3>
<p>这是整个框架最令人玩味的地方。当前配置中：</p>
<div class="arcaea-table-wrap" data-bac-table-shell="1"><table>
<tr>
<th>参数</th>
<th>当前值</th>
<th>备注</th>
</tr>
<tr>
<td>各流程动态限值</td>
<td>500W</td>
<td>远超实际负载功率（直通模式）</td>
</tr>
<tr>
<td>各负载 profile 值</td>
<td>100W</td>
<td>仅为占位符</td>
</tr>
<tr>
<td>告警触发</td>
<td>已定义但从不触发</td>
<td><code>APP_ALARM_POWER_OVER_LIMIT (0x0E)</code></td>
</tr>
</table></div>
<p>这种"先上线、后校准"的策略在工业项目中很常见，原因如下：</p>
<ol>
<li><strong>功能完整性优先</strong>：先确保评估引擎、锁存机制、日志记录等所有功能链路完整跑通</li>
<li><strong>避免回归风险</strong>：阈值设得太小会意外触发保护，干扰功能测试</li>
<li><strong>数据驱动的校准</strong>：先用直通模式跑一段时间，收集实际功率数据，再据此设定合理阈值</li>
<li><strong>渐进式部署</strong>：第一阶段做计量（accounting），第二阶段做警告（warning），第三阶段做硬限流（hard limit）</li>
</ol>
<h3>5.7 决策快照 —— 为审计做准备</h3>
<p>框架为每次请求生成了完整的<strong>决策快照（decision snapshot）</strong>：</p>
<pre><code class="language-c">typedef struct {
    load_type_t load;
    flow_type_t flow;
    uint32_t    predicted_power_mw;
    uint32_t    current_limit_mw;
    bool        would_exceed;
    bool        latched;
    uint32_t    timestamp_ms;
} power_decision_snapshot_t;</code></pre>
<p>这意味着即使现在是直通，未来某天阈值调小后，可以回查历史记录，分析哪些操作"本应被阻止"——<strong>设计上已经做好了审计准备</strong>。</p>
<hr>
<h2>6. 集成：加热器、DC 电机、继电器如何统一经过 power_limit</h2>
<h3>6.1 分层架构</h3>
<p>整个功率控制体系分为三个清晰的层次：</p>
<pre><code class="language-text">┌─────────────────────────────────────────────────────┐
│                  Application Layer                   │
│     (bag filling / self-check / seal / reset)        │
└────────────┬───────────────────────────────┬─────────┘
             │ start_motor_X()              │ relay_write()
             ▼                              ▼
┌──────────────────────────────────────────────────────┐
│             packer_power_limit_request_*()            │ ← 统一入口
│                                                       │
│  ┌──────────────┐  ┌─────────────┐  ┌───────────┐   │
│  │ Measurement   │→ │ Limit       │→ │ Policy    │   │
│  │ (ADC filter)  │  │   Eval      │  │ Latch     │   │
│  └──────────────┘  └─────────────┘  └───────────┘   │
└──────────────────────────┬───────────────────────────┘
                           ▼
┌──────────────────────────────────────────────────────┐
│           BSP Layer (bsp_dc_motor)                    │
│  GPIO / PWM / Relay / Motor Driver Operations        │
└──────────────────────────────────────────────────────┘</code></pre>
<p><strong>关键设计点</strong>：所有电机启动和继电器写入都必须经过 <code>packer_power_limit_request_*</code> 系列函数，BSP 层只负责"能否执行"，不关心"应该执行多少功率"。</p>
<h3>6.2 集成流程示例</h3>
<p>以加热器 PWM 驱动为例，完整的调用链：</p>
<pre><code class="language-c">/* HeaterTask 每 10ms 执行一次 */
void heater_task_once(void)
{
    /* 1. 强制加热？ */
    if (indl_controller_heater_force_on_consume()) {
        /* 通过 power_limit 检查 */
        if (packer_power_limit_request_relay_write(
                LOAD_HEATER, current_flow, HEATER_PROFILE_MW) == POWER_LIMIT_OK) {
            write_relay(1);
        }
        return;
    }

    /* 2. 读取运行时参数 → 窗口 PWM 计算 */
    uint16_t duty = rcfg_read_u16(RCFG_ID_HEATER_DUTY_PER_MILLE);
    uint16_t period = rcfg_read_u16(RCFG_ID_HEATER_PWM_PERIOD_MS);
    uint8_t target = compute_target_output(duty, period);

    /* 3. 通过 power_limit 检查后写继电器 */
    if (target) {
        if (packer_power_limit_request_relay_write(
                LOAD_HEATER, current_flow, HEATER_PROFILE_MW) == POWER_LIMIT_OK) {
            write_relay(1);
        } else {
            write_relay(0);
        }
    } else {
        write_relay(0);
    }
}</code></pre>
<p>DC 电机同理：</p>
<pre><code class="language-text">/* 启动电机前必须先经过 power_limit */
packer_power_limit_result_t result;
result = packer_power_limit_request_start_motor(
             LOAD_DC_MOTOR1, current_flow, MOTOR1_PROFILE_MW);

if (result == POWER_LIMIT_OK) {
    bsp_dc_motor_start(MOTOR_1, DIR_FORWARD, speed);
} else {
    /* 被限流阻止，记录告警 */
    app_alarm_trigger(APP_ALARM_POWER_OVER_LIMIT);
}</code></pre>
<h3>6.3 BSP 层的纯正性</h3>
<p>功率限制逻辑在 <strong>BSP 层之外</strong>实现，位于上层的 <code>packer_actuator</code> / <code>packer_heater</code> 模块。这种设计保持了 BSP 层的纯正性——BSP 只提供原子化的硬件控制原语（start / stop / set_duty），上层策略层组合这些原语实现功率管理、安全联锁、工艺时序。</p>
<hr>
<h2>7. 设计经验与教训</h2>
<div class="arcaea-table-wrap" data-bac-table-shell="1"><table>
<tr>
<th>决策</th>
<th>方案</th>
<th>理由</th>
</tr>
<tr>
<td>加热器控制方式</td>
<td>GPIO 翻转（非硬件 PWM）</td>
<td>继电器机械特性不适用高频 PWM</td>
</tr>
<tr>
<td>加热 PWM 实现</td>
<td>窗口累加算法</td>
<td>简单可靠，无浮点运算</td>
</tr>
<tr>
<td>最大占空比（加热器）</td>
<td>硬编码 200‰</td>
<td>防止配置错误导致的起火事故</td>
</tr>
<tr>
<td>DC 电机方向切换</td>
<td>Stop-Then-Start</td>
<td>防止 H 桥直通（shoot-through）</td>
</tr>
<tr>
<td>PWM 占空比（电机）</td>
<td>96% 上限</td>
<td>IR2104 自举电容充电需求</td>
</tr>
<tr>
<td>功率评估策略</td>
<td>先直通、后校准</td>
<td>功能完整性优先，避免回归风险</td>
</tr>
<tr>
<td>锁存释放</td>
<td>80% 回退迟滞</td>
<td>防止阈值边界抖动</td>
</tr>
<tr>
<td>跨任务通信</td>
<td>volatile + 临界区</td>
<td>轻量级，适用于标志类信号</td>
</tr>
<tr>
<td>功率门控</td>
<td>独立函数层</td>
<td>统一处理所有输出抑制场景</td>
</tr>
<tr>
<td>最小 ON 时间</td>
<td>1ms</td>
<td>避免零占空比导致的除零异常</td>
</tr>
<tr>
<td>继电器写入</td>
<td>重复写入抑制</td>
<td>减少 GPIO 总线访问，延长继电器寿命</td>
</tr>
</table></div>
<h3>7.1 教训一：不要因为 MCU 有硬件 PWM 就想当然地用它驱动继电器</h3>
<blockquote>
<p>继电器是机电元件，不是功率 MOSFET。100ms 级别的软件翻转才是正确的打开方式。</p>
</blockquote>
<h3>7.2 教训二：安全限幅必须硬编码</h3>
<blockquote>
<p>安全限幅必须硬编码，不可由运行时参数覆盖。一次真实起火事故让整个产品线加上了 HEATER_MAX_DUTY_PER_MILLE 这个不可逾越的上限。</p>
</blockquote>
<h3>7.3 教训三：IR2104 的前级反相特性必须在 BSP 层显式建模</h3>
<blockquote>
<p>"Pre-stage HIGH is safe + bootstrap charge" 是设计原则。初始化、停止、方向切换前的过渡状态，均保持 INH = INL = HIGH。在任何代码审查中，只要看到 INH 或 INL 直接接地而没有经过逻辑转换，就需要打上红色标记。</p>
</blockquote>
<h3>7.4 教训四：框架的价值在于为未来铺好轨道</h3>
<blockquote>
<p>packer_power_limit 框架的真正价值不在于它现在保护了什么，而在于它为未来的保护铺好了所有轨道。当实际负载数据收集完成、阈值校准后，只需修改几个 #define 就能从"计量"切换到"保护"模式——而代价是零代码重构。</p>
</blockquote>
<h3>7.5 预热阶段的价值</h3>
<blockquote>
<p>预热阶段的强制加热 API 是流程控制的关键接口。在批量生产中，预热时间每优化 1 秒都有商业价值——但前提是安全限幅不能被 bypass。</p>
</blockquote>
<hr>
<h2>8. 结语</h2>
<p>本文介绍的三层功率控制体系已在 DEVICE_CO 的 INDL_CONTROLLER 系列产品上稳定运行多个版本。从加热器用 100ms 窗口做正确的事（继电器 ON/OFF），到 DC 电机用 IR2104 严格时序确保 H 桥安全，再到 packer_power_limit 用"先搭骨架、再校准"的架构给所有功率操作加上统一的前置评估层——这套体系经过了真实现场故障的检验：</p>
<ul>
<li>硬件 PWM 误用 → 起火事故 → 限幅硬编码 → 跨任务预热接口</li>
<li>IR2104 前级反相踩坑 → Pre-stage HIGH 安全原则 → Stop-Then-Start 方向切换</li>
<li>功率管理分散 → packer_power_limit 统一入口 → 直通模式收集数据 → 未来校准</li>
</ul>
<p>核心思路可以概括为一句话：<strong>用正确的时机做正确的事，用硬编码的安全上限兜住失控的配置，用分层架构隔离关注点。</strong></p>
<hr>
<p><em>—— DEVICE_CO 嵌入式团队，技术博客系列 · 功率控制专题</em></p>
</div>
