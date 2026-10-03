---
title: "一台 STM32 设备是怎么在 83 次修复里暴露出自己的问题分布的"
description: "这份发布版报告把一组嵌入式项目修复记录收拢成问题分布图，重点展示哪些故障最常见、哪些类别最贵、哪些风险具有重复性。"
published: "2026-05-26"
updated: "2026-08-18"
permalink: "/2026/05/26/embedded-project-problem-evolution-report/"
draft: false
categories: ["工程复盘"]
tags: []
legacyId: 176
---

<p><strong>摘要：</strong>这份发布版报告把一组嵌入式项目修复记录收拢成问题分布图，重点展示哪些故障最常见、哪些类别最贵、哪些风险具有重复性。</p>
<blockquote>
<p>如果把 bug 只看成零散事件，就很难发现它们背后的结构规律。这份报告把某 STM32 运动控制项目的修复历史按类型、严重度和时间分布重新整理，适合做技术债盘点、团队复盘和架构改造前的底稿。</p>
</blockquote>
<p>单个 bug 看起来往往只是局部失误，几十个 bug 放到一起看，才会显出工程真正的受伤方式。</p>
<p>这份报告做的事情很直接：不再按时间顺序复读提交记录，而是把修复历史重新按问题类型、严重度和出现阶段归并，看看一套嵌入式控制工程到底最容易在哪些地方反复出错。</p>
<p>发布版已去掉仓库身份和提交哈希，保留统计口径与问题模式，方便把阅读重点放在共性结论上。</p>
<blockquote>
<p><strong>项目</strong>: 某 STM32 运动控制项目（STM32F103 + FreeRTOS）<br>
<strong>方法</strong>: Git 历史语义挖掘（MSR）<br>
<strong>范围</strong>: 329 个提交，其中 83 个修复类（25%）<br>
<strong>时段</strong>: 2025-02 初始化 → 2026-05-25</p>
</blockquote>
<hr>
<h2>一、问题分类统计</h2>
<h3>1.1 总览</h3>
<div class="arcaea-table-wrap" data-bac-table-shell="1"><table>
<thead>
<tr>
<th>类别</th>
<th style="text-align: right;">数量</th>
<th style="text-align: right;">占比</th>
<th>关键短语</th>
</tr>
</thead>
<tbody>
<tr>
<td><strong>业务逻辑错误</strong></td>
<td style="text-align: right;">18</td>
<td style="text-align: right;">22%</td>
<td>加热时序、状态机条件、流程标志</td>
</tr>
<tr>
<td><strong>硬件抽象错误</strong></td>
<td style="text-align: right;">10</td>
<td style="text-align: right;">12%</td>
<td>引脚模式、定时器频率、默认值</td>
</tr>
<tr>
<td><strong>并发/调度问题</strong></td>
<td style="text-align: right;">8</td>
<td style="text-align: right;">10%</td>
<td>DMA 缓冲、栈溢出、队列竞争</td>
</tr>
<tr>
<td><strong>配置/参数错误</strong></td>
<td style="text-align: right;">8</td>
<td style="text-align: right;">10%</td>
<td>宏门控、默认值错误、语义不一致</td>
</tr>
<tr>
<td><strong>文档/注释脱节</strong></td>
<td style="text-align: right;">9</td>
<td style="text-align: right;">11%</td>
<td>文档未同步、注释过时、Doxygen 丢失</td>
</tr>
<tr>
<td><strong>协议语义未收敛</strong></td>
<td style="text-align: right;">4</td>
<td style="text-align: right;">5%</td>
<td>STOP 粒度、应答模型、条件门控</td>
</tr>
<tr>
<td><strong>其他修正</strong></td>
<td style="text-align: right;">26</td>
<td style="text-align: right;">31%</td>
<td>超时调整、方向修正、斩杀线、括号残留</td>
</tr>
</tbody>
</table></div>
<h3>1.2 按严重等级细分</h3>
<div class="arcaea-table-wrap" data-bac-table-shell="1"><table>
<thead>
<tr>
<th>等级</th>
<th style="text-align: right;">数量</th>
<th>判断标准</th>
<th>典型</th>
</tr>
</thead>
<tbody>
<tr>
<td><strong>致命（产生不可用状态）</strong></td>
<td style="text-align: right;">5</td>
<td>流程卡死 / 报警停机 / 端口永久失效</td>
<td>[提交哈希已隐去] alarm=11, [提交哈希已隐去] USART1 永久停, [提交哈希已隐去] 校准恒跳过</td>
</tr>
<tr>
<td><strong>严重（功能异常但可恢复）</strong></td>
<td style="text-align: right;">18</td>
<td>动作执行错误 / 参数不对 / 状态残留</td>
<td>[提交哈希已隐去] 风机不关, [提交哈希已隐去] 加热时序, [提交哈希已隐去] run_state</td>
</tr>
<tr>
<td><strong>中等（边界条件遗漏）</strong></td>
<td style="text-align: right;">31</td>
<td>超时不准 / 方向反 / 门控遗漏</td>
<td>[提交哈希已隐去] 三角波公式, [提交哈希已隐去] motion_seen 守卫</td>
</tr>
<tr>
<td><strong>轻微（文档/注释/风格）</strong></td>
<td style="text-align: right;">29</td>
<td>注释不一致 / 格式化</td>
<td>[提交哈希已隐去] 注释恢复, [提交哈希已隐去] 代码格式</td>
</tr>
</tbody>
</table></div>
<h3>1.3 时间分布（按周）</h3>
<pre><code class="language-text">第 1 周（初始化）：0 修复
第 2 周（功能填充）：2 修复
第 3 周（状态机建设）：4 修复
第 4 周（协议搭建）：6 修复
第 5 周（重构 v4 / 解耦）：18 修复 ← 峰值
第 6 周（运行时配置迁移）：12 修复
第 7 周（加热/风机/协议修正）：15 修复 ← 次峰
第 8 周（加热 GPIO + 自检修正）：10 修复
第 9 周（DMA + HMI Session + doc 清理）：16 修复
</code></pre>
<p><strong>修复频率在第 5~9 周激增</strong>——恰好对应加热模块 3 次方案变更 + USART1 协议切换 + v1.1 板卡适配的前期阶段。</p>
<hr>
<h2>二、高频根因</h2>
<h3>根因 1：职责错位——一个物理单元分散在多个模块，或一个模块承载多个物理单元</h3>
<p><strong>证据链</strong>（按时间顺序）：</p>
<pre><code class="language-text">加热历程：
  加热在 bsp_dc_motor.c（初始）→ 软件 PWM → GPIO → 周期修正 → STOP 逻辑 → 风机解耦
  6 周 7 版方案，加热始终没有自己的 BSP 文件

dc_motor.c 承载的实际物理单元：
  - 加热丝          ← 功率继电器
  - 风机            ← 功率继电器
  - NMOS1~4         ← 功率输出
  - IR2104 组1      ← DC 电机
  - IR2104 组2      ← DC 电机
  共 5 种物理语义，只有最后两种真正是 DC 电机
</code></pre>
<p><strong>影响扩散模式</strong>:</p>
<pre><code class="language-text">加热丝 BSP 出问题
  → packer_heater.c/h 跟着改
  → freertos.c 任务周期跟着改
  → app_define.h 宏跟着改
  → doc/debug命令.md 跟着改
  → .agents/*.md 跟着改
  → AGENTS.md 路由表跟着改
  → 最终文档修正还需要另一次提交
</code></pre>
<p><strong>同类型问题</strong>: <code>app_packer_sm.c</code> = 状态机 + 命令分发 + 报警处理，<br>
<code>packer_actuator.c</code> = 所有执行器的动作编排 + 脉冲计算 + 功率限制。</p>
<p><strong>量化</strong>: dc_motor 文件有 14+ 次加热相关变更，只有 4 次是真正的 DC 电机变更。<br>
<strong>加热的寄生增加了 dc_motor 的变更频率 350%</strong>。</p>
<hr>
<h3>根因 2：共享资源的同步约束未显式建模</h3>
<p><strong>证据链</strong>:</p>
<div class="arcaea-table-wrap" data-bac-table-shell="1"><table>
<thead>
<tr>
<th>提交</th>
<th>共享资源</th>
<th>约束</th>
<th>发现方式</th>
</tr>
</thead>
<tbody>
<tr>
<td>[提交哈希已隐去]</td>
<td>TIM4（四轴步进共用）</td>
<td>同频启动</td>
<td>运行时报 BSP_STEPPER_RESULT_BUSY</td>
</tr>
<tr>
<td>[提交哈希已隐去]</td>
<td>USART TX DMA 队列</td>
<td>单次单任务写入</td>
<td>队列损坏</td>
</tr>
<tr>
<td>[提交哈希已隐去]</td>
<td>USART1 RX DMA</td>
<td>错误后不自动恢复</td>
<td>端口永久失效</td>
</tr>
<tr>
<td>[提交哈希已隐去]</td>
<td>configMAX_TASK_NAME_LEN</td>
<td>长度不足 → configASSERT</td>
<td>上电死锁</td>
</tr>
<tr>
<td>[提交哈希已隐去]</td>
<td>UART RX DMA 缓冲</td>
<td>259B 帧需 ≥ 256B</td>
<td>打印机帧截断</td>
</tr>
</tbody>
</table></div>
<p><strong>模式</strong>: 所有约束都是<strong>运行时</strong>发现的——没有编译期检查，没有设计文档，没有显式断言。开发者看到外设可用就直接用，不知道其他模块对它的使用约束。</p>
<p><strong>最典型的例子——TIM4</strong>:<br>
- bsp_stepper 要求同频率才能 <code>start_group()</code><br>
- 但 pact_fill_runtime_press_dual_action() 和 pact_try_fill_press_axis2_return_action() 各自独立计算频率<br>
- 两个频率不一致时，start_group() 返回 BUSY<br>
- 轴 2 单独运行 → 超时 → alarm=11<br>
- 修复后，在 v1.1 板卡中 ST1/ST2 被拆到独立定时器（但代码尚未适配）</p>
<p><strong>问题的递归性</strong>: 因为 TIM4 共享 → 限制了频率自由度 → 被迫拆定时器 → 拆了定时器要重写步进驱动 → 重写成本太大 → v1.1 文档先写但代码一直没动。</p>
<hr>
<h3>根因 3：配置数据的多版本真相</h3>
<p><strong>证据链</strong>:</p>
<div class="arcaea-table-wrap" data-bac-table-shell="1"><table>
<thead>
<tr>
<th>提交</th>
<th>参数</th>
<th>涉及的存储位置数</th>
<th>不一致类型</th>
</tr>
</thead>
<tbody>
<tr>
<td>[提交哈希已隐去]</td>
<td>heater_pwm_duty_per_mille</td>
<td>6+</td>
<td>命名语义 vs 实际行为</td>
</tr>
<tr>
<td>[提交哈希已隐去]</td>
<td>自检 3/4 轴角度</td>
<td>5+</td>
<td>固定值 vs 运行时计算</td>
</tr>
<tr>
<td>[提交哈希已隐去]</td>
<td>APP_CFG_BAG_CALIB_SENSOR_ENABLE</td>
<td>3+</td>
<td>条件编译失效（include 顺序）</td>
</tr>
<tr>
<td>[提交哈希已隐去]</td>
<td>printer_bag_trigger_len_mm_x1000</td>
<td>2</td>
<td>默认值 30U vs 30000U</td>
</tr>
<tr>
<td>[提交哈希已隐去]</td>
<td>CONTRO stop 门控条件</td>
<td>3+</td>
<td>条件遗漏 boot_sequence_active</td>
</tr>
</tbody>
</table></div>
<p><strong>参数从定义到使用的路径</strong>:</p>
<pre><code class="language-text">app_define.h（宏定义）
  → app_runtime_config_defaults.h（默认值）
  → packer_runtime_config_t（结构体字段 + 注释）
  → s_param_desc[]（运行时描述表）
  → EEPROM（持久化）
  → HMI 屏幕显示
  → doc/ 硬件文档
  → .agents/ 项目文档

每个节点都可能独立修改，
没有机制保证它们的同步。
</code></pre>
<p><strong>最严重的一次</strong>: <code>heater_pwm_duty_per_mille</code> 字段名叫千分比，代码解释为百分比存、运行时 <code>*10</code>。字段名、代码、EEPROM 三层语义不一致。修正波及了参数管道的每一个节点。</p>
<hr>
<h3>根因 4：协议/状态机的语义设计只有主路径</h3>
<p><strong>证据链</strong>（同一个问题的 3 次迭代）:</p>
<pre><code class="language-text">CONTROL stop:
  版本 1: 收到 stop 就全部停止
    → 打断正在进行的 BAG/SEAL/DELIVER（不好）
  版本 2: 被 boot_sequence_active 门控阻止
    → 上电默认停机不生效（更糟）
  版本 3: 停新不停车中（当前）
    → 禁止启动下一轮，已进行的自然收尾

0x47 打印机透传:
  版本 1: 同步应答
    → 打印机慢于串口，响应超时
  版本 2: 异步双阶段
    → Z1=0x03"已受理" + 打印机应答

加热 STOP 行为:
  版本 1: stop 不涉及加热
  版本 2: stop 立即关断加热
  版本 3: stop 关加热，但 42/43/44 各自行为不同
</code></pre>
<p><strong>模式</strong>: 每个命令只设计了"正常情况下的主路径"，没有在最初覆盖：</p>
<div class="arcaea-table-wrap" data-bac-table-shell="1"><table>
<thead>
<tr>
<th>遗漏维度</th>
<th>后果</th>
<th>例子</th>
</tr>
</thead>
<tbody>
<tr>
<td>中断粒度</td>
<td>反复修 stop 口径</td>
<td>CONTROL stop x3</td>
</tr>
<tr>
<td>状态残留</td>
<td>A 流程设置的状态 B 流程继承</td>
<td>风机 x3</td>
</tr>
<tr>
<td>异步应答模型</td>
<td>重做 0x47 响应机制</td>
<td>0x47 x2</td>
</tr>
<tr>
<td>交叉影响</td>
<td>加热/风机关断时机错</td>
<td>加热时序 x4</td>
</tr>
<tr>
<td>幂等性</td>
<td>重复命令行为未定义</td>
<td>0x42 多次触发</td>
</tr>
</tbody>
</table></div>
<hr>
<h3>根因 5：补丁式修复累积——越过架构层直接在上层加适配</h3>
<p><strong>识别的补丁层</strong>（按添加时间排序）:</p>
<div class="arcaea-table-wrap" data-bac-table-shell="1"><table>
<thead>
<tr>
<th>补丁层</th>
<th>解决的问题</th>
<th>架构问题</th>
<th>后续成本</th>
</tr>
</thead>
<tbody>
<tr>
<td>功率限制适配层 <code>packer_power_limit</code></td>
<td>DC 电机加功率门控</td>
<td>旧入口未删除</td>
<td>AGENTS.md 写规则"必须走新入口"</td>
</tr>
<tr>
<td>HMI 桥接 <code>bridge_dispatch</code></td>
<td>USART1 发控制命令</td>
<td>USART1 绕回 USART3</td>
<td>第三协议口需再建 bridge</td>
</tr>
<tr>
<td>2000 脉冲斩杀线</td>
<td>步进收尾不准</td>
<td>应用层 magic number</td>
<td>AGENTS.md 禁用此模式</td>
</tr>
<tr>
<td>日志队列 + 节流</td>
<td>多任务抢 UART 队列</td>
<td>Logger 非重入未修</td>
<td>3 层限制包着</td>
</tr>
<tr>
<td>收包预算（192B/4帧）</td>
<td>CommTask 被洪峰占满</td>
<td>任务设计没估算容量</td>
<td>运行时保护替代架构约束</td>
</tr>
<tr>
<td>DGUS 键值写零</td>
<td>按键防重入</td>
<td>屏幕配置能解决但没配</td>
<td>后处理 hook 替代事前配置</td>
</tr>
</tbody>
</table></div>
<p><strong>补丁层的生命周期</strong>:</p>
<pre><code class="language-text">第 1 层：原始代码（有设计缺陷）
第 2 层：补丁层（绕过缺陷但不拆除缺陷）
第 3 层：规则约束（AGENTS.md "必须通过 XXX"）
第 4 层：补丁的补丁（hack on top of hack）
</code></pre>
<p><strong>量化代价</strong>: 6 条补丁层 ≈ 12 个额外 commit + 4 条 AGENTS.md 约束规则 + 约 500 行间接代码。</p>
<hr>
<h2>三、模块脆弱性分析</h2>
<h3>3.1 模块级 Heatmap</h3>
<p>按修复数 × 波及面 × 复发次数加权：</p>
<pre><code class="language-text">模块                         修复数   波及面   复发    脆弱指数
─────────────────────────────────────────────────────────────
bsp_dc_motor.c               14+    高      5次     ██████████
app_packer_sm.c              18+    极高    4次     █████████
packer_actuator.c            12+    高      3次     ████████
packer_state_handler.c       10+    中高    3次     ███████
packer_heater.c/h            8+     高      4次     ███████
bsp_stepper.c                8+     中高    3次     ██████
app_packer_proto.c           7+     高      3次     ██████
bsp_uart.c                   6+     中      2次     ████
packer_hmi_proto.c           4+     中高    2次     ████
comm_task.c                  4+     中      2次     ███
</code></pre>
<h3>3.2 第一脆弱模块包：加热子系统（dc_motor + heater + 相关 doc）</h3>
<p><strong>演化链</strong>:</p>
<pre><code class="language-text">v0  bsp_dc_motor_heater_pwm_start()       ← TIM5 CH1 硬件 PWM
v1  软件 PWM（百分比存 *10）               ← 第一次解耦（但仍寄生在 dc_motor）
v2  真千分比                              ← 语义修正
v3  GPIO 继电器（移除 TIM PWM）            ← 硬件事实修正
v4  周期 100ms→10ms                      ← 分辨率不够
v5  STOP/ERROR 关断逻辑                  ← 语义修正
v6  风机从加热拆分                        ← 没拆彻底，还在 dc_motor 里

结论：
  加热子系统 6 周 7 版，平均每周换一个方案。
  自始至终加热没有自己的 BSP 文件。
  dc_motor 文件 14+ 次变更中只有 4 次是真正 DC 电机相关。
  加热寄生在 dc_motor 下使 dc_motor 的变更频率增加了 350%。
</code></pre>
<h3>3.3 第二脆弱模块：状态机（app_packer_sm）</h3>
<p><strong>演化链</strong>:</p>
<pre><code class="language-text">状态数量：12 个初始状态 → 20+ 个状态（含子阶段）

主要问题模式：
  状态退出时残留标志                   → [提交哈希已隐去] 修复
  状态间交叉影响（加热/风机/stop）       → [提交哈希已隐去] + [提交哈希已隐去]
  状态转换条件遗漏（motion_seen 守卫）   → [提交哈希已隐去]
  状态超时边界条件错误                  → [提交哈希已隐去] + [提交哈希已隐去]
  状态 done 标志被跳过（残留旧标志）      → [提交哈希已隐去] + [提交哈希已隐去]
</code></pre>
<p><strong>核心问题</strong>: 状态机没有统一的进入/退出/清理契约。每个状态自己决定什么时候清理标志、什么时候释放资源。这种不统一是大多数"状态残留"类 bug 的源头。</p>
<h3>3.4 第三脆弱模块：协议分发（app_packer_proto + bridge_dispatch）</h3>
<p><strong>演化链</strong>:</p>
<pre><code class="language-text">v1  USART3 独占 20B 协议
v2  USART1 调试模式备选主口              → 增加协议口
v3  USART1 DGUS 协议                    → 协议切换
v4  USART1 HMI Session Protocol         → 再次协议切换
v5  HMI Session 桥接 0x30~0x37 控制命令   → bridge_dispatch 回环
v6  双通信口共存                          → 文档补充

问题：
  每次扩展协议口都加一层适配。
  bridge_dispatch 引入了一条回环路径：
    HMI → USART1 → 拆 20B → USART3 分发 → 截获 → 拆包 → USART1
  路径上的每一步都可能出问题。
</code></pre>
<hr>
<h2>四、典型 Bug 演化链（图文）</h2>
<h3>演化链 1：加热——职责错位导致的连锁修复</h3>
<pre><code class="language-text">[根本原因]
加热放在了 bsp_dc_motor.c
  ↓
[第一层修复] PWM → GPIO
  [提交哈希已隐去] + [提交哈希已隐去]：删除 TIM5 PWM 路径，改为 GPIO
  波及：6 个文件，文档遗留 2 处
  ↓
[第二层修复] 周期不对
  [提交哈希已隐去]：100ms → 10ms
  因为软件 PWM 精度不够
  ↓
[第三层修复] 单位不对  
  [提交哈希已隐去]：伪千分比 → 真千分比
  EEPROM 已有数据与新语义不兼容
  ↓
[第四层修复] STOP/ERROR 行为不对
  [提交哈希已隐去]：流程不同阶段加热行为不同
  ↓
[第五层修复] 风机解耦
  [提交哈希已隐去]：风机从加热拆分 → 但加热还在 dc_motor 里
  ↓
[第六层（未发生）] 加热拆出 dc_motor
  “涉及面太大，暂时不动”
</code></pre>
<p><strong>总代价</strong>: 5 轮修复 + 2 轮文档补 + 1 次未完成拆分 = <strong>至少 8 个 commit</strong>。</p>
<hr>
<h3>演化链 2：TIM4 同频约束——共享资源未建模</h3>
<pre><code class="language-text">[设计] TIM4 四轴共用，同频运行
  ↓
[矛盾] 不同子阶段可能请求不同频率
  pact_fill_runtime_press_dual_action() → speed_seal_return_hz
  pact_try_fill_press_axis2_return_action() → scaled auto_hz
  ↓
[撞车] bsp_stepper_start_group() 返回 BUSY
  [提交哈希已隐去]：轴 2 单独运行 → IN1 超时 → alarm=11
  ↓
[第一次修复] 强制算同一频率
  在 OPEN_DUAL_RETURN profile 中统一频率
  ↓
[第二次修复] 2000 脉冲斩杀线
  [提交哈希已隐去]：收尾不准，加 magic number patch
  ↓
[第三次修复] AGENTS.md 禁用斩杀线
  规则：必须走目标脉冲停轴，不使用斩杀线
  ↓
[第四次（未完成）] 拆分独立定时器
  v1.1 板卡：ST1→TIM2, ST2→TIM5, 仅 ST3/ST4 共用 TIM4
  文档已更新，代码未适配
</code></pre>
<p><strong>总代价</strong>: 4 轮修复 + 2 条 AGENTS.md 约束 + <strong>架构迁移至今未完成</strong>。</p>
<hr>
<h3>演化链 3：CONTROL stop——协议语义设计不完整</h3>
<pre><code class="language-text">[初始设计] stop = 全部停止
  → 打断 BAG/SEAL/DELIVER
  ↓
[第一次修正] stop 被 boot_sequence_active 门控
  [提交哈希已隐去]：上电默认停机状态，但 stop 无效
  → 条件遗漏
  ↓
[第二次修正] 停新不停车中
  [提交哈希已隐去]：禁止启动下一轮，已进行的收尾
  → 同时关加热（[提交哈希已隐去]）
  → 但不关风机（[提交哈希已隐去]）
  ↓
[第三次修正] 文档回写
  [提交哈希已隐去]：协议文档 + AGENTS.md + .agents 全部更新
  ↓
[第四次连锁] USART1 Session run_state 未同步
  [提交哈希已隐去]：停机状态已更新，但 HMI Session 的缓存没跟上
</code></pre>
<p><strong>总代价</strong>: 4 次语义修正 + 3 次文档修正 + 1 次连锁修复。</p>
<hr>
<h2>五、架构问题总结</h2>
<h3>5.1 六个架构缺陷</h3>
<div class="arcaea-table-wrap" data-bac-table-shell="1"><table>
<thead>
<tr>
<th>#</th>
<th>缺陷</th>
<th>严重度</th>
<th>证据</th>
</tr>
</thead>
<tbody>
<tr>
<td>1</td>
<td><strong>BSP 按外设类型而非物理单元组织</strong></td>
<td>高</td>
<td>dc_motor 承载 5 种物理语义</td>
</tr>
<tr>
<td>2</td>
<td><strong>共享资源约束隐式存在，无显式建模</strong></td>
<td>高</td>
<td>TIM4 同频、DMA 队列单写</td>
</tr>
<tr>
<td>3</td>
<td><strong>配置参数不存在单一事实来源</strong></td>
<td>高</td>
<td>一个参数在 6+ 处冗余定义</td>
</tr>
<tr>
<td>4</td>
<td><strong>协议接口层扩展采用「加层」而非重构</strong></td>
<td>中</td>
<td>bridge_dispatch、power_limit</td>
</tr>
<tr>
<td>5</td>
<td><strong>跨任务状态一致性无契约</strong></td>
<td>高</td>
<td>run_state 不同步、标志残留</td>
</tr>
<tr>
<td>6</td>
<td><strong>状态机无统一进入/退出/清理契约</strong></td>
<td>中</td>
<td>done 残留，motion_seen 守卫漏</td>
</tr>
</tbody>
</table></div>
<h3>5.2 债务累积结构</h3>
<pre><code class="language-text">加一层补丁（power_limit）
  → 不删旧入口
    → AGENTS.md 加一条规则
      → 修复提交再波及这里
        → 再补一层（更不敢删了）
</code></pre>
<p>当前 AGENTS.md 中有 <strong>6 条</strong>规则是为补丁层兜底的:</p>
<ol>
<li>"DC 电机启动必须走 packer_power_limit 入口"</li>
<li>"轴2 PRESS_RETRACT 禁止使用 2000 脉冲斩杀线"</li>
<li>"禁止在 StateMachineTask 中同步等待 UART"</li>
<li>"阻塞 I/O 必须通过 comm_task_enqueue 异步化"</li>
<li>"新增步进轴保护先判断是否有传感器反馈"</li>
<li>"压杆下压与回位必须保持不同语义"</li>
</ol>
<p><strong>6 条规则 = 6 个本不该存在的架构假设需要人工记忆。</strong></p>
<hr>
<h2>六、推荐重构方案</h2>
<h3>P0 级（立即，影响可靠性）</h3>
<div class="arcaea-table-wrap" data-bac-table-shell="1"><table>
<thead>
<tr>
<th>项</th>
<th>理由</th>
<th>风险</th>
<th>操作</th>
</tr>
</thead>
<tbody>
<tr>
<td>加热拆出 dc_motor</td>
<td>dc_motor 50%+ 的变更来自加热</td>
<td>低</td>
<td>新建 bsp_heater.c/h，移过去</td>
</tr>
<tr>
<td>验证 USART1 DMA 恢复</td>
<td>[提交哈希已隐去] 已合入，需测 HMI 长时间运行</td>
<td>低</td>
<td>HIL 跑 24h</td>
</tr>
<tr>
<td>步进驱动适配 v1.1 TIM2/TIM5</td>
<td>架构依赖：当前代码假设四轴同频</td>
<td>高</td>
<td>重写 bsp_stepper 分配层</td>
</tr>
</tbody>
</table></div>
<h3>P1 级（短期，降修复成本）</h3>
<div class="arcaea-table-wrap" data-bac-table-shell="1"><table>
<thead>
<tr>
<th>项</th>
<th>理由</th>
<th>风险</th>
<th>操作</th>
</tr>
</thead>
<tbody>
<tr>
<td>协议分发器多端口化</td>
<td>消除 bridge 回环，第三口不重写</td>
<td>中</td>
<td>proto_port_cfg_t 注册表</td>
</tr>
<tr>
<td>packer_pin_map.h 单一事实</td>
<td>引脚变更只需改一处</td>
<td>低</td>
<td>新头文件 + 静态断言</td>
</tr>
<tr>
<td>状态机进入/退出/清理契约</td>
<td>消除标志残留</td>
<td>中</td>
<td>sm_*_flow 统一 enter/exit/cleanup</td>
</tr>
</tbody>
</table></div>
<h3>P2 级（中期，消补丁债）</h3>
<div class="arcaea-table-wrap" data-bac-table-shell="1"><table>
<thead>
<tr>
<th>项</th>
<th>理由</th>
<th>风险</th>
<th>操作</th>
</tr>
</thead>
<tbody>
<tr>
<td>消除 power_limit 适配层</td>
<td>合并到 bsp_dc_motor 入口</td>
<td>中</td>
<td>删旧入口，强制不走旧路径</td>
</tr>
<tr>
<td>消除 HMI bridge 回环</td>
<td>proto 原生支持多端口</td>
<td>高</td>
<td>重写 dispatch</td>
</tr>
<tr>
<td>Logger 重入实现</td>
<td>移除队列+节流三层限制</td>
<td>中</td>
<td>锁或专用任务</td>
</tr>
</tbody>
</table></div>
<hr>
<h2>七、工程改进建议</h2>
<h3>7.1 提交规范</h3>
<p>当前 329 个提交中，26% 没有 Conventional Commit 前缀（如 <code>fix:</code>、<code>feat:</code>、<code>refactor:</code>）。建议：</p>
<pre><code class="language-text">fix(加热): GPIO 控制（移除错误的 TIM5 PWM 路径）
fix(步进): 双轴频率不匹配导致 alarm=11
fix(协议): CONTROL stop 口径——停新不停车中
refactor(dc_motor): 加热拆出到独立 bsp_heater
</code></pre>
<p>AI 分析时，前缀就是分类标签。</p>
<h3>7.2 修复流程改进</h3>
<p>每个修复类提交建议包含：</p>
<pre><code class="language-text">fix(模块): 一句话问题描述

Root cause: [根因一句话]
Fix: [做了啥]
File list: [波及文件]
</code></pre>
<p>例：</p>
<pre><code class="language-text">fix(步进): 双轴频率不匹配导致 alarm=11

Root cause: pact_fill_runtime_press_dual_action() 和
pact_try_fill_press_axis2_return_action() 独立计算频率，
但 TIM4 要求所有轴同频启动。

Fix: 在 OPEN_DUAL_RETURN profile 中显式计算同一 auto_hz，
确保三轴同时启动。

File list: packer_actuator.c, sm_press_util.c
</code></pre>
<h3>7.3 周期性审计</h3>
<p>每月一次：</p>
<pre><code class="language-bash">git log --since="1 month ago" --grep="fix|修正|修复"
</code></pre>
<p>统计月度修复热力图。如果某模块连续两个月出现在热力图中——<strong>说明该模块有架构问题，不是"修复度不够"的问题。</strong></p>
<h3>7.4 文档同步检查</h3>
<p>commit 钩子检查：如果 commit 改了 <code>.c</code> 或 <code>.h</code> 文件，检查是否有对应的 <code>.md</code>（doc 或 agents）也需要更新。不强制阻止提交，但打印提醒。</p>
<hr>
<p><strong>结论</strong>: 项目 25% 的提交是修复。这不是个案，而是架构层面没有为变化留出位置的系统性代价。最有效的单一改进是 <strong>加热拆出 dc_motor</strong>——它用最低的代价（新建一个文件）切断了一整类修复的根因链路。</p>
