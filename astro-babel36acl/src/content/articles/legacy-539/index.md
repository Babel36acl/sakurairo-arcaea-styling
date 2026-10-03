---
title: "状态机引擎内部：回调注册表、子流程模块与事件系统如何协同"
description: "从状态机引擎内部视角看 psh_task_once 完整执行流、sm_* 子流程注册模式、事件系统解耦、子阶段枚举、状态切换全链路。"
published: "2026-05-28"
updated: "2026-08-18"
permalink: "/2026/05/28/state-machine-engine-internals-callbacks-sm-events/"
draft: false
categories: ["嵌入式实战","架构与重构"]
tags: ["ARCH"]
legacyId: 539
---

<div class="arcaea-wrap">
<p><span class="tag">架构与重构</span> <span class="tag">状态机</span></p>
<p>前面写过"回调注册表替代 switch-case"的模式介绍。但回调注册表只是一个框架——真正复杂的是多个子流程模块（sm_*）、事件系统（psh_fire_event）、命令网关（packer_command_gateway）如何整体协同。</p>
<p>本文从状态机引擎的内部视角，展示这些模块是如何装配起来的。</p>
<h2>整体架构</h2>
<pre><code class="language-text">┌──────────────────────────────────────┐
│         app_packer_sm.c              │  ← APP 层门面
│  app_packer_sm_init()                │     初始化所有 sm_* 模块
│  app_packer_sm_task_once()           │     包装 psh_task_once()
└──────────────────┬───────────────────┘
                   │ 调用
┌──────────────────▼───────────────────┐
│        packer_state_handler.c        │  ← Service 层核心
│                                      │
│  psh_task_once() {                   │
│    1. 同步运行时标志                  │
│    2. 消费边界命令 (CONTROL/RESET)   │
│    3. 检查直接进 ERROR 的条件         │
│    4. 检查停机强制回 IDLE             │
│    5. 调用当前状态的 on_run()         │
│  }                                   │
│                                      │
│  psh_register(&handler)              │
│  psh_transition(state, delay_ms)     │
│  psh_fire_event(event)               │
└──┬───────────────┬───────────────┬───┘
   │ 注册回调       │ 触发事件       │ 查询访问
   ▼               ▼               ▼
┌──────────┐ ┌──────────┐ ┌──────────────┐
│ sm_*.c   │ │ 其他模块  │ │ packer_*     │
│ 子流程    │ │ 事件处理  │ │ 执行器/配置  │
└──────────┘ └──────────┘ └──────────────┘</code></pre>
<h2>sm_* 子流程模块的注册模式</h2>
<p>每个子流程模块（如 sm_bag_flow.c、sm_seal_flow.c、sm_self_check.c）都遵循相同的结构：</p>
<p><strong>定义静态回调函数</strong>：</p>
<pre><code class="language-c">// sm_bag_flow.c
static uint8_t s_motion_seen = 0;

static void bag_out_on_enter(packer_state_t prev_state) {
    s_motion_seen = 0;
    packer_actuator_start_bag_out();
}

static void bag_out_run(void) {
    if (!s_motion_seen && packer_actuator_is_axis_running(1)) {
        s_motion_seen = 1;
    }
    if (s_motion_seen && packer_actuator_is_axis_done(1)) {
        psh_transition(PACKER_STATE_PREHEAT, delay_ms);
    }
    if (check_timeout()) {
        psh_enter_error(APP_ALARM_BAG_TIMEOUT);
    }
}

static void bag_out_on_exit(packer_state_t next_state) {
    // 清理（如果需要）
}</code></pre>
<p><strong>注册到处理器</strong>：</p>
<pre><code class="language-c">static const packer_state_handler_t s_handlers[] = {
    {PACKER_STATE_BAG_CALIB_CHECK,  NULL,                    bag_calib_check_run,  NULL, "BAG_CALIB_CHECK"},
    {PACKER_STATE_BAG_CALIB_CLEAR,  bag_calib_clear_enter,   bag_calib_clear_run,  NULL, "BAG_CALIB_CLEAR"},
    {PACKER_STATE_BAG_CALIB_SEEK,   bag_calib_seek_enter,    bag_calib_seek_run,   NULL, "BAG_CALIB_SEEK"},
    {PACKER_STATE_BAG_OUT,          bag_out_on_enter,        bag_out_run,          bag_out_on_exit, "BAG_OUT"},
    // ...
};

void sm_bag_flow_init(void) {
    psh_register_batch(s_handlers, sizeof(s_handlers) / sizeof(s_handlers[0]));
}</code></pre>
<p><strong>在 app_packer_sm_init() 中统一初始化</strong>：</p>
<pre><code class="language-c">void app_packer_sm_init(void) {
    psh_init();

    sm_self_check_init();   // 注册自检状态的回调
    sm_bag_flow_init();     // 注册出袋流程的回调
    sm_seal_flow_init();    // 注册封口流程的回调

    psh_log_registry();     // 打印所有已注册的处理器

    // 注册跨模块回调
    sm_printer_service_init();
    packer_printer_comm_init();
    psh_register_cancel_printer_cb(sm_printer_service_cancel);
    psh_register_arm_printer_bag_cb(sm_printer_service_arm_bag);
    psh_register_state_change_cb(app_packer_sm_on_state_change);
}</code></pre>
<h2>psh_task_once 的完整执行流</h2>
<p>这是状态机引擎的心脏。每个 10ms 周期执行：</p>
<pre><code class="language-c">void psh_task_once(void) {
    // 1. 同步运行时标志（从 EventGroup 读取全局控制位）
    psh_sync_runtime_flags();

    // 2. 消费边界命令（CONTROL stop/start, RESET_FAULT）
    //    这些命令由 ProtoTask 通过命令网关投递
    if (psh_try_consume_control_command()) {
        // 消费了命令，可能触发了状态切换
        return;
    }

    // 3. 检查 E03/E05 等直接进入 ERROR 的条件
    //    这些条件由 packer_fault_latch 统一仲裁
    if (packer_fault_latch_get_code() != APP_ALARM_NONE) {
        if (s_state != PACKER_STATE_ERROR) {
            psh_enter_error(packer_fault_latch_get_code());
            return;
        }
    }

    // 4. 检查停机命令是否需强制回 IDLE
    if (psh_stop_should_force_idle()) {
        psh_transition(PACKER_STATE_RESET, reset_delay);
        return;
    }

    // 5. 调用当前状态的 on_run 回调
    //    如果是 IDLE 状态，内部还会尝试启动 pending 动作流
    const packer_state_handler_t *h = psh_find_handler(s_state);
    if (h != NULL && h->on_run != NULL) {
        h->on_run();
    }
}</code></pre>
<h2>事件系统：子流程间的解耦通信</h2>
<p>有时候一个状态的 on_run 需要询问其他模块"你要不要优先处理"。这就是事件系统的用途：</p>
<pre><code class="language-c">// 定义事件类型
typedef enum {
    PSH_EVENT_BOOT_BAG_CALIB_COMPLETE = 0,  // 上电自检袋口校准完成
    PSH_EVENT_PRESS_OPEN_DELEGATE,           // 进入 PRESS_OPEN → 询问自检是否优先
    PSH_EVENT_MAX
} psh_event_t;

// 注册事件处理器（模块 A）
void sm_self_check_init(void) {
    psh_register_event_handler(PSH_EVENT_PRESS_OPEN_DELEGATE,
                                self_check_on_press_open);
}

// 触发事件（模块 B）
// sm_seal_flow.c 的 PRESS_OPEN on_enter 中：
if (psh_fire_event(PSH_EVENT_PRESS_OPEN_DELEGATE)) {
    // 事件已被消费（自检模块接管了 PRESS_OPEN 处理）
    return;
}
// 事件未被消费，走默认 PRESS_OPEN 逻辑</code></pre>
<p>事件系统的返回值决定了调用方是否继续默认路径：1=已消费（停止默认），0=未被处理（继续默认）。这避免了模块之间的硬编码相互依赖。</p>
<h2>状态切换的完整链路</h2>
<pre><code class="language-text">某个 on_run() 中调用了 psh_transition(NEXT_STATE, timeout_ms):

  psh_transition() {
    1. 查找新状态的处理器
    2. 调用旧状态的 on_exit(NEXT_STATE)
    3. 更新全局 s_state = NEXT_STATE
    4. 设置新状态的超时 deadline
    5. 调用新状态的 on_enter(OLD_STATE)
    6. 通知状态变更回调
    7. 设置 s_state_changed 标志（供 MotorTask 通知链使用）
  }

此时：
  - MotorTask 会在下一周期收到通知 → 重新查动作表
  - app_packer_proto 会在下次查询时返回新的阶段码
  - packer_status_snapshot 的 running 标志由 on_run 内部维护</code></pre>
<h2>子阶段枚举的用途</h2>
<p>某些状态（如 PRESS_CLOSE）包含多段固定脉冲动作。不是增加更多状态，而是用子阶段枚举：</p>
<pre><code class="language-c">typedef enum {
    APP_PRESS_CLOSE_STAGE_IDLE = 0,
    APP_PRESS_CLOSE_STAGE_AXIS2_RETRACT,
    APP_PRESS_CLOSE_STAGE_AXIS34_CLOSE,
    APP_PRESS_CLOSE_STAGE_DONE
} app_press_close_stage_t;

// PRESS_CLOSE.on_run():
void press_close_run(void) {
    switch (psh_get_press_close_stage()) {
    case AXIS2_RETRACT:
        if (packer_actuator_is_axis_done(2)) {
            psh_set_press_close_stage(AXIS34_CLOSE);
            packer_actuator_start_dual_axis();
        }
        break;
    case AXIS34_CLOSE:
        if (packer_actuator_is_dual_axis_done()) {
            psh_set_press_close_stage(DONE);
            psh_set_active_flow(FLOW_NONE);  // 清 flow
            psh_transition(NEXT, delay);
        }
        break;
    }
}</code></pre>
<p>子阶段状态保存在 psh 的共享状态中，其他模块可以通过 psh_get_press_close_stage() 只读查询。</p>
<blockquote>
<p>状态机框架（psh）只维护"当前状态"和"跨模块共享状态"。具体每个状态怎么做事的逻辑，全部在 sm_*.c 中。事件系统让模块之间不需要相互 include 头文件。</p>
</blockquote>
