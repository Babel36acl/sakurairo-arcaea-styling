---
title: "从 #define 到 EEPROM：嵌入式参数持久化的迁移实战"
description: "项目初期所有参数都是 #define。要从编译期宏迁移到运行时 EEPROM 持久化，需要一条安全的四步路径。"
published: "2026-05-28"
updated: "2026-08-18"
permalink: "/2026/05/28/define-to-eeprom-parameter-migration/"
draft: false
categories: ["嵌入式实战","架构与重构"]
tags: []
legacyId: 533
---

<div class="arcaea-wrap">
<p><span class="tag">嵌入式实战</span> <span class="tag">配置管理</span></p>
<p>项目初期所有参数都是 <code>#define BAG_SPEED_HZ 10504</code>。每次改速度都要重新编译、烧录、重启。现场调试时工程师提了一个需求："能不能在串口屏上改完直接生效？"</p>
<p>答案是可以，但要走一条安全的迁移路径。</p>
<h2>迁移四步走</h2>
<h3>第一步：定义参数 ID 枚举</h3>
<p>每个参数一个全局唯一 ID，与 20B 协议的 Y1 字段对应：</p>
<pre><code class="language-c">typedef enum {
    RCFG_ID_SPEED_BAG_OUT_HZ       = 0x10,
    RCFG_ID_SPEED_TEAR_OFF_HZ      = 0x11,
    RCFG_ID_SPEED_SEAL_MOVE_HZ     = 0x12,
    RCFG_ID_SPEED_SEAL_RETURN_HZ   = 0x13,
    RCFG_ID_STEPPER_START_HZ       = 0x14,
    RCFG_ID_STEPPER_ACCEL_HZ_PER_S = 0x15,
    RCFG_ID_POWER_ON_DELAY_MS      = 0x20,
    RCFG_ID_SELF_CHECK_DELAY_MS    = 0x21,
    // ... 共约 30+ 个参数
} rcfg_id_t;</code></pre>
<h3>第二步：集中数据结构</h3>
<pre><code class="language-c">typedef struct {
    uint32_t version;                // 结构体版本，用于兼容性检查
    uint32_t speed_bag_out_hz;
    uint32_t speed_tear_off_hz;
    uint32_t speed_seal_move_hz;
    uint32_t stepper_start_hz;
    uint32_t stepper_accel_hz_per_s;
    uint32_t power_on_delay_ms;
    uint32_t self_check_delay_ms;
    // ... 所有运行时参数
    uint16_t crc;                    // 全结构体 CRC16，校验完整性
} packer_runtime_config_t;</code></pre>
<h3>第三步：四函数接口</h3>
<pre><code class="language-text">// 1. 上电初始化 — 从 EEPROM 加载，加载失败回退默认值
void packer_runtime_config_init(void);

// 2. 只读访问 — 返回 const 指针，各模块直接读字段
const packer_runtime_config_t* packer_runtime_config_get(void);

// 3. 单参数写入（仅 RAM）
uint8_t packer_runtime_config_write(rcfg_id_t id, uint32_t value);

// 4. 显式保存到 EEPROM
uint8_t packer_runtime_config_save(void);</code></pre>
<p>默认值集中在一个头文件中：</p>
<pre><code class="language-c">// app_runtime_config_defaults.h
#define RCFG_DEFAULT_SPEED_BAG_OUT_HZ  10504u
#define RCFG_DEFAULT_SPEED_TEAR_OFF_HZ 10504u
#define RCFG_DEFAULT_STEPPER_START_HZ  2000u</code></pre>
<h3>第四步：增量替换旧宏</h3>
<p>不是一次性替换全部代码。逐个宏替换的流程：</p>
<ol>
<li>在 runtime_config 结构体中加入新字段，默认值等于旧宏</li>
<li>所有代码改为通过 <code>runtime_config_get()-&gt;xxx</code> 读取</li>
<li><code>grep -rn 'OLD_MACRO_NAME' --include='*.c' --include='*.h'</code> 确认零引用</li>
<li>删除旧宏定义</li>
<li>同步清理 Doxygen <code>@name</code> 空组</li>
</ol>
<p>整个迁移历时数个重构迭代，没有任何一个版本同时出现"新架构没写完、旧宏已删除"的中间态。</p>
<h2>EEPROM 存储策略</h2>
<pre><code class="language-c">// AT24C02: 256 字节，软件 I2C (PA11/PA12)
// 结构体放在 EEPROM 起始地址
#define RCFG_EEPROM_ADDR 0x00

// 保存流程：
// 1. 计算整个结构体的 CRC16
// 2. 写入 crc 字段
// 3. bsp_eeprom_write(addr, &amp;config, sizeof(config))

// 加载流程：
// 1. bsp_eeprom_read(addr, &amp;config, sizeof(config))
// 2. 重新计算 CRC16 与存储的 crc 比较
// 3. 匹配 → 使用；不匹配 → 回退默认值</code></pre>
<h2>串口调参链路</h2>
<pre><code class="language-text">DGUS 串口屏 (USART1) → packer_dbus_frame → 解析 5A A5 帧
  → 识别写参数命令 → packer_runtime_config_write(id, value)
  → packer_runtime_config_save() ─→ EEPROM 持久化

HMI 上位机 (USART3) → 20B 协议帧 → 协议分发
  → 识别调参功能码 → packer_runtime_config_write(id, value)
  → packer_runtime_config_save() ─→ EEPROM 持久化</code></pre>
<h2>参数分类策略</h2>
<div class="arcaea-table-wrap" data-bac-table-shell="1"><table>
<tr>
<th>分类</th>
<th>例子</th>
<th>管理方式</th>
</tr>
<tr>
<td>运行时调参</td>
<td>速度、加减速、延时、脉冲</td>
<td>runtime_config + EEPROM</td>
</tr>
<tr>
<td>固件定死</td>
<td>硬件引脚、节点地址、报警码</td>
<td>保留 <code>#define</code></td>
</tr>
<tr>
<td>换算常量</td>
<td>脉冲换算中间值</td>
<td>局部 <code>static const</code></td>
</tr>
</table></div>
<p><strong>核心经验</strong>：不要把"能在运行时调"和"应该运行时调"混为一谈。任务栈大小影响 .bss 布局，就不能运行时改。区分清楚再决定归属。</p>
<blockquote>
<p>整个迁移过程中没有出现"旧宏已删、新字段未上线"的断档期。加字段 → 切换读取点 → 确认零引用 → 删宏。每一步都可回退。</p>
</blockquote>
</div>
