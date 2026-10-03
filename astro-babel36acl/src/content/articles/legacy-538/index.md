---
title: "软件 I2C + AT24C02 EEPROM：BSP 驱动的分层设计与时序实现"
description: "三层隔离：GPIO bit-bang 时序、AT24C02 芯片协议、统一接口。展示了 BSP 层设计的四个核心原则。"
published: "2026-05-28"
updated: "2026-08-18"
permalink: "/2026/05/28/soft-i2c-at24c02-bsp-layered-design/"
draft: false
categories: ["嵌入式实战"]
tags: ["ARCH"]
legacyId: 538
---

<div class="arcaea-wrap">
<p><span class="tag">嵌入式实战</span> <span class="tag">BSP驱动</span></p>
<p>EEPROM 驱动是展示 BSP 层设计原则的绝佳案例。它包含三个层次：比特级时序（软件 I2C）、芯片级协议（AT24C02）、模块级接口（bsp_eeprom）。上层只看到一个读/写/初始化三个函数的统一接口。</p>
<h2>第一层：软件 I2C Bit-Bang</h2>
<p>PA11(SDA) / PA12(SCL)，开漏输出，100kHz 软件时序。核心是一个 5μs 的延时循环：</p>
<pre><code class="language-c">// 72 MHz → 360 个空转 ≈ 5 μs → ~100 kHz SCL
#define SOFT_I2C_HALF_PERIOD_TICKS 360U

static void soft_i2c_delay(void) {
    volatile uint32_t i = SOFT_I2C_HALF_PERIOD_TICKS;
    while (i &gt; 0U) { i--; }
}</code></pre>
<div class="arcaea-table-wrap" data-bac-table-shell="1"><table>
<tr>
<th>原语</th>
<th>代码</th>
<th>说明</th>
</tr>
<tr>
<td>START</td>
<td>SDA 下降沿（SCL 高时）</td>
<td>i2c_start()</td>
</tr>
<tr>
<td>STOP</td>
<td>SDA 上升沿（SCL 高时）</td>
<td>i2c_stop()</td>
</tr>
<tr>
<td>写字节</td>
<td>MSB first，每位移完后拉高 SCL</td>
<td>i2c_write_byte()</td>
</tr>
<tr>
<td>读字节</td>
<td>释放 SDA，每位移入，SCL 脉冲</td>
<td>i2c_read_byte(ack)</td>
</tr>
<tr>
<td>ACK 检测</td>
<td>写完后释放 SDA，读第 9 个 SCL 脉冲的电平</td>
<td>i2c_write_byte 返回值</td>
</tr>
</table></div>
<pre><code class="language-c">// START 条件：SDA 在 SCL 高时拉低
static void i2c_start(void) {
    sda_set();                    // SDA 拉高
    scl_set();                    // SCL 拉高
    soft_i2c_delay();
    sda_clr();                    // SDA 拉低（START）
    soft_i2c_delay();
    scl_clr();                    // SCL 拉低（准备传输）
}

// 写一个字节，返回 ACK（0=应答，1=无应答）
static uint8_t i2c_write_byte(uint8_t byte) {
    for (int i = 0; i &lt; 8; i++) {
        if ((byte &amp; 0x80U) != 0U) sda_set();
        else                      sda_clr();
        scl_set();                // SCL 高 → 从机采样
        soft_i2c_delay();
        scl_clr();                // SCL 低 → 准备下一位
        byte = (uint8_t)(byte &lt;&lt; 1U);
    }
    sda_set();                    // 释放 SDA，从机发 ACK
    scl_set();
    uint8_t ack = (sda_read() == GPIO_PIN_RESET) ? 0U : 1U;
    scl_clr();
    return ack;
}</code></pre>
<h2>第二层：AT24C02 协议接入</h2>
<p>AT24C02 的设备地址固定为 0xA0（写）/ 0xA1（读）。256 字节容量，地址用 8 位，页写入粒度 8 字节：</p>
<pre><code class="language-c">// 随机读取：START + 写地址 + 寄存器地址 + START + 读地址 + 读数据 + STOP
static uint8_t soft_iic_read(uint8_t addr, uint8_t reg,
                              uint8_t *buf, uint16_t len) {
    i2c_start();
    if (i2c_write_byte(addr) != 0U) { i2c_stop(); return 1U; }  // 设备地址
    if (i2c_write_byte(reg) != 0U)  { i2c_stop(); return 1U; }  // 寄存器地址
    i2c_start();                     // 重复 START
    if (i2c_write_byte(addr | 0x01U) != 0U) { i2c_stop(); return 1U; }  // 读地址
    for (uint16_t i = 0; i &lt; len; i++) {
        buf[i] = i2c_read_byte((i &lt; len - 1) ? 1U : 0U);  // 最后一字节 NACK
    }
    i2c_stop();
    return 0U;
}</code></pre>
<h2>第三层：bsp_eeprom 统一接口</h2>
<pre><code class="language-c">typedef enum {
    BSP_EEPROM_STATUS_OK           = 0,
    BSP_EEPROM_STATUS_ERROR        = 1,
    BSP_EEPROM_STATUS_INVALID_ARG  = 2,
    BSP_EEPROM_STATUS_NOT_READY    = 3,
    BSP_EEPROM_STATUS_OUT_OF_RANGE = 4
} bsp_eeprom_status_t;

bsp_eeprom_status_t bsp_eeprom_init(void);
bsp_eeprom_status_t bsp_eeprom_deinit(void);
bsp_eeprom_status_t bsp_eeprom_read(uint16_t address, uint8_t *buf, uint16_t len);
bsp_eeprom_status_t bsp_eeprom_write(uint16_t address, const uint8_t *buf, uint16_t len);</code></pre>
<h2>BSP 接口设计原则（从本例看通用规则）</h2>
<p>这个 EEPROM 驱动展示了 BSP 层设计的四个核心原则：</p>
<p><strong>原则一：用枚举取代魔法数字</strong></p>
<pre><code class="language-text">// ❌ 坏味道
if (eeprom_write(addr, buf, len) != 0) { error }

// ✅ 可读的错误码
if (bsp_eeprom_write(addr, buf, len) != BSP_EEPROM_STATUS_OK) { error }</code></pre>
<p><strong>原则二：参数边界检查在接口层</strong></p>
<pre><code class="language-c">bsp_eeprom_status_t bsp_eeprom_write(uint16_t address, const uint8_t *buf, uint16_t len) {
    // 入参检查
    if ((buf == NULL) || (len == 0U))  return BSP_EEPROM_STATUS_INVALID_ARG;
    // 范围检查
    if ((address + len) &gt; BSP_EEPROM_SIZE_BYTES) return BSP_EEPROM_STATUS_OUT_OF_RANGE;
    // 就绪检查
    if (!s_initialized) return BSP_EEPROM_STATUS_NOT_READY;
    // 实际写入...
}</code></pre>
<p><strong>原则三：软件 I2C 用开漏输出</strong></p>
<p>PA11/PA12 配置为开漏输出（GPIO_MODE_OUTPUT_OD），不需要切换输入输出方向——读 SDA 时直接读输入寄存器，写 SDA 时写输出寄存器。这是 GPIO 模拟 I2C 的正确做法。</p>
<p><strong>原则四：分三层隔离</strong></p>
<div class="arcaea-table-wrap" data-bac-table-shell="1"><table>
<tr>
<th>层</th>
<th>文件</th>
<th>职责</th>
</tr>
<tr>
<td>硬件时序</td>
<td>bsp_eeprom.c（前 100 行）</td>
<td>GPIO 电平、延时、START/STOP/字节</td>
</tr>
<tr>
<td>芯片协议</td>
<td>（bsp_at24cxx.c）</td>
<td>AT24C02 读写命令序列、页写拆分</td>
</tr>
<tr>
<td>模块接口</td>
<td>bsp_eeprom.h</td>
<td>init/read/write/deinit + 错误码</td>
</tr>
</table></div>
<blockquote>
<p>换芯片（AT24C02→AT24C04/AT24C128）只需要改芯片协议层和容量常量，时序层和接口层都不动。</p>
</blockquote>
</div>
