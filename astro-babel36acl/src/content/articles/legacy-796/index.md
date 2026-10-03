---
title: "步进电机完整驱动指南：BSP 驱动层到运动控制算法"
description: "TL;DR：STM32F103 上四轴步进电机驱动从 BSP 层到运动算法的完整工程模式。硬件层用 TMC2209 UART 配置 ..."
published: "2026-05-29"
updated: "2026-06-02"
permalink: "/2026/05/29/步进电机完整驱动指南：bsp-驱动层到运动控制算法/"
draft: false
categories: ["嵌入式实战"]
tags: []
legacyId: 796
---

<p><strong>TL;DR：</strong>STM32F103 上四轴步进电机驱动从 BSP 层到运动算法的完整工程模式。硬件层用 TMC2209 UART 配置 + 共享 TIM4 原子化启停；起步用二次抛物线软启动避免丢步；收尾用 S 曲线 done 优先级 + motion_seen 防残留打破「不等末尾慢脉冲又不误判」的矛盾。</p>
<p>一个 72MHz Cortex-M3 上跑着 4 路步进电机轴，由单个 TIM4 提供 PWM 脉冲，四轴共享同一个自动重装载值（ARR）。项目有 11 个步进动作阶段，短到 PRESS_CLOSE（3333 脉冲），长到 BAG_OUT（50611 脉冲）。TMC2209 驱动芯片通过 UART 单线协议配置，细分 16 微步。</p>
<p>匀加速起步在负载稍大时丢步。七段 S 曲线代码量 200+ 行且需要改写停止逻辑。两个方案都不合适。本文覆盖从硬件配置到运动控制算法的完整工程链路，每个模式都来自生产项目。</p>
<p>本文假设读者熟悉步进电机基本驱动原理、STM32 定时器 PWM 输出和 FreeRTOS 任务调度。</p>
<p>读完本文应该能回答三个问题：</p>
<ul>
<li><strong>二次抛物线为什么比匀加速更适合 STM32 步进电机起步</strong>——从力矩-频率特性到离散 10ms 周期约束的完整推导</li>
<li><strong>S 曲线收尾「优先置 done」和 motion_seen 防残留为什么必须配对使用</strong>——缺一个就会误判运动完成</li>
<li><strong>硬件层、算法层、架构层如何通过动作表解耦</strong>——BSP 不碰控制逻辑，算法不碰停止判定</li>
</ul>
<div class="arcaea-mermaid-box"><pre class="mermaid">graph TB
    subgraph HARDWARE["硬件层"]
        H1["TIM4 四通道 PWM"]
        H2["TMC2209 UART 配置"]
        H3["原子化启停 stepper_start/stop_all"]
        H4["task_once 轮询驱动"]
    end
    subgraph ALGO["运动算法层"]
        A1["二次抛物线软起步
f(s)=2s-s²"]
        A2["S 曲线优先置 done
不等末尾慢脉冲"]
        A3["motion_seen 防残留
清→等→判"]
    end
    subgraph ARCH["架构集成层"]
        I1["动作表 action_entry_t"]
        I2["三种模式统一调度"]
    end
    subgraph TUNING["调参验证层"]
        T1["灵敏度分析"]
        T2["11 阶段参数表"]
        T3["现场日志验证"]
    end
    HARDWARE --&gt; ALGO --&gt; ARCH --&gt; TUNING
    style HARDWARE fill:transparent,stroke:#9db4ff,color:#eef4ff
    style ALGO fill:transparent,stroke:#8ad8ff,color:#eef4ff
    style ARCH fill:transparent,stroke:#c7b6ff,color:#eef4ff
    style TUNING fill:transparent,stroke:#ff9191,color:#eef4ff</pre></div>
<h2>一、硬件层：BSP 驱动架构</h2>
<h3>1.1 TIM4 四通道硬件配置</h3>
<p>基于 STM32F103RCT6，单 TIM4 四通道驱动四轴步进电机。TIM4 是 32 位向上计数定时器，自动重装载值（ARR）决定 PWM 脉冲频率。CH1~CH4 四路独立 OC 比较输出，各驱动一台步进电机的 STEP 引脚。DIR 和 EN 引脚由各轴独立的 GPIO 控制。</p>
<p>每个轴使用 TMC2209 驱动芯片，通过 UART 单线协议配置：</p>
<pre><code class="language-c">// TMC2209 关键寄存器配置
tmc2209_write_reg(GCONF, 0x00000004);     // pdn_disable = 1, 启用 UART
tmc2209_write_reg(CHOICE, 0x00040100);     // microsteps = 16, vsense = 1
tmc2209_write_reg(TPOWERDOWN, 0x00000010); // 自动减电流延迟

// 80 位数据帧格式: sync(0xFF) + addr(8) + data(32) + crc(8)</code></pre>
<h3>1.2 四轴原子化启停</h3>
<p>所有轴同时 start 或 stop，避免轴间时序差导致机械偏移。核心结构体记录每轴状态：</p>
<pre><code class="language-c">typedef struct {
    uint32_t arr;            // TIM4 ARR 值（决定脉冲频率）
    uint32_t pulse_target;   // 目标脉冲数
    uint32_t pulse_emitted;  // 已发出脉冲数
    uint8_t  step_pin;       // STEP 引脚掩码
    uint8_t  dir_pin;        // DIR 引脚
    bool     running;
} stepper_axis_t;

static stepper_axis_t axes[STEPPER_AXIS_MAX];

void stepper_start_all(uint32_t freq_hz, uint32_t pulses) {
    TIM4-&gt;ARR = (1000000 / freq_hz) - 1;
    // 写入所有轴的目标脉冲
    for (int i = 0; i &lt; STEPPER_AXIS_MAX; i++)
        axes[i].pulse_target = pulses;
    TIM4-&gt;CR1 |= TIM_CR1_CEN;   // 所有轴同时开始
}

void stepper_stop_all(void) {
    TIM4-&gt;CR1 &amp;= ~TIM_CR1_CEN;  // 所有轴同时停止
}</code></pre>
<p>四轴共用 ARR 是核心约束：同一时刻所有运行的轴必须使用相同的频率。多轴同步起步时只有一条抛物线曲线，不能出现「轴 3 加速、轴 4 恒速」的状态。</p>
<h3>1.3 task_once 轮询驱动</h3>
<p>在 FreeRTOS 的 10ms 周期任务中轮询 TIM4 状态寄存器，逐轴处理脉冲输出：</p>
<pre><code class="language-c">void stepper_task_once(void) {
    uint32_t sr = TIM4-&gt;SR;
    for (int i = 0; i &lt; STEPPER_AXIS_MAX; i++) {
        if (!axes[i].running) continue;
        if (sr &amp; (TIM_SR_CC1IF &lt;&lt; i)) {
            HAL_GPIO_TogglePin(axes[i].step_port, axes[i].step_pin);
            axes[i].pulse_emitted++;
            if (axes[i].pulse_emitted &gt;= axes[i].pulse_target) {
                axes[i].running = false;
                axes[i].done = true;
            }
        }
    }
}</code></pre>
<p>这是基本的脉冲计数模式。后续的抛物线起步、S 曲线优先置 done、motion_seen 都在这个 task_once 框架内部增量修改，不改变整体架构。</p>
<h2>二、运动算法：二次抛物线起步</h2>
<h3>2.1 力矩-速度关系与起步丢步</h3>
<p>步进电机的输出力矩随速度升高而下降。在低速区（&lt;5000 Hz）力矩充沛，中速区域开始衰减。匀加速方案在力矩最低的高速段仍然使用与低速段相同的加速度——这是失步的直接原因。</p>
<p>二次抛物线起步的核心思想：在起步初期（速度低、力矩充沛）使用较高的加速度，随速度升高（力矩下降）逐步降低加速度。</p>
<h3>2.2 形状函数 f(s) = 2s − s²</h3>
<p>定义归一化时间 $s = t / T_{\text{ramp}},\ s \in [0, 1]$。二次抛物线形状函数满足三个边界条件：</p>
<div class="arcaea-table-wrap" data-bac-table-shell="1"><table>
<tr>
<th>条件</th>
<th>表达式</th>
<th>物理含义</th>
</tr>
<tr>
<td>零起点</td>
<td>$f(0)=0$</td>
<td>起步从起始频率开始</td>
</tr>
<tr>
<td>归一终点</td>
<td>$f(1)=1$</td>
<td>到达目标频率</td>
</tr>
<tr>
<td>最大斜率</td>
<td>$f'(0)=2$</td>
<td>起步时刻加速最快，随后逐渐减小到 0</td>
</tr>
</table></div>
<p>速度曲线：</p>
<p></p><div class="katex-display">$$\text{hz}(s) = f_{\text{start}} + (f_{\text{target}} - f_{\text{start}}) \cdot (2s - s^2)$$</div>

<p>起步窗口长度由加速斜率决定。从加速度积分推导 $T_{\text{ramp}}$：</p>
<p></p><div class="katex-display">$$T_{\text{ramp}} = \left\lceil\frac{1000 \cdot (f_{\text{target}} - f_{\text{start}})}{\text{accel\_hz\_per\_s}}\right\rceil \quad \text{[ms]}$$</div>

<h3>2.3 与线性加速的对比</h3>
<div class="arcaea-table-wrap" data-bac-table-shell="1"><table>
<tr>
<th>特性</th>
<th>线性加速</th>
<th>二次抛物线</th>
</tr>
<tr>
<td>起步瞬间加速度</td>
<td>$a_{\max}$（从 0 跳变）</td>
<td>$a_{\max}$（从最大值连续开始）</td>
</tr>
<tr>
<td>加速度变化率</td>
<td>0（恒定）</td>
<td>线性递减</td>
</tr>
<tr>
<td>高速段加速度</td>
<td>$a_{\max}$（与低速相同）</td>
<td>$\to 0$（匹配力矩下降）</td>
</tr>
<tr>
<td>对负载变化的容忍度</td>
<td>低</td>
<td>高</td>
</tr>
</table></div>
<h3>2.4 10ms 离散化系统分析</h3>
<p>MotorTask 周期 10ms，速度更新只能发生在离散时刻 $t_n = n \cdot 10\,\text{ms}$。起步窗口被离散化为 $N_{\text{ramp}} = T_{\text{ramp}} / 10\,\text{ms}$ 个更新点。</p>
<p>例如 $f_{\text{start}}=2000$、$f_{\text{target}}=60000$、$\text{accel}=90000$ 时，$T_{\text{ramp}}=645\,\text{ms}$，对应 $N_{\text{ramp}}=65$ 个点。$N_{\text{ramp}}$ 至少需要 3–5 个采样点才能体现软起步的物理效果。</p>
<div class="arcaea-table-wrap" data-bac-table-shell="1"><table>
<tr>
<th>目标频率</th>
<th>ARR</th>
<th>实际频率</th>
<th>误差</th>
</tr>
<tr>
<td>2000 Hz</td>
<td>500</td>
<td>2000.0 Hz</td>
<td>0%</td>
</tr>
<tr>
<td>10504 Hz</td>
<td>95</td>
<td>10526.3 Hz</td>
<td>0.2%</td>
</tr>
<tr>
<td>60000 Hz</td>
<td>16</td>
<td>62500.0 Hz</td>
<td>0.6%</td>
</tr>
</table></div>
<p>对于开环步进系统，ARR 取整产生的量化误差被位置闭环（目标脉冲计数）的终点判定吸收，不累积。</p>
<h3>2.5 核心代码实现</h3>
<p>入口文件：<code class="language-text">BSP/Src/bsp_stepper.c</code>。</p>
<pre><code class="language-c">static uint32_t scurve_calc_soft_start_hz(uint32_t elapsed_ticks,
                                          uint32_t ramp_ticks,
                                          uint32_t start_hz,
                                          uint32_t target_hz) {
    float s, shape, hz;
    if ((ramp_ticks == 0U) || (target_hz &lt;= start_hz))
        return target_hz;
    if (elapsed_ticks &gt;= ramp_ticks)
        return target_hz;
    s = (float)elapsed_ticks / (float)ramp_ticks;  /* s = n / N_ramp */
    shape = (2.0f * s) - (s * s);                   /* f(s) = 2s - s² */
    hz = (float)start_hz + ((float)(target_hz - start_hz) * shape);
    return (uint32_t)hz;
}</code></pre>
<p>STM32F103 无硬件 FPU，但每次计算约 5 次浮点乘除（~150 周期 ≈ 2μs），在 10ms MotorTask 周期中可忽略。若需要移除浮点运行时，可用 Q16.16 定点格式替换，但当前 FreeRTOS + HAL 已引入浮点库，平衡点倾向于保留 float。</p>
<h3>2.6 11 个阶段的参数与短段极限</h3>
<p>参数全部位于现有结构体 <code class="language-text">packer_runtime_config_t</code>：</p>
<div class="arcaea-table-wrap" data-bac-table-shell="1"><table>
<tr>
<th>参数</th>
<th>默认值</th>
<th>作用域</th>
</tr>
<tr>
<td>stepper_start_hz</td>
<td>2000 Hz</td>
<td>全局起步频率</td>
</tr>
<tr>
<td>stepper_accel_hz_per_s</td>
<td>90000 Hz/s</td>
<td>加速斜率（决定 $T_{\text{ramp}}$）</td>
</tr>
<tr>
<td>speed_bag_out_hz</td>
<td>10504 Hz</td>
<td>BAG_OUT 目标频率</td>
</tr>
<tr>
<td>speed_seal_move_hz</td>
<td>60000 Hz</td>
<td>PRESS_* 系列目标频率</td>
</tr>
</table></div>
<div class="arcaea-table-wrap" data-bac-table-shell="1"><table>
<tr>
<th>阶段</th>
<th>类型</th>
<th>起步 Hz</th>
<th>目标 Hz</th>
<th>目标脉冲</th>
<th>$T_{\text{ramp}}$</th>
</tr>
<tr>
<td>BAG_OUT</td>
<td>有限</td>
<td>2000</td>
<td>10504</td>
<td>50611</td>
<td>95ms</td>
</tr>
<tr>
<td>PRESS_RETRACT</td>
<td>有限</td>
<td>2000</td>
<td>60000</td>
<td>18499</td>
<td>645ms</td>
</tr>
<tr>
<td>PRESS_CLOSE</td>
<td>有限</td>
<td>2000</td>
<td>60000</td>
<td>3333</td>
<td>645ms</td>
</tr>
<tr>
<td>SELF_CHECK</td>
<td>有限</td>
<td>2000</td>
<td>5000</td>
<td>3889</td>
<td>34ms</td>
</tr>
</table></div>
<p><strong>重要边界</strong>：target_pulses 是动作目标脉冲，pulse_margin 是故障保护上限余量。不要把 target_pulses + pulse_margin 当作起步曲线长度——这会平白拉长保护余量，改变工艺时序。</p>
<p>短段极限：以 PRESS_CLOSE（3333 pulses）为例，起步窗口脉冲积分约 26 万脉冲，远大于 3333。轴在起步初期就被 target_pulses 命中停止，抛物线效果体现在前几个 MotorTask 周期的频率渐升，而不是跑完 645ms。</p>
<p>SELF_CHECK（3889 pulses）：$T_{\text{ramp}}=34\,\text{ms}$（3 个周期），频率轨迹 n=0→2000、n=1→3680、n=2→4670、n=3→5000。</p>
<h2>三、收尾模式：S 曲线优先置 done + motion_seen</h2>
<h3>3.1 减速段末尾的工程问题</h3>
<p>S 曲线减速段末端脉冲频率极低。如果等待最后几个慢脉冲走完才置 done，动作完成时刻会拖后——从操作者的视角看就是「动作走完了但机器还在等那几微秒的停顿感」。这个问题在短段（如 PRESS_CLOSE 的 3333 脉冲）和长时间连续运行中尤为明显。</p>
<h3>3.2 解法：优先置 done</h3>
<p>在 task_once 中检查 pulse_emitted ≥ target 时立即 stop + done，不等剩余慢脉冲走完。因为末尾段脉冲的物理位移已微不可察，直接截断完全可接受。</p>
<pre><code class="language-c">if (axes[i].pulse_emitted &gt;= axes[i].pulse_target) {
    axes[i].running = false;
    axes[i].done = true;   // 立刻标记完成，不等最后脉冲
}</code></pre>
<p>但产生了新问题。</p>
<h3>3.3 motion_seen 防残留</h3>
<p>优先置 done 导致 done 标志在运动结束后持续为 true。下一次新运动开始时，外部状态机如果直接检查 done 标志，会误以为上一次运动还没结束——因为 done 还是 true，running 刚被设为 true 但还没来得及发出第一个脉冲。</p>
<p>解法：引入 motion_seen 标志——每次新运动开始时先清 motion_seen，等待 timer 真正输出第一个脉冲后再置位。外部状态机用 motion_seen 而非 done 判断：</p>
<pre><code class="language-c">static bool motion_seen[STEPPER_AXIS_MAX] = {false};

void stepper_start_new_move(uint8_t axis, uint32_t target) {
    motion_seen[axis] = false;   // 新运动开始，清标志
    axes[axis].pulse_emitted = 0;
    axes[axis].pulse_target = target;
    axes[axis].running = true;
}

void stepper_task_once(void) {
    if (/* 第一次发出脉冲 */) {
        motion_seen[axis] = true;  // 确认运动已开始
    }
}

// 外部状态机判断运动完成
bool stepper_is_motion_done(uint8_t axis) {
    return motion_seen[axis] &amp;&amp; !axes[axis].running;
}</code></pre>
<h3>3.4 配对规则</h3>
<div class="arcaea-table-wrap" data-bac-table-shell="1"><table>
<tr>
<th>模式组合</th>
<th>效果</th>
<th>适用场景</th>
</tr>
<tr>
<td>两种都不用</td>
<td>末尾慢脉冲拖时间；done 判定安全但慢</td>
<td>精确计步、定位场景</td>
</tr>
<tr>
<td>只用优先置 done</td>
<td>收尾快；但新运动被残留 done 误判</td>
<td>不可用——存在漏洞</td>
</tr>
<tr>
<td>只用 motion_seen</td>
<td>防残留生效；收尾仍慢</td>
<td>安全但收益有限</td>
</tr>
<tr>
<td><strong>优先置 done + motion_seen</strong></td>
<td>收尾快、不会误判</td>
<td><strong>推荐组合</strong></td>
</tr>
</table></div>
<p>两个技巧必须配对使用。缺一个就出现误判或收尾慢。</p>
<h2>四、架构集成：动作表调度</h2>
<p>BSP 驱动层和运动算法层通过统一动作表解耦。动作表条目定义运动参数和模式：</p>
<pre><code class="language-c">typedef struct {
    uint8_t  axis;         // 轴号
    uint32_t target_pulse; // 目标脉冲数
    uint32_t freq_hz;      // 目标频率
    uint32_t accel_ms;     // 加速时间(ms)
    stepper_mode_t mode;   // PARABOLA / S_CURVE / CONSTANT
} action_entry_t;</code></pre>
<p>动作表驱动根据 mode 字段选择运动算法：</p>
<pre><code class="language-c">void action_table_execute(action_entry_t *table, uint8_t count) {
    for (int i = 0; i &lt; count; i++) {
        switch (table[i].mode) {
        case STEPPER_MODE_PARABOLA:
            stepper_start_parabola(table[i].axis,
                table[i].target_pulse, table[i].freq_hz, table[i].accel_ms);
            break;
        case STEPPER_MODE_S_CURVE:
            stepper_start_s_curve(table[i].axis,
                table[i].target_pulse, table[i].freq_hz);
            break;
        case STEPPER_MODE_CONSTANT:
            stepper_start_constant(table[i].axis, table[i].freq_hz);
            break;
        }
    }
}</code></pre>
<p>动作表模式的工程价值：新增运动算法时只需要增加一个 mode 枚举值和对应的 xxx_start 函数，不修改 task_once 循环、不修改状态机判定逻辑。抛物线起步、S 曲线启停、恒速驱动三种模式通过动作表统一入口调度。</p>
<h2>五、调参与现场验证</h2>
<h3>5.1 参数灵敏度</h3>
<p>$T_{\text{ramp}}$ 对 accel 的敏感度：</p>
<p></p><div class="katex-display">$$\frac{\partial T_{\text{ramp}}}{\partial \text{accel}} = -\frac{1000 \cdot (f_{\text{target}} - f_{\text{start}})}{\text{accel}^2}$$</div>

<p>accel 从 90000 提高到 100000 约使 $T_{\text{ramp}}$ 缩短 72ms。</p>
<h3>5.2 调参优先级</h3>
<div class="arcaea-table-wrap" data-bac-table-shell="1"><table>
<tr>
<th>调整目标</th>
<th>建议优先改什么</th>
<th>物理含义</th>
</tr>
<tr>
<td>起步更稳</td>
<td>降低 stepper_start_hz</td>
<td>降低起步力矩突变</td>
</tr>
<tr>
<td>拉升更柔和</td>
<td>降低 accel_hz_per_s</td>
<td>延长起步窗口</td>
</tr>
<tr>
<td>起步更快到顶</td>
<td>提高 accel_hz_per_s</td>
<td>缩短起步窗口</td>
</tr>
<tr>
<td>中段更快</td>
<td>提高各阶段 speed_*_hz</td>
<td>注意电机失步上限</td>
</tr>
</table></div>
<h3>5.3 现场验证方法</h3>
<p>在 task_once 中增加条件日志输出：</p>
<pre><code class="language-text">[CURVE] axis=1 s=0.05 f=2398 arr=417
[CURVE] axis=1 s=0.15 f=5310 arr=188
[CURVE] axis=1 s=0.25 f=8222 arr=121</code></pre>
<p>只在起步窗口激活时输出，结束后静默。检查 $ARR \times f \approx 1000000$ 在量化误差范围内。</p>
<h2>六、风险、边界与模式选择</h2>
<h3>6.1 已知风险</h3>
<div class="arcaea-table-wrap" data-bac-table-shell="1"><table>
<tr>
<th>风险</th>
<th>说明</th>
<th>缓解措施</th>
</tr>
<tr>
<td>TIM4 共频约束</td>
<td>四轴共用 ARR，多轴同步只能用同一曲线</td>
<td>同步轴使用相同起步参数</td>
</tr>
<tr>
<td>目标脉冲与保护脉冲混淆</td>
<td>18000 目标 + 10000 margin ≠ 28000 起步曲线</td>
<td>代码注释明确区分</td>
</tr>
<tr>
<td>抛物线不碰停止逻辑</td>
<td>抛物线模块只算频率，done 仍由 target_pulses 命中置位</td>
<td>抛物线函数只返回 hz 值</td>
</tr>
<tr>
<td>S 曲线优先置 done 的适用边界</td>
<td>仅适用于末尾脉冲极慢的短段</td>
<td>精确计步场景关闭此模式</td>
</tr>
<tr>
<td>浮点在 ISR 中调用</td>
<td>不可在 TIM4 中断里算浮点</td>
<td>只在 MotorTask 10ms 周期中计算</td>
</tr>
</table></div>
<h3>6.2 抛物线 vs 七段 S 曲线对比</h3>
<div class="arcaea-table-wrap" data-bac-table-shell="1"><table>
<tr>
<th>特性</th>
<th>七段 S 曲线</th>
<th>二次抛物线 + 优先置 done + motion_seen</th>
</tr>
<tr>
<td>段数</td>
<td>7（升速/匀加速/过渡/恒速/降速/匀减速/停止）</td>
<td>1（起步窗口）+ 恒速 + done 截断</td>
</tr>
<tr>
<td>加速度变化率</td>
<td>可控（jerk-limited）</td>
<td>线性衰减（隐含 jerk）</td>
</tr>
<tr>
<td>起步丢步抑制</td>
<td>优</td>
<td>良</td>
</tr>
<tr>
<td>收尾停顿感</td>
<td>无（对称降速到 0）</td>
<td>截断消除（不等末尾慢脉冲）</td>
</tr>
<tr>
<td>代码量</td>
<td>200–500 行</td>
<td>~50 行（抛物线）+ ~30 行（motion_seen）</td>
</tr>
<tr>
<td>RAM 占用</td>
<td>多状态变量</td>
<td>4 + 1 个 uint32_t</td>
</tr>
<tr>
<td>加减速对称性</td>
<td>自然对称</td>
<td>不处理减速（由 done 截断处理）</td>
</tr>
<tr>
<td>与现有架构集成</td>
<td>需改写停止逻辑</td>
<td>不碰停止逻辑</td>
</tr>
</table></div>
<h2>关键约束</h2>
<div class="arcaea-table-wrap" data-bac-table-shell="1"><table>
<tr>
<th>约束</th>
<th>为什么重要</th>
</tr>
<tr>
<td>$T_{\text{ramp}}$ 是 10ms 的整数倍</td>
<td>MotorTask 周期 10ms，不是整数倍则截断偏差累积</td>
</tr>
<tr>
<td>抛物线不修改 done 置位时机</td>
<td>抛物线模块只计算频率，done 由底层 task_once 的计数命中处理</td>
</tr>
<tr>
<td>S 曲线优先置 done + motion_seen 必须配对</td>
<td>缺 motion_seen 则残留 done 误判；缺优先置 done 则收尾慢</td>
</tr>
<tr>
<td>float 计算仅在 10ms 周期</td>
<td>不在 ISR 中调用</td>
</tr>
<tr>
<td>连续段不要求整段抛物线包络</td>
<td>传感器命中随时结束，抛物线无意义</td>
</tr>
<tr>
<td>短段起步窗口 &lt; 全段时长的 30%</td>
<td>防止起步窗口占主导导致流程超时</td>
</tr>
</table></div>
<h2>结语</h2>
<p>步进电机驱动从硬件到算法有四层。硬件层用 TMC2209 + 共享 TIM4 + 原子化启停解决四轴同步问题。算法层用二次抛物线解决起步丢步——形状函数 $f(s)=2s-s^2$ 把力矩-速度逆关系转化为离散时间域上的频率更新。收尾层用 S 曲线优先置 done + motion_seen 解决「不等末尾慢脉冲又不误判」的矛盾。架构层用动作表统一入口解耦运动模式。</p>
<p>每层只做一件事：BSP 不碰控制逻辑，抛物线不算停止判定，motion_seen 不管驱动细节。41 行抛物线核心代码在一个 FreeRTOS 10ms 周期里完成一次浮点计算，不做状态机、不引入新配置结构、不需要为了一个起步段推翻整个驱动架构。</p>
<hr>
<p style="color:var(--arcaea-muted);font-size:0.9em">基于 BSP/Src/bsp_stepper.c、packer_runtime_config_t 生产实现撰写。动作表模式参考嵌入式执行器统一调度架构。</p>
<h2>相关文章</h2>
<ul>
<li><a href="/shared-timer-multi-axis-stepper/" target="_blank" rel="nofollow">同定时器多轴联动：四路步进共享一个 TIM</a></li>
<li><a href="/unified-actuator-action-table-pattern/" target="_blank" rel="nofollow">嵌入式执行器架构：从散落 switch 到统一动作表</a></li>
</ul>
