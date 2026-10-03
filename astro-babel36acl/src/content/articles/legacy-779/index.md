---
title: "S6: bsp_log 日志系统"
description: "在嵌入式 MCU 开发中，日志系统是调试与运行状态监控的核心基础设施。本文介绍 bsp_log —— 一个专为 STM32F103 ..."
published: "2026-05-29"
updated: "2026-06-02"
permalink: "/2026/05/29/s6-bsp_log-日志系统/"
draft: false
categories: ["方法与工具"]
tags: []
legacyId: 779
---

<p>在嵌入式 MCU 开发中，日志系统是调试与运行状态监控的核心基础设施。本文介绍 <strong>bsp_log</strong> —— 一个专为 STM32F103 设计的轻量级、编译期可配、无死锁风险的嵌入式日志模块。</p>
<p><!--more--></p>
<h2>设计动机</h2>
<p>早期版本的日志代码直接将 <code>bsp_log</code> 与 <code>bsp_uart</code> 耦合在一起：日志格式化完直接调用 UART 的 TX 函数。这看似简单，却带来了循环依赖的问题 —— 当 UART 驱动自身需要输出调试日志时，就会形成递归调用死锁。</p>
<p>重构后的 <code>bsp_log</code> 采用 <strong>Dispatch 架构</strong>，彻底解耦格式输出与底层传输。日志模块只负责格式化，实际的字符输出通过注册的回调函数委托给下层驱动。这样，<code>bsp_uart</code> 可以被替换为任何输出通道（USB CDC、SPI 屏、RTT……），而日志模块本身不需要任何修改。</p>
<h2>架构总览</h2>
<p>整个日志系统的工作流如下：</p>
<pre><code class="language-text">应用程序调用宏    →    bsp_log_vprintf() 格式化    →    dispatch 回调    →    bsp_uart 实际发送
     │                        │                          │
     └── BSP_LOG_ERR(...)     └── 160B 缓冲区 (task)      └── bsp_log_dispatch_fn_t
     └── BSP_LOG_INF(...)     └── 128B 缓冲区 (ISR)</code></pre>
<p>核心抽象是一个函数指针类型：</p>
<pre><code class="language-text">typedef void (*bsp_log_dispatch_fn_t)(const char *data, uint16_t len);</code></pre>
<p>日志模块在初始化时通过 <code>bsp_log_register_dispatch()</code> 注册这个回调，之后所有格式化完成的字符串都会交给这个回调去处理。对于 GENERIC_DEVICE_CONTROLLER 项目，这个回调就是 <code>bsp_uart_port_transmit()</code>。</p>
<h2>日志级别定义</h2>
<p><code>bsp_log</code> 定义了 5 个日志级别，每个级别对应一个固定的 4 字符前缀标签：</p>
<pre><code class="language-c">typedef enum {
    BSP_LOG_LEVEL_OFF   = 0,   // 无前缀，完全关闭
    BSP_LOG_LEVEL_ERROR = 1,   // [E]
    BSP_LOG_LEVEL_WARN  = 2,   // [W]
    BSP_LOG_LEVEL_INFO  = 3,   // [I]
    BSP_LOG_LEVEL_DEBUG = 4,   // [D]
} bsp_log_level_t;</code></pre>
<p>输出时，每个日志条目会自动添加对应的前缀、换行符号 <code>\r\n</code>，形如：</p>
<pre><code class="language-text">[I] System initialized, uptime=12345ms
[E] I2C timeout on bus 1, addr=0x3C
[W] Flash write retry #2, sector=7
[D] DMA buffer drained, bytes=512</code></pre>
<h2>编译期级别过滤</h2>
<p>日志级别过滤在 <strong>编译期</strong> 完成，通过宏 <code>BSP_LOG_LEVEL</code> 控制。默认值为 <code>BSP_LOG_LEVEL_INFO</code>（3）。</p>
<p>在 <code>bsp_log_cfg.h</code> 或编译器命令行中定义：</p>
<pre><code class="language-c">#define BSP_LOG_LEVEL   BSP_LOG_LEVEL_INFO</code></pre>
<p>其核心机制是：当日志宏的级别高于（数值大于）<code>BSP_LOG_LEVEL</code> 时，宏展开为 <code>((void)0)</code>，编译器会完全优化掉这些调用，不产生任何代码与运行时开销。这是嵌入式系统最关键的优化策略之一。</p>
<p>Release 构建通常设为 <code>BSP_LOG_LEVEL_WARN</code> 或 <code>BSP_LOG_LEVEL_ERROR</code>，只保留错误与警告；Debug 构建设为 <code>BSP_LOG_LEVEL_DEBUG</code>，输出所有信息。</p>
<h2>便捷宏 API</h2>
<p>为了方便调用，系统提供了 4 个便捷宏（不含 OFF）：</p>
<pre><code class="language-c">#define BSP_LOG_ERR(...)  bsp_log_write(BSP_LOG_LEVEL_ERROR, __VA_ARGS__)
#define BSP_LOG_WARN(...) bsp_log_write(BSP_LOG_LEVEL_WARN,  __VA_ARGS__)
#define BSP_LOG_INF(...)  bsp_log_write(BSP_LOG_LEVEL_INFO,  __VA_ARGS__)
#define BSP_LOG_DBG(...)  bsp_log_write(BSP_LOG_LEVEL_DEBUG, __VA_ARGS__)</code></pre>
<p>当对应级别被编译期关闭时，宏展开为 <code>((void)0)</code>：</p>
<pre><code class="language-text">// 如果 BSP_LOG_LEVEL &lt; BSP_LOG_LEVEL_DEBUG
BSP_LOG_DBG("Sensor reading: %d", val);
// 编译后变成 → ((void)0)
// 不产生任何二进制代码</code></pre>
<p>用法示例：</p>
<pre><code class="language-c">BSP_LOG_INF("GENERIC_DEVICE_CONTROLLER starting, f_cpu=%lu", HAL_RCC_GetSysClockFreq());
BSP_LOG_ERR("SPI transaction failed, cs=%d, err=%d", cs_pin, status);
BSP_LOG_DBG("Encoder pulses: L=%ld R=%ld", left_enc, right_enc);</code></pre>
<h2>核心格式化函数</h2>
<p>所有宏最终汇聚到 <code>bsp_log_vprintf()</code> 和 <code>bsp_log_write()</code>：</p>
<pre><code class="language-text">void bsp_log_write(bsp_log_level_t level, const char *fmt, ...);

void bsp_log_vprintf(bsp_log_level_t level, const char *fmt, va_list args);</code></pre>
<p>这两个函数的工作流程：</p>
<ol>
<li>检查 <code>level</code> 是否 ≤ <code>BSP_LOG_LEVEL</code>（运行时二次守卫）</li>
<li>将级别标签（<code>[E]</code> / <code>[W]</code> / <code>[I]</code> / <code>[D]</code>）写入格式化缓冲区头部</li>
<li>使用 <code>vsnprintf</code> 格式化用户消息，追加 <code>\r\n</code></li>
<li>调用注册的 dispatch 回调，将完整字符串发送出去</li>
</ol>
<h2>中断安全的 ISR 接口</h2>
<p>在中断上下文中调用标准 <code>BSP_LOG_INF()</code> 是不安全的 —— 它可能被更高优先级的中断打断。为此，<code>bsp_log</code> 提供了专用的 ISR 接口：</p>
<pre><code class="language-text">void bsp_log_irq_printf(bsp_log_level_t level, const char *fmt, ...);</code></pre>
<p>它的特殊之处：</p>
<ul>
<li>使用独立的 128 字节缓冲区（ISR 中不允许阻塞等待大缓冲区）</li>
<li>格式化完成后，直接调用 <code>bsp_uart_port_transmit()</code>，<strong>timeout=0</strong>（轮询模式，不等待）</li>
<li>自动追加 <code>\r\n</code></li>
<li>不经过 dispatch 回调，减少中间跳转</li>
</ul>
<p>使用场景示例：</p>
<pre><code class="language-c">void EXTI15_10_IRQHandler(void)
{
    if (__HAL_GPIO_EXTI_GET_IT(GPIO_PIN_13) != RESET) {
        bsp_log_irq_printf(BSP_LOG_LEVEL_WARN, "GPIO13 edge detected");
        __HAL_GPIO_EXTI_CLEAR_IT(GPIO_PIN_13);
    }
}</code></pre>
<p>注意：传入 ISR 接口的级别标签仅做标记用，不会在 ISR 中再次过滤（因为 ISR 要求极低的延迟，不做额外判断）。但如果编译期 <code>BSP_LOG_LEVEL</code> 低于写入级别，整个调用在编译期就会被消除。</p>
<h2>缓冲区策略</h2>
<p>两个独立缓冲区：</p>
<ul>
<li><strong>Task 上下文</strong>：160 字节格式缓冲区 —— 适用于普通线程/主循环中的日志输出</li>
<li><strong>ISR 上下文</strong>：128 字节格式缓冲区 —— 用于中断处理函数，减少栈占用</li>
</ul>
<p>日志系统采用 <strong>即时发送</strong> 策略：格式化完成后立即通过 dispatch 回调发送，不设环形缓冲区（ring buffer），不做延迟输出。这意味着：</p>
<ul>
<li>优点：实现极简，无缓存溢出风险，日志实时性高</li>
<li>代价：如果 dispatch 回调阻塞（例如 UART 发送队列满），调用方也会阻塞</li>
<li>适用场景：日志量可控的嵌入式系统，日志主要用于调试而非高频数据记录</li>
</ul>
<h2>Hook 系统：输出复制到 DGUS 屏</h2>
<p>日志系统支持注册一个额外的 <strong>hook 回调</strong>，用于将日志输出复制到其他介质。在 GENERIC_DEVICE_CONTROLLER 中，这个机制被用来将日志转发到 DGUS 串口屏显示。</p>
<pre><code class="language-text">typedef void (*bsp_log_hook_fn_t)(const char *data, uint16_t len);

void bsp_log_register_hook(bsp_log_hook_fn_t hook);</code></pre>
<p>当 hook 注册后，每次 dispatch 完成后，日志内容会再次调用 hook 回调。DGUS 屏的驱动解析这些日志字符串，将其显示在屏幕的调试窗口中。这在不占用额外 UART 端口的情况下，实现了设备本地日志可视化。</p>
<pre><code class="language-text">// 初始化
bsp_log_register_dispatch(bsp_uart_port_transmit);
bsp_log_register_hook(dgus_log_display);

// 之后每次 BSP_LOG_INF(...) 都会：
//   1. 格式化 → " [I] xxx\r\n"
//   2. → bsp_uart_port_transmit()   // 输出到串口调试终端
//   3. → dgus_log_display()         // 同步显示到 DGUS 屏幕</code></pre>
<h2>与旧版的对比</h2>
<div class="arcaea-table-wrap" data-bac-table-shell="1"><table>
<tr>
<th>特性</th>
<th>旧版（耦合）</th>
<th>新版（Dispatch）</th>
</tr>
<tr>
<td>与 bsp_uart 关系</td>
<td>直接调用，循环依赖</td>
<td>回调解耦，零依赖</td>
</tr>
<tr>
<td>输出通道扩展</td>
<td>需修改日志模块代码</td>
<td>注册不同 dispatch 即可</td>
</tr>
<tr>
<td>ISR 支持</td>
<td>不安全</td>
<td>专用 bsp_log_irq_printf()</td>
</tr>
<tr>
<td>Hook 扩展</td>
<td>无</td>
<td>支持注册 hook（如 DGUS 屏）</td>
</tr>
<tr>
<td>缓冲区</td>
<td>单一缓冲区</td>
<td>task 160B + ISR 128B</td>
</tr>
</table></div>
<h2>有意的设计取舍</h2>
<p><code>bsp_log</code> 明确不提供以下功能：</p>
<ul>
<li><strong>不包含时间戳</strong> —— 避免依赖 RTC 或 systick，保持模块纯净；需要时间戳时由调用方在消息中自行添加</li>
<li><strong>不注入文件名/行号</strong> —— 减少 ROM 占用（__FILE__ 字符串在嵌入式上很昂贵）</li>
<li><strong>不支持运行时修改日志级别</strong> —— 编译期固定，省去运行时判断的开销；确实需要时可通过条件编译在不同构建中切换</li>
<li><strong>无环形缓冲区</strong> —— 即时发送，不缓存；适用日志量可控的场景</li>
</ul>
<h2>头文件接口总览</h2>
<pre><code class="language-c">// ========== bsp_log.h ==========

typedef enum {
    BSP_LOG_LEVEL_OFF   = 0,
    BSP_LOG_LEVEL_ERROR = 1,
    BSP_LOG_LEVEL_WARN  = 2,
    BSP_LOG_LEVEL_INFO  = 3,
    BSP_LOG_LEVEL_DEBUG = 4,
} bsp_log_level_t;

typedef void (*bsp_log_dispatch_fn_t)(const char *data, uint16_t len);
typedef void (*bsp_log_hook_fn_t)(const char *data, uint16_t len);

void bsp_log_init(void);
void bsp_log_register_dispatch(bsp_log_dispatch_fn_t fn);
void bsp_log_register_hook(bsp_log_hook_fn_t fn);

void bsp_log_write(bsp_log_level_t level, const char *fmt, ...);
void bsp_log_vprintf(bsp_log_level_t level, const char *fmt, va_list args);
void bsp_log_irq_printf(bsp_log_level_t level, const char *fmt, ...);

#define BSP_LOG_ERR(...)  bsp_log_write(BSP_LOG_LEVEL_ERROR, __VA_ARGS__)
#define BSP_LOG_WARN(...) bsp_log_write(BSP_LOG_LEVEL_WARN,  __VA_ARGS__)
#define BSP_LOG_INF(...)  bsp_log_write(BSP_LOG_LEVEL_INFO,  __VA_ARGS__)
#define BSP_LOG_DBG(...)  bsp_log_write(BSP_LOG_LEVEL_DEBUG, __VA_ARGS__)</code></pre>
<h2>总结</h2>
<p><code>bsp_log</code> 是一个轻量、解耦、中断安全的嵌入式日志模块。它的核心设计哲学是：<strong>格式化与传输分离</strong>、<strong>编译期开销归零</strong>、<strong>不引入不必要的依赖</strong>。通过 Dispatch + Hook 的双回调机制，它既能输出到串口调试终端，也能同步显示到 DGUS 设备屏幕，而日志模块本身对输出通道一无所知 —— 这正是嵌入式软件工程中"关注点分离"的典型实践。</p>
<p>对于 GENERIC_DEVICE_CONTROLLER 这样的资源受限系统（STM32F103, 72MHz, 20KB RAM），这种设计在灵活性与资源消耗之间取得了良好的平衡。</p>
