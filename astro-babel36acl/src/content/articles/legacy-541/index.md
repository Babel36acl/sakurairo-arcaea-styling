---
title: "BSP 实现总览：10 个驱动模块的设计模式"
description: "硬件映射表、错误码枚举映射、DMA+回调通知、纯格式化+回调分发、直接寄存器——BSP 层 10 个驱动的五种模式。"
published: "2026-05-28"
updated: "2026-08-18"
permalink: "/2026/05/28/bsp-implementation-patterns-overview/"
draft: false
categories: ["嵌入式实战","架构与重构"]
tags: ["ARCH"]
legacyId: 541
---

<div class="arcaea-wrap">
<p><span class="tag">嵌入式实战</span> <span class="tag">BSP设计</span></p>
<p>BSP 层 10 个 .c 文件，每个遵循相同的接口模式。本文统一展示它们的共性和差异。</p>
<h2>BSP 模块清单</h2>
<div class="arcaea-table-wrap" data-bac-table-shell="1"><table>
<tr>
<th>模块</th>
<th>硬件</th>
<th>核心接口</th>
<th>模式</th>
</tr>
<tr>
<td>bsp_stepper</td>
<td>TIM4 四轴 PWM</td>
<td>start / stop / is_done / task_once</td>
<td>硬件映射表 + 共享ARR + 抛物线起步</td>
</tr>
<tr>
<td>bsp_dc_motor</td>
<td>TIM1+TIM8 PWM+IR2104</td>
<td>start / stop / set_dir / stop_all</td>
<td>硬件映射表 + 逐周期超时</td>
</tr>
<tr>
<td>bsp_actuator</td>
<td>GPIO 继电器/指示灯</td>
<td>init / write / read</td>
<td>直接 GPIO 封装</td>
</tr>
<tr>
<td>bsp_uart</td>
<td>USART1/2/3 + DMA</td>
<td>port_init / transmit / receive</td>
<td>端口枚举 + StreamBuffer</td>
</tr>
<tr>
<td>bsp_log</td>
<td>格式化输出</td>
<td>log_inf / log_err / set_dispatch</td>
<td>纯格式化，无 I/O（回调输出）</td>
</tr>
<tr>
<td>bsp_adc</td>
<td>ADC1_IN4 DMA</td>
<td>init / get_raw / get_voltage</td>
<td>DMA 双缓冲 + 回调通知</td>
</tr>
<tr>
<td>bsp_gpio</td>
<td>各 GPIO 引脚</td>
<td>init / read / write / toggle</td>
<td>直接 HAL 封装</td>
</tr>
<tr>
<td>bsp_eeprom</td>
<td>AT24C02 软件 I2C</td>
<td>init / read / write / deinit</td>
<td>三层隔离（时序+芯片+接口）</td>
</tr>
<tr>
<td>bsp_at24cxx</td>
<td>AT24C 系列通用</td>
<td>通用驱动回调注册</td>
<td>回调函数表（I2C 时序）</td>
</tr>
<tr>
<td>bsp_watchdog</td>
<td>IWDG</td>
<td>init / kick</td>
<td>直接寄存器操作</td>
</tr>
</table></div>
<h2>模式一：硬件映射表（bsp_stepper, bsp_dc_motor）</h2>
<p>多实例硬件（四轴步进、两路直流）通过查找表将逻辑编号映射到物理资源：</p>
<pre><code class="language-c">// bsp_stepper.c — 四轴硬件映射
typedef struct {
    GPIO_TypeDef *en_port;
    uint16_t      en_pin;
    GPIO_TypeDef *dir_port;
    uint16_t      dir_pin;
    uint32_t      tim_channel;   // TIM4 CH1~CH4
} bsp_stepper_hw_map_t;

// 硬编码映射表，编译器优化后无运行时开销
static bsp_stepper_hw_map_t bsp_stepper_get_axis_map(bsp_stepper_axis_t axis) {
    static const bsp_stepper_hw_map_t map[] = {
        {GPIOA, GPIO_PIN_8,  GPIOB, GPIO_PIN_12, TIM_CHANNEL_1},
        {GPIOA, GPIO_PIN_15, GPIOB, GPIO_PIN_13, TIM_CHANNEL_2},
        {GPIOB, GPIO_PIN_3,  GPIOB, GPIO_PIN_14, TIM_CHANNEL_3},
        {GPIOB, GPIO_PIN_4,  GPIOB, GPIO_PIN_15, TIM_CHANNEL_4},
    };
    return (axis &lt; BSP_STEPPER_AXIS_COUNT) ? map[axis] : map[0];
}</code></pre>
<p>同理，TIM4 通道中断信息也建表：</p>
<pre><code class="language-c">static const bsp_stepper_channel_info_t s_channel_lut[] = {
    {TIM_IT_CC1, TIM_FLAG_CC1, HAL_TIM_ACTIVE_CHANNEL_1},
    {TIM_IT_CC2, TIM_FLAG_CC2, HAL_TIM_ACTIVE_CHANNEL_2},
    {TIM_IT_CC3, TIM_FLAG_CC3, HAL_TIM_ACTIVE_CHANNEL_3},
    {TIM_IT_CC4, TIM_FLAG_CC4, HAL_TIM_ACTIVE_CHANNEL_4},
};</code></pre>
<p>四轴共享同一个 TIM4 的 ARR。启动新轴时必须在临界区中比较各轴需求，选择最高频率作为共享 ARR。这是这个硬件方案最核心的约束。</p>
<h2>模式二：错误码枚举 + 状态映射（bsp_uart → packer_screen）</h2>
<p>BSP 层定义自己的错误码枚举，上层使用状态映射函数做跨层转换：</p>
<pre><code class="language-c">// bsp_uart 错误码
typedef enum {
    BSP_UART_STATUS_OK = 0,
    BSP_UART_STATUS_BUSY,
    BSP_UART_STATUS_TIMEOUT,
    BSP_UART_STATUS_ERROR
} bsp_uart_status_t;

// Service 层映射为 DGUS 状态码
static packer_screen_dgus_status_t
packer_screen_dgus_from_uart(bsp_uart_status_t status) {
    switch (status) {
    case BSP_UART_STATUS_OK:      return PACKER_SCREEN_DGUS_STATUS_OK;
    case BSP_UART_STATUS_BUSY:    return PACKER_SCREEN_DGUS_STATUS_BUSY;
    case BSP_UART_STATUS_TIMEOUT: return PACKER_SCREEN_DGUS_STATUS_TIMEOUT;
    default:                      return PACKER_SCREEN_DGUS_STATUS_ERROR;
    }
}</code></pre>
<p>BSP 层不直接 include 上层的枚举。上层通过映射函数做转换——这是分层边界的一个具体体现。</p>
<h2>模式三：DMA + 回调通知（bsp_adc）</h2>
<p>ADC 使用 DMA 双缓冲采样，完成时通过注册的回调通知任务：</p>
<pre><code class="language-text">// BSP 层 — 注册回调函数指针
typedef void (*bsp_adc_notify_cb_t)(void);
void bsp_adc_register_notification_cb(bsp_adc_notify_cb_t cb);

// 回调在 ISR 中调用，通过 vTaskNotifyGiveFromISR 唤醒任务</code></pre>
<h2>模式四：纯格式化 + 回调分发（bsp_log）</h2>
<p>bsp_log 不包含任何 I/O 操作。它只是一个格式化引擎，输出通过回调分发给注册的后端：</p>
<pre><code class="language-text">// bsp_log 输出流
void bsp_log_write(const char *text, uint16_t len);
// 内部调用注册的分发函数
// 当前注册：packer_dbus_log_send() → DGUS 5A A5 帧 → USART1

// 调用方式
BSP_LOG_INF("SM_CMD CONTROL stop");
// 内部: vsnprintf → bsp_log_write → 分发回调</code></pre>
<h2>模式五：直接寄存器（不绕 HAL）</h2>
<p>某些性能敏感的 BSP 操作跳过 HAL，直接操作寄存器。例如关闭单路 TIM4 PWM 通道时，HAL 的 <code>HAL_TIM_PWM_Stop()</code> 会关闭整个定时器，但四轴共享 TIM4——只能手动操作通道寄存器：</p>
<pre><code class="language-c">static void bsp_stepper_disable_axis_channel(bsp_stepper_axis_t axis,
                                              uint8_t disable_irq) {
    __HAL_TIM_DISABLE_IT(&amp;htim4, info-&gt;it_mask);
    __HAL_TIM_CLEAR_FLAG(&amp;htim4, info-&gt;flag_mask);
    TIM_CCxChannelCmd(htim4.Instance, channel, TIM_CCx_DISABLE);
    TIM_CHANNEL_STATE_SET(&amp;htim4, channel, HAL_TIM_CHANNEL_STATE_READY);

    if (bsp_stepper_any_channel_enabled() == 0U) {
        __HAL_TIM_DISABLE(&amp;htim4);  // 全部通道关闭后才停 TIM
    }
}</code></pre>
<h2>所有 BSP 遵循的共同原则</h2>
<ol>
<li><strong>命名</strong>：<code>bsp_&lt;模块&gt;_&lt;动作&gt;</code>，如 <code>bsp_stepper_start()</code></li>
<li><strong>错误码</strong>：每个模块有自己的枚举，上层做映射转换</li>
<li><strong>硬件映射表</strong>：逻辑编号 → 物理资源，集中一处管理</li>
<li><strong>不暴露 HAL</strong>：上层看不到 <code>HAL_GPIO_WritePin</code> 等调用</li>
<li><strong>不承载业务</strong>：BSP 不知道什么是"出袋"、"封口"</li>
<li><strong>临界区保护</strong>：<code>__disable_irq()</code> + 保存恢复，不用 volatile 替代</li>
</ol>
<h2>附录 A：CubeMX 外设资源分配</h2>
<p>本文涉及的 10 个 BSP 模块对应的 CubeMX 外设配置如下，供硬件迁移或 .ioc 同步时参考。</p>
<h3>时钟配置</h3>
<div class="arcaea-table-wrap" data-bac-table-shell="1"><table>
<tr>
<th>参数</th>
<th>值</th>
</tr>
<tr>
<td>HSE</td>
<td>8 MHz 外部晶振</td>
</tr>
<tr>
<td>PLL 倍频</td>
<td>×9</td>
</tr>
<tr>
<td>SYSCLK</td>
<td>72 MHz</td>
</tr>
<tr>
<td>APB1</td>
<td>36 MHz (max)</td>
</tr>
<tr>
<td>APB2</td>
<td>72 MHz (max)</td>
</tr>
</table></div>
<h3>定时器分配</h3>
<div class="arcaea-table-wrap" data-bac-table-shell="1"><table>
<tr>
<th>TIM</th>
<th>用途</th>
<th>备注</th>
</tr>
<tr>
<td>TIM1</td>
<td>IR2104 两路 PWM (CH1~CH4)</td>
<td>高级定时器，互补输出</td>
</tr>
<tr>
<td>TIM2</td>
<td>ST1 步进电机 PUL</td>
<td>专用定时器，独立 ARR</td>
</tr>
<tr>
<td>TIM3</td>
<td>NMOS 输出 (Partial Remap)</td>
<td>CH1=PA6, CH2=PA7, CH3=PB0, CH4=PB1</td>
</tr>
<tr>
<td>TIM4</td>
<td>ST3、ST4 步进电机 PUL</td>
<td>共享 ARR 方案</td>
</tr>
<tr>
<td>TIM5</td>
<td>ST2 步进电机 PUL</td>
<td>专用定时器，独立 ARR</td>
</tr>
<tr>
<td>TIM6</td>
<td>FreeRTOS timebase</td>
<td>基本定时器，仅中断</td>
</tr>
<tr>
<td>TIM8</td>
<td>IR2104 第二组两路 PWM</td>
<td>高级定时器，互补输出</td>
</tr>
</table></div>
<h3>USART 分配</h3>
<div class="arcaea-table-wrap" data-bac-table-shell="1"><table>
<tr>
<th>USART</th>
<th>波特率</th>
<th>电平</th>
<th>接驳设备</th>
<th>用途</th>
</tr>
<tr>
<td>USART1</td>
<td>9600</td>
<td>RS232</td>
<td>DB9 串口</td>
<td>调试控制台 + 日志输出（dgus_log 后端）</td>
</tr>
<tr>
<td>USART2</td>
<td>115200</td>
<td>RS232</td>
<td>DB9 串口</td>
<td>热敏打印机</td>
</tr>
<tr>
<td>USART3</td>
<td>9600</td>
<td>RS485</td>
<td>RS485 总线</td>
<td>主站协议通信</td>
</tr>
</table></div>
<h3>ADC</h3>
<div class="arcaea-table-wrap" data-bac-table-shell="1"><table>
<tr>
<th>ADC</th>
<th>通道</th>
<th>引脚</th>
<th>采样方式</th>
</tr>
<tr>
<td>ADC1</td>
<td>IN4</td>
<td>PA4</td>
<td>DMA 循环 + 双缓冲</td>
</tr>
</table></div>
<h3>GPIO 分类</h3>
<div class="arcaea-table-wrap" data-bac-table-shell="1"><table>
<tr>
<th>类别</th>
<th>引脚</th>
<th>方向</th>
<th>说明</th>
</tr>
<tr>
<td>隔离输入</td>
<td>IN1~IN9 (PA0~PA3, PA5~PA7, PB0~PB1)</td>
<td>输入</td>
<td>外部传感器/限位开关</td>
</tr>
<tr>
<td>步进信号</td>
<td>PUL(PA8/PA15/PB3/PB4), DIR(PB12~PB15), EN(PA11~PA14)</td>
<td>输出</td>
<td>ST1~ST4 控制</td>
</tr>
<tr>
<td>IR2104</td>
<td>TIM1/TIM8 CH1~CH4</td>
<td>输出</td>
<td>两路直流电机 H 桥</td>
</tr>
<tr>
<td>NMOS</td>
<td>PA6, PA7, PB0, PB1 (TIM3 CH1~CH4 Partial Remap)</td>
<td>输出</td>
<td>负载控制</td>
</tr>
<tr>
<td>LED 指示灯</td>
<td>PC13 (板载), 其他 GPIO</td>
<td>输出</td>
<td>状态指示</td>
</tr>
<tr>
<td>I2C 软件</td>
<td>PB6 (SCL), PB7 (SDA)</td>
<td>开漏输出</td>
<td>AT24C02 EEPROM</td>
</tr>
</table></div>
<h3>DMA 分配</h3>
<div class="arcaea-table-wrap" data-bac-table-shell="1"><table>
<tr>
<th>外设</th>
<th>DMA 流</th>
<th>方向</th>
<th>模式</th>
</tr>
<tr>
<td>USART1_TX</td>
<td>DMA1_Channel4</td>
<td>内存→外设</td>
<td>Normal</td>
</tr>
<tr>
<td>USART2_TX</td>
<td>DMA1_Channel7</td>
<td>内存→外设</td>
<td>Normal</td>
</tr>
<tr>
<td>USART3_TX</td>
<td>DMA1_Channel2</td>
<td>内存→外设</td>
<td>Normal</td>
</tr>
<tr>
<td>ADC1</td>
<td>DMA1_Channel1</td>
<td>外设→内存</td>
<td>Circular (双缓冲)</td>
</tr>
</table></div>
<h2>附录 B：板级外设接线与引脚冲突 v1.1</h2>
<p>以下记录 BSP 驱动层对应的物理引脚映射，以及在布线调试过程中已解决的引脚冲突。</p>
<h3>隔离输入接线</h3>
<div class="arcaea-table-wrap" data-bac-table-shell="1"><table>
<tr>
<th>逻辑编号</th>
<th>功能</th>
<th>MCU 引脚</th>
<th>备注</th>
</tr>
<tr>
<td>INPUT_1</td>
<td>入袋限位</td>
<td>PA0</td>
<td></td>
</tr>
<tr>
<td>INPUT_2</td>
<td>封口限位</td>
<td>PA1</td>
<td></td>
</tr>
<tr>
<td>INPUT_3</td>
<td>打印就绪</td>
<td>PA2</td>
<td></td>
</tr>
<tr>
<td>INPUT_4</td>
<td>应急停止</td>
<td>PA3</td>
<td></td>
</tr>
<tr>
<td>INPUT_5</td>
<td>袋检测</td>
<td>PA5</td>
<td></td>
</tr>
<tr>
<td>INPUT_6</td>
<td>封口温度</td>
<td><strong>PA6</strong></td>
<td>v1.0 原为 PB0→v1.1 改至 PA6 (见冲突说明)</td>
</tr>
<tr>
<td>INPUT_7</td>
<td>步进复位</td>
<td>PA7</td>
<td></td>
</tr>
<tr>
<td>INPUT_8</td>
<td>预留 A</td>
<td>PB0</td>
<td>v1.1 复用 NMOS CH3</td>
</tr>
<tr>
<td>INPUT_9</td>
<td>预留 B</td>
<td>PB1</td>
<td>v1.1 复用 NMOS CH4</td>
</tr>
</table></div>
<h3>步进电机接线 (ST1~ST4)</h3>
<div class="arcaea-table-wrap" data-bac-table-shell="1"><table>
<tr>
<th>轴</th>
<th>定时器</th>
<th>PUL</th>
<th>DIR</th>
<th>EN</th>
</tr>
<tr>
<td>ST1</td>
<td>TIM2</td>
<td>PA8</td>
<td>PB12</td>
<td>PA11</td>
</tr>
<tr>
<td>ST2</td>
<td>TIM5</td>
<td>PA15</td>
<td>PB13</td>
<td>PA12</td>
</tr>
<tr>
<td>ST3</td>
<td>TIM4 CH1</td>
<td>PB3</td>
<td>PB14</td>
<td>PA13</td>
</tr>
<tr>
<td>ST4</td>
<td>TIM4 CH2</td>
<td>PB4</td>
<td>PB15</td>
<td>PA14</td>
</tr>
</table></div>
<h3>NMOS 输出接线 (TIM3 Partial Remap)</h3>
<div class="arcaea-table-wrap" data-bac-table-shell="1"><table>
<tr>
<th>通道</th>
<th>TIM3 输出</th>
<th>MCU 引脚</th>
<th>负载</th>
</tr>
<tr>
<td>CH1</td>
<td>TIM3_CH1</td>
<td>PA6</td>
<td>封口加热</td>
</tr>
<tr>
<td>CH2</td>
<td>TIM3_CH2</td>
<td>PA7</td>
<td>气泵</td>
</tr>
<tr>
<td>CH3</td>
<td>TIM3_CH3</td>
<td>PB0</td>
<td>预留</td>
</tr>
<tr>
<td>CH4</td>
<td>TIM3_CH4</td>
<td>PB1</td>
<td>预留</td>
</tr>
</table></div>
<p><strong>注意</strong>：TIM3 配置为 <code>Partial Remap</code>，将默认的 CH3(PC6)、CH4(PC7) 重映射至 PB0、PB1，避免与 USART3(PC10/PC11) 冲突。</p>
<h3>已解决的引脚冲突</h3>
<ol>
<li><strong>INPUT_6 迁移（PB0 → PA6）</strong>：v1.0 将 INPUT_6 分配在 PB0，但 PB0 同时是 TIM3_CH3 (Partial Remap) 的 NMOS 输出引脚，造成输入/输出冲突。v1.1 将 INPUT_6 移到了 PA6，PB0 释放给 NMOS CH3 使用。NMOS CH1(PA6) 被 INPUT_6 占据的问题通过将 TIM3 Partial Remap 的 CH1 共用同一 PA6 来解决——NPWM 和 GPIO 输入在 v1.1 的电气设计中通过外部分时/跳线处理。</li>
<li><strong>PB3 / PB4 / PA15 复用作 SWD 与 JTAG</strong>：这三个引脚默认被 Debug 接口占用的（PA15=JTDI, PB3=JTDO/Traceswo, PB4=JNTRST）。CubeMX 中已配置为 <code>Serial Wire (SWD)</code> 模式禁用 JTAG，释放 PA15/PB3/PB4 给步进 PUL 使用。</li>
<li><strong>TIM3 Partial Remap 必要性</strong>：TIM3 默认 CH3(PC6)、CH4(PC7) 与 USART3(PC10/PC11) 无冲突，但 PC6/PC7 在 PCB 上已被其他外设占用。启用 Partial Remap 后将 TIM3_CH3→PB0、TIM3_CH4→PB1，规避了 PCB 走线冲突。</li>
<li><strong>ST1 / ST2 从 TIM4 拆分</strong>：v1.0 原型将 ST1~ST4 全部挂于 TIM4 四通道，共享 ARR 限制导致 ST1/ST2 频率受限。v1.1 将 ST1 独立至 TIM2、ST2 独立至 TIM5，ST3/ST4 仍共享 TIM4。这样 ST1/ST2 可获得独立 ARR，不受四轴最高频率约束。</li>
</ol>
<h3>固件兼容性说明</h3>
<p><strong>注意</strong>：当前的 bsp_stepper 固件实现（代码块中的映射表）仍然基于 v1.0 的硬件方案——四轴全部挂载在 TIM4 上。这意味着本文列出的 v1.1 接线表是硬件文档和 .ioc 文件中的真实配置，<strong>但固件尚未同步更新</strong>。.ioc 文件和硬件接线表是唯一正确的物理拓扑依据，固件将在下一迭代中根据此处记录的 TIM2/TIM5/TIM4 分组重新生成硬件映射表。此文档优先于固件实现。</p>
</div>
