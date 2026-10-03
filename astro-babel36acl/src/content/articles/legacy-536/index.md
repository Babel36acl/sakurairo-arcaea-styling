---
title: "FreeRTOS 任务通知链：xTaskNotifyGive 的三种模式"
description: "任务通知比信号量快约 40%。项目中 xTaskNotifyGive 承担了状态推送、ISR 唤醒、UART 驱动三种不同模式。"
published: "2026-05-28"
updated: "2026-08-18"
permalink: "/2026/05/28/freertos-task-notification-three-patterns/"
draft: false
categories: ["嵌入式实战","方法与工具"]
tags: ["ARCH"]
legacyId: 536
---

<div class="arcaea-wrap">
<p><span class="tag">嵌入式实战</span> <span class="tag">FreeRTOS</span></p>
<p>FreeRTOS 任务通知（Task Notifications）比信号量、队列轻量得多——不需要创建内核对象，直接向目标任务的任务控制块写一个通知值。在我们 7 任务的系统中，xTaskNotifyGive 承担了三种不同的协作模式。</p>
<h2>模式一：状态变化推送（减少轮询）</h2>
<p>MotorTask 每 5ms 跑一次动作表。但如果状态机 98% 的时间里状态都没变，5ms 轮询就是白跑的。用任务通知做"有变化才唤醒"：</p>
<pre><code class="language-c">// StateMachineTask 侧 — 状态变化时推送通知
void app_packer_sm_task_once(void) {
    psh_task_once();

    if (psh_consume_state_change() != 0U) {
        // 状态确实变了 → 通知 MotorTask
        if (s_motor_task_handle != NULL) {
            (void)xTaskNotifyGive(s_motor_task_handle);
        }
    }
}

// MotorTask 侧 — 优先等通知，超时兜底
void StartMotorTask(void *argument) {
    packer_actuator_init();
    for (;;) {
        // 等通知：有通知立即响应，无通知 5ms 超时后周期执行
        (void)ulTaskNotifyTake(pdTRUE,
                               pdMS_TO_TICKS(APP_CFG_TASK_MOTOR_PERIOD_MS));
        packer_actuator_task_once(app_packer_sm_get_state());
    }
}</code></pre>
<p>效果：状态不变时 5ms 等超时；状态变化时 &lt;1ms 内响应。实际测试中无效查表减少了约 80%。</p>
<h2>模式二：ISR 唤醒任务（DMA 完成回调）</h2>
<p>ADC 采用 DMA 采样，完成回调在 ISR 上下文中触发。ISR 不能调阻塞 API，但 <code>vTaskNotifyGiveFromISR</code> 是专门为 ISR 设计的非阻塞通知：</p>
<pre><code class="language-c">// ISR 侧（HAL ADC 转换完成回调）
static void adc_notify_from_isr(void) {
    BaseType_t hpw = pdFALSE;
    TaskHandle_t adc_handle = (TaskHandle_t)AdcTaskHandle;

    if (adc_handle != NULL) {
        vTaskNotifyGiveFromISR(adc_handle, &amp;hpw);
        portYIELD_FROM_ISR(hpw);  // 如果唤醒的任务优先级更高，立即切换
    }
}

// AdcTask 侧 — 等待 ISR 通知或超时兜底
void StartAdcTask(void *argument) {
    packer_adc_init();
    bsp_adc_register_notification_cb(adc_notify_from_isr);
    for (;;) {
        (void)ulTaskNotifyTake(pdTRUE,
                               pdMS_TO_TICKS(APP_CFG_ADC_SAMPLE_PERIOD_MS * 2));
        packer_adc_task_once();
    }
}</code></pre>
<p>超时兜底的保护作用：如果 DMA 回调因为某种原因丢失了，AdcTask 不会永久阻塞——超时后仍然会采样一次。</p>
<h2>模式三：UART 字节流驱动（ISR 通知任务消费）</h2>
<p>ProtoTask 消费 USART3 的 DMA 接收缓冲。每收到新字节，UART IDLE 中断或 DMA 半满中断通过 <code>vTaskNotifyGiveFromISR</code> 通知 ProtoTask：</p>
<pre><code class="language-c">// ISR 侧（UART 中断回调）
void USART3_IRQHandler(void) {
    if (__HAL_UART_GET_FLAG(&amp;huart3, UART_FLAG_IDLE)) {
        __HAL_UART_CLEAR_IDLEFLAG(&amp;huart3);
        BaseType_t hpw = pdFALSE;
        vTaskNotifyGiveFromISR(s_serial_task_handle, &amp;hpw);
        portYIELD_FROM_ISR(hpw);
    }
}

// ProtoTask 侧 — 有数据立即处理，无数据 50ms 兜底
void StartProtoTask(void *argument) {
    for (;;) {
        (void)ulTaskNotifyTake(pdTRUE,
                               pdMS_TO_TICKS(APP_CFG_TASK_PROTO_PERIOD_MS));
        app_packer_proto_task_once();
    }
}</code></pre>
<h2>三种模式对比</h2>
<div class="arcaea-table-wrap" data-bac-table-shell="1"><table>
<tr>
<th>模式</th>
<th>通知方向</th>
<th>API（发送侧）</th>
<th>API（接收侧）</th>
<th>超时用途</th>
</tr>
<tr>
<td>状态推送</td>
<td>任务→任务</td>
<td>xTaskNotifyGive</td>
<td>ulTaskNotifyTake</td>
<td>5ms 兜底周期</td>
</tr>
<tr>
<td>ISR 唤醒</td>
<td>ISR→任务</td>
<td>vTaskNotifyGiveFromISR</td>
<td>ulTaskNotifyTake</td>
<td>DMA 丢失保护</td>
</tr>
<tr>
<td>UART 驱动</td>
<td>ISR→任务</td>
<td>vTaskNotifyGiveFromISR</td>
<td>ulTaskNotifyTake</td>
<td>50ms 兜底轮询</td>
</tr>
</table></div>
<h2>为什么选任务通知而不是信号量</h2>
<p>FreeRTOS 中任务通知比二进制信号量快约 40%（不需要创建 Semaphore 句柄，没有队列操作）。在这个项目中所有"唤醒"语义都不需要计数——二进制通知正好匹配。</p>
<p>任务通知的另一个优势：<strong>不需要提前创建</strong>。任务启动时通知值初始为 0，第一次 <code>xTaskNotifyGive</code> 就置为 1。信号量需要额外调用 <code>xSemaphoreCreateBinary</code>。</p>
<blockquote>
<p>"有变化才唤醒"替代"周期轮询"——减少无效 CPU 占用的最直接手段。</p>
</blockquote>
</div>
