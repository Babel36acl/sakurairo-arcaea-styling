---
title: "运行时参数框架 (Runtime Config Framework)"
description: "参数描述表驱动读写、CRC 校验 EEPROM 完整性、写操作不自动保存防寿命耗尽、HMIS 协议动态参数发现。"
published: "2026-05-28"
updated: "2026-06-02"
permalink: "/2026/05/28/runtime-config-internals-param-table-crc/"
draft: false
categories: ["嵌入式实战","架构与重构"]
tags: ["ARCH"]
legacyId: 543
---

<div class="arcaea-article" style="font-family: 'Segoe UI', 'Noto Sans SC', sans-serif; line-height: 1.8; color: #333; max-width: 960px; margin: 0 auto; padding: 20px; background: #fafafa; border: 1px solid #e0e0e0; border-radius: 8px;">
<h2>一、参数描述表驱动读写 (Descriptor-Driven Access)</h2>
<p>运行时参数框架采用参数描述表（<code>rcfg_param_descriptor_t</code>）驱动所有参数的读写操作。每个参数通过唯一的 ID 进行索引，描述表记录了参数在结构体中的偏移量（offset）、位宽（width）、取值范围（min/max）以及默认值。读写接口通过 ID → descriptor → struct offset 的映射实现 O(1) 访问，避免了冗长的 switch-case 或 if-else 链。</p>
<div class="arcaea-mermaid-box"><pre class="mermaid">flowchart LR
    subgraph DESC[参数描述表]
        D1[ID / 偏移 / 位宽]
        D2[取值范围 / 默认值]
    end
    subgraph RW[读写接口]
        R1[rcfg_read]
        R2[rcfg_write]
    end
    subgraph STORE[存储后端]
        S1[RAM 运行时]
        S2[EEPROM 持久化]
    end
    D1 --&gt; RW --&gt; STORE
    style DESC fill:transparent,stroke:#8dc7ff,color:#eaf4ff
    style RW fill:transparent,stroke:#8dc7ff,color:#eaf4ff
    style STORE fill:transparent,stroke:#8dc7ff,color:#eaf4ff</pre></div>
<p>核心数据结构：</p>
<pre><code class="language-c">typedef struct {
    uint16_t id;          // 参数 ID
    uint16_t offset;      // 在 packer_runtime_config_t 中的字节偏移
    uint8_t  width;       // 位宽（0 表示已废弃/只读）
    int32_t  min;         // 最小值
    int32_t  max;         // 最大值
    int32_t  def;         // 默认值
    uint8_t  flags;       // 属性标志位
} rcfg_param_descriptor_t;</code></pre>
<p>所有与 HMI 或协议层的交互均通过统一的 <code>rcfg_get_param()</code> / <code>rcfg_set_param()</code> 接口完成，读写逻辑与具体业务解耦。</p>
<h2>二、EEPROM 持久化与写保护策略</h2>
<p>参数持久化采用 I²C EEPROM（24LC64 或兼容型号），存储布局包含魔法数、版本号、CRC16 校验和及参数数据块。写入操作采用"手动保存"策略——调用 <code>rcfg_set_param()</code> 仅修改内存中的缓存，必须显式调用 <code>rcfg_save_to_eeprom()</code> 才会触发 EEPROM 写入，从而避免频繁写入导致 EEPROM 寿命耗尽（典型 endurance 为 1,000,000 次）。</p>
<p>EEPROM 存储布局：</p>
<pre><code class="language-text">// EEPROM 布局（地址从 0 开始）
// +--------+---------+-------+----------+------+
// | Magic  | Version | CRC16 | Reserved | Data |
// | (2 B)  |  (2 B)  | (2 B) | (2 B)    |  N B |
// +--------+---------+-------+----------+------+
// Magic   = 0x5AA5
// Version = 0x000D (当前版本)
// CRC16   = CRC16-Modbus over data area only
// Reserved= 0x0000</code></pre>
<p>加载流程的三重校验：读取后依次校验 Magic → Version → CRC16，任一校验失败则回退到编译期默认值（不自动回写 EEPROM，避免写入损坏数据）。</p>
<hr style="border: none; border-top: 2px solid #d4a017; margin: 30px 0;">
<h2>三、描述表设计：O(1) 参数访问</h2>
<p><code>rcfg_param_descriptor_t</code> 结构体是参数访问的核心元数据。每个活跃参数在编译期生成一个描述符条目，构成全局描述符表。40+ 个活跃参数通过 ID 线性索引描述表，每条记录直接映射到 <code>packer_runtime_config_t</code> 结构体的内存偏移，实现 O(1) 随机访问。</p>
<pre><code class="language-c">// 描述符结构体原型
typedef struct {
    uint16_t id;          // 参数 ID，0..RCFG_PARAM_COUNT-1
    uint16_t offset;      // packer_runtime_config_t 中的字节偏移
    uint8_t  width;       // 位宽（字节）；width=0 标识已移除或废弃的参数
    int32_t  min;         // 最小值（含）
    int32_t  max;         // 最大值（含）
    int32_t  def;         // 出厂默认值
    uint8_t  flags;       // 位标志：只读、隐藏、需重启生效等
} rcfg_param_descriptor_t;

// 访问流程（伪代码）
int32_t rcfg_get_param(uint16_t id) {
    const rcfg_param_descriptor_t *desc = &s_param_descriptors[id];
    if (desc->width == 0) return 0;  // 已废弃参数
    uint8_t *base = (uint8_t *)&s_runtime_config;
    int32_t val = 0;
    memcpy(&val, base + desc->offset, desc->width);
    return val;
}</code></pre>
<p><strong>已移除/废弃参数处理</strong>：当某参数因功能迭代被移除时，其描述符条目保留在表中但 <code>width</code> 设为 0。get 操作返回 0，set 操作返回错误码 <code>RCFG_ERR_OBSOLETE</code>。这样既保证 ID 不重排（避免协议层兼容性问题），又明确标识废弃状态。</p>
<h2>四、EEPROM 持久化三重校验</h2>
<p>EEPROM 存储区布局：</p>
<pre><code class="language-text">// EEPROM 地址映射
// 0x0000: Magic         (uint16_t) = 0x5AA5
// 0x0002: Version        (uint16_t) = 0x000D
// 0x0004: CRC16          (uint16_t) = CRC16-Modbus of Data
// 0x0006: Reserved       (uint16_t) = 0x0000
// 0x0008: Data           (N bytes)  = packer_runtime_config_t</code></pre>
<p><strong>三重校验加载流程</strong>：</p>
<pre><code class="language-c">rcfg_load_status_t rcfg_load_from_eeprom(void) {
    // 第一重：Magic 校验
    uint16_t magic = eeprom_read16(EEPROM_ADDR_MAGIC);
    if (magic != EEPROM_MAGIC_0x5AA5) {
        LOG_WRN("EEPROM magic mismatch: 0x%04X", magic);
        return RCFG_LOAD_FALLBACK_DEFAULTS;
    }
    // 第二重：Version 校验
    uint16_t version = eeprom_read16(EEPROM_ADDR_VERSION);
    if (version != EEPROM_CURRENT_VERSION) {
        LOG_WRN("EEPROM version mismatch: 0x%04X", version);
        return rcfg_migrate_from_version(version);
    }
    // 第三重：CRC16 校验
    uint16_t stored_crc = eeprom_read16(EEPROM_ADDR_CRC);
    uint16_t calc_crc = crc16_modbus(
        eeprom_data_ptr(EEPROM_ADDR_DATA),
        sizeof(packer_runtime_config_t)
    );
    if (stored_crc != calc_crc) {
        LOG_WRN("EEPROM CRC mismatch: stored=0x%04X calc=0x%04X",
                stored_crc, calc_crc);
        return RCFG_LOAD_FALLBACK_DEFAULTS;
    }
    // 全部通过 → 加载数据
    eeprom_read(EEPROM_ADDR_DATA, &s_runtime_config,
                sizeof(packer_runtime_config_t));
    return RCFG_LOAD_OK;
}</code></pre>
<p>任何一重校验失败都回退到编译期默认值，<strong>不写回</strong> EEPROM（避免将损坏数据覆盖回存储介质）。CRC16-Modbus 仅覆盖 Data 区域（不含 Magic、Version、CRC 自身及 Reserved 字段）。</p>
<h2>五、旧版本兼容迁移</h2>
<p>当 EEPROM 中存储的版本号低于当前版本时，<code>rcfg_migrate_from_version()</code> 负责将旧版数据升级到新版格式。迁移按版本号顺序链式执行。</p>
<h3>0x000B → 0x000C：heater_pwm_duty 精度提升</h3>
<p>heater_pwm_duty 从 0-100（百分比，整数）迁移到 0-200（千分比 ×10，即 0.0‰–200.0‰）。</p>
<pre><code class="language-c">static void migrate_0x000B_to_0x000C(packer_runtime_config_t *cfg) {
    // 旧版：heater_pwm_duty = 0..100 (percent)
    // 新版：heater_pwm_duty = 0..200 (per-mille * 10, i.e. 0.0‰..200.0‰)
    int32_t old_val = cfg->legacy.heater_pwm_duty;  // 0..100
    cfg->heater_pwm_duty = old_val * 2;              // 0..200
    LOG_INF("Migrated heater_pwm_duty: %d → %d", old_val, cfg->heater_pwm_duty);
}</code></pre>
<h3>0x000C → 0x000D：tear_off_len_mm_x1000 字段补充</h3>
<p>0x000C 版本缺少 tear_off_len_mm_x1000 字段。迁移时通过旧结构体镜像（legacy struct mirror）读取旧布局，将缺失字段设为默认值后重新保存。</p>
<pre><code class="language-c">// 旧版结构体镜像（0x000C 布局）
typedef struct __attribute__((packed)) {
    // ... 所有 0x000C 版本的字段 ...
    uint8_t  leg_puller_duty;       // 旧版同位置字段
    // 注：tear_off_len_mm_x1000 在 0x000C 中不存在
    uint16_t heater_pwm_duty;       // 已迁移
    // ...
} packer_runtime_config_0x000C_t;

static void migrate_0x000C_to_0x000D(packer_runtime_config_t *cfg) {
    packer_runtime_config_0x000C_t old;
    memcpy(&old, cfg, sizeof(old));  // 从当前结构体读取旧版数据

    // 填充缺失字段的默认值
    cfg->tear_off_len_mm_x1000 = TEAR_OFF_LEN_DEFAULT_MM_X1000;
    LOG_INF("Migrated tear_off_len_mm_x1000 ← default (%d)",
            cfg->tear_off_len_mm_x1000);
}</code></pre>
<p><strong>迁移模式总结</strong>：每个版本升级对应一个独立的迁移函数，按版本号顺序依次调用。迁移仅操作内存中的数据，最终由上层决定是否写回 EEPROM。</p>
<h2>六、参数清洗与范围钳位</h2>
<p>每次加载完成或初始化后，调用 <code>rcfg_sanitize_config()</code> 遍历<strong>所有活跃参数</strong>，将超出 [min, max] 范围的值钳位到边界值。每个钳位操作记录一条 WRN 级别日志，便于调试和审计。</p>
<pre><code class="language-c">void rcfg_sanitize_config(void) {
    for (int i = 0; i < RCFG_PARAM_ACTIVE_COUNT; i++) {
        const rcfg_param_descriptor_t *desc = &s_param_descriptors[i];
        if (desc->width == 0) continue;  // 跳过废弃参数

        int32_t val = rcfg_get_param(desc->id);
        int32_t clamped = val;

        if (val < desc->min) {
            clamped = desc->min;
            LOG_WRN("Param[%d] %s clamped: %d → %d (min=%d)",
                    desc->id, desc->name, val, clamped, desc->min);
        } else if (val > desc->max) {
            clamped = desc->max;
            LOG_WRN("Param[%d] %s clamped: %d → %d (max=%d)",
                    desc->id, desc->name, val, clamped, desc->max);
        }

        if (clamped != val) {
            rcfg_set_param(desc->id, clamped);
        }
    }
}</code></pre>
<p><code>rcfg_sanitize_config()</code> 在以下时机被调用：</p>
<ul>
<li>系统上电初始化（从 EEPROM 加载后）</li>
<li>EEPROM 校验失败回退到默认值后</li>
<li>版本迁移完成后</li>
<li>外部协议批量设置参数后</li>
</ul>
<h2>七、惰性派生缓存刷新</h2>
<p>为避免每次读取派生值都重新计算，框架采用<strong>脏标志（dirty flag）</strong>机制实现惰性刷新。</p>
<pre><code class="language-c">// ===== 脏标志管理 =====
static bool s_derived_dirty = true;

void packer_runtime_config_mark_derived_dirty(void) {
    s_derived_dirty = true;
}

void packer_runtime_config_refresh_derived_if_needed(void) {
    if (!s_derived_dirty) return;

    // 重新初始化派生模块
    bag_runtime_config_init(&s_bag_config, &s_runtime_config);
    press_runtime_config_init(&s_press_config, &s_runtime_config);

    s_derived_dirty = false;
}

// ===== 应用入口 =====
// 每次写入基本参数时标记脏标志
rcfg_status_t rcfg_set_param(uint16_t id, int32_t value) {
    // ... 写入逻辑 ...
    packer_runtime_config_mark_derived_dirty();
    return RCFG_OK;
}

// 每次读取派生参数前检查是否需要刷新
int32_t rcfg_get_bag_param(uint16_t param_id) {
    packer_runtime_config_refresh_derived_if_needed();
    return bag_runtime_config_get(&s_bag_config, param_id);
}</code></pre>
<p><strong>触发 dirty 的场景</strong>：任何基本参数（袋长、速度、压杆延时等）通过 <code>rcfg_set_param()</code> 写入时，自动调用 <code>mark_derived_dirty()</code>。下次读取派生参数时触发一次性刷新，避免冗余重复计算。</p>
<h2>八、自描述元数据表</h2>
<p>框架维护两套自描述元数据表，使 HMI 能够动态渲染参数页面，无需 HMI 侧硬编码参数列表。</p>
<pre><code class="language-text">// 分组元数据（7 组）
static const rcfg_group_catalog_t s_group_catalog[7] = {
    { .id = 0, .name_zh = "基础参数",   .name_en = "Basic" },
    { .id = 1, .name_zh = "袋长参数",   .name_en = "Bag Length" },
    { .id = 2, .name_zh = "压杆参数",   .name_en = "Press Bar" },
    { .id = 3, .name_zh = "加热参数",   .name_en = "Heating" },
    { .id = 4, .name_zh = "送膜参数",   .name_en = "Film Feed" },
    { .id = 5, .name_zh = "拉链参数",   .name_en = "Zipper" },
    { .id = 6, .name_zh = "系统参数",   .name_en = "System" },
};

// 参数元数据（38 个）
static const rcfg_param_catalog_t s_param_catalog[38] = {
    { .id = 0,  .group = 0, .name_zh = "运行速度",     .name_en = "Speed",
      .exp = 2,  .min = 0,    .max = 5000,  .step = 1,   .def = 1000 },
    { .id = 1,  .group = 0, .name_zh = "加速度",       .name_en = "Accel",
      .exp = 0,  .min = 1,    .max = 100,   .step = 1,   .def = 20 },
    // ... 其余 36 个参数类似 ...
};</code></pre>
<p>元数据字段说明：</p>
<ul>
<li><code>exp</code> (scaling exponent)：十进制幂指数，实际值 = 整数值 / 10^exp。例如 exp=2 时存储值 12345 表示 123.45。</li>
<li><code>min</code> / <code>max</code>：存储值范围。</li>
<li><code>step</code>：HMI 步进调整的增量。</li>
<li><code>def</code>：出厂默认值。</li>
</ul>
<p>HMI 通过 HMIS 协议请求参数目录，框架返回 <code>s_group_catalog</code> 和 <code>s_param_catalog</code>，HMI 据此动态构建参数编辑页面，无需固件升级即可适配新增参数。</p>
<h2>九、派生模块：袋长换算</h2>
<p>袋长换算模块将用户设置的袋长（mm）转换为伺服电机所需的脉冲数，同时将运行速度（bags/min）转换为电机频率（Hz）。</p>
<p><strong>核心换算公式</strong>：</p>
<pre><code class="language-c">// ===== 编译期常量 =====
#define PULLEY_DRIVEN_TEETH   48   // 从动轮齿数
#define PULLEY_DRIVE_TEETH    24   // 主动轮齿数
#define ROLLER_DIAMETER_MM    40   // 辊筒直径 (mm)
#define PPR                  4096  // 伺服编码器线数

// ===== 脉冲数换算 =====
// 袋长（mm）→ 伺服脉冲数
// pulses = len × ppr × driven_teeth / (roller_diameter × drive_teeth × π)
static int32_t calc_bag_len_pulses(int32_t len_mm) {
    // 使用定点数运算避免浮点
    // pulses = len * PPR * PULLEY_DRIVEN_TEETH * 1000
    //        / (ROLLER_DIAMETER_MM * PULLEY_DRIVE_TEETH * 3141)
    // (π ≈ 3.141，放大 1000 倍为 3141)
    int64_t numerator   = (int64_t)len_mm * PPR * PULLEY_DRIVEN_TEETH * 1000;
    int64_t denominator = (int64_t)ROLLER_DIAMETER_MM * PULLEY_DRIVE_TEETH * 3141;
    return (int32_t)(numerator / denominator);
}

// ===== 速度换算 =====
// 速度（bags/min）→ 电机频率（Hz）
// speed_hz = speed × pulses / 60
static int32_t calc_speed_hz(int32_t speed_bpm, int32_t pulses_per_bag) {
    return (speed_bpm * pulses_per_bag) / 60;
}</code></pre>
<p>袋长模块通过 <code>bag_runtime_config_refresh()</code> 在派生缓存刷新时重新计算脉冲数和频率，供运动控制模块直接使用。</p>
<h2>十、派生模块：压杆脉冲换算</h2>
<p>压杆模块沿用与袋长相同的换算内核，但使用同步压轮节距（<code>sync_pulley_pd</code>）替代辊筒直径。</p>
<pre><code class="language-c">// ===== 压杆专用常量 =====
#define SYNC_PULLEY_PD_MM     30   // 同步压轮节距 (mm)
#define PRESS_PULLEY_DRIVEN   24   // 压杆从动轮齿数
#define PRESS_PULLEY_DRIVE    12   // 压杆主动轮齿数

// ===== 压杆脉冲换算 =====
// 与袋长公式相同结构，仅 roller_diameter → sync_pulley_pd
static int32_t press_len_to_pulses(int32_t len_mm) {
    int64_t numerator   = (int64_t)len_mm * PPR * PRESS_PULLEY_DRIVEN * 1000;
    int64_t denominator = (int64_t)SYNC_PULLEY_PD_MM * PRESS_PULLEY_DRIVE * 3141;
    return (int32_t)(numerator / denominator);
}

// ===== 便利封装 =====
int32_t calc_retract_pulses(void) {
    // 压杆回缩脉冲 = 压杆回缩长度 → 脉冲
    int32_t retract_len = bag_runtime_config_get_retract_len();
    return press_len_to_pulses(retract_len);
}

int32_t calc_open_return_pulses(void) {
    // 压杆张开返回脉冲 = 压杆张开长度 → 脉冲
    int32_t open_return_len = bag_runtime_config_get_open_return_len();
    return press_len_to_pulses(open_return_len);
}</code></pre>
<p>便利封装函数屏蔽了内部换算细节，运动控制模块只需调用 <code>calc_retract_pulses()</code> 和 <code>calc_open_return_pulses()</code> 即可获得脉冲目标值。</p>
<h2>十一、全模块数据流</h2>
<p>下图展示了运行时参数框架的数据流：基本参数（由 HMI/协议写入）经过派生缓存层，在脏标志控制下按需刷新，最终供各执行模块使用。</p>
<pre><code class="language-text">┌──────────────────────────┐
                    │     HMI / HMIS 协议       │
                    │  (rcfg_set_param)         │
                    └───────────┬──────────────┘
                                │
                                ▼
                    ┌──────────────────────────┐
                    │   packer_runtime_config_t │
                    │   (核心基本参数结构体)      │
                    │   offset/width 描述表驱动  │
                    └───────────┬──────────────┘
                                │ rcfg_set_param()
                                │ mark_derived_dirty()
                                ▼
                    ┌──────────────────────────┐
                    │   脏标志检查门控           │
                    │  is_derived_dirty?        │
                    └───────┬─────────┬────────┘
                            │ YES     │ NO
                            ▼         ▼
                    ┌──────────┐  ┌──────────┐
                    │ 刷新派生  │  │ 直接返回  │
                    │ 缓存      │  │ 缓存值    │
                    └────┬─────┘  └──────────┘
                         │
              ┌──────────┴──────────┐
              ▼                     ▼
    ┌──────────────────┐  ┌──────────────────┐
    │ bag_runtime_config│  │press_runtime_cfg │
    │ - pulses_per_bag │  │ - retract_pulses │
    │ - speed_hz       │  │ - open_pulses    │
    │ - ...            │  │ - ...            │
    └────────┬─────────┘  └────────┬─────────┘
             │                     │
             ▼                     ▼
    ┌─────────────────────────────────────────┐
    │     运动控制 / 执行模块                   │
    │  (伺服驱动、加热控制、送膜、拉链等)        │
    └─────────────────────────────────────────┘</code></pre>
<p><strong>数据流说明</strong>：</p>
<ol>
<li>HMI 或通信协议通过 <code>rcfg_set_param()</code> 写入基本参数，写入后自动标记脏标志。</li>
<li>执行模块读取派生参数时，脏标志门控检查是否需要刷新缓存。</li>
<li>需要刷新时，<code>bag_runtime_config_refresh()</code> 和 <code>press_runtime_config_refresh()</code> 从核心参数重新计算所有派生值。</li>
<li>无需刷新时，直接从缓存读取，避免重复计算开销。</li>
</ol>
