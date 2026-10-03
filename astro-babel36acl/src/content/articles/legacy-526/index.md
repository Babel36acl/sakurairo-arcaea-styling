---
title: "工业控制固件与 HMI 的工程架构复盘：从 STM32 到 Flutter 的全链路实践"
description: "一个完整的工业控制嵌入式系统项目复盘：四轮重构、七任务 RTOS、APP/Service/BSP 三层物理隔离、18 状态循环流程、Flutter HMI 双串口架构。311 次提交沉淀的工程经验。"
published: "2026-05-28"
updated: "2026-06-02"
permalink: "/2026/05/28/embedded-firmware-hmi-engineering-retrospective/"
draft: false
categories: ["工程复盘","方法与工具","架构与重构"]
tags: ["ARCH"]
legacyId: 526
---

<div class="arcaea-wrap">
<p>工业控制固件与 HMI 的工程架构复盘：从 STM32 到 Flutter 的全链路实践</p>
<blockquote>
<p><strong>TL;DR：</strong>本文复盘了一个工业控制设备的完整嵌入式系统——从 STM32 固件的三层架构（APP/Service/BSP）、7 任务 FreeRTOS 模型、状态机流程设计、三步通信协议体系（20B / HMIS / HMIS-BAM），到 Flutter HMI 上位机的全链路架构。重点还原了 20B 固定帧协议的双串口路由决策、HMIS-BAM 的单缓冲分片设计，以及串口总线宽度对协议形态的约束。</p>
<p>一篇完整的项目复盘 — 架构演进、状态机设计、分层解耦、串口协议、双端协同</p>
</blockquote>
<hr>
<h2>1. 项目背景</h2>
<p>这是一个<strong>工业自动化控制设备</strong>的完整嵌入式系统，包含下位机固件和上位机 HMI。</p>
<h3>下位机（执行节点）</h3>
<p>基于 ARM Cortex-M3 MCU（72MHz/256KB Flash/48KB RAM），运行 FreeRTOS，控制 4 轴步进电机、2 路直流电机、多路继电器和传感器，通过 RS485 与上位主控通信。</p>
<p><strong>角色</strong>：执行节点 — 不承担订单编排或业务协议，只负责接收命令、执行动作、返回状态。</p>
<h3>上位机 HMI</h3>
<p>跨平台桌面应用（Flutter），通过两路物理串口同时连接下位机和主控系统，承担调试、参数调节、日志监控的职能。</p>
<hr>
<h2>2. 系统架构概览</h2>
<p>整个系统分为两个独立的软件项目，通过三路 UART 互联：</p>
<p>以下是系统的整体架构图：</p>
<div class="arcaea-mermaid-box"><pre class="mermaid">flowchart TB
    subgraph 上位主控["上位主控系统（外部）"]
        MC[USART3 / RS485 / 20B 协议]
    end

    subgraph 分片层["HMIS-BAM 分片重组层"]
        BAM[FUNC=0x7F
12B 载荷 / 20B 帧
单缓冲区 / Bitmap]
    end

    subgraph HMI["HMI 上位机（Flutter 跨平台应用）"]
        PA["端口 A (USART3)
BAM + 20B + CRC16-Modbus"]
        PB["端口 B (USART1)
BAM only + DGUS 日志/调参
5A A5"]
    end

    subgraph 固件["固件（STM32 + FreeRTOS）"]
        APP["APP 层
协议分发 + 状态机 + 监控"]
        SVC["Service 层
执行器编排 + 设备适配 + 运行时配置"]
        BSP["BSP 层
步进/UART/GPIO/ADC/PWM 硬件驱动"]
        UART1["USART1 — DGUS 串口屏与日志"]
        UART2["USART2 — 打印机接口"]
        UART3["USART3 — 主通信 (RS485/9600)"]
        TIM4["TIM4 — 4 轴步进脉冲输出"]
        TIM1["TIM1/TIM8 — 直流电机 PWM"]
    end

    上位主控 --&gt;|20B 帧| 分片层
    分片层 --&gt; HMI
    HMI --&gt; 固件
    UART3 --&gt;|RS485/9600| HMI
    UART1 --&gt;|RS232/9600| HMI
    APP --&gt; SVC --&gt; BSP
    BSP --&gt; UART1
    BSP --&gt; UART2
    BSP --&gt; UART3
    BSP --&gt; TIM4
    BSP --&gt; TIM1</pre></div>
<h3>硬件资源分配</h3>
<div class="arcaea-table-wrap" data-bac-table-shell="1"><table>
<tr>
<th>外设</th>
<th>功能</th>
<th>速率</th>
</tr>
<tr>
<td>USART3 / RS485</td>
<td>主通信协议</td>
<td>9600 8N1</td>
</tr>
<tr>
<td>USART1 / RS232</td>
<td>串口屏 + 日志输出</td>
<td>9600 8N1</td>
</tr>
<tr>
<td>USART2 / RS232</td>
<td>打印机接口</td>
<td>115200 8N1</td>
</tr>
<tr>
<td>TIM4</td>
<td>四轴步进脉冲</td>
<td>1MHz 基准</td>
</tr>
<tr>
<td>TIM1 / TIM8</td>
<td>直流电机 PWM</td>
<td>IR2104 驱动</td>
</tr>
<tr>
<td>ADC1_IN4</td>
<td>功率采样</td>
<td>PA4</td>
</tr>
<tr>
<td>软件 I2C</td>
<td>EEPROM (AT24C02)</td>
<td>PA11/PA12</td>
</tr>
</table></div>
<hr>
<h2>3. 固件三层架构详解</h2>
<p>整个固件的核心设计是 <strong>APP / Service / BSP 三层分层</strong>，经过 V2→V5 四轮重构逐步落地。</p>
<pre><code class="language-text">┌──────────────────────────────────────────────────────────────┐
│  APP 层（3个 .c 文件）                                        │
│  职责：业务流程决策，不做任何硬件操作                          │
│                                                               │
│  app_packer_proto.c    20B 协议帧分发、校验、回复              │
│  app_packer_sm.c       状态机初始化、周期调度、API 封装         │
│  app_monitor.c         栈水位诊断、通信看门狗、报警上报         │
└──────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────┐
│  Service 层（25 个 .c 文件）                                   │
│  职责：设备能力抽象、动作编排、运行时支持                      │
│                                                               │
│  回调注册表核心                                               │
│  packer_state_handler.c    状态机调度引擎 + 处理器注册表       │
│                                                               │
│  子流程状态机                                                 │
│  sm_bag_flow.c / sm_seal_flow.c / sm_self_check.c             │
│  sm_press_util.c / sm_printer_service.c                       │
│                                                               │
│  执行器与设备适配                                             │
│  packer_actuator.c / packer_adc.c / packer_heater.c           │
│  packer_input.c / packer_dbus.c / packer_printer.c            │
│                                                               │
│  运行时支持                                                   │
│  packer_runtime_config.c / packer_fault_latch.c               │
│  packer_status_snapshot.c / packer_command_gateway.c          │
│  packer_runtime_flags.c / packer_power_limit.c                │
│  packer_serial_frame.c / packer_screen_engine.c               │
│                                                               │
│  阻塞 I/O 异步化                                              │
│  comm_task.c                                                  │
└──────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────┐
│  BSP 层（10 个 .c 文件）                                       │
│  职责：纯硬件驱动，不承载任何业务语义                          │
│                                                               │
│  bsp_stepper.c / bsp_dc_motor.c / bsp_actuator.c             │
│  bsp_uart.c / bsp_adc.c / bsp_gpio.c                         │
│  bsp_log.c / bsp_eeprom.c / bsp_at24cxx.c / bsp_watchdog.c   │
└──────────────────────────────────────────────────────────────┘</code></pre>
<h3>三层核心约束（物理级，非道德级）</h3>
<p><strong>用构建系统做隔离</strong>。CMakeLists.txt 为每层设置独立的 include 路径：</p>
<pre><code class="language-cmake">APP 层编译时，BSP 的 include 路径不可见
target_link_libraries(app INTERFACE service bsp_headers)
target_link_libraries(service INTERFACE bsp_headers)
# BSP 不链接任何上层</code></pre>
<p>效果：<br>- APP 层 <strong>无法</strong> <code>#include "bsp_uart.h"</code> — 编译直接报错<br>- Service 层 <strong>无法</strong> <code>#include "app_packer_sm.h"</code> — 编译直接报错<br>- BSP 层 <strong>无法</strong> include 任何上层头文件</p>
<h3>为什么是三层不是两层</h3>
<p>很多项目只有两层：HAL + 业务。对于简单项目够了。但在这个项目中：</p>
<ul>
<li>4 个步进轴有不同的速度/加减速/停止模式</li>
<li>2 个直流电机有方向/PWM/功率限制</li>
<li>打印机有握手协议/超时/重试</li>
<li>多传感器输入需要消抖/同步/状态管理</li>
</ul>
<p>如果 APP 直接调 BSP，APP 层会被设备适配细节膨胀到不可控。</p>
<p>如果 Service 不存在，那这些适配逻辑要么在 APP 层变成大杂烩，要么在 BSP 层被业务语义污染。</p>
<p><strong>Service 层存在的理由是：把"硬件能力"翻译成"设备能力"。</strong></p>
<hr>
<h2>4. 状态机循环流程设计</h2>
<p>以下是系统状态机的主流程：</p>
<div class="arcaea-mermaid-box"><pre class="mermaid">flowchart TB
    POWER_ON["POWER_ON
上电稳定 100ms"] --&gt; SELF_CHECK["SELF_CHECK
打印机探测 + 输入重采样 + 轴位确认"]
    SELF_CHECK --&gt; IDLE["IDLE
空闲待命"]

    IDLE --&gt;|"TRIGGER_BAG (0x42)"| BAG["出袋流程"]
    subgraph BAG["出袋流程"]
        direction TB
        BAG_CALIB_CHECK["BAG_CALIB_CHECK"]
        BAG_CALIB_CLEAR["BAG_CALIB_CLEAR"]
        BAG_CALIB_SEEK["BAG_CALIB_SEEK"]
        BAG_CALIB_BACKOFF["BAG_CALIB_BACKOFF"]
        BAG_OUT["BAG_OUT"]
        PREHEAT["PREHEAT"]
        BAG_CALIB_CHECK --&gt; BAG_CALIB_CLEAR --&gt; BAG_CALIB_SEEK --&gt; BAG_CALIB_BACKOFF --&gt; BAG_OUT --&gt; PREHEAT
    end

    IDLE --&gt;|"TRIGGER_SEAL (0x43)"| SEAL["封口流程"]
    subgraph SEAL["封口流程"]
        direction TB
        SEAL_FORWARD["SEAL_FORWARD"]
        CONVEYOR_RUN["CONVEYOR_RUN
投料传送带"]
        SEAL_BACKWARD["SEAL_BACKWARD
热封后退"]
        PRESS_RETRACT["PRESS_RETRACT
轴2下压"]
        PRESS_CLOSE["PRESS_CLOSE
轴3/4闭合"]
        SEAL_HOLD["SEAL_HOLD
封口保持"]
        TEAR_OFF["TEAR_OFF
轴1撕断"]
        PRESS_OPEN["PRESS_OPEN
轴2回位+轴3/4打开"]
        RESET_SEAL["RESET"]
        SEAL_FORWARD --&gt; CONVEYOR_RUN --&gt; SEAL_BACKWARD --&gt; PRESS_RETRACT --&gt; PRESS_CLOSE --&gt; SEAL_HOLD --&gt; TEAR_OFF --&gt; PRESS_OPEN --&gt; RESET_SEAL
    end

    IDLE --&gt;|"TRIGGER_DELIVER (0x44)"| DELIVER["投料流程"]
    subgraph DELIVER["投料流程"]
        direction TB
        CONVEYOR_RUN2["CONVEYOR_RUN"]
        RESET_DELIVER["RESET"]
        CONVEYOR_RUN2 --&gt; RESET_DELIVER
    end

    BAG --&gt; IDLE
    SEAL --&gt; IDLE
    DELIVER --&gt; IDLE

    IDLE --&gt;|"故障"| ERROR["ERROR
立即停轴 + 释放使能 + 切断电源"]
    ERROR --&gt;|"故障清除"| POWER_ON</pre></div>
<h3>完整流程</h3>
<pre><code class="language-text">POWER_ON (上电稳定)
    │ 等待电源稳定 + 100ms
    ▼
SELF_CHECK (自检)
    │ 打印机探测 + 输入重采样 + 轴位确认
    ▼
IDLE (空闲待命) ←───────────────────┐
    │                                │
    ├── TRIGGER_BAG (0x42) ────────┤
    │   BAG_CALIB_CHECK             │ 出袋流程
    │   BAG_CALIB_CLEAR             │
    │   BAG_CALIB_SEEK              │
    │   BAG_CALIB_BACKOFF           │
    │   BAG_OUT                     │
    │   PREHEAT                     │
    └───────────────────────────────┘
    │
    ├── TRIGGER_SEAL (0x43) ──────┐
    │   SEAL_FORWARD               │ 封口流程
    │   CONVEYOR_RUN               │ 投料传送带
    │   SEAL_BACKWARD              │ 热封后退
    │   PRESS_RETRACT              │ 轴2下压
    │   PRESS_CLOSE                │ 轴3/4闭合
    │   SEAL_HOLD                  │ 封口保持
    │   TEAR_OFF                   │ 轴1撕断
    │   PRESS_OPEN                 │ 轴2回位+轴3/4打开
    │   RESET                      │
    └───────────────────────────────┘
    │
    ├── TRIGGER_DELIVER (0x44) ───┐
    │   CONVEYOR_RUN               │ 投料流程
    │   RESET                      │
    └───────────────────────────────┘
    │
    ▼
ERROR (故障态)
    │ 立即停轴 + 释放使能 + 切断电源
    │ 故障清除后 → POWER_ON → SELF_CHECK → IDLE</code></pre>
<h3>流程设计原则</h3>
<p><strong>1. 每个流程有明确的 active_flow 标记</strong></p>
<p>状态机追踪当前在执行哪个动作流（BAG / SEAL / DELIVER / NONE）。CONTROL stop 只允许中断 active_flow 标记的动作，不影响自检、ERROR 恢复等非动作流链路。</p>
<p><strong>2. 错误态走完整恢复路径</strong></p>
<pre><code class="language-text">ERROR → POWER_ON(100ms) → SELF_CHECK → IDLE</code></pre>
<p>不能直接从 ERROR 跳 IDLE。100ms 上电稳定确保所有执行器已进入安全状态，自检重新确认机械位置。</p>
<p><strong>3. CONTROL stop 插队语义</strong></p>
<pre><code class="language-text">CONTROL stop → 清空队列中所有待执行动作 → 插队到队首 → 执行</code></pre>
<p>不是简单的 FIFO。停止命令有最高优先级。</p>
<h3>子阶段设计</h3>
<p>对于带有"多段固定脉冲"的单一状态（如 PRESS_CLOSE 包含"轴3/4同时闭合"和"轴2下压"两个子动作），拆分为显式子阶段：</p>
<pre><code class="language-c">typedef enum {
    APP_PRESS_CLOSE_STAGE_IDLE = 0,
    APP_PRESS_CLOSE_STAGE_AXIS2_RETRACT,
    APP_PRESS_CLOSE_STAGE_AXIS34_CLOSE,
    APP_PRESS_CLOSE_STAGE_DONE
|} app_press_close_stage_t;</code></pre>
<p>状态机只推进阶段编号，不直接调执行器启动下一段动作。执行器通过统一入口收口。</p>
<hr>
<h2>5. RTOS 任务模型与调度</h2>
<h3>7 个 FreeRTOS 任务</h3>
<pre><code class="language-text">优先级（从高到低）
  ProtoTask        AboveNormal   USART ISR 通知 + 50ms 兜底
                      │ 消费 UART DMA 字节流 → 解码20B帧 → 校验 CRC → 投递命令队列
                      │
  StateMachineTask  Normal7       10ms 固定周期
                      │ 推进状态机 → 子流程 on_run 回调
                      │
  MotorTask         AboveNormal1  5ms 固定周期 + SM 通知
                      │ packer_actuator_task_once() → 动作表映射
                      │
  AdcTask           Normal        100ms 固定周期
                      │ ADC 采样 + 功率记账
                      │
  CommTask          Normal        50ms 固定周期 + 命令触发
                      │ 异步执行阻塞 I/O（打印机对话、屏幕更新）
                      │
  MonitorTask       Normal1       500ms 固定周期
                      │ 栈水位诊断 + 通信看门狗 + 报警推送
                      │
  HeaterTask        Normal        100ms 固定周期
                      │ 加热占空比输出 → 继电器翻转</code></pre>
<h3>任务间协作模式</h3>
<p><strong>1. 任务通知链</strong></p>
<p>StateMachineTask 状态变化后，通过 <code>xTaskNotifyGive(MotorTaskHandle)</code> 通知 MotorTask。MotorTask 收到通知立即重新查动作表，否则按 5ms 固定周期轮训。减少了 80% 以上的无效查表。</p>
<p><strong>2. 句柄注册（禁止 extern）</strong></p>
<pre><code class="language-c">// ❌ 反模式
extern osThreadId_t MotorTaskHandle;

// ✅ 显式注入
void app_sm_register_motor_task(void *handle);</code></pre>
<p><strong>3. CommTask 异步 I/O</strong></p>
<p>打印机阻塞操作通过三函数接口异步化：</p>
<pre><code class="language-text">comm_task_enqueue(COMM_CMD_PRINTER_SELF_CHECK);  // 投递，不阻塞
comm_task_get_result(COMM_CMD_PRINTER_SELF_CHECK); // BUSY / OK / FAIL
comm_task_register_handler(type, handler_fn);      // 注册执行器</code></pre>
<p>CommTask 优先级<strong>低于</strong> StateMachineTask，确保阻塞 I/O 不会抢占流程推进。</p>
<h3>临界区规则</h3>
<ul>
<li>BSP 层：<code>__disable_irq()</code> / <code>__set_PRIMASK()</code>（保存恢复）</li>
<li>APP 层：<code>taskENTER_CRITICAL()</code> / <code>taskEXIT_CRITICAL()</code></li>
<li><code>volatile</code> <strong>不能</strong>替代原子性和临界区保护</li>
</ul>
<hr>
<h2>6. 执行器统一映射模式</h2>
<h3>从过程驱动到数据驱动</h3>
<p>传统写法：</p>
<pre><code class="language-c">void execute_actions(state_t s) {
    switch (s) {
    case STATE_A: start_motor(M1, 1000); break;
    case STATE_B: start_motor(M1, 0); break;
    }
}</code></pre>
<p>统一动作表写法：</p>
<pre><code class="language-c">typedef struct {
    packer_state_t        state;
    pact_stepper_mode_t   stepper_mode;   // 单轴/双轴/运行时换算
    bsp_dc_motor_id_t     dc_motor;
    bsp_dc_motor_dir_t    dc_motor_dir;   // STOP 表示不启动
    uint8_t hopper_conveyor : 1;
    uint8_t power_on : 1;
    uint8_t heater_toggle : 1;
|} state_action_t;

static const state_action_t s_actions[] = {
    {STATE_BAG_OUT,      STEP_BAG_RUNTIME, DC_NONE, STOP,      0, 1, 0},
    {STATE_SEAL_FORWARD, STEP_SINGLE,      DC_NONE, STOP,      0, 1, 0},
    {STATE_CONVEYOR_RUN, STEP_NONE,        DC_1,    FORWARD,   1, 1, 0},
    {STATE_PRESS_CLOSE,  STEP_DUAL,        DC_NONE, STOP,      0, 1, 0},
    {STATE_SEAL_HOLD,    STEP_NONE,        DC_NONE, STOP,      0, 1, 1},
    // ...
};</code></pre>
<p>MotorTask 周期遍历整个表：</p>
<pre><code class="language-c">void packer_actuator_task_once(packer_state_t state) {
    const state_action_t *action = find_action(state);
    if (!action) return;

    // 步进：单轴 / 双轴 / 运行时换算
    handle_stepper(action-&gt;stepper_mode, state);

    // 直流电机 + 功率限制统一入口
    if (action-&gt;dc_motor != DC_MOTOR_ID_COUNT) {
        packer_power_limit_request(action-&gt;dc_motor, action-&gt;dc_motor_dir);
    }

    // 继电器 + 加热
    bsp_actuator_write(RELAY_HOPPER, action-&gt;hopper_conveyor);
    if (action-&gt;heater_toggle) packer_heater_toggle();
}</code></pre>
<h3>优势</h3>
<ul>
<li>新增状态 = 加一行表，不改流程代码</li>
<li>所有执行器状态一目了然，可审计</li>
<li>功率限制、加热逻辑等横向关注点只需要在循环中加一行</li>
</ul>
<h3>步进电机控制模型</h3>
<pre><code class="language-text">轴1（出袋/撕断）  轴2（压杆）     轴3/4（封口）
        ───────────────  ────────────  ──────────────
方向     正/反转          正/反转       正/反转
脉冲     有限/连续         有限/连续      有限/连续
停止模式 目标/溢出/连续   目标/溢出/连续  目标/溢出+IN1
加减速   抛物线起步       抛物线起步     抛物线起步
         线性收尾         线性收尾       线性收尾</code></pre>
<p>二次抛物线起步频率规划：</p>
<pre><code class="language-text">斜坡脉冲数 = (target_hz² - start_hz²) / (2 × accel_hz_per_s)

三角波条件: target_pulses ≤ 加速斜坡 + 减速斜坡
梯形条件:   target_pulses &gt; 加速斜坡 + 减速斜坡</code></pre>
<p>使用 <code>uint64_t</code> 整数平方根（逐位逼近法）计算，避免浮点库引入。</p>
<hr>
<h2>7. 通信协议体系</h2>
<p>通信协议体系分为三层：20B 固定帧层、HMIS 会话层、以及中间的分片适配层 HMIS-BAM：</p>
<div class="arcaea-mermaid-box"><pre class="mermaid">flowchart TB
    subgraph 会话层["HMIS 会话层"]
        HMIS["完整 HMIS 帧
长度可变，最大 512B"]
    end

    subgraph 分片层_["HMIS-BAM 分片层 (FUNC=0x7F)"]
        BAM_LAYER["单缓冲区 · Bitmap 跟踪
ACK/NACK 重试 · 超时 1500ms
最多 3 次重发
12B 载荷 / 分片"]
    end

    subgraph 固定帧层["20B 固定帧层 (FUNC=0x40-0x4C)"]
        FRAME20["帧头 + ADDR + FUNC + Z1
+ 14B Data + CRC16-Modbus"]
    end

    subgraph 物理层_["物理层 (UART DMA)"]
        PHY["USART3 / RS485
9600 8N1"]
    end

    HMIS --&gt;|"分片 (12B 载荷)"| BAM_LAYER
    BAM_LAYER --&gt;|"重组"| HMIS
    BAM_LAYER --&gt;|"封装为 20B 帧"| FRAME20
    FRAME20 --&gt; PHY</pre></div>
<h3>物理层</h3>
<div class="arcaea-table-wrap" data-bac-table-shell="1"><table>
<tr>
<th>端口</th>
<th>电平</th>
<th>速率</th>
<th>用途</th>
</tr>
<tr>
<td>USART3</td>
<td>RS485</td>
<td>9600 8N1</td>
<td>主通信（20B 固定帧）</td>
</tr>
<tr>
<td>USART1</td>
<td>RS232</td>
<td>9600 8N1</td>
<td>DGUS 串口屏 + 日志</td>
</tr>
<tr>
<td>USART2</td>
<td>RS232</td>
<td>115200 8N1</td>
<td>打印机</td>
</tr>
</table></div>
<h3>USART3 20B 固定帧协议</h3>
<pre><code class="language-text">┌────┬────┬────┬────┬────┬────┬────┬────┬────┬────┬────┬────┬────┬────┬────┬────┬────┬────┬────┬────┐
│HDR │ADDR│FUNC│Z1  │  DATA[0..13]      (14 bytes payload)    │CRC_L│CRC_H│            │
└────┴────┴────┴────┴────┴────┴────┴────┴────┴────┴────┴────┴────┴────┴────┴────┴────┴────┴────┴────┘
 1B   1B   1B   1B     14B data field                            2B CRC (Modbus, low first)</code></pre>
<p>功能码：</p>
<div class="arcaea-table-wrap" data-bac-table-shell="1"><table>
<tr>
<th>码值</th>
<th>命令</th>
<th>说明</th>
</tr>
<tr>
<td>0x40</td>
<td>CONTROL</td>
<td>start / stop</td>
</tr>
<tr>
<td>0x42</td>
<td>TRIGGER_BAG</td>
<td>触发出袋</td>
</tr>
<tr>
<td>0x43</td>
<td>TRIGGER_SEAL</td>
<td>触发封口</td>
</tr>
<tr>
<td>0x44</td>
<td>TRIGGER_DELIVER</td>
<td>触发投料</td>
</tr>
<tr>
<td>0x45</td>
<td>JOG</td>
<td>点动（步进/直流）</td>
</tr>
<tr>
<td>0x46</td>
<td>ALARM_QUERY</td>
<td>查询报警</td>
</tr>
<tr>
<td>0x47</td>
<td>PRINTER_FORWARD</td>
<td>打印机透传</td>
</tr>
<tr>
<td>0x48</td>
<td>HEARTBEAT</td>
<td>心跳</td>
</tr>
<tr>
<td>0x49</td>
<td>RESET_FAULT</td>
<td>故障复位</td>
</tr>
</table></div>
<p>回复时机约定（Z1 字段控制）：</p>
<div class="arcaea-table-wrap" data-bac-table-shell="1"><table>
<tr>
<th>Z1</th>
<th>语义</th>
<th>回复时机</th>
</tr>
<tr>
<td>0x00</td>
<td>停机/查询</td>
<td>立即回复</td>
</tr>
<tr>
<td>0x01</td>
<td>启动运行</td>
<td>立即回复</td>
</tr>
<tr>
<td>0x02</td>
<td>完成查询</td>
<td>立即回复</td>
</tr>
</table></div>
<h3>DGUS (USART1) 协议</h3>
<pre><code class="language-text">帧头: 5A A5
帧格式: 5A A5 + Length + Command + Data[n]
命令: 0x81 读变量 / 0x82 写变量 / 0x83 上报
用途: 参数读写 + 系统日志帧推送</code></pre>
<h3>打印机协议</h3>
<p>基于最小 5A A5 框架，支持 0x81/0x82/0x83 命令，USART2 115200 8N1。</p>
<h3>双端口隔离原则</h3>
<p>USART3 和 USART1 是<strong>两个物理端口，两套协议，完全隔离</strong>：<br>- USART3 只解析 20B 协议，不认识 DGUS 帧<br>- USART1 只解析 DGUS 5A A5，不认识 20B 协议<br>- 不自动回退到另一个端口<br>- 每个端口独立配置波特率、CRC 算法、超时策略</p>
<hr>
<h2>7.5 HMIS-BAM：20B 分片承载 HMIS 会话协议</h2>
<h3>为什么需要 BAM</h3>
<p>HMIS 会话帧长度可达 128+ 字节，但现有总线宽度为 20B 固定帧（14B 数据段），直接传输不可行。解决方案：将 HMIS 帧分片为 12B 载荷块，装入 20B 框架内传输，对端重组还原。</p>
<p><code>FUNC=0x7F</code> 专门用于 BAM 协议，与 legacy 0x40-0x4C 控制协议完全分离，避免功能码冲突和解析混淆。</p>
<h3>BAM 帧格式</h3>
<div class="arcaea-table-wrap" data-bac-table-shell="1"><table>
<tr>
<th>Offset</th>
<th>Field</th>
<th>Len</th>
</tr>
<tr>
<td>0</td>
<td>ADDR</td>
<td>1B</td>
</tr>
<tr>
<td>1</td>
<td>FUNC (0x7F)</td>
<td>1B</td>
</tr>
<tr>
<td>2</td>
<td>SESSION_ID</td>
<td>1B</td>
</tr>
<tr>
<td>3</td>
<td>FRAG_INDEX</td>
<td>1B (0xFE=ACK, 0xFF=NACK)</td>
</tr>
<tr>
<td>4</td>
<td>FRAG_COUNT</td>
<td>1B</td>
</tr>
<tr>
<td>5</td>
<td>FRAG_LEN</td>
<td>1B</td>
</tr>
<tr>
<td>6-17</td>
<td>PAYLOAD</td>
<td>12B</td>
</tr>
<tr>
<td>18-19</td>
<td>CRC16</td>
<td>2B</td>
</tr>
</table></div>
<p>帧头 ADDR + FUNC(0x7F) 两字节即可识别 BAM 帧，与普通 20B 控制帧共享底层收发路径，仅通过 FUNC 值路由到 BAM 解析器。</p>
<h3>单缓冲区设计</h3>
<p>512B 单静态缓冲区 <code>s_bam_payload[512]</code>，RX 和 TX 通过 <code>s_tx.active</code> / <code>s_rx.active</code> 标志互斥访问。无 malloc，无动态分配——嵌入式 48KB RAM MCU 环境下不允许堆分配。</p>
<pre><code class="language-c">// 单个 s_bam_payload 缓冲区，RX/TX 互斥
static uint8_t s_bam_payload[BAM_PAYLOAD_SIZE]; // 512B
static struct {
    uint8_t active;
    uint8_t session_id;
    uint8_t frag_count;
    uint16_t total_len;
|} s_tx, s_rx;</code></pre>
<p>发送时先将完整 HMIS 帧填入 <code>s_bam_payload</code>，再逐片切片发送；接收时将各分片载荷按偏移写入同一缓冲区，全部收齐后即得到完整 HMIS 帧。</p>
<h3>Bitmap 跟踪接收进度</h3>
<p>接收端使用 bitmap 跟踪已收分片（最多 43 分片，512B / 12B = 42.67）：</p>
<pre><code class="language-c">#define MAX_FRAGMENTS 43
static uint64_t s_rx_bitmap; // 位 0-42 标记分片已收

static uint8_t bam_received(uint8_t index) {
    return (s_rx_bitmap &gt;&gt; index) &amp; 1;
}

static void bam_mark_received(uint8_t index) {
    s_rx_bitmap |= ((uint64_t)1 &lt;&lt; index);
}</code></pre>
<p>满收判定：<code>s_rx.received_count &gt;= s_rx.frag_count</code>，触发 ACK 回复。</p>
<h3>ACK / NACK 控制帧</h3>
<p>控制帧以 <code>FRAG_INDEX=0xFE</code>（ACK）或 <code>0xFF</code>（NACK）标识，携带状态码：</p>
<div class="arcaea-table-wrap" data-bac-table-shell="1"><table>
<tr>
<th>码值</th>
<th>常量</th>
<th>含义</th>
</tr>
<tr>
<td>0x00</td>
<td>CTRL_OK</td>
<td>收发成功</td>
</tr>
<tr>
<td>0x01</td>
<td>CTRL_BUSY</td>
<td>接收器忙（正在收另一个会话）</td>
</tr>
<tr>
<td>0x02</td>
<td>CTRL_OVERSIZE</td>
<td>HMIS 帧超长（&gt;512B）</td>
</tr>
<tr>
<td>0x03</td>
<td>CTRL_FORMAT</td>
<td>分片格式错误</td>
</tr>
<tr>
<td>0x04</td>
<td>CTRL_TIMEOUT</td>
<td>接收超时（1500ms 无新分片）</td>
</tr>
</table></div>
<p>重试策略：发送方在发送所有分片后等待 ACK，若收到 NACK 或 1500ms 内无回复，重发全部最多 3 次。3 次失败后向上层报告发送失败。</p>
<h3>代码关键路径</h3>
<p><strong>分片构造（packer_hmis_bam.c:121-128）：</strong></p>
<pre><code class="language-c">frame.data.raw[0] = s_tx.session_id;
frame.data.raw[1] = i;                 // fragment index
frame.data.raw[2] = s_tx.frag_count;
frame.data.raw[3] = frag_len;
memcpy(&amp;frame.data.raw[4], &amp;s_bam_payload[offset], frag_len);</code></pre>
<p><strong>接收完成判定（packer_hmis_bam.c:291）：</strong></p>
<pre><code class="language-c">if (s_rx.received_count &gt;= s_rx.frag_count) {
    s_rx.complete = 1;
    bam_send_control(..., ACK, CTRL_OK);
    return RX_COMPLETE;
}</code></pre>
<h3>架构整合</h3>
<ul>
<li><strong>单缓冲区互斥</strong>：<code>s_bam_payload</code> 在 RX 和 TX 之间共享，通过 <code>s_tx.active</code> 和 <code>s_rx.active</code> 互斥——任一时刻只在一个方向上使用。</li>
<li><strong>无专用任务</strong>：<code>packer_hmis_bam_task_once()</code> 从现有 <code>ProtoTask</code> 周期中调用，不新增 RTOS 任务。函数内部检查缓冲区状态和超时，非阻塞执行。</li>
<li><strong>双端口部署</strong>：
<ul>
<li>USART1 仅接收 BAM 帧 —— 用于 HMI 与打包机之间的 HMIS 会话</li>
<li>USART3 同时接收 BAM 帧 + Legacy 20B 控制帧 —— 向上兼容旧协议</li>
<li>两个端口均不接收原始 HMIS 会话帧（即不接收未经分片的 HMIS 帧）</li>
</ul>
</li>
</ul>
<h3>协议栈分层视角</h3>
<pre><code class="language-text">┌──────────────────────────────────────────┐
│       HMIS 会话层（128+ 字节帧）            │
│                                            │
│  完整 HMIS 帧（长度可变，最大 512B）        │
└──────────────────┬───────────────────────┘
                   │ 分片（12B 载荷） / 重组
┌──────────────────▼───────────────────────┐
│       HMIS-BAM 分片层（FUNC=0x7F）        │
│                                            │
│  单缓冲区 · Bitmap 跟踪 · ACK/NACK 重试    │
│  超时 1500ms · 最多 3 次重发               │
└──────────────────┬───────────────────────┘
                   │ 封装为 20B 帧
┌──────────────────▼───────────────────────┐
│       20B 固定帧层（FUNC=0x40-0x4C）      │
│                                            │
│  帧头 + ADDR + FUNC + Z1 + 14B + CRC16   │
└──────────────────┬───────────────────────┘
                   │ USART3 / RS485 9600 8N1
┌──────────────────▼───────────────────────┐
│              物理层（UART DMA）            │
└──────────────────────────────────────────┘</code></pre>
<p>HMIS-BAM 的引入使得 20B 窄总线得以承载完整的 HMIS 会话协议而无须修改物理层，同时通过 FUNC=0x7F 与 legacy 协议共存于同一物理端口。</p>
<hr>
<h2>8. HMI 上位机架构</h2>
<h3>技术选型</h3>
<p>Flutter 3.41.7 / Dart 3.11.5，跨平台目标：Windows/macOS/Linux/Android/iOS/Web。桌面端（Windows/Linux/macOS）为优先调试平台。</p>
<h3>模块结构</h3>
<pre><code class="language-text">HMI/lib/
├── core/
│   ├── protocol/
│   │   ├── crc16_modbus.dart      CRC16-Modbus 算法
│   │   ├── crc_algorithm.dart     CRC 抽象接口
│   │   └── hmi_frame.dart         帧编解码
│   ├── serial/
│   │   ├── serial_transport.dart      串口抽象接口
│   │   └── serial_transport_impl.dart 平台实现
├── features/
│   └── hmi/
│       ├── hmi_controller.dart        主控制器（帧消费 + 命令执行）
│       ├── hmi_dashboard_page.dart    仪表盘页面
│       ├── hmi_param_config.dart      参数配置
│       ├── hmi_port_config.dart       串口配置
│       └── hmi_protocol.dart          协议层
└── util/
    ├── log_exporter.dart              日志导出抽象
    ├── log_exporter_io.dart           IO 实现
    └── log_exporter_web.dart          Web 实现</code></pre>
<h3>双串口设计</h3>
<pre><code class="language-text">端口 A (USART3)
  主控协议 / 20B 固定帧 / CRC16-Modbus / 9600 8N1
  功能码: 0x01~0x10 (上位机→主控), 0x40~0x53 (上位机→打包机)
  仅处理 20B 主协议，不解析 DGUS

端口 B (USART1)
  日志监控 + DGUS 调参 / 9600 8N1 / 帧头 5A A5
  被动: 接收日志输出/调试信息
  主动: 发送 DGUS 变参调节帧
  仅处理 DGUS，不解析 20B 主协议</code></pre>
<h3>日志系统</h3>
<p>日志包含完整时间标签 (<code>yyyy-MM-dd HH:mm:ss.SSS</code>)，每条日志分多行展示（时间/方向行 + 内容行分离），便于检索 RX/TX。记录 HMI 控制器的每次命令执行（命令名、参数、结果、尝试次数、耗时）。</p>
<h3>HMI 控制器核心接口</h3>
<pre><code class="language-text">// 帧消费
Future&lt;CommandExecutionResult&gt; _consumeFrames(
    HmiFrame request, String label,
    {Duration? totalTimeout, int maxAttempts});

// DGUS 参数读写
Uint8List _dgusEncode(int command, Uint8List data);
Future&lt;_DgusFrame?&gt; _dgusTransaction(_DgusFrame request);

// 端口扫描与连接
Future&lt;PortScanResult&gt; scanPorts();
Future&lt;ConnectionResult&gt; connect(PortConfig config);</code></pre>
<hr>
<h2>9. 工程难点与解决方案</h2>
<h3>9.1 三层分层落地 — 建筑隔离 vs 文档规范</h3>
<p><strong>问题</strong>：团队知道要分层，但实际代码中 APP 层到处都是 <code>HAL_GPIO_WritePin</code>。</p>
<p><strong>根因</strong>：文档规范缺乏强制力。CMakeLists 允许所有文件互相 include。</p>
<p><strong>方案</strong>：用构建系统做物理隔离。三层各自定义 <code>target_include_directories</code>，APP 编译时 BSP 的 include 路径不可见。</p>
<p><strong>结果</strong>：违反分层变成编译错误，不再是 code review 问题。</p>
<h3>9.2 状态机与阻塞 I/O 冲突</h3>
<p><strong>问题</strong>：StateMachineTask 在 10ms 周期内调用打印机 UART 收发，卡住几百毫秒。</p>
<p><strong>根因</strong>：状态机任务混合了"流程决策"和"阻塞 I/O"两种不相容的职责。</p>
<p><strong>方案</strong>：引入 CommTask（专用 I/O 任务），三函数接口（enqueue / get_result / register_handler）解耦。CommTask 优先级低于 StateMachineTask。</p>
<h3>9.3 步进电机脉冲溢出 — 超时保护不可靠</h3>
<p><strong>问题</strong>：给开环步进轴加 10 秒超时保护，ISR 正常时超时没有意义（done 先到），ISR 异常时超时也不准。</p>
<p><strong>根因</strong>：超时信号和脉冲由同一个 ISR 产生，两者不独立。</p>
<p><strong>方案</strong>：脉冲溢出保护 <code>目标脉冲 + 10000</code> → 硬停止 + 报警。有传感器反馈的轴才保留超时作为辅助。</p>
<h3>9.4 残留 done 标志误判</h3>
<p><strong>问题</strong>：步进电机完成有限脉冲后 done 保持置位。同一状态被复用于不同轴配置时，旧标志误导后续判断。</p>
<p><strong>方案</strong>：motion_seen 模式——每个有限脉冲动作配一个"是否观察到运动开始"的标志。确认运动开始后才允许 done 收尾。</p>
<pre><code class="language-c">static uint8_t s_motion_seen = 0;
void on_enter(void) {
    packer_actuator_start(...);
    s_motion_seen = 0;
}
void on_run(void) {
    if (!s_motion_seen &amp;&amp; is_running(axis)) s_motion_seen = 1;
    if (s_motion_seen &amp;&amp; is_done(axis)) transition_to(NEXT);
}</code></pre>
<h3>9.5 编译期宏到运行时参数的迁移</h3>
<p><strong>问题</strong>：项目初期所有参数是 <code>#define BAG_SPEED_HZ 10504</code>，每次改参数要重新编译烧录。</p>
<p><strong>方案</strong>：增量迁移——先在 runtime_config 里加字段（默认值等于旧宏），代码同时支持两套；<code>grep</code> 确认旧宏零引用后删除；同步更新 Doxygen 组。</p>
<p><strong>分类策略</strong>：<br>- 运行时调参（速度/加减速/延时）→ runtime_config + EEPROM<br>- 固件期定死（硬件引脚/协议地址/任务栈）→ 保留宏<br>- 换算常量 → 局部 .c 静态常量</p>
<h3>9.6 开环超时误区（纯开环轴）</h3>
<p><strong>问题</strong>：为无感测器步进轴尝试进行超时保护</p>
<p><strong>根因</strong>：开环轴 ISR 正常则 done 先于超时，ISR 异常则超时也异常</p>
<p><strong>方案</strong>：唯一硬保护采用脉冲溢出 <code>目标脉冲 + APP_CFG_STEPPER_PULSE_OVERFLOW_MARGIN(10000)</code>，独立 ISR 计步</p>
<h3>9.7 协议回复时机（Z1 语义优化）</h3>
<p><strong>问题</strong>：之前所有命令都在"完成后回复"，导致上位机长时间等待后超时</p>
<p><strong>方案</strong>：Z1 字段控制语义——0x01 启动立即回复（不等待动作完成），0x02 完成查询确认。启动和查询分离，上位机不用阻塞</p>
<h3>9.8 HMI 双端口帧冲突</h3>
<p><strong>问题</strong>：两个协议（20B + DGUS）混用一个串口，字节流粘包时误判</p>
<p><strong>根因</strong>：5A A5 恰好可能是 20B 帧的 data 段内容</p>
<p><strong>方案</strong>：两个物理端口完全隔离，每个端口只解析一种协议，不自动回退</p>
<h3>9.9 任务栈水位诊断</h3>
<p><strong>问题</strong>：FreeRTOS 任务栈溢出难以复现，随机崩溃</p>
<p><strong>方案</strong>：MonitorTask 每 500ms 采集所有任务的最低栈水位，计算最小值，日志上报。提前预警而非事后崩溃</p>
<h3>9.10 中断错误快照</h3>
<p><strong>问题</strong>：UART/DMA 硬件错误难以现场定位，重启后丢失</p>
<p><strong>方案</strong>：在 .noinit 段保留错误快照结构体，下次启动时日志上报上次崩溃原因（UART 错误码、DMA 错误码、实例索引）</p>
<hr>
<h2>10. 可复用经验与模板</h2>
<h3>10.1 最佳实践清单</h3>
<p><strong>状态机设计</strong><br>- 使用回调注册表替代 switch-case<br>- 每个状态独立文件，on_enter / on_run / on_exit 三回调<br>- 显式子阶段替代隐式脉冲斩杀<br>- 错误态走完整恢复路径（ERROR→POWER_ON→SELF_CHECK→IDLE）</p>
<p><strong>执行器设计</strong><br>- 统一动作表（数据驱动）替代散落 switch<br>- 开环轴唯一保护：脉冲溢出<br>- 有传感器轴：传感器 + 脉冲溢出双层保护<br>- motion_seen 模式防残留标志误判</p>
<p><strong>RTOS 设计</strong><br>- 阻塞 I/O 专用任务（CommTask 模式）<br>- 任务通知链减少轮询<br>- 优先级：状态机 &gt; 执行器 &gt; I/O &gt; 监控<br>- 句柄注入注册替代 extern</p>
<p><strong>分层设计</strong><br>- 构建隔离（物理级）而非文档规范（道德级）<br>- BSP：纯硬件，无业务语义<br>- Service：设备能力，不直接调 BSP<br>- APP：业务流程，不直接操作硬件</p>
<p><strong>协议设计</strong><br>- 双端口隔离（不要混用协议）<br>- 启动回复与完成查询分离<br>- CRC 校验 + 帧头保护</p>
<h3>10.2 推荐模板</h3>
<p><strong>CMake 三层模板</strong></p>
<pre><code class="language-cmake">BSP 层
add_library(bsp STATIC)
target_include_directories(bsp PUBLIC BSP/Inc)
target_sources(bsp PRIVATE BSP/Src/bsp_stepper.c BSP/Src/bsp_uart.c ...)

# Service 层
add_library(service STATIC)
target_include_directories(service PUBLIC Service/Inc)
target_link_libraries(service PUBLIC bsp)
target_sources(service PRIVATE Service/Src/packer_actuator.c ...)

# APP 层 - 不直接看到 BSP 路径
add_executable(app)
target_include_directories(app PRIVATE APP/Inc)
target_link_libraries(app service)
target_sources(app PRIVATE APP/Src/app_packer_sm.c ...)</code></pre>
<p><strong>回调注册表状态机模板</strong></p>
<pre><code class="language-c">static const packer_state_handler_t s_handler = {
    .state    = PACKER_STATE_MY_STATE,
    .on_enter = my_state_on_enter,
    .on_run   = my_state_on_run,
    .on_exit  = my_state_on_exit,
    .name     = "MY_STATE"
};

void my_module_init(void) {
    psh_register(&amp;s_handler);
}</code></pre>
<p><strong>CommTask 异步 I/O 模板</strong></p>
<pre><code class="language-c">// 头文件
void comm_task_init(void);
void comm_task_run(void);
void comm_task_register_handler(cmd_type_t, handler_t);
uint8_t comm_task_enqueue(cmd_type_t);
result_t comm_task_get_result(cmd_type_t);

// 使用（状态机侧）
void state_on_run(void) {
    comm_task_enqueue(CMD_MY_OPERATION);
    // 下一周期：
    result_t r = comm_task_get_result(CMD_MY_OPERATION);
    if (r == BUSY) return;
    // r == OK / FAIL
}</code></pre>
<p><strong>串口帧 + CRC 模板</strong></p>
<pre><code class="language-c">#define FRAME_SIZE 20
#define DATA_SIZE  14

typedef struct {
    uint8_t header;
    uint8_t addr;
    uint8_t func;
    uint8_t z1;
    uint8_t data[DATA_SIZE];
    uint16_t crc;
|} __attribute__((packed)) serial_frame_t;

uint8_t frame_decode(const uint8_t *raw, serial_frame_t *out);
uint16_t crc16_modbus(const uint8_t *data, uint32_t len);</code></pre>
<h3>10.3 项目文档体系（.agents/ 范式）</h3>
<pre><code class="language-text">.agents/
├── index.md              # 模块导航
├── SKILL.md              # 架构约束 + 历史故障 TOP 10 + 修改清单
├── common/               # 项目基线、协议口径、构建规则
├── app/                  # APP 层模块 agent 文档
├── service/              # Service 层模块 agent 文档
└── bsp/                  # BSP 层模块 agent 文档

doc/
├── 文档索引.md            # 阅读路线
├── 打包机上位主控系统说明书.md  # 对外协议
├── DGUS串口屏协议.md
├── 步进电机二次抛物线S曲线设计与调参.md
├── 构建与协作环境.md
├── 硬件使用情况和配置.md
├── 硬件原理图与网表索引.md
└── CubeMX_ioc外设规划表.md</code></pre>
<hr>
<h2>11. 后续优化方向</h2>
<h3>短期（可快速落地）</h3>
<ul>
<li><strong>功率限制正式启用</strong> — <code>packer_power_limit</code> 框架已预埋，当前阈值设为超大值仅做记账。现场参数核对后可开启实际限流。</li>
<li><strong>二次抛物线起步验证</strong> — 步进抛物线起步已代码落地，但 FW 路径未验证。需要在实物上测试三角波/梯形波边界情况。</li>
<li><strong>HMI 打印机功能扩展</strong> — CommTask 模式已支持打印机透传，可以通过 HMI 增加打印机测试面板。</li>
</ul>
<h3>中期（需架构调整）</h3>
<ul>
<li><strong>日志系统统一化</strong> — 当前 BSP log 和 DGUS log 两套并存。可以统一为可配置的日志后端（UART / DGUS / RingBuffer）。</li>
<li><strong>HMI 参数同步</strong> — 运行时参数通过 DGUS 写入后，可以考虑自动同步到 EEPROM，减少手动保存操作。</li>
<li><strong>更细粒度的功率限制</strong> — 当前为 DC+NMOS 合并采样。可以拆分为独立采样通道。</li>
<li><strong>CI/CD 集成</strong> — 可以接入 GitHub Actions 做固件自动构建 + 单元测试（在 PC 模拟层/硬件在环）。</li>
</ul>
<h3>长期（思考方向）</h3>
<ul>
<li><strong>多模块总控</strong> — 当前固件是执行节点，不承担整机编排。需要多个执行节点时，上位主控的调度策略需要重构。</li>
<li><strong>通信协议版本协商</strong> — 20B 固定帧当前硬编码版本号。可以做协议版本协商实现向后兼容。</li>
<li><strong>单元测试框架</strong> — 将 BSP 层抽离 HAL 依赖后，可以在 PC 上跑 Service 层单元测试。</li>
<li><strong>配置管理平台</strong> — EEPROM 参数可通过上位机导出/导入，多个执行节点统一配置分发。</li>
</ul>
<hr>
<h2>12. 总结</h2>
<p>这个项目从 V2 到 V5 的四轮重构，本质上完成了三件事：</p>
<p><strong>第一，把"怎么执行"从"决定做什么"里分离。</strong> APP 层的文件从 10+ 个缩减到 3 个，每个不到 200 行。不是因为功能变少了——是因为细节下沉到了正确的位置。</p>
<p><strong>第二，把"阻塞"从"周期"里分离。</strong> CommTask 的出现让状态机保持了 10ms 的确定性脉搏，不再被打印机 UART 劫持。</p>
<p><strong>第三，用编译器替代了 code review 来做架构合规。</strong> 物理层的 include 隔离比一万字文档都有效。允许编译通过就一定会被人利用——所以不让它编译通过。</p>
<p><em>311 次提交，5 个本地分支，12 个远程分支。278 个源文件，约 50K LOC C + 3K LOC Dart。这不是一个"写好架构图再写代码"的项目——它是一个"每改一次 bug 架构就干净一分"的项目。</em></p>
<p><strong>后记：这套架构的价值不在代码本身，而在分层思想 + 状态机模式 + 接口规范 + 异常处理 + 可复用模板。下次做类似工业嵌入式项目，几乎可以直接套用。</strong></p>
<hr>
<h2>13. 顶层状态机路由</h2>
<h3>19 状态主循环</h3>
<p>整个系统围绕一个 19-state 主状态机运转，每个状态由独立的子状态机（Sub-SM）或直接回调处理。状态序列如下：</p>
<pre><code class="language-text">POWER_ON → SELF_CHECK → IDLE → BAG_CALIB_CHECK → BAG_INIT → BAG_EXTRUDE → BAG_PULL → BAG_CUT → BAG_UNLOAD → SEAL_INIT → SEAL_PRESS → SEAL_HOLD → SEAL_COOL → SEAL_UNLOAD → DELIVER_INIT → DELIVER_RUN → DELIVER_DONE → WAIT_NEXT → ERROR</code></pre>
<p>每个状态的角色与对应的子状态机处理器：</p>
<div class="arcaea-table-wrap" data-bac-table-shell="1"><table>
<tr>
<th>状态</th>
<th>角色</th>
<th>处理器 / Sub-SM</th>
</tr>
<tr>
<td>POWER_ON</td>
<td>上电初始化，时钟、GPIO、外设复位</td>
<td>sm_self_check (初始化子集)</td>
</tr>
<tr>
<td>SELF_CHECK</td>
<td>自检：步进归零、传感器校验、通信环路</td>
<td>sm_self_check</td>
</tr>
<tr>
<td>IDLE</td>
<td>空闲等待指令，心跳维持，参数查询响应</td>
<td>app_packer_sm (轮询)</td>
</tr>
<tr>
<td>BAG_CALIB_CHECK</td>
<td>装袋校准：袋子位置 / 长度验证</td>
<td>sm_bag_flow</td>
</tr>
<tr>
<td>BAG_INIT</td>
<td>取袋准备：压杆抬起、封口就位</td>
<td>sm_bag_flow</td>
</tr>
<tr>
<td>BAG_EXTRUDE</td>
<td>挤出出袋：步进电机旋转挤出</td>
<td>sm_bag_flow</td>
</tr>
<tr>
<td>BAG_PULL</td>
<td>拉袋牵引：牵引辊动作至目标位置</td>
<td>sm_bag_flow</td>
</tr>
<tr>
<td>BAG_CUT</td>
<td>切袋：切断机构动作</td>
<td>sm_bag_flow</td>
</tr>
<tr>
<td>BAG_UNLOAD</td>
<td>卸袋过渡：等待封口工位就绪</td>
<td>sm_bag_flow</td>
</tr>
<tr>
<td>SEAL_INIT</td>
<td>封口预热：加热管使能、温度稳定</td>
<td>sm_seal_flow</td>
</tr>
<tr>
<td>SEAL_PRESS</td>
<td>封口压制：加热压合动作</td>
<td>sm_seal_flow</td>
</tr>
<tr>
<td>SEAL_HOLD</td>
<td>保压固化：保持压力直到密封固化</td>
<td>sm_seal_flow</td>
</tr>
<tr>
<td>SEAL_COOL</td>
<td>冷却脱模：自然冷却 / 主动散热</td>
<td>sm_seal_flow</td>
</tr>
<tr>
<td>SEAL_UNLOAD</td>
<td>封口卸料：松开夹具，就绪出料</td>
<td>sm_seal_flow</td>
</tr>
<tr>
<td>DELIVER_INIT</td>
<td>投料准备：输送带就位</td>
<td>sm_deliver_flow</td>
</tr>
<tr>
<td>DELIVER_RUN</td>
<td>投料运行：输送电机动作</td>
<td>sm_deliver_flow</td>
</tr>
<tr>
<td>DELIVER_DONE</td>
<td>投料完成：确认成品输出</td>
<td>sm_deliver_flow</td>
</tr>
<tr>
<td>WAIT_NEXT</td>
<td>周期等待：延时 / 等待触发后再入 IDLE</td>
<td>app_packer_sm (定时器)</td>
</tr>
<tr>
<td>ERROR</td>
<td>故障处理：记录快照、报警、等待复位</td>
<td>packer_fault_latch</td>
</tr>
</table></div>
<h3>流路由（Flow Routing）</h3>
<p>主状态机根据指令类型将流程路由到三个独立流：</p>
<pre><code class="language-text">┌─────────────────────────┐
                     │    app_packer_sm         │
                     │    (顶层路由调度)         │
                     └────────┬────────────────┘
                              │
              ┌───────────────┼───────────────┐
              │               │               │
              ▼               ▼               ▼
     ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
     │  BAG FLOW    │ │  SEAL FLOW   │ │ DELIVER FLOW │
     │              │ │              │ │              │
     │ BAG_INIT     │ │ SEAL_INIT    │ │ DELIVER_INIT │
     │ BAG_EXTRUDE  │ │ SEAL_PRESS   │ │ DELIVER_RUN  │
     │ BAG_PULL     │ │ SEAL_HOLD    │ │ DELIVER_DONE │
     │ BAG_CUT      │ │ SEAL_COOL    │ │              │
     │ BAG_UNLOAD   │ │ SEAL_UNLOAD  │ │              │
     └──────────────┘ └──────────────┘ └──────────────┘
                              │
                              ▼
                     ┌────────────────┐
                     │   WAIT_NEXT    │
                     │   → IDLE       │
                     └────────────────┘</code></pre>
<p>路由规则：</p>
<ul>
<li>收到 TRIGGER_BAG (0x42) → 路由到 BAG_FLOW，完成后自动进入 SEAL_FLOW</li>
<li>收到 TRIGGER_SEAL (0x43) → 直接路由到 SEAL_FLOW</li>
<li>收到 TRIGGER_DELIVER (0x44) → 路由到 DELIVER_FLOW</li>
<li>任意流遇到故障 → 共路到 ERROR 状态</li>
<li>ERROR → 复位后走 POWER_ON → SELF_CHECK → IDLE 完整恢复路径</li>
</ul>
<h3>24 阶段码映射</h3>
<p>每个状态映射为一个 1 字节的阶段码（Phase Code），用于上位机状态指示和日志：</p>
<div class="arcaea-table-wrap" data-bac-table-shell="1"><table>
<tr>
<th>阶段码</th>
<th>状态</th>
<th>阶段码</th>
<th>状态</th>
</tr>
<tr>
<td>0x01</td>
<td>POWER_ON</td>
<td>0x0D</td>
<td>SEAL_PRESS</td>
</tr>
<tr>
<td>0x02</td>
<td>SELF_CHECK</td>
<td>0x0E</td>
<td>SEAL_HOLD</td>
</tr>
<tr>
<td>0x03</td>
<td>IDLE</td>
<td>0x0F</td>
<td>SEAL_COOL</td>
</tr>
<tr>
<td>0x04</td>
<td>BAG_CALIB_CHECK</td>
<td>0x10</td>
<td>SEAL_UNLOAD</td>
</tr>
<tr>
<td>0x05</td>
<td>BAG_INIT</td>
<td>0x11</td>
<td>DELIVER_INIT</td>
</tr>
<tr>
<td>0x06</td>
<td>BAG_EXTRUDE</td>
<td>0x12</td>
<td>DELIVER_RUN</td>
</tr>
<tr>
<td>0x07</td>
<td>BAG_PULL</td>
<td>0x13</td>
<td>DELIVER_DONE</td>
</tr>
<tr>
<td>0x08</td>
<td>BAG_CUT</td>
<td>0x14</td>
<td>WAIT_NEXT</td>
</tr>
<tr>
<td>0x09</td>
<td>BAG_UNLOAD</td>
<td>0x15</td>
<td>ERROR</td>
</tr>
<tr>
<td>0x0A</td>
<td>BAG_COMPLETE</td>
<td>0x16</td>
<td>FAULT_LATCH</td>
</tr>
<tr>
<td>0x0B</td>
<td>SEAL_INIT</td>
<td>0x17</td>
<td>RECOVERY</td>
</tr>
<tr>
<td>0x0C</td>
<td>SEAL_PREHEAT</td>
<td>0x18</td>
<td>STOPPED</td>
</tr>
</table></div>
<p>上位机通过读取阶段码即可精确定位当前工艺步骤，而不需要理解整个状态机拓扑。</p>
<h3>app_packer_sm：薄外观模式</h3>
<p><code>app_packer_sm.c</code> 是整个状态机系统的外观入口，其职责被刻意限制在最小范围：</p>
<pre><code class="language-c">// app_packer_sm.c — 薄外观模式（~180 行）
void app_packer_sm_init(void) {
    psh_init();                    // 初始化回调注册表引擎
    sm_self_check_init();          // 子 SM 自注册
    sm_bag_flow_init();
    sm_seal_flow_init();
    sm_deliver_flow_init();
    psh_transition(PACKER_STATE_POWER_ON);  // 首次转态
}

void app_packer_sm_run(void) {
    // StateMachineTask 10ms 周期调用
    if (psh_is_busy()) return;     // 正在跨状态切换中
    psh_run();                     // 委托给当前状态 on_run
}

void app_packer_sm_handle_cmd(uint8_t func, const uint8_t *data) {
    // 协议分发 → 流路由
    switch (func) {
        case 0x42: flow_route = FLOW_BAG;   break;
        case 0x43: flow_route = FLOW_SEAL;  break;
        case 0x44: flow_route = FLOW_DELIVER; break;
        case 0x49: flow_route = FLOW_RESET; break;
    }
}</code></pre>
<p>关键约束：</p>
<ul>
<li><strong>不做任何硬件操作</strong> — 所有执行器操作由 Service 层的 actuator 完成</li>
<li><strong>不做协议解析</strong> — 由 app_packer_proto.c 完成校验和分发</li>
<li><strong>不做超时管理</strong> — 各子 SM 内部自行管理状态驻留超时</li>
<li><strong>不感知具体执行器</strong> — 只通过 packer_actuator.h 的抽象接口通信</li>
</ul>
<p>这种刻意削薄的设计保证了即使状态机数量增长到 30+ 状态，顶层入口依然保持可读和可测试。每次添加新状态只需新增一个 <code>sm_*.c</code> 文件并注册回调，<code>app_packer_sm.c</code> 本身几乎不需要修改。</p>
<hr>
<h2>14. 7 任务协作模型</h2>
<h3>任务定义表</h3>
<p>系统运行 7 个 FreeRTOS 任务，参数如下：</p>
<div class="arcaea-table-wrap" data-bac-table-shell="1"><table>
<tr>
<th>任务名</th>
<th>周期</th>
<th>栈大小</th>
<th>优先级</th>
<th>唤醒机制</th>
<th>职责</th>
</tr>
<tr>
<td>ProtoTask</td>
<td>5ms</td>
<td>2 KB</td>
<td>AboveNormal (4)</td>
<td>通知 / 超时</td>
<td>串口协议帧接收、校验、分发</td>
</tr>
<tr>
<td>StateMachineTask</td>
<td>5ms</td>
<td>2 KB</td>
<td>Normal (7)</td>
<td>超时</td>
<td>主状态机调度 + 流路由</td>
</tr>
<tr>
<td>MotorTask</td>
<td>10ms</td>
<td>2 KB</td>
<td>AboveNormal (4)</td>
<td>通知 / 超时</td>
<td>步进电机 / 直流电机动作执行</td>
</tr>
<tr>
<td>AdcTask</td>
<td>10ms</td>
<td>512 B</td>
<td>Normal (7)</td>
<td>超时</td>
<td>ADC 采样、功率计算、过流检测</td>
</tr>
<tr>
<td>CommTask</td>
<td>10ms</td>
<td>2560 B</td>
<td>Normal (7)</td>
<td>通知 / 超时</td>
<td>阻塞 I/O 异步化（打印机 / 串口屏）</td>
</tr>
<tr>
<td>MonitorTask</td>
<td>20ms</td>
<td>2 KB</td>
<td>Normal (7)</td>
<td>超时</td>
<td>栈水位诊断、通信看门狗、报警上报</td>
</tr>
<tr>
<td>HeaterTask</td>
<td>10ms</td>
<td>1536 B</td>
<td>Normal (7)</td>
<td>超时</td>
<td>加热管 PID 协同 + 温度超限保护</td>
</tr>
</table></div>
<p>优先级说明（FreeRTOS 数值越小优先级越大）：ProtoTask 和 MotorTask 使用 <code>AboveNormal</code>（比 Normal 高一级），确保协议帧不丢失、电机响应实时。StateMachineTask 虽然是 Normal 中的最高级（7），但不抢占 ProtoTask，保证接收稳定性。</p>
<h3>任务间通信机制</h3>
<p>四个核心通信原语：</p>
<p><strong>1. 任务通知（Task Notifications）</strong><br>用于轻量级信号传递，替代全局标志位：</p>
<pre><code class="language-c">// ProtoTask → StateMachineTask：新帧就绪
void proto_task_notify_sm(void) {
    xTaskNotifyGive(s_state_machine_task_handle);
}

// StateMachineTask 等待通知或超时
void state_machine_task_run(void) {
    uint32_t notified;
    xTaskNotifyWait(0, ULONG_MAX, &amp;notified, pdMS_TO_TICKS(5));
    if (notified) {
        frame_t f = proto_task_consume_frame();
        app_packer_sm_handle_cmd(f.func, f.data);
    }
    app_packer_sm_run();
}</code></pre>
<p><strong>2. 命令队列（Command Queue）</strong><br>StateMachineTask → CommTask 的阻塞 I/O 委托：</p>
<pre><code class="language-c">// 状态机侧：非阻塞入队
comm_task_enqueue(CMD_PRINT_LABEL);

// CommTask 侧：阻塞出队 + 执行
void comm_task_run(void) {
    cmd_t cmd;
    if (xQueueReceive(s_cmd_queue, &amp;cmd, pdMS_TO_TICKS(10)) == pdTRUE) {
        execute_blocking_io(cmd);   // 串口收发可能阻塞数十 ms
        xTaskNotifyGive(s_sm_task_handle);  // 通知完成
    }
}</code></pre>
<p><strong>3. 临界区（Critical Sections）</strong><br>保护跨任务访问的共享内存（运行时配置、故障锁存）：</p>
<pre><code class="language-text">taskENTER_CRITICAL();
s_runtime_config.speed_hz = new_speed;
s_runtime_config.dirty = 1;
taskEXIT_CRITICAL();</code></pre>
<p><strong>4. 句柄注入（Handle Injection）</strong><br>用注册替代全局 extern，每个模块在初始化阶段接收依赖的句柄：</p>
<pre><code class="language-c">void comm_task_register_sm_handle(TaskHandle_t sm_handle) {
    s_sm_task_handle = sm_handle;
}

void proto_task_register_sm_handle(TaskHandle_t sm_handle) {
    s_state_machine_task_handle = sm_handle;
}</code></pre>
<h3>唤醒模式</h3>
<p>两种唤醒策略共存：</p>
<ul>
<li><strong>超时唤醒</strong> — StateMachineTask / MotorTask / AdcTask / MonitorTask / HeaterTask 以固定周期运行，即使无事可做也执行检查（超时检测、水位诊断）。</li>
<li><strong>通知唤醒</strong> — ProtoTask 收到完整帧后才通知 StateMachineTask；CommTask 在有命令入队时才被唤醒，否则阻塞等待。</li>
</ul>
<p>混合模式：ProtoTask 和 MotorTask 既接受通知（快速响应），也使用超时（保底检查 DMA 溢出或停止状态）。</p>
<h3>任务交互 ASCII 图</h3>
<pre><code class="language-text">┌──────────────────────┐
                        │    USART3 中断 (ISR)   │
                        │  DMA 接收完成 → 通知    │
                        └──────────┬───────────┘
                                   │ xTaskNotifyGive
                                   ▼
                     ┌─────────────────────────┐
                     │      ProtoTask (5ms)     │
                     │  帧校验 → 分发 → 通知 SM  │
                     └────┬────────────────┬───┘
                          │                │
            xTaskNotify   │                │ xQueueSend
                          ▼                ▼
           ┌──────────────────┐   ┌──────────────────┐
           │ StateMachineTask │   │   CommTask       │
           │   (5ms/Normal7)  │   │ (10ms/Normal)    │
           │                  │   │                  │
           │ app_packer_sm    │   │ 阻塞 I/O 执行     │
           │ 路由判断 →       │   │ 打印机 / 串口屏    │
           │ 子 SM 调度       │   │ 完成后通知 SM      │
           └───┬────┬────┬───┘   └──────────────────┘
               │    │    │
       cmd_q   │    │    │ xTaskNotify
               ▼    │    ▼
     ┌────────────┐ │  ┌────────────┐
     │ MotorTask  │ │  │ HeaterTask │
     │ (10ms)     │ │  │ (10ms)     │
     │ 步进/直流   │ │  │ PID 协同   │
     │ 电机动作    │ │  │ 温度保护    │
     └────────────┘ │  └────────────┘
                    │
                    ▼
          ┌──────────────────┐
          │   AdcTask        │
          │  (10ms/512B)     │
          │  功率采样 + 检测   │
          └──────────────────┘
                    │
                    ▼
          ┌──────────────────┐
          │  MonitorTask     │
          │  (20ms/2KB)      │
          │ 栈水位 / 看门狗   │
          └──────────────────┘</code></pre>
<h3>设计要点</h3>
<ul>
<li><strong>ProtoTask 是唯一从 ISR 接收通知的任务</strong>，确保帧接收路径最短，不经过队列或信号量中转。</li>
<li><strong>StateMachineTask 占 Normal 最高优先级（7）</strong>，ProtoTask 和 MotorTask 用 AboveNormal（4）更高一级，保证 I/O 和动作优先于决策。</li>
<li><strong>CommTask 栈最大（2560B）</strong>，因为其内部调用可能嵌套多层协议栈（DGUS 命令 + 打印机透传）。</li>
<li><strong>AdcTask 栈最小（512B）</strong>，没有函数调用栈深，纯粹寄存器轮询 + 计算。</li>
<li><strong>所有任务共用一个错误通道</strong> — 在 MonitorTask 中统一采集和上报，避免每个任务独立处理故障。</li>
</ul>
</div>
