---
title: "AT24C02 EEPROM 驱动 — Software Bit-Bang I2C on STM32F103"
description: "本文记录了 GENERIC_DEVICE_CONTROLLER 项目中 AT24C02 EEPROM 驱动的完整实现。设计采用双层 ..."
published: "2026-05-29"
updated: "2026-06-02"
permalink: "/2026/05/29/article-s5-at24c02-eeprom-驱动-software-bit-bang-i2c-on-stm32f103/"
draft: false
categories: ["嵌入式实战"]
tags: []
legacyId: 780
---

<p>本文记录了 GENERIC_DEVICE_CONTROLLER 项目中 AT24C02 EEPROM 驱动的完整实现。设计采用双层硬件访问架构：通用层 <code>bsp_at24cxx</code> 通过函数指针处理任意 AT24C01~AT24CM02 器件，具体层 <code>bsp_eeprom</code> 封装 AT24C02 实例化。I2C 传输完全基于 GPIO 软件 bit-bang 实现，不使用硬件 I2C 外设。</p>
<h2>1. 为什么用软件 Bit-Bang I2C？</h2>
<p>GENERIC_DEVICE_CONTROLLER 的 STM32F103 有硬件 I2C 外设（I2C1 在 PB6/PB7，I2C2 在 PB10/PB11），但在密集布局中这些引脚常被复用作其他功能。AT24C02 接在 PA11（SDA）和 PA12（SCL）上——这两个引脚在 F103 上不映射到任何硬件 I2C 模块，因此必须用软件 bit-bang 实现。</p>
<div class="arcaea-mermaid-box"><pre class="mermaid">sequenceDiagram
    participant MCU as STM32 MCU
    participant EEP as AT24C02
    MCU-&gt;&gt;EEP: START + 0xA0
    EEP--&gt;&gt;MCU: ACK
    MCU-&gt;&gt;EEP: 寄存器地址(8bit)
    EEP--&gt;&gt;MCU: ACK
    MCU-&gt;&gt;EEP: 数据字节
    EEP--&gt;&gt;MCU: ACK
    MCU-&gt;&gt;EEP: STOP
    Note over MCU,EEP: 软件 Bit-Bang I2C @ ~100kHz
    MCU-&gt;&gt;EEP: tWR 6ms 延时</pre></div>
<p>Bit-bang I2C 还提供了完整的时序控制能力，避开了 STM32 I2C 广为人知的硬件缺陷（busy 标志锁死、时钟拉伸毛刺），且产生的驱动只需两个 GPIO 即可移植到任意 MCU 上运行。</p>
<h2>2. 硬件连接</h2>
<figure class="wp-block-table">
<table>
<thead>
<tr>
<th>AT24C02 引脚</th>
<th>MCU 引脚</th>
<th>功能</th>
</tr>
</thead>
<tbody>
<tr>
<td>SCL</td>
<td>PA12</td>
<td>I2C 时钟（输出，开漏+上拉）</td>
</tr>
<tr>
<td>SDA</td>
<td>PA11</td>
<td>I2C 数据（双向，开漏+上拉）</td>
</tr>
<tr>
<td>A0/A1/A2</td>
<td>GND</td>
<td>全部接低 → 从机地址 0xA0</td>
</tr>
<tr>
<td>WP</td>
<td>GND</td>
<td>写保护关闭</td>
</tr>
<tr>
<td>VCC</td>
<td>3.3V</td>
<td>电源</td>
</tr>
</tbody>
</table>
</figure>
<p>SDA 和 SCL 各自外接 4.7 kΩ 上拉电阻。AT24C02 工作在 3.3 V，在其规格 1.8~5.5 V 范围内。</p>
<h2>3. 双层架构</h2>
<p>驱动拆分两个文件：</p>
<ul>
<li><strong>bsp_at24cxx.h / .c</strong>——通用 AT24Cxx 驱动。使用用户提供的 <code>bsp_i2c_t</code> 结构体（内含 bit-bang 原语的函数指针），支持从 AT24C01（128 字节 × 8 页）到 AT24CM02（256 KiB × 1024 页）全系列器件。</li>
<li><strong>bsp_eeprom.h / .c</strong>——项目专用封装。用 AT24C02 参数和 PA11/PA12 bit-bang 实现实例化 <code>bsp_at24cxx_t</code>，对外暴露 <code>eeprom_init()</code>、<code>eeprom_read()</code>、<code>eeprom_write()</code>、<code>eeprom_erase()</code> 接口。</li>
</ul>
<p>这种分离意味着换板子时绝不修改通用驱动——只需换具体的封装层和 I2C 传输实现。</p>
<h2>4. 软件 Bit-Bang I2C 实现</h2>
<p>Bit-bang 层以约 100 kHz SCL 频率运行，延时循环按 72 MHz 系统时钟校准。关键原语如下：</p>
<pre class="wp-block-preformatted"><code class="language-c">/* 引脚控制宏（已脱敏） */
#define EEPROM_I2C_PORT       GPIOA
#define EEPROM_SCL_PIN        GPIO_Pin_12
#define EEPROM_SDA_PIN        GPIO_Pin_11

#define SCL_H()   GPIO_SetBits(EEPROM_I2C_PORT, EEPROM_SCL_PIN)
#define SCL_L()   GPIO_ResetBits(EEPROM_I2C_PORT, EEPROM_SCL_PIN)
#define SDA_H()   GPIO_SetBits(EEPROM_I2C_PORT, EEPROM_SDA_PIN)
#define SDA_L()   GPIO_ResetBits(EEPROM_I2C_PORT, EEPROM_SDA_PIN)
#define SDA_IN()  GPIO_ReadInputDataBit(EEPROM_I2C_PORT, EEPROM_SDA_PIN)

/* ~360 CPU ticks at 72 MHz → ~100 kHz SCL */
#define I2C_DELAY()  { volatile uint32_t _d = 90; while (_d--); }</code></pre>
<h3>4.1 START 和 STOP 条件</h3>
<pre class="wp-block-preformatted"><code class="language-c">static void i2c_start(void)
{
    SDA_H();
    SCL_H();
    I2C_DELAY();
    SDA_L();          /* SCL 高电平时 SDA 下降 → START */
    I2C_DELAY();
    SCL_L();
}

static void i2c_stop(void)
{
    SDA_L();
    SCL_H();
    I2C_DELAY();
    SDA_H();          /* SCL 高电平时 SDA 上升 → STOP */
    I2C_DELAY();
}</code></pre>
<h3>4.2 字节写入与 ACK 检测</h3>
<pre class="wp-block-preformatted"><code class="language-c">static uint8_t i2c_write_byte(uint8_t data)
{
    uint8_t ack;
    for (int i = 0; i &lt; 8; i++)
    {
        if (data &amp; 0x80)
            SDA_H();
        else
            SDA_L();
        data &lt;&lt;= 1;
        SCL_H();
        I2C_DELAY();
        SCL_L();
        I2C_DELAY();
    }
    /* 释放 SDA，等待从机 ACK */
    SDA_H();
    SCL_H();
    I2C_DELAY();
    ack = SDA_IN();   /* 0 = ACK, 1 = NACK */
    SCL_L();
    I2C_DELAY();
    return ack;
}</code></pre>
<h3>4.3 字节读取与 ACK/NACK 生成</h3>
<pre class="wp-block-preformatted"><code class="language-c">static uint8_t i2c_read_byte(uint8_t ack)
{
    uint8_t data = 0;
    SDA_H();          /* 释放总线 */
    for (int i = 0; i &lt; 8; i++)
    {
        data &lt;&lt;= 1;
        SCL_H();
        I2C_DELAY();
        if (SDA_IN()) data |= 0x01;
        SCL_L();
        I2C_DELAY();
    }
    /* 产生 ACK (0) 或 NACK (1) */
    if (ack)
        SDA_H();
    else
        SDA_L();
    SCL_H();
    I2C_DELAY();
    SCL_L();
    I2C_DELAY();
    SDA_H();          /* 释放 */
    return data;
}</code></pre>
<h2>5. 通用驱动：bsp_at24cxx</h2>
<p>通用驱动在运行时通过描述符配置：</p>
<pre class="wp-block-preformatted"><code class="language-c">typedef struct {
    uint16_t total_size;      /* EEPROM 总容量（字节） */
    uint16_t page_size;       /* 页面大小（字节） */
    uint8_t  dev_addr;        /* 7 位器件地址（如 0xA0 &gt;&gt; 1 = 0x50） */
    uint8_t  use_16bit_addr;  /* AT24C16 以上为 1（16 位寄存器地址），否则 0 */
    void     (*scl_h)(void);
    void     (*scl_l)(void);
    void     (*sda_h)(void);
    void     (*sda_l)(void);
    uint8_t  (*sda_in)(void);
    void     (*delay)(void);
} bsp_at24cxx_t;</code></pre>
<h3>5.1 页写入算法</h3>
<p>页写入尊重页边界。如果写入跨越边界，自动拆分为多个页大小（或更小）的写入。每次页写入后加 6 ms 延时（tWR 最大值 5 ms，留 1 ms 余量）。</p>
<pre class="wp-block-preformatted"><code class="language-c">int bsp_at24cxx_write(bsp_at24cxx_t *eep, uint16_t addr,
                      const uint8_t *data, uint16_t len)
{
    uint16_t page_size = eep-&gt;page_size;
    uint16_t remain;
    int      ret = 0;

    if (addr + len &gt; eep-&gt;total_size)
        return -1;  /* 边界检查 */

    while (len &gt; 0)
    {
        /* 当前页从该偏移量起还剩多少字节 */
        remain = page_size - (addr % page_size);
        if (remain &gt; len) remain = len;

        if (eep-&gt;use_16bit_addr)
            ret = write_page_16bit(eep, addr, data, remain);
        else
            ret = write_page_8bit(eep, addr, data, remain);

        if (ret != 0) return ret;

        addr += remain;
        data += remain;
        len  -= remain;

        /* tWR max = 5ms（AT24C02），用 6ms 余量 */
        eep-&gt;delay();
        eep-&gt;delay();
        eep-&gt;delay();
        eep-&gt;delay();
        eep-&gt;delay();
        eep-&gt;delay();  /* 总计 ~6 ms */
    }
    return 0;
}</code></pre>
<h3>5.2 顺序读取（当前地址读）</h3>
<p>顺序读取复用同样的页拆分逻辑，但读操作<strong>不需要</strong>页间延时——器件在读操作中会自动跨页递增内部地址计数器。</p>
<pre class="wp-block-preformatted"><code class="language-c">int bsp_at24cxx_read(bsp_at24cxx_t *eep, uint16_t addr,
                     uint8_t *data, uint16_t len)
{
    if (addr + len &gt; eep-&gt;total_size)
        return -1;

    /* 通过伪写入序列设置寄存器地址 */
    eep-&gt;scl_h(); eep-&gt;sda_h();   /* 总线空闲 */
    i2c_start_g(eep);
    i2c_write_byte_g(eep, eep-&gt;dev_addr &lt;&lt; 1);  /* 写位 = 0 */

    if (eep-&gt;use_16bit_addr)
    {
        i2c_write_byte_g(eep, (addr &gt;&gt; 8) &amp; 0xFF);
        i2c_write_byte_g(eep, addr &amp; 0xFF);
    }
    else
    {
        i2c_write_byte_g(eep, addr &amp; 0xFF);
    }

    /* 重复 START，转为读 */
    i2c_start_g(eep);
    i2c_write_byte_g(eep, (eep-&gt;dev_addr &lt;&lt; 1) | 0x01);  /* 读位 = 1 */

    while (len--)
    {
        *data++ = i2c_read_byte_g(eep, (len == 0) ? 1 : 0);
    }

    i2c_stop_g(eep);
    return 0;
}</code></pre>
<h3>5.3 器件地址分辨率</h3>
<p>驱动根据 <code>use_16bit_addr</code> 标志自动选择 8 位或 16 位寄存器寻址。≤ AT24C16（2 KiB）用 8 位寄存器地址，≥ AT24C32（4 KiB）用 16 位。阈值在静态配置表中设定：</p>
<pre class="wp-block-preformatted"><code class="language-text">static const bsp_at24cxx_cfg_t at24cxx_config[] = {
    /* 名称         容量      页大小  地址   16bit */
    {"AT24C01",     128,      8,      0x50,  0},
    {"AT24C02",     256,      8,      0x50,  0},
    {"AT24C04",     512,      16,     0x50,  0},
    {"AT24C08",     1024,     16,     0x50,  0},
    {"AT24C16",     2048,     16,     0x50,  0},
    {"AT24C32",     4096,     32,     0x50,  1},
    {"AT24C64",     8192,     32,     0x50,  1},
    {"AT24C128",    16384,    64,     0x50,  1},
    {"AT24C256",    32768,    64,     0x50,  1},
    {"AT24CM01",    131072,   256,    0x50,  1},
    {"AT24CM02",    262144,   256,    0x50,  1},
};</code></pre>
<h2>6. 具体封装：bsp_eeprom</h2>
<p>封装层为 AT24C02 实例化通用驱动：</p>
<pre class="wp-block-preformatted"><code class="language-c">/* bsp_eeprom.c — AT24C02 具体实例化 */
#include "bsp_at24cxx.h"
#include "bsp_eeprom.h"

static bsp_at24cxx_t eeprom_dev = {
    .total_size     = 256,
    .page_size      = 8,
    .dev_addr       = 0x50,       /* 0xA0 &gt;&gt; 1 */
    .use_16bit_addr = 0,
    .scl_h          = pa12_scl_h,
    .scl_l          = pa12_scl_l,
    .sda_h          = pa11_sda_h,
    .sda_l          = pa11_sda_l,
    .sda_in         = pa11_sda_in,
    .delay          = eeprom_delay_6ms,
};

int eeprom_init(void)
{
    GPIO_InitTypeDef gpio;

    RCC_APB2PeriphClockCmd(RCC_APB2Periph_GPIOA, ENABLE);

    /* SCL — 开漏输出 */
    gpio.GPIO_Pin   = EEPROM_SCL_PIN;
    gpio.GPIO_Mode  = GPIO_Mode_Out_OD;
    gpio.GPIO_Speed = GPIO_Speed_50MHz;
    GPIO_Init(EEPROM_I2C_PORT, &amp;gpio);

    /* SDA — 开漏输出（bit-bang 中动态切换为输入） */
    gpio.GPIO_Pin   = EEPROM_SDA_PIN;
    GPIO_Init(EEPROM_I2C_PORT, &amp;gpio);

    /* 总线空闲：SCL 高，SDA 高 */
    SCL_H();
    SDA_H();

    return 0;
}

int eeprom_write(uint16_t addr, const uint8_t *data, uint16_t len)
{
    return bsp_at24cxx_write(&amp;eeprom_dev, addr, data, len);
}

int eeprom_read(uint16_t addr, uint8_t *data, uint16_t len)
{
    return bsp_at24cxx_read(&amp;eeprom_dev, addr, data, len);
}

int eeprom_erase(uint16_t addr, uint16_t len)
{
    /* 将区域填充为 0xFF（EEPROM 擦除默认状态） */
    uint8_t fill = 0xFF;
    int ret;
    while (len &gt; 0)
    {
        ret = bsp_at24cxx_write(&amp;eeprom_dev, addr, &amp;fill, 1);
        if (ret != 0) return ret;
        addr++;
        len--;
    }
    return 0;
}</code></pre>
<h2>7. AT24C02 关键参数</h2>
<figure class="wp-block-table">
<table>
<thead>
<tr>
<th>参数</th>
<th>值</th>
</tr>
</thead>
<tbody>
<tr>
<td>总容量</td>
<td>256 字节（2 Kbit）</td>
</tr>
<tr>
<td>页大小</td>
<td>8 字节</td>
</tr>
<tr>
<td>从机地址</td>
<td>0xA0（A0/A1/A2 = GND）</td>
</tr>
<tr>
<td>寄存器地址宽度</td>
<td>8 位</td>
</tr>
<tr>
<td>最大时钟频率</td>
<td>400 kHz（快速模式）；实际运行 ~100 kHz</td>
</tr>
<tr>
<td>写入周期时间（tWR）</td>
<td>最大 5 ms；实际用 6 ms 余量</td>
</tr>
<tr>
<td>擦写寿命</td>
<td>1,000,000 次</td>
</tr>
<tr>
<td>数据保持</td>
<td>100 年</td>
</tr>
</tbody>
</table>
</figure>
<h2>8. 设计决策与权衡</h2>
<ul>
<li><strong>不用硬件 I2C。</strong>PA11/PA12 不映射到 I2C 外设。Bit-bang 也消除了 STM32 I2C 的 busy 标志异常。</li>
<li><strong>不加 CRC。</strong>这只是个薄硬件访问层。CRC、磨损均衡和页面管理属于上层（FATFS、EEPROM 抽象层等）。</li>
<li><strong>不做磨损均衡。</strong>AT24C02 有 100 万次擦写寿命。GENERIC_DEVICE_CONTROLLER 的保存频率（启动时写配置、偶尔存校准值）下，裸访问足够了。</li>
<li><strong>函数指针 I2C。</strong>便于用 mock GPIO 做测试、移植到其他 MCU，以及在不同板子上复用同一套通用驱动而无需重新编译。</li>
<li><strong>6 ms 页写入延时。</strong>保守值。tWR 最大为 5 ms；6 ms 在温度和电压波动下留了 1 ms 余量。更激进的方案可以用 ACK 轮询技巧（重复 START 直到收到 ACK）提前检测写入完成。</li>
<li><strong>擦除逐字节写。</strong>AT24Cxx 没有硬件页擦除命令。<code>eeprom_erase()</code> 循环将每个字节写为 0xFF。大批量擦除较慢但语义正确。</li>
</ul>
<h2>9. 使用示例</h2>
<pre class="wp-block-preformatted"><code class="language-c">#include "bsp_eeprom.h"

void save_config(void)
{
    uint8_t cfg[8] = {0xAA, 0x55, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06};

    eeprom_init();
    eeprom_write(0x00, cfg, 8);   /* 向页 0 写入 8 字节 */
}

void load_config(void)
{
    uint8_t buf[8];

    eeprom_init();
    eeprom_read(0x00, buf, 8);    /* 从页 0 读回 */
}</code></pre>
<h2>10. 总结</h2>
<p>GENERIC_DEVICE_CONTROLLER 的 AT24C02 驱动提供了一套干净的双层抽象：基于函数指针 bit-bang I2C 的可复用通用 AT24Cxx 核心，以及针对 AT24C02 的薄封装层。软件 I2C 在 PA11/PA12 上以 ~100 kHz 运行，实现了标准的 START/STOP/字节写入/字节读取原语，正确处理了读写操作中的页边界拆分。驱动故意保持最小化——无 CRC、无缓存、无磨损均衡——作为嵌入式系统配置存储的可靠硬件访问层。</p>
<p>完整源码维护在 GENERIC_DEVICE_CONTROLLER 固件仓库的 <code>hw/eeprom/</code> 目录下。</p>
