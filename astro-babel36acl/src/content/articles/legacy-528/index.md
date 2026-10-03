---
title: "状态机设计的正确模式：回调注册表替代 switch-case"
description: "一个 18 状态的嵌入式状态机如果全部塞在一个 switch-case 里，一个文件 900 行。回调注册表模式让每个状态独立文件、三回调驱动，新增状态零侵入。"
published: "2026-05-28"
updated: "2026-08-18"
permalink: "/2026/05/28/callback-registry-state-machine-pattern/"
draft: false
categories: ["架构与重构"]
tags: ["ARCH"]
legacyId: 528
---

<div class="arcaea-wrap">
<p><span class="tag">架构与重构</span> <span class="tag">状态机</span></p>
<p>状态机设计的正确模式：回调注册表替代 switch-case</p>
<p>一个 18 状态的嵌入式状态机，如果全部塞在一个 switch-case 里，一个文件 900 行。每次改一个状态都要读懂全部逻辑。每次 merge 冲突都在同一个文件。这是不可持续的。</p>
<p>## 传统 switch-case 的问题</p>
<p>大多数嵌入式项目的状态机长这样：</p>
<pre><code class="language-c">void task_once(void) {
    switch (state) {
    case STATE_A:
        // 50行逻辑...
        // 超时检查...
        // 传感器读取...
        // 状态切换...
        break;
    case STATE_B:
        // 又是50行...
        break;
    // ... 18 个 case
    }
}</code></pre>
<p>这个模式有三个死穴：</p>
<ul>
<li><strong>单一文件膨胀</strong> — 每个状态 50 行，18 个状态就是 900 行。改一个状态要滚动翻页。</li>
<li><strong>merge 冲突集中营</strong> — 多人改不同状态，但都在同一个 switch 函数里，git 不能自动合并。</li>
<li><strong>新增状态需要读全部</strong> — 要加一个新状态，先得搞懂既有的流转逻辑，心理门槛极高。</li>
</ul>
<p>## 回调注册表模式</p>
<p>核心思路：状态机框架只维护"当前状态"和"处理器注册表"。每个状态写在独立文件里，注册自己的三回调。</p>
<pre><code class="language-c">// 框架侧 — psh_task_once()
void psh_task_once(void) {
    // 1. 前置检查（超时、中断控制、错误条件）
    if (check_exit_conditions()) {
        // 调用当前状态的 on_exit
        current_handler-&gt;on_exit();
        // 切换到新状态
        current_handler = find_handler(new_state);
        // 调用新状态的 on_enter
        current_handler-&gt;on_enter();
        return;
    }
    // 2. 周期推进当前状态
    current_handler-&gt;on_run();
}</code></pre>
<pre><code class="language-c">// 每个状态一个文件 — 以出袋校准为例
#include "packer_state_handler.h"

static void on_enter(packer_state_t prev) {
    packer_actuator_start_bag_calib();
    s_motion_seen = 0;
}

static void on_run(void) {
    if (!s_motion_seen &amp;&amp; is_axis_running(1)) {
        s_motion_seen = 1;
    }
    if (s_motion_seen &amp;&amp; is_axis_done(1)) {
        psh_transition(PACKER_STATE_NEXT);
    }
    if (check_timeout()) {
        psh_transition(PACKER_STATE_ERROR);
    }
}

static void on_exit(void) {
    // 清理本状态特有的资源
}

const packer_state_handler_t s_handler = {
    .state    = PACKER_STATE_BAG_CALIB_SEEK,
    .on_enter = on_enter,
    .on_run   = on_run,
    .on_exit  = on_exit,
    .name     = "BAG_CALIB_SEEK"
};

void sm_bag_flow_init(void) {
    psh_register(&amp;s_handler);
}</code></pre>
<h2>状态切换的时序保障</h2>
<p>核心调度器保证三回调的执行顺序：</p>
<pre><code class="language-text">psh_transition(new_state):
    // 1. 调用旧状态的 on_exit
    current_handler-&gt;on_exit();
    // 2. 更新全局状态变量
    s_state = new_state;
    // 3. 调用新状态的 on_enter
    new_handler-&gt;on_enter();
    // 4. 通知状态变更回调
    if (s_on_state_change_cb) s_on_state_change_cb(new_state);</code></pre>
<p>这个顺序很重要。如果先更新状态再调 on_exit，on_exit 查到的新状态是错的。</p>
<h2>on_enter / on_run / on_exit 的职责划分</h2>
<div class="arcaea-table-wrap" data-bac-table-shell="1"><table>
<tr>
<th>回调</th>
<th>触发时机</th>
<th>典型职责</th>
</tr>
<tr>
<td><code>on_enter</code></td>
<td>进入状态时，执行一次</td>
<td>下发执行器动作、重置子阶段计数器、初始化超时</td>
</tr>
<tr>
<td><code>on_run</code></td>
<td>每个周期，反复执行</td>
<td>检查完成条件、传感器输入、超时、推进子阶段</td>
</tr>
<tr>
<td><code>on_exit</code></td>
<td>离开状态时，执行一次</td>
<td>清理临时资源、通知其他模块状态即将改变</td>
</tr>
</table></div>
<h2>与 switch-case 的对比</h2>
<div class="arcaea-table-wrap" data-bac-table-shell="1"><table>
<tr>
<th>维度</th>
<th>switch-case</th>
<th>回调注册表</th>
</tr>
<tr>
<td>文件组织</td>
<td>一个文件 900+ 行</td>
<td>每个状态一个 .c 文件，约 30-50 行</td>
</tr>
<tr>
<td>新增状态</td>
<td>读懂整个 switch 再加 case</td>
<td>新建 .c + 一行 psh_register()</td>
</tr>
<tr>
<td>merge 冲突</td>
<td>容易全文件冲突</td>
<td>只有 psh_register 那一行可能冲突</td>
</tr>
<tr>
<td>可见性</td>
<td>所有状态互相可见，容易误改</td>
<td>每个状态只知道自己的回调</td>
</tr>
<tr>
<td>状态间共享数据</td>
<td>局部 static 变量，猜依赖</td>
<td>显式通过 psh_* 接口访问</td>
</tr>
<tr>
<td>框架稳定性</td>
<td>核心调度和业务代码混在一起</td>
<td>psh_task_once 稳定后几乎不改</td>
</tr>
</table></div>
<h2>适用边界</h2>
<p>这个模式适用于 10 个状态以上的复杂流程。如果你的状态只有 3-5 个，switch-case 更简单直接。</p>
<blockquote>
<p>状态机是业务代码，调度器是基础设施。混在一起两个都烂。</p>
</blockquote>
<h2>配套工具</h2>
<p>注册完成后，可以用 psh_log_registry() 输出所有已注册状态的名称和数量，用于调试：</p>
<pre><code class="language-text">[SM] Handler registry: 18 handlers registered
  [0] POWER_ON           — sm_self_check.c
  [1] SELF_CHECK         — sm_self_check.c
  [2] IDLE               — builtin
  [3] BAG_CALIB_CHECK    — sm_bag_flow.c
  [4] BAG_CALIB_CLEAR    — sm_bag_flow.c
  ...</code></pre>
</div>
