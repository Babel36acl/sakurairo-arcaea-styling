---
title: "AI Agent + AGENTS.md 知识库——嵌入式开发的 AI 辅助体系实战（双 Agent + 45 Skills + MCP + 项目宪法）"
description: "很多搞嵌入式的朋友看到 AI 辅助开发，第一反应是「那玩意儿写写前端还行，嵌入式能用？」 坦白说，两年前我也是这么想的。但现在我的 ..."
published: "2026-05-28"
updated: "2026-06-02"
permalink: "/2026/05/28/tutorial-ai/"
draft: false
categories: ["嵌入式实战","方法与工具"]
tags: []
legacyId: 407
---

<p>很多搞嵌入式的朋友看到 AI 辅助开发，第一反应是「那玩意儿写写前端还行，嵌入式能用？」</p>
<p>坦白说，两年前我也是这么想的。但现在我的开发环境里 AI 不是聊天玩具——它是我每天都在用的工作搭档。</p>
<p>这篇文章不讲虚的，直接把我系统里 AI 接入嵌入式开发的完整方案摊开。从双 Agent 架构、45+ 技能分类、AGENTS.md 知识库体系到 MCP 桥接自动发博客，每一项都是实际在用的。</p>
<h2>一、整体架构</h2>
<p>我的 WSL 环境里跑着两个 AI Agent，分工非常明确：</p>
<pre class="wp-block-code"><code class="language-text">Hermes Agent（主 AI 助手）
├── 远程模型：DeepSeek V4 Flash（通过 API）
├── 45+ 技能（Skills）
├── MCP 桥接（WordPress REST API）
├── 可调度子 Agent（claude-code、codex、opencode）
└── 角色：环境扫描、技术规划、代码审查、博客生成

Codex CLI（副 AI 代理）
├── 本地运行（独立会话 + 记忆系统）
├── AGENTS.md 知识库体系（5 个文件 + 14 个模块文档）
├── 项目级行为规范
└── 角色：代码生成、项目规则执行
</code></pre>
<p>Hermes 是「大脑」——分析、规划、审查、调度。Codex 是「手」——在 repo 层面执行，带着 AGENTS.md 的规则写代码。两者互补，不冲突。</p>
<h2>二、Hermes Agent 实际配置</h2>
<h3>2.1 模型</h3>
<p>当前通过 DeepSeek API 调用 <code>deepseek-v4-flash</code>，没有跑本地模型。虽然 RTX 3050 4GB 显卡装着 CUDA 13.3 驱动，但还没装 ollama/llama.cpp 这类本地推理引擎。</p>
<pre class="wp-block-code"><code class="language-yaml">model:
  default: deepseek-v4-flash
  provider: deepseek
  base_url: https://api.deepseek.com

agent:
  max_turns: 90
  gateway_timeout: 1800
  api_max_retries: 3
  reasoning_effort: medium
</code></pre>
<h3>2.2 45+ Skills 全分类</h3>
<p>Skills 是 Hermes 能做事的基础。每个 Skill 是一个 markdown 文件，里面写着怎么做某类事情——包含步骤、命令、坑点。</p>
<figure class="wp-block-table">
<table>
<tr>
<th>类别</th>
<th>数量</th>
<th>代表性技能</th>
<th>用途场景</th>
</tr>
<tr>
<td>嵌入式/软件开发</td>
<td>10+</td>
<td>test-driven-development、systematic-debugging、requesting-code-review、writing-plans、embedded-rtos-debugging、embedded-protocol-documentation、firmware-protocol-bridge、android-usb-serial</td>
<td>TDD 流程、4 阶段根因分析、代码审查、嵌入式协议文档、Android USB 串口调试</td>
</tr>
<tr>
<td>AI/ML 推理部署</td>
<td>6</td>
<td>llama-cpp、serving-llms-vllm、evaluating-llms-harness、dspy、weights-and-biases、huggingface-hub</td>
<td>本地 GGUF 推理、模型评估、声明式 LLM 编程、HF 模型搜索下载</td>
</tr>
<tr>
<td>内容创作</td>
<td>9</td>
<td>baoyu-article-illustrator、baoyu-comic、baoyu-cover-image、baoyu-infographic、baoyu-slide-deck、baoyu-xhs-images、baoyu-post-to-wechat、baoyu-post-to-weibo、baoyu-post-to-x</td>
<td>文章插图、知识漫画、封面、信息图、幻灯片、小红书/公众号/微博/X 多平台发文</td>
</tr>
<tr>
<td>代理/自动化</td>
<td>4</td>
<td>claude-code、codex、opencode、kanban-orchestrator</td>
<td>委托其他 AI 代理、任务分解编排</td>
</tr>
<tr>
<td>创意</td>
<td>6</td>
<td>ascii-art、ascii-video、excalidraw、architecture-diagram、p5js、pixel-art</td>
<td>ASCII 艺术、手绘风格图、SVG 架构图、创意编程</td>
</tr>
<tr>
<td>数据/生产力</td>
<td>6</td>
<td>notion、obsidian、google-workspace、airtable、linear、powerpoint</td>
<td>笔记管理、Google 套件、Airtable 数据、项目管理</td>
</tr>
<tr>
<td>GitHub</td>
<td>5</td>
<td>github-code-review、github-issues、github-pr-workflow、github-repo-management、codebase-inspection</td>
<td>PR 审查、Issue 管理、仓库管理、代码量分析</td>
</tr>
<tr>
<td>MCP/协议</td>
<td>2</td>
<td>native-mcp、cronjob</td>
<td>MCP 服务集成、后台定时任务</td>
</tr>
<tr>
<td>其他</td>
<td>3</td>
<td>devops/dev-environment-audit、webhook-subscriptions、red-teaming/godmode</td>
<td>环境审计、Webhook 驱动、LLM 越狱测试</td>
</tr>
</table>
</figure>
<p><strong>实际使用场景举例：</strong></p>
<ol>
<li><strong>「检查我的开发环境」</strong> — Hermes 自动扫系统工具版本、执行一次真实编译、检查 VSCode 配置、输出完整报告。不需要我手动 <code>--version</code> 一个个查。</li>
<li><strong>「审核代码」</strong> — 加载 <code>requesting-code-review</code> 技能和 <code>systematic-debugging</code> 技能，自动 diff 分析、检查安全漏洞、输出结构化评审。</li>
<li><strong>「写博客发布」</strong> — 加载 <code>upgrade-tech-tutorial-to-engineering-guide</code> 技能，按步骤扩写文章，通过 MCP 调用 WordPress API 自动发布。</li>
<li><strong>「分析 git 历史」</strong> — 加载 <code>msr-git-history-analysis</code> 技能，分析数月 commit 数据，输出文件级和 commit 级证据的结构化报告。</li>
</ol>
<h3>2.3 人格系统</h3>
<p>Hermes 内置了 10+ 种人格，通过配置文件切换：</p>
<pre class="wp-block-code"><code class="language-yaml">personalities:
  helpful: "You are a helpful, friendly AI assistant."
  technical: "You are a technical expert. Provide detailed, accurate technical information."
  teacher: "You are a patient teacher. Explain concepts clearly with examples."
  pirate: "Arrr! Ye be talkin' to Captain Hermes..."
  noir: "The rain hammered against the terminal like regrets on a guilty conscience."
  hype: "YOOO LET'S GOOOO!!! 🔥🔥🔥"
</code></pre>
<p>平时用 <code>technical</code> 做技术工作，写博客切 <code>teacher</code> 风格，心情好切个 <code>pirate</code> 让 terminal 变成海盗船。</p>
<h2>三、Codex CLI + AGENTS.md：项目的「不遗忘」机制</h2>
<h3>3.1 为什么需要 AGENTS.md</h3>
<p>AI 有一个致命缺陷——它会忘。上周你告诉它「不要直接在状态机里调用 HAL_GPIO」，这周它又写了同样的代码。</p>
<p>AGENTS.md 就是用来解决这个问题的：<strong>把架构规则、历史踩坑、协议细节写进文件，AI 每次进项目先读、再动手。</strong></p>
<h3>3.2 系统里现在的 AGENTS.md</h3>
<figure class="wp-block-table">
<table>
<tr>
<th>文件</th>
<th>行数</th>
<th>覆盖范围</th>
</tr>
<tr>
<td><code>/root/.codex/AGENTS.md</code></td>
<td>307 行</td>
<td>Codex 全局行为基线（24 条规则）</td>
</tr>
<tr>
<td><code>/root/develop/HMI/AGENTS.md</code></td>
<td>159 行</td>
<td>Flutter 上位机完整知识库</td>
</tr>
<tr>
<td><code>/root/develop/Packaging_machine_V1.0/AGENTS.md</code></td>
<td>271 行</td>
<td>打包机固件，最详尽</td>
</tr>
<tr>
<td><code>/root/develop/XYZ/AGENTS.md</code></td>
<td>71 行</td>
<td>XYZ 固件项目知识库</td>
</tr>
</table>
</figure>
<h3>3.3 以打包机固件为例：271 行 AGENTS.md 写了什么</h3>
<pre class="wp-block-code"><code class="language-c">AGENTS.md（271 行）
├── 1. 文件角色 —— 什么情况下读取
├── 2. 项目一眼结论 —— MCU（STM32F103RCT6）、技术栈、3 路 UART、7 任务
├── 3. Codex 进入仓库后的默认动作（信息优先级 10 级）
├── 4. 全局路由表 —— 22 种问题类型→哪个模块文档
├── 5. 全局硬规则（4 大类）
│   ├── 5.1 分层边界——APP 不能直接调 BSP
│   ├── 5.2 并发与中断——临界区规范
│   ├── 5.3 通信口径——USART3 主协议 vs USART1 调试口
│   └── 5.4 配置与接口——运行时参数走 EEPROM
├── 6. 修改代码时的检查点（12 种类型）
│   ├── 改协议 → 同时看 3 个文件 + 同步文档
│   ├── 改状态机 → 看 app_packer_sm + state_handler
│   ├── 改执行器 → 改 action table，不散落 switch
│   ├── 改 ADC/功率 → 不改变主流程结果
│   ├── 改串口/DMA → 先查 ISR 竞争
│   ├── 改监控/报警 → 确认锁存/清除/快照一致
│   ├── 改打印机/屏幕 → 必须在 CommTask 异步
│   ├── 改 USART1 HMI → 同步核对 HMI Dart 解码
│   ├── 改线程/任务模型 → 注册栈大小宏
│   ├── 改构建/调试 → 同步 VSCode launch.json
│   ├── 改 app_define.h → grep 确认零引用再删除
│   └── 改步进保护 → 传感器轴=超时，纯开环轴=脉冲溢出
├── 7. 文档回写规则
└── 8. 一句话执行原则
</code></pre>
<p>这就是 AI 版的项目「宪法」。每次改代码前先查，不靠记忆力，不翻聊天记录。</p>
<h3>3.4 .agents/ 模块级知识库</h3>
<p>除了顶层的 AGENTS.md，还有 14 个模块级文档放在 <code>.agents/</code> 目录里：</p>
<pre class="wp-block-code"><code class="language-text">.agents/
├── index.md                   # 模块入口索引
├── SKILL.md                   # 架构约束、线程模型、历史故障
├── app/
│   ├── app_packer_proto.md    # 协议分发/命令校验/响应字段
│   ├── app_packer_sm.md       # 顶层状态机/流程
│   └── app_monitor.md         # 监控/报警/喂狗
├── service/
│   ├── packer_state_handler.md  # 状态注册表
│   ├── packer_actuator.md       # 执行器映射/点动/换算
│   ├── io_adapters.md           # 串口/屏幕/打印机/输入/ADC
│   └── runtime_support.md       # 运行时标志/故障锁存/快照
├── bsp/
│   ├── bsp_uart.md           # UART/DMA/IDLE/日志/StreamBuffer
│   ├── bsp_motion.md         # 步进/电机/继电器/功率
│   └── bsp_misc.md           # GPIO/ADC/EEPROM/IWDG
├── common/
│   ├── project-baseline.md   # 软件架构/分层/任务/临界区
│   ├── protocol-and-io.md    # 固定协议/串口/HMI/输入输出
│   └── build-debug-rules.md  # 构建/clangd/OpenOCD/VSCode
└── refactoring/
    └── define-to-runtime-migration-log.md  # 编译期宏迁移记录
</code></pre>
<p>架构规则、协议细节、IO 映射、状态机约束、UART 配置、步进电机驱动——每个模块都有自己的 md 文档。AI 进入项目后先读 index.md 定位入口，再按路由表找到对应模块文档。</p>
<h3>3.5 AGENTS.md 的 24 条全局行为规则</h3>
<p>Codex 的全局 AGENTS.md 定义了 24 条规则，核心几条：</p>
<figure class="wp-block-table">
<table>
<tr>
<th>规则</th>
<th>内容</th>
</tr>
<tr>
<td><strong>两层结构</strong></td>
<td>全局（<code>/root/.codex/AGENTS.md</code>）+ 项目本地（<code><repo>/AGENTS.md</repo></code>）</td>
</tr>
<tr>
<td><strong>优先顺序</strong></td>
<td>当前任务事实 &gt; 项目 AGENTS.md &gt; 文档 &gt; 源码 &gt; 全局 AGENTS.md</td>
</tr>
<tr>
<td><strong>执行纪律</strong></td>
<td>改前读文档、只改必要行、避免多余抽象</td>
</tr>
<tr>
<td><strong>Docs-First</strong></td>
<td>先读文档再查代码，用代码确认而不是用代码推导</td>
</tr>
<tr>
<td><strong>硬件优先</strong></td>
<td>以 .ioc、网表、原理图为准</td>
</tr>
<tr>
<td><strong>IWYU Pragma</strong></td>
<td>嵌入式工程中标记必须保留的头文件，防止 clangd 自动删除</td>
</tr>
<tr>
<td><strong>验证说明</strong></td>
<td>任何未验证的操作要标注「Build not verified」「Flash path not verified」</td>
</tr>
</table>
</figure>
<p>这套规则让 AI 的行为可预期、可约束、可审计。</p>
<h2>四、MCP（Model Context Protocol）桥接</h2>
<p>MCP 是 AI 和外部工具之间的「API 网关」。我的系统里配置了 WordPress MCP 桥接：</p>
<pre class="wp-block-code"><code class="language-text">Hermes Agent → MCP Server → WordPress REST API
  ├── create_post       → 创建/更新文章
  ├── list_categories   → 查看文章分类
  └── get_user_info     → 获取用户信息
</code></pre>
<p>MCP 服务器脚本在 <code>~/.hermes/scripts/wp_mcp_server.py</code>，通过 WordPress 的 REST API 直接操作。</p>
<p><strong>实际使用场景：</strong> 让 Hermes 写一篇技术文章，它加载写作 skill，按步骤扩写内容，然后通过 MCP 调用 WordPress API 设置分类、发布。全程不需要打开浏览器、不需要登录 WP 后台、不需要复制粘贴。一句话完成。</p>
<p>系统里 WordPress 的实际分类：</p>
<figure class="wp-block-table">
<table>
<tr>
<th>ID</th>
<th>名称</th>
<th>已发文章</th>
</tr>
<tr>
<td>6</td>
<td>学习笔记</td>
<td>4 篇</td>
</tr>
<tr>
<td>13</td>
<td>嵌入式实战</td>
<td>7 篇</td>
</tr>
<tr>
<td>14</td>
<td>工程复盘</td>
<td>2 篇</td>
</tr>
<tr>
<td>15</td>
<td>架构与重构</td>
<td>1 篇</td>
</tr>
<tr>
<td>16</td>
<td>方法与工具</td>
<td>3 篇</td>
</tr>
</table>
</figure>
<h2>五、AI 辅助的实际工作流</h2>
<p>最后说说这套东西每天都在怎么用。</p>
<h3>场景 1：环境快查</h3>
<pre class="wp-block-code"><code class="language-c"># 一句话
「检查我的 STM32 开发环境」
</code></pre>
<p>Hermes 自动扫描系统、执行一次编译验证、检查 VSCode 所有配置、输出完整的报告——工具版本、缺失项、项目状态。原来手动 <code>--version</code> 一个一个查需要 10 分钟，现在 30 秒。</p>
<h3>场景 2：代码审查</h3>
<p>AI 加载 <code>requesting-code-review</code> + <code>codebase-inspection</code> + <code>systematic-debugging</code> 三个技能，自动：</p>
<ol>
<li>拉取 git diff</li>
<li>检查安全违规（硬编码、缓冲区溢出）</li>
<li>检查代码风格（中文注释、Doxygen 格式）</li>
<li>检查分层违规（APP 直接调 BSP）</li>
<li>给出结构化评审</li>
</ol>
<h3>场景 3：写技术文章</h3>
<p>AI 加载 <code>upgrade-tech-tutorial-to-engineering-guide</code> 技能：</p>
<ol>
<li>先审计现有文章结构</li>
<li>补充官方文档细节</li>
<li>添加架构深度分析</li>
<li>小白提示和检查清单</li>
<li>通过 MCP 发布到 WordPress</li>
</ol>
<h3>场景 4：调试分析</h3>
<p>HardFault 命中后，<code>hardfault_info</code> 打印异常帧。把寄存器值贴给 Hermes，它直接解读 CFSR 寄存器各位的含义——是因为访问了不存在的地址（IMPRECISERR）还是指令访问了不可执行区域（IACCVIOL）。不用翻 ref manual。</p>
<h2>六、当前限制和后续规划</h2>
<h3>限制</h3>
<figure class="wp-block-table">
<table>
<tr>
<th>项目</th>
<th>状态</th>
<th>说明</th>
</tr>
<tr>
<td>本地模型推理</td>
<td>未启用</td>
<td>依赖远程 API，离线不能用</td>
</tr>
<tr>
<td>GPU（RTX 3050 4GB）</td>
<td>闲置</td>
<td>驱动已装（CUDA 13.3），但没装推理引擎</td>
</tr>
<tr>
<td>Docker</td>
<td>未安装</td>
<td>AI 沙箱环境待搭建</td>
</tr>
<tr>
<td>CICD 集成</td>
<td>未接入</td>
<td>AI 审查结果还没进 GitHub Actions</td>
</tr>
</table>
</figure>
<h3>后续</h3>
<ol>
<li><strong>装 ollama 跑本地模型</strong> — 3B/7B Q4 量化小模型在 RTX 3050 上能跑，离线也能用</li>
<li><strong>MCP 扩展</strong> — 接入 GitHub MCP（自动创建 PR、打标签），接入 Jira/Linear MCP（自动同步任务状态）</li>
<li><strong>AGENTS.md 自动化检</strong> — 开发一个脚本自动检查 AGENTS.md 规则是否被违反</li>
<li><strong>CICD 集成</strong> — AI 代码审查结果作为 GitHub Actions 的门禁</li>
</ol>
<h2>七、一句话</h2>
<p>AGENTS.md 是项目的法，Skills 是 AI 的手，MCP 是 AI 的眼睛——三样加在一起，AI 才真正嵌入开发流程，而不是一个高级聊天框。</p>
<hr class="wp-block-separator">
<h3>相关文章</h3>
<ul>
<li><strong><a href="/2026/05/28/arch-linux-embedded-dev-environment/">主文章：Arch Linux 嵌入式开发环境完整总结</a></strong> —— 全景视角，AI 是其中最重要的一章</li>
<li><a href="/2026/05/28/tutorial-wsl2/">WSL2 + Arch Linux 环境从零搭建</a> —— AI Agent 运行在 WSL 内部</li>
<li><a href="/2026/05/28/tutorial-cmake/">CMake Presets + ARM Toolchain + clangd 工程化构建</a> —— AI 审查代码时理解的分层架构</li>
</ul>
