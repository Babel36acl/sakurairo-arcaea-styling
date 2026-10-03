---
title: "嵌入式物理输入采集与消抖"
description: "1. 问题背景 工业现场的数字量输入信号——行程开关、光电传感器、接近开关——在物理触点切换的瞬间会持续产生 机械抖动（bounc ..."
published: "2026-05-29"
updated: "2026-06-02"
permalink: "/2026/05/29/嵌入式物理输入采集与消抖/"
draft: false
categories: ["嵌入式实战"]
tags: []
legacyId: 771
---

<div class="arcaea-article">
<h2>1. 问题背景</h2>
<p>工业现场的数字量输入信号——行程开关、光电传感器、接近开关——在物理触点切换的瞬间会持续产生 <strong>机械抖动（bouncing）</strong>：信号在高低电平之间来回跳变数十毫秒后才稳定。如果不做任何处理，一次按压可能被解释为几十次触发。</p>
<div class="arcaea-mermaid-box"><pre class="mermaid">flowchart TB
    subgraph HARD[硬件层]
        H1[GPIO 输入]
        H2[机械按键/编码器]
    end
    subgraph FILTER[消抖层]
        F1[延时采样]
        F2[边沿检测]
        F3[长按/短按识别]
    end
    subgraph EVENT[事件层]
        E1[按键事件队列]
        E2[协议帧封装]
    end
    HARD --&gt; FILTER --&gt; EVENT
    style HARD fill:transparent,stroke:#8dc7ff,color:#eaf4ff
    style FILTER fill:transparent,stroke:#8dc7ff,color:#eaf4ff
    style EVENT fill:transparent,stroke:#8dc7ff,color:#eaf4ff</pre></div>
<p>常见的应对方案有两种：<strong>硬件 RC 滤波</strong>（在 GPIO 引脚上加电容电阻构成低通滤波器）和 <strong>软件消抖</strong>（在固件代码中通过时间窗口判断信号的稳定状态）。</p>
<p>本文讨论的是一个纯软件消抖的实现方案，运行在 <strong>STM32F103</strong> 平台上，对应的抽象层名为 <code>GENERIC_INPUT_CONTROLLER</code>。该模块负责管理最多 4 路物理数字输入，提供带消抖的稳定状态接口、原始电平旁路接口以及状态重同步机制。</p>
<h2>2. 整体架构</h2>
<p><code>GENERIC_INPUT_CONTROLLER</code> 位于 <strong>Service 层</strong>，不直接调用 HAL 的 GPIO 接口，而是通过 <code>bsp_gpio_read_pin()</code> 间接读取电平。每一路输入的管脚映射、有效电平极性、消抖时间等配置均以 <strong>编译期常量表</strong> 的形式定义在 <code>app_define.h</code> 中。</p>
<p>模块的核心 API 接口如下：</p>
<pre class="arcaea-code"><code class="language-text">/* 模块初始化 — 根据配置表建立输入通道 */
void generic_input_init(void);

/* 周期性更新 — 必须在主循环/任务中以固定周期调用 */
void generic_input_update(uint32_t now_ms);

/* 获取消抖后的稳定状态 */
bool generic_input_is_active(uint8_t ch);

/* 获取原始电平（绕过消抖，用于急停等场景） */
bool generic_input_is_raw_active(uint8_t ch);

/* 强制重同步 — 将稳定态与候选态对齐到当前硬件电平 */
void generic_input_resync(uint8_t ch);</code></pre>
<h2>3. 消抖数据结构</h2>
<p>每个物理输入通道维护 4 个状态变量：</p>
<pre class="arcaea-code"><code class="language-c">typedef struct {
    uint8_t channel_id;              /* 通道编号 */
    uint8_t  raw_level;              /* 本次采样到的原始电平 */
    uint8_t  candidate_level;        /* 候选稳定电平 */
    uint32_t candidate_start_tick;   /* 候选电平首次出现的时间戳 */
    uint8_t  stable_level;           /* 经过消抖确认的稳定电平 */
    uint8_t  active_level;           /* 有效电平极性（ACTIVE_HIGH / ACTIVE_LOW） */
    uint16_t debounce_ms;            /* 消抖时间窗口，默认 40 ms */
} generic_input_ch_t;</code></pre>
<p>关键设计思路：<strong>不依赖硬件定时器</strong>，所有时间窗口计算都基于外部传入的 <code>now_ms</code> 时间戳。这意味着模块本身不关心时间基从哪来，只要调用方在每个周期传入单调递增的 ms 级时间即可。典型场景下由 RTOS 的 Task 循环或 Systick 计数器提供。</p>
<h2>4. 消抖算法实现</h2>
<p>算法本质上是一个 <strong>两级状态机</strong>：</p>
<ol>
<li><strong>原始电平变化</strong> → 立即刷新 <code>candidate_level</code> 并重置 <code>candidate_start_tick</code></li>
<li><strong>候选电平保持超过 debounce_ms</strong> → 将 <code>stable_level</code> 更新为 <code>candidate_level</code></li>
</ol>
<p>核心更新逻辑如下：</p>
<pre class="arcaea-code"><code class="language-c">void generic_input_update(uint32_t now_ms) {
    for (int i = 0; i &lt; GENERIC_INPUT_CH_MAX; i++) {
        generic_input_ch_t *ch = &amp;channels[i];

        /* 跳过未配置的通道 */
        if (ch->port == NULL) continue;

        /* 1. 读取原始电平 */
        uint8_t new_raw = bsp_gpio_read_pin(ch->port, ch->pin);
        ch->raw_level = new_raw;

        /* 2. 检测到跳变 — 立即刷新候选 */
        if (new_raw != ch->candidate_level) {
            ch->candidate_level = new_raw;
            ch->candidate_start_tick = now_ms;
            continue;   /* 等待下一次更新再判断 */
        }

        /* 3. 候选已稳定且超过消抖阈值 — 更新稳定态 */
        if (now_ms - ch->candidate_start_tick >= ch->debounce_ms) {
            ch->stable_level = ch->candidate_level;
        }
    }
}</code></pre>
<p>这里有一个容易被忽视的细节：在步骤 2 检测到跳变后，<strong>立即 continue</strong>，不进入时间窗口判断。这意味着一个通道从跳变开始至少等待一个完整的 <code>debounce_ms</code> 窗口才能改变稳定态。这是防止「刚跳变就在同一周期内被判为稳定」的关键。</p>
<h2>5. 状态查询 API</h2>
<p>稳定态读取需要结合 <code>active_level</code> 进行极性转换：</p>
<pre class="arcaea-code"><code class="language-c">bool generic_input_is_active(uint8_t ch_idx) {
    generic_input_ch_t *ch = &amp;channels[ch_idx];
    if (ch->port == NULL) return false;  /* 未配置通道始终返回 inactive */
    return (ch->stable_level == ch->active_level);
}

bool generic_input_is_raw_active(uint8_t ch_idx) {
    generic_input_ch_t *ch = &amp;channels[ch_idx];
    if (ch->port == NULL) return false;
    return (ch->raw_level == ch->active_level);
}</code></pre>
<p><code>is_raw_active()</code> 的存在是为了应对 <strong>急停（E-Stop）</strong> 等需要零延迟响应的高优先级输入。它绕过消抖层，直接返回当前物理电平。对于常规的限位开关、到位传感器等信号，则应始终使用 <code>is_active()</code> 以避免误触发。</p>
<h2>6. 重同步机制</h2>
<p>在实际项目中还发现一个边界场景：假设设备正在执行某个动作（如气缸伸出），动作的完成信号由 IN1 提供。在动作启动之前，IN1 可能处于任意状态（过去残留的稳定态可能仍然是「激活」）。如果直接用 <code>is_active()</code> 判断动作是否完成，就会因为历史状态错误而立即认为完成了。</p>
<p>解决方案是在动作开始前对相关输入做 <strong>一次强制重同步</strong>：</p>
<pre class="arcaea-code"><code class="language-c">void generic_input_resync(uint8_t ch_idx) {
    generic_input_ch_t *ch = &amp;channels[ch_idx];
    if (ch->port == NULL) return;

    uint8_t hw_level = bsp_gpio_read_pin(ch->port, ch->pin);

    /* 将三个层级全部对齐到当前硬件电平 */
    ch->raw_level        = hw_level;
    ch->candidate_level  = hw_level;
    ch->stable_level     = hw_level;
    ch->candidate_start_tick = 0;  /* 强制候选为「已稳定」状态 */
}</code></pre>
<p>重同步的典型调用时机：进入一个新的工艺步骤之前，对步骤相关的所有传感器输入做一次 <code>resync()</code>，确保消抖状态与物理世界之间没有历史残留。</p>
<h2>7. 通道配置表</h2>
<p>所有通道参数在编译期通过宏展开生成实例：</p>
<pre class="arcaea-code"><code class="language-c">/* app_define.h — 传感器映射表 */
#define GENERIC_INPUT_CFG_TABLE \
    ENTRY(GPIOA, GPIO_PIN_0, ACTIVE_HIGH, 40),   /* CH0: 气缸到位传感器 */  \
    ENTRY(GPIOA, GPIO_PIN_1, ACTIVE_HIGH, 40),   /* CH1: 物料在位传感器 */  \
    ENTRY(GPIOA, GPIO_PIN_2, ACTIVE_LOW,  50),   /* CH2: 校准光电传感器 */  \
    ENTRY(GPIOA, GPIO_PIN_3, ACTIVE_HIGH, 40),   /* CH3: 料斗光电传感器 */

/* 初始化时通过 X-Macro 展开为结构体数组 */
static const generic_input_cfg_t input_cfg[GENERIC_INPUT_CH_MAX] = {
    #define ENTRY(p, n, a, d) { .port = p, .pin = n, .active_level = a, .debounce_ms = d },
    GENERIC_INPUT_CFG_TABLE
    #undef ENTRY
};</code></pre>
<p>对于 <strong>未使用的通道</strong>，将配置设为 <code>{NULL, 0}</code>，模块在 <code>update()</code> 循环中会跳过这些端口。此时 <code>is_active()</code> 和 <code>is_raw_active()</code> 均返回 <code>false</code>（inactive）。</p>
<h2>8. 禁用通道的处理</h2>
<p>如果某个物理输入被禁用（比如硬件上没有连接或者被功能裁剪），只需要在配置表中将其项注释或设置为无效：</p>
<pre class="arcaea-code"><code class="language-c">#define GENERIC_INPUT_CFG_TABLE \
    ENTRY(GPIOA, GPIO_PIN_0, ACTIVE_HIGH, 40),   /* CH0 */  \
    /* ENTRY(GPIOA, GPIO_PIN_1, ACTIVE_HIGH, 40), */        \
    ENTRY(NULL,  0,            ACTIVE_HIGH, 40),   /* CH1 — 禁用，占位 */ \
    ENTRY(GPIOA, GPIO_PIN_2, ACTIVE_LOW,  50),   /* CH2 */  \
    ENTRY(NULL,  0,            ACTIVE_HIGH, 40),   /* CH3 — 禁用，占位 */</code></pre>
<p>这种做法使得模块在硬件裁剪时不需要修改任何逻辑代码，只需修改配置表即可。对于被禁用的通道，<code>bsp_gpio_read_pin(NULL, 0)</code> 的实现直接返回非激活电平值。</p>
<h2>9. 与 RTOS 的集成方式</h2>
<p>模块本身 <strong>不依赖 RTOS</strong>——它是一组纯计算函数，无阻塞、无临界区。唯一的外部输入是 <code>now_ms</code> 时间戳。典型的调用模式：</p>
<pre class="arcaea-code"><code class="language-c">/* PackerTask 主循环 */
void packer_task(void *param) {
    generic_input_init();

    while (1) {
        uint32_t now = get_system_tick_ms();

        /* 步骤 1: 更新所有输入状态 */
        generic_input_update(now);

        /* 步骤 2: 读取稳定后的输入做工艺逻辑 */
        if (generic_input_is_active(CH_CYLINDER_OUT)) {
            /* 气缸已伸出到位，执行下一步 */
        }

        /* 步骤 3: 特殊信号走原始电平 */
        if (generic_input_is_raw_active(CH_ESTOP)) {
            emergency_stop();
        }

        osDelay(10);  /* 10 ms 周期 */
    }
}</code></pre>
<p>消抖周期设为 40 ms，而 Task 调度周期为 10 ms，这意味着稳定态切换最多需要 <strong>4 个更新周期 + 40 ms 候选窗口</strong>才能反映最新物理状态——这在绝大多数工业场景下完全可以接受。</p>
<h2>10. 总结</h2>
<p>纯软件消抖方案在 STM32F103 这类资源受限的 MCU 上是可靠且经济的选择：</p>
<ul>
<li><strong>零 BOM 成本</strong>：不需要电容电阻，省 PCB 面积也省物料</li>
<li><strong>参数可调</strong>：每个通道独立配置消抖时间，适应不同传感器特性（机械开关通常 20–50 ms，光电传感器可以更短）</li>
<li><strong>无阻塞设计</strong>：所有函数都是 O(1) 纯计算，不会干扰 RTOS 的调度延迟</li>
<li><strong>重同步机制</strong>：解决了状态机切换过程中的历史状态残留问题，是生产环境中一个非常实用的技巧</li>
<li><strong>Service 层隔离</strong>：通过 BSP 抽象层屏蔽 HAL 细节，换 MCU 平台时只需重写 BSP 层，消抖逻辑完全不变</li>
</ul>
<p>这套设计已经在实际产线上运行，稳定处理了累计数百万次的数字输入采样。如果你正在设计一个同样需要多路数字量输入的嵌入式系统，纯软件消抖 + 重同步的架构值得参考。</p>
<hr class="arcaea-hr" />
<p class="arcaea-meta">STM32F103 | DIGITAL INPUT | DEBOUNCE | GENERIC_INPUT_CONTROLLER | EMBEDDED</p>
