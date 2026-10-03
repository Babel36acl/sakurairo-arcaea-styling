---
title: "三层重构不是靠文档做到，是靠构建系统"
description: "一个 3 万行嵌入式项目的三层物理隔离实战——当你的构建系统不允许 APP 层 include BSP 头文件时，架构才算真正落地。"
published: "2026-05-28"
updated: "2026-08-18"
permalink: "/2026/05/28/architecture-is-enforced-by-build-system/"
draft: false
categories: ["方法与工具","架构与重构"]
tags: ["ARCH"]
legacyId: 523
---

<div class="arcaea-wrap">
<p>三层重构不是靠文档做到，是靠构建系统</p>
<p>> 一个 3 万行嵌入式项目的 APP / Service / BSP 物理隔离实战</p>
<p>"我们要做三层分层架构。"</p>
<p>这句话我在无数嵌入式项目里听过。三个月后，代码还是一团。不是大家不认同分层——是没人愿意为「道德约束」买单。</p>
<p>当你的 CMakeLists.txt 允许 APP 层直接 `#include "bsp_uart.h"` 时，你的架构文档写得再好也没用。因为改 bug 的人总有「就这一次」的冲动。</p>
<p>## 反直觉的结论</p>
<p>让代码保持分层的，不是架构规范文档，是你的构建系统。</p>
<p>我们的做法：在 CMakeLists.txt 里把三层暴露成三个不同的 include 路径范围。</p>
<p>```bash<br /> APP 层编译时，BSP 头文件路径根本不可见<br />
target_include_directories(app PRIVATE<br />
    ${CMAKE_CURRENT_SOURCE_DIR}/Service/Inc<br />
    # 绝不包含 BSP/Inc<br />
)<br />
```</p>
<p>不是「APP 层不要 include BSP 头文件」，而是「APP 层没有办法 include BSP 头文件」。差别很大。</p>
<p>## 第一步：划边界，但不动代码</p>
<p>先定义三层干什么：</p>
<p>- **APP** — 业务决策。协议语义、状态机路由、监控。只管"现在该做什么"。<br />
- **Service** — 设备适配。把"做什么"翻译成"怎么做"。动作编排、状态注册表、运行时参数。<br />
- **BSP** — 硬件驱动。GPIO 电平、UART 寄存器、TIM 频率。只回答"信号通不通"。</p>
<p>第一阶段，不动一行代码。只改构建系统：创建三个 CMake 子目录，把对应的 .c 文件分别归入。然后让 APP 和 BSP 互相不可见。</p>
<p>构建炸了。好，这正是我们要找的——所有跨层直接调用现在都是编译错误。</p>
<p>## 第二步：收口函数</p>
<p>清理这些编译错误的最好方法，是创建一个明确的「收口层」。</p>
<p>我们造了一个叫 `packer_actuator` 的模块。它只做一件事：接收一个状态枚举，返回该状态需要执行的所有硬件动作。APP 不再调 `HAL_GPIO_WritePin`，只调 `packer_actuator_task_once(state)`。</p>
<p>```c<br />
// Service 层 — 唯一收口<br />
void packer_actuator_task_once(packer_state_t state) {<br />
    // 查表 → 发脉冲 → 控制继电器 → 一切硬件操作<br />
}<br />
```</p>
<p>APP 层从此无硬件。BSP 层从此无业务。</p>
<p>## 第三步：增量迁移，不推倒重来</p>
<p>每次改一个功能点，顺手把相关代码搬到正确的一层。不是停线重构——是每改一个 bug，架构就干净一分。</p>
<p>半年后的状态：APP 层从 10 个文件缩减到 3 个，每个不到 200 行。BSP 层完全不懂什么是打包机——它只知道 GPIO 编号和 UART 实例。</p>
<p>## 构建隔离 vs 文档规范</p>
<p>| | 文档规范 | 构建隔离 |<br />
|---|---|---|<br />
| 代价 | 每次 code review 都要查 | 一次配置，永远生效 |<br />
| 可靠度 | 看人 | 看编译器 |<br />
| 新人上手 | 先读 20 页文档 | 编译不过就知道错了 |<br />
| 重构勇气系数 | 低（怕漏）| 高（编译器兜底）|</p>
<p>## 关键是物理隔离</p>
<p>你可以在架构文档里写一万字"APP 不要直接调 HAL"，但只要 `#include "stm32f1xx_hal.h"` 能编译通过，就一定会有人这样做。</p>
<p>真正的分层不是用文档约束的——是用链接器约束的。</p>
<p>有没有类似的经历？欢迎讨论。</p>
