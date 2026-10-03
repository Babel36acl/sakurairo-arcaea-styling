---
title: "STM32 CMake 工程实践 — 从 CubeMX 到分层架构"
description: "2019 年接手一个 STM32F103RCT6 的工业控制项目。接手时仓库里有 6 个 .c 文件和一份 Keil .uvpro ..."
published: "2026-06-02"
updated: "2026-08-18"
permalink: "/2026/06/02/stm32-cmake-工程实践-从-cubemx-到分层架构/"
draft: false
categories: ["学习笔记","嵌入式实战","工程复盘","架构与重构"]
tags: []
legacyId: 1178
---

<p>2019 年接手一个 STM32F103RCT6 的工业控制项目。接手时仓库里有 6 个 <code>.c</code> 文件和一份 Keil <code>.uvprojx</code>，运行在 FreeRTOS 上，串口收发数据。当时觉得不管用什么工具链，一个 72MHz Cortex-M3 上的小项目不会复杂到哪去。</p>
<p>两年后，同一个仓库膨胀到 200+ 个源文件，分布在三个子系统的 12 个目录里，外加 FreeRTOS 的 7 个任务、3 路 USART（RS485 协议主口、RS232 调试口、打印机高波特率口）、一路 ADC 和多个传感器。Keil 的工程文件从最初的 1 页源文件列表变成了 4 页，每加一个 <code>.c</code> 都要同时更新开发和 CI 分支的两份 <code>.uvprojx</code>，合并时 XML diff 几乎不可读。</p>
<p>真正促使迁移的是一次 CI 故障。GitHub Actions 上的 Linux 构建因为 Keil 的 <code>.uvprojx</code> 编码问题无法解析——Keil 工程文件在 Windows 上用 GBK 编码保存，Git 在 Linux 上检出时乱码。花了三天排错，发现根源不是代码逻辑，而是 IDE 工程文件的兼容性。Keil 的 <code>.uvprojx</code> 本质上是一个 XML 文件，但它混合了源文件列表、编译器参数、调试器配置和窗口布局——其中窗口布局部分使用与系统语言环境绑定的编码。Windows 简体中文环境下生成的 <code>.uvprojx</code> 中包含了 GBK 编码的中文字段，上传到 Git 后 Linux CI 用 UTF-8 解析，XML parser 直接崩溃。最终结论是：IDE 工程文件不是为 CI 设计的，它对构建系统的绑定太紧、对自动化的支持太弱。</p>
<p>换到 CMake + Ninja 之后，源文件管理变成了 <code>file(GLOB_RECURSE)</code> 自动收集，CI 和本地用同一份 <code>CMakePresets.json</code>，没有第二个源文件列表需要同步。更重要的是，从此可以按层控制编译粒度——BSP 改一个 GPIO 驱动只重编 BSP 层，APP 层的编译缓存可以保留。加文件变成在目录里创建文件本身，不需要再打开 IDE 做任何操作。</p>
<p>这个故事不是个案。过去几年中，越来越多 STM32 项目从 CubeIDE/Keil/IAR 迁移到 CMake 构建体系。迁移的动机不尽相同——有人是为了 CI，有人是为了多板型支持，有人是为了摆脱 IDE 版本锁定——但最终收益是相同的：构建系统从「黑盒」变成「可读、可改、可版本管理」的文本文件。</p>
<p>这篇文章用这个真实项目——STM32F103RCT6 + FreeRTOS + 多任务工业控制器——来拆解一套 CMake 工程实践。全文不写理论推导，每一段 CMake 代码都是生产仓库里的真实文件摘录，每一个结论都在源码中有据可查。读完这篇文章，你应该能回答三个问题：</p>
<ul>
<li><strong>从 CubeMX 到 CMake 的迁移路径是怎么走的</strong>——不仅仅是「改个构建系统」</li>
<li><strong>三层分层架构的 CMake 实现</strong>——不仅仅是「分三个文件夹」</li>
<li><strong>从原型到量产的构建系统长什么样</strong>——不仅仅是「能编译通过」</li>
</ul>
<div class="arcaea-mermaid-box"><pre class="mermaid">graph TB
        subgraph DEV["开发环境"]
            IDE["STM32CubeMX
生成 HAL + 启动代码"] --&gt; CML["cmake/stm32cubemx/
CMakeLists.txt"]
            CML --&gt; TC["Toolchain File
cmake/gcc-arm-none-eabi.cmake"]
            TC --&gt; PRESET["CMakePresets.json"]
        end
        subgraph CONFIG["Configure 阶段"]
            PRESET --&gt; CMD1["cmake --preset Debug"]
            CMD1 --&gt; F1["find toolchain
compiler detection"]
            F1 --&gt; F2["load subdirectories
stm32cubemx → BSP → Service → APP"]
            F2 --&gt; F3["resolve dependencies
PUBLIC/PRIVATE propagation"]
            F3 --&gt; BN["build.ninja"]
        end
        subgraph BUILD["Build 阶段"]
            CMD2["cmake --build --preset Debug"] --&gt; COMPILE["GCC compile
.c/.S → .o"]
            COMPILE --&gt; LINK["Link with
STM32F103XX_FLASH.ld"]
            LINK --&gt; ELF["final.elf"]
            ELF --&gt; BIN["objcopy → final.bin"]
        end
        subgraph FLASH["烧录调试"]
            BIN --&gt; OPENOCD["OpenOCD + CMSIS-DAP"]
            OPENOCD --&gt; GDB["arm-none-eabi-gdb"]
        end
        style DEV fill:transparent,stroke:#9db4ff,color:#eef4ff
        style CONFIG fill:transparent,stroke:#8ad8ff,color:#eef4ff
        style BUILD fill:transparent,stroke:#c7b6ff,color:#eef4ff
        style FLASH fill:transparent,stroke:#ff9191,color:#eef4ff</pre></div>
<h2>第一章：IDE 与构建系统的本质区别</h2>
<h3>为什么选择 CMake——IDE 模式的三个死穴</h3>
<p>很多嵌入式开发者第一次面对 CMake 时的第一反应是：「STM32CubeIDE 不是可以编译吗？为什么还要再学一套东西？」</p>
<p>这个问题的答案取决于项目规模。CubeIDE 在原型阶段是完美的——打开就能用、点一下就能编译、集成了 CubeMX 的图形化配置。但当项目从原型阶段走向产品阶段时，IDE 模式会暴露出三个死穴。</p>
<h4>死穴一：CI/CD 不可达</h4>
<p>CubeIDE 基于 Eclipse。Eclipse 的 headless build（命令行构建）在 Linux CI 上需要完整的 X11 依赖——至少需要安装 <code>libgtk-3-0</code>、<code>libXtst6</code>、<code>libXrender1</code> 等十几个 GUI 库。而且不同版本的 Eclipse 生成 <code>.cproject</code> 格式不同——从 CubeIDE 1.10 升级到 1.14，<code>.cproject</code> 的 XML namespace 变了，整个构建系统在 CI 上崩溃。</p>
<p>CMake 的处理方式完全不同：CMakeLists.txt 是纯文本脚本，CMake 本身是一个命令行工具，在无头 Linux 服务器上无需任何 GUI 依赖。CI 脚本的核心只有两行：</p>
<pre><code class="language-bash">cmake --preset Debug
cmake --build --preset Debug --parallel $(nproc)</code></pre>
<p>没有 IDE、没有 GUI、没有编码问题。</p>
<h4>死穴二：源文件列表的维护成本</h4>
<p>CubeIDE 的 <code>.cproject</code> 记录了每个源文件的绝对路径引用。当三个开发者各自在本地新建文件后合并时，<code>.cproject</code> 的 XML diff 几乎是不可读的——它不是一个结构化的条目列表，而是包含编译器参数、debugger 配置、窗口布局等几十行无关元数据。</p>
<p>CMake 改用 <code>file(GLOB_RECURSE)</code> 按目录自动收集后，加文件就是创建文件本身，不需要修改任何工程文件。Git diff 只有新文件的 <code>.c</code> 和 <code>.h</code>，没有工程元数据噪音。</p>
<h4>死穴三：分层权限无法表达</h4>
<p>当项目按 BSP/Service/APP 分层时，期望的编译控制是：</p>
<ul>
<li>BSP 头文件对 Service 可见、但对 APP 不可见（除非 APP 显式 link BSP）</li>
<li>HAL 头文件对所有层可见</li>
<li>APP 的某些内部类型定义对 Service 不可见</li>
</ul>
<p>CubeIDE 的 <code>.cproject</code> 是一个扁平的编译目标——所有源文件共享同一个 include 路径列表。无法表达「这个目标私有地 link 了那个库，所以它的接口不应该透传到上层」。CMake 的 <code>target_link_libraries</code> 的 <code>PUBLIC/PRIVATE/INTERFACE</code> 关键字是专门为这个场景设计的。</p>
<h2>第二部分：Toolchain File——交叉编译的入口</h2>
<h3>第二章：工具链文件的职责边界</h3>
<p>入口文件：<code class="language-text">cmake/gcc-arm-none-eabi.cmake</code>。</p>
<p>工具链文件（toolchain file）是 CMake 交叉编译的第一入口。它在 <code>project()</code> 命令执行之前被加载——这是一个硬性时序约束：<code>project()</code> 执行时 CMake 会做编译器检测，检测时使用的编译器由 toolchain file 决定。如果在 <code>project()</code> 之后才设置 <code>CMAKE_C_COMPILER</code>，CMake 会报错或使用宿主编译器。</p>
<h4>编译器声明</h4>
<pre><code class="language-cmake">set(CMAKE_SYSTEM_NAME               Generic)
set(CMAKE_SYSTEM_PROCESSOR          arm)

set(TOOLCHAIN_PREFIX                arm-none-eabi-)
set(CMAKE_C_COMPILER                ${TOOLCHAIN_PREFIX}gcc)
set(CMAKE_ASM_COMPILER              ${CMAKE_C_COMPILER})
set(CMAKE_CXX_COMPILER              ${TOOLCHAIN_PREFIX}g++)
set(CMAKE_LINKER                    ${TOOLCHAIN_PREFIX}g++)
set(CMAKE_OBJCOPY                   ${TOOLCHAIN_PREFIX}objcopy)
set(CMAKE_SIZE                      ${TOOLCHAIN_PREFIX}size)</code></pre>
<p><code>CMAKE_SYSTEM_NAME Generic</code> 是嵌入式交叉编译的关键。如果不设置这一行，CMake 默认会走 <code>CMAKE_SYSTEM_NAME</code> 的宿主检测逻辑——在 Linux 上检测到 <code>Linux</code>，然后自动添加宿主系统链接库（<code>-ldl</code>、<code>-lrt</code>、<code>-lpthread</code> 等）。这些库在嵌入式裸机环境中不存在，链接阶段会报 <code>cannot find -ldl</code>。</p>
<p><code>CMAKE_SYSTEM_PROCESSOR arm</code> 告知 CMake 目标处理器架构。影响 CMake 的默认编译器测试行为，也影响一些平台相关的 CMake 模块判断。</p>
<p>TOOLCHAIN_PREFIX 变量的设计意图：如果将来换用 LLVM Clang 工具链，只需要把 <code>arm-none-eabi-</code> 改成 <code>llvm-arm-none-eabi-</code>，所有编译器变量的设置点自动更新。不需要在工具链文件的 10 个地方分别改。</p>
<p><code>CMAKE_TRY_COMPILE_TARGET_TYPE STATIC_LIBRARY</code> 是一个容易被忽略的配置。CMake 在 <code>project()</code> 执行时默认会尝试编译一个简单的可执行文件来验证编译器正常工作。但在交叉编译场景下，链接可执行文件需要 linker script（<code>-T</code> 参数），而 linker script 的路径在 toolchain file 中通常还没有设置。如果 CMake 尝试链接一个可执行文件，会因为没有 linker script 而失败，进而错误地判断编译器不可用。设置为 <code>STATIC_LIBRARY</code> 后，CMake 只编译不链接，跳过了这个验证陷阱。</p>
<h3>第三章：编译参数的分层设计</h3>
<h4>芯片架构参数</h4>
<pre><code class="language-cmake">set(TARGET_FLAGS "-mcpu=cortex-m3 -mthumb")
set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} ${TARGET_FLAGS}")</code></pre>
<p>STM32F103RCT6 使用 ARM Cortex-M3 内核。Cortex-M3 只支持 Thumb-2 指令集，不支持 ARM 指令集。<code>-mcpu=cortex-m3</code> 告诉 GCC 生成针对 Cortex-M3 优化的代码——使用其特有的指令调度、分支预测和乘除法器配置。<code>-mthumb</code> 强制生成 Thumb 指令编码。在 Cortex-M3 上不加 <code>-mthumb</code> 也会默认使用 Thumb-2，但是显式声明可以确保代码在 Cortex-M 全系列上的一致性。</p>
<p>如果是 STM32F407（Cortex-M4F），<code>TARGET_FLAGS</code> 变成：</p>
<pre><code class="language-cmake">set(TARGET_FLAGS "-mcpu=cortex-m4 -mthumb -mfpu=fpv4-sp-d16 -mfloat-abi=hard")</code></pre>
<p>这意味着换芯片型号时，整个 toolchain file 只需要修改 <code>TARGET_FLAGS</code> 这一行。其余所有编译选项——警告、调试信息、优化策略——保持不变。</p>
<h4>全局警告与代码生成</h4>
<pre><code class="language-cmake">set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} -Wall -fdata-sections -ffunction-sections -fstack-usage")</code></pre>
<p><code>-fdata-sections</code> 和 <code>-ffunction-sections</code> 这两个选项是链接优化的前置条件。<code>-ffunction-sections</code> 让 GCC 把每个函数放到独立的 section（<code>.text.function_name</code>）而不是默认的单一 <code>.text</code> 段。<code>-fdata-sections</code> 对全局变量同理。然后链接器参数中的 <code>-Wl,--gc-sections</code> 会逐 section 扫描引用关系——未被任何活跃代码引用的 section 被丢弃。对于 STM32F103 这种 256KB Flash 的芯片，这个组合通常能省下 10~30KB 的无用代码。</p>
<p><code>-fstack-usage</code> 让 GCC 为每个函数输出栈使用量到 <code>.su</code> 文件。这些文件在构建完成后可以用脚本汇总——找出栈使用量最大的函数，辅助 FreeRTOS 任务栈大小配置。</p>
<h4>构建类型专属参数</h4>
<pre><code class="language-cmake">set(CMAKE_C_FLAGS_DEBUG   "-O0 -g3")
set(CMAKE_C_FLAGS_RELEASE "-Os -g0")
set(CMAKE_CXX_FLAGS_DEBUG   "-O0 -g3")
set(CMAKE_CXX_FLAGS_RELEASE "-Os -g0")</code></pre>
<p>Debug 使用 <code>-O0</code> 禁止所有优化，配合 <code>-g3</code> 生成最完整的调试符号（包括宏定义和行号信息）。Release 使用 <code>-Os</code> 以代码尺寸为主要优化目标——对于 Flash 有限的 MCU，代码尺寸比执行速度更重要。<code>-g0</code> 不生成任何调试符号，减少 ELF 文件体积。</p>
<h3>第四章：链接参数与 Newlib 配置</h3>
<pre><code class="language-cmake">set(CMAKE_EXE_LINKER_FLAGS "${CMAKE_EXE_LINKER_FLAGS} -T "${CMAKE_SOURCE_DIR}/STM32F103XX_FLASH.ld"")
set(CMAKE_EXE_LINKER_FLAGS "${CMAKE_EXE_LINKER_FLAGS} --specs=nano.specs")
set(CMAKE_EXE_LINKER_FLAGS "${CMAKE_EXE_LINKER_FLAGS} --specs=rdimon.specs")
set(CMAKE_EXE_LINKER_FLAGS "${CMAKE_EXE_LINKER_FLAGS} -Wl,-Map=${CMAKE_PROJECT_NAME}.map -Wl,--gc-sections")
set(CMAKE_EXE_LINKER_FLAGS "${CMAKE_EXE_LINKER_FLAGS} -Wl,--print-memory-usage")
set(TOOLCHAIN_LINK_LIBRARIES "m")</code></pre>
<p><code>-T</code> 指定 linker script（.ld 文件）。注意这里使用 <code>${CMAKE_SOURCE_DIR}</code> 而不是相对路径——linker script 在根目录，所有子目录的 CMakeLists.txt 都能通过这个绝对路径索引。</p>
<p>Newlib 是 ARM GCC 工具链自带的嵌入式 C 标准库实现。但它有多个变体：</p>
<ul>
<li><strong>Newlib（完整版）</strong>——包含完整的 printf 浮点支持、malloc 线程安全锁、locale、宽字符等。链接后增加约 40~60KB Flash 占用</li>
<li><strong>Newlib-nano（<code>nano.specs</code>）</strong>——精简版，去掉浮点格式化、locale、宽字符等功能。Flash 占用减少到 10~20KB</li>
<li><strong>Newlib-nano + rdimon（<code>rdimon.specs</code>）</strong>——在 nano 的基础上增加了半主机（semihosting）支持，用于调试阶段的 printf 输出到调试器控制台</li>
</ul>
<p>项目中只使用 <code>nano.specs</code>。<code>printf("%f")</code> 输出 0.000000——因为 Newlib-nano 明确移除了浮点格式化的弱符号。如果需要浮点输出，要么手动用 <code>sprintf</code> 拆成整数部分和小数部分输出，要么链接完整版 Newlib。</p>
<p><code>--print-memory-usage</code> 在链接完成后输出内存统计：</p>
<pre><code class="language-text">Memory region         Used Size  Region Size  %age Used
           RAM:          36552 B        48 KB     74.37%
         FLASH:         123448 B       256 KB     47.09%</code></pre>
<p>建议在 CI 脚本中解析这个输出，设置资源和告警阈值。RAM 超过 85% 时标记 Warning，超过 95% 时阻止合并。</p>
<p>除了 <code>--print-memory-usage</code> 的汇总统计外，<code>.map</code> 文件是分析内存占用的详细工具。链接器生成的 <code>.map</code> 文件包含了每个 section 的起始地址、大小、所属对象文件和符号等详细信息。当 RAM 利用率接近上限时，用 <code>arm-none-eabi-objdump -t final.elf | sort -k5 -rn | head -30</code> 可以列出占用 RAM 最大的 30 个符号。这个命令在 CI 中作为内存审计的补充步骤，帮助定位异常增长的对象。</p>
<p>Newlib 的浮点 printf 替代方案在实际项目中是一个反复遇到的细节问题。</p>
<p>链接器的 <code>--gc-sections</code> 与 <code>-ffunction-sections</code> 的组合对 STM32F103 这类 Flash 紧张的芯片是强制配置项。一个被 <code>#ifdef</code> 排除的初始化函数如果不放在独立 section 中，它的整个 .o 文件都不会被 <code>--gc-sections</code> 丢弃——因为该 .o 中至少有一个符号被引用。ST 的 HAL 库的 <code>.c</code> 文件中每个外设的初始化函数、控制函数、中断处理函数都在同一个翻译单元中。如果某个外设在选型阶段没有启用，但它的驱动文件被编译了——<code>--gc-sections</code> 无法丢弃该文件中未被调用的远端函数，因为同文件的另一个函数被引用了。OBJECT 库模式在一定程度上缓解了这个问题，因为 OBJECT 的 <code>.o</code> 在链接时直接嵌入 ELF、不经过 .a 归档的符号解析步骤。</p>
<h2>第三部分：CMakePresets——入口标准化</h2>
<h3>第五章：为什么需要 Preset</h3>
<p>CMake 的命令行参数在不同开发者之间很容易出现不一致。有人用 <code>-G Ninja</code> 有人用默认的 <code>Unix Makefiles</code>，有人忘记加 <code>-DCMAKE_TOOLCHAIN_FILE</code>，有人在 <code>project()</code> 之后才设置语言标准。每次新人加入项目，第一周都在排构建问题。</p>
<p>CMakePresets 是 CMake 3.19 引入的构建入口标准化方案。它将所有构建参数——generator、工具链文件、构建目录、缓存变量——写入一个 JSON 文件，开发者只需要知道 preset 的名字。</p>
<p>但我理解，在命令行中传递所有这些参数是可行的。问题是可重复性——当一个参数被写在 README 里、另一个被写在团队的 Wiki 里、第三个由某个开发者在 <code>.bash_history</code> 中偶然发现，最终构建入口就不再是确定性的了。</p>
<h3>第六章：Preset 文件结构</h3>
<pre><code class="language-json">{
    "version": 3,
    "configurePresets": [
        {
            "name": "default",
            "hidden": true,
            "generator": "Ninja",
            "binaryDir": "${sourceDir}/build/${presetName}",
            "toolchainFile": "${sourceDir}/cmake/gcc-arm-none-eabi.cmake",
            "cacheVariables": {}
        },
        {
            "name": "Debug",
            "inherits": "default",
            "cacheVariables": {
                "CMAKE_BUILD_TYPE": "Debug",
                "CMAKE_EXPORT_COMPILE_COMMANDS": "ON"
            }
        },
        {
            "name": "Release",
            "inherits": "default",
            "cacheVariables": {
                "CMAKE_BUILD_TYPE": "Release"
            }
        }
    ],
    "buildPresets": [
        { "name": "Debug",   "configurePreset": "Debug" },
        { "name": "Release", "configurePreset": "Release" }
    ]
}</code></pre>
<p>设计细节解析：</p>
<ul>
<li><strong>hidden + inherits 模式</strong>——<code>default</code> 基 preset 标记为 <code>hidden: true</code>，表示它不是一个可以直接使用的 preset。所有具体 preset（Debug/Release）通过 <code>inherits</code> 继承它的参数。修改基 preset 时所有子 preset 自动同步，不会出现 Debug 用了 Ninja、Release 用了 Unix Makefiles 的不一致情况。</li>
<li><strong>binaryDir 的动态确定</strong>——<code>${sourceDir}/build/${presetName}</code> 使 Debug 的输出目录为 <code>build/Debug/</code>，Release 为 <code>build/Release/</code>。两个构建类型完全隔离，切换时不需要清理之前的构建产物。</li>
<li><strong>compile_commands 只对 Debug</strong>——<code>CMAKE_EXPORT_COMPILE_COMMANDS=ON</code> 只放在 Debug Preset 中。Release 构建不需要生成编译数据库，也减少了 Release 构建的 Configure 开销。</li>
</ul>
<h3>第七章：Preset 的 CI 集成</h3>
<p>Preset 最大的好处是本地开发和 CI 使用同一个入口。GitHub Actions 的核心步骤与开发者在终端敲的命令完全一致：</p>
<pre><code class="language-bash"># .github/workflows/build.yml（核心步骤）
cmake --preset Debug
cmake --build --preset Debug --parallel $(nproc)

# 验证链接内存
arm-none-eabi-size build/Debug/final.elf

# 检查是否有未定义的引用
arm-none-eabi-objdump -t build/Debug/final.elf | grep "UND" | head -20</code></pre>
<p>Cache 策略：</p>
<ul>
<li>工具链版本写入 <code>.github/tool-versions.env</code>，缓存 key 按版本组合生成</li>
<li>修改 <code>BSP/Src/</code> 下的文件时只重编 BSP 层，其他层命中 ccache</li>
<li>Preset JSON 本身也加入缓存 key——改 Preset 后全量重编是预期行为</li>
</ul>
<h2>第四部分：分层架构——三层静态库的 CMake 实现</h2>
<h3>第八章：分层的动机</h3>
<p>项目代码分为四个编译单元，按依赖方向排列：</p>
<pre><code class="language-text">stm32cubemx（INTERFACE 库）—— CubeMX 生成的头文件路径和编译宏
    ↑
BSP/（bsp_layer.a）—— 硬件驱动层：GPIO、UART、ADC、定时器
    ↑
Service/（service_layer.a）—— 服务层：协议解析、状态机、动作编排
    ↑
APP/（app_layer.a）—— 应用层：顶层状态机、命令分发、监控

final.elf 链接所有四层</code></pre>
<p>三层分层的核心约束：</p>
<ul>
<li>Service 不能直接调 BSP 的硬件操作——必须通过 Service 层封装的动作接口</li>
<li>APP 不能跳过 Service 层直接调 BSP</li>
<li>BSP 不知道 APP 和 Service 的存在——BSP 的头文件不应 include 任何应用层的类型定义</li>
</ul>
<p>在代码层面，这些约束靠代码审查维持是不够的。编译期强制约束只有一条路：<strong>让违反依赖方向的代码编译不通过</strong>。</p>
<h3>第九章：INTERFACE 库——stm32cubemx 层的设计</h3>
<pre><code class="language-cmake"># cmake/stm32cubemx/CMakeLists.txt
add_library(stm32cubemx INTERFACE)
target_include_directories(stm32cubemx INTERFACE ${MX_Include_Dirs})
target_compile_definitions(stm32cubemx INTERFACE ${MX_Defines_Syms})</code></pre>
<p>INTERFACE 库是 CMake 中没有源文件的库——它不生成 <code>.o</code> 文件，只传播属性。任何 <code>target_link_libraries(xxx stm32cubemx)</code> 的目标会自动获得 CubeMX 的头文件路径和编译宏。</p>
<p>为什么不用 STATIC + 空源文件？因为 STATIC 库即使没有源文件也会生成一个空的 <code>.a</code> 归档文件，在链接时多一次空归档的扫描开销。INTERFACE 库完全跳过这一步骤。</p>
<p>HAL 驱动和 FreeRTOS 使用 OBJECT 库而非 STATIC 库：</p>
<pre><code class="language-cmake">add_library(STM32_Drivers OBJECT)
target_sources(STM32_Drivers PRIVATE ${STM32_Drivers_Src})
target_link_libraries(STM32_Drivers PUBLIC stm32cubemx)

add_library(FreeRTOS OBJECT)
target_sources(FreeRTOS PRIVATE ${FreeRTOS_Src})
target_link_libraries(FreeRTOS PUBLIC stm32cubemx)</code></pre>
<p>OBJECT 库的关键行为：它的 <code>.o</code> 文件在被 <code>target_link_libraries</code> 到主目标时直接嵌入 ELF 文件，不会先归档为 <code>.a</code> 再被链接器扫描。这意味着：</p>
<ul>
<li>HAL 驱动中未被调用的函数在 OBJECT 模式下被 GCC 的 <code>-ffunction-sections</code> + 链接器的 <code>--gc-sections</code> 准确丢弃</li>
<li>STATIC 库模式下，即使使用了 <code>--gc-sections</code>，链接器在处理 STATIC 库时是按 object 粒度丢弃的——一个 <code>.o</code> 文件里如果有任何一个符号被引用，整个 <code>.o</code> 的所有内容都会被保留</li>
</ul>
<p>CubeMX 生成的 <code>main.c</code>、各外设初始化文件直接加到主目标：</p>
<pre><code class="language-cmake">target_sources(${CMAKE_PROJECT_NAME} PRIVATE ${MX_Application_Src})
target_link_libraries(${CMAKE_PROJECT_NAME} ${MX_LINK_LIBS})</code></pre>
<p>原因：CubeMX 生成的 <code>main.c</code> 包含 <code>main()</code> 函数和硬件初始化入口。如果把它编入 STATIC 库，链接器在遇到 <code>main()</code> 时行为取决于链接顺序——有时能解析，有时不。直接加到主目标消除了这种不确定性。</p>
<h4>Generator Expression 的编译宏控制</h4>
<pre><code class="language-cmake">set(MX_Defines_Syms
    USE_HAL_DRIVER
    STM32F103xE
    STM32_THREAD_SAFE_STRATEGY=4
    $&lt;$<debug>:DEBUG&gt;
)</debug></code></pre>
<p><code>$&lt;$&lt;CONFIG:Debug&gt;:DEBUG&gt;</code> 是 CMake 的 generator expression。只在 Debug 配置下定义 <code>DEBUG</code> 宏。这个宏可以在代码中控制调试输出的开关：</p>
<pre><code class="language-c">#ifdef DEBUG
    printf("[DBG] sensor_value = %dn", val);
#endif</code></pre>
<p>Generator expression 的优势：不需要为 Debug/Release 写两套 <code>target_compile_definitions</code>。同一个 CMakeLists.txt 中一声明，CMake 在生成 <code>build.ninja</code> 时根据不同配置自动展开成不同的编译参数。</p>
<h3>第十章：BSP 层——硬件驱动隔离</h3>
<pre><code class="language-cmake">file(GLOB_RECURSE BSP_SOURCES CONFIGURE_DEPENDS
    "${CMAKE_CURRENT_SOURCE_DIR}/Src/*.c"
)

add_library(bsp_layer STATIC)
target_sources(bsp_layer PRIVATE ${BSP_SOURCES})

target_include_directories(bsp_layer PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}/Inc
)

target_link_libraries(bsp_layer PUBLIC stm32cubemx)</code></pre>
<p>BSP 层的 PUBLIC include 决定了它的头文件可以被链接它的目标使用。但 PUBLIC/PRIVATE 的语义需要准确理解：</p>
<ul>
<li><strong>PUBLIC</strong>：目标的头文件路径、编译宏、链接库既为自己所用，也透传给任何链接自己的目标</li>
<li><strong>PRIVATE</strong>：只为自己所用，不透传</li>
<li><strong>INTERFACE</strong>：只透传，不为自己所用（就是 stm32cubemx 那种）</li>
</ul>
<p>BSP 的 <code>stm32cubemx</code> 依赖是 PUBLIC——因为链接 BSP 的上层目标（Service）也需要 HAL 头文件。</p>
<h3>第十一章：Service 层——PRIVATE 隔离的艺术</h3>
<pre><code class="language-cmake">file(GLOB_RECURSE SERVICE_SOURCES CONFIGURE_DEPENDS
    "${CMAKE_CURRENT_SOURCE_DIR}/Src/*.c"
)

add_library(service_layer STATIC)
target_sources(service_layer PRIVATE ${SERVICE_SOURCES})

target_include_directories(service_layer
    PUBLIC
        ${CMAKE_CURRENT_SOURCE_DIR}/Inc
        ${CMAKE_CURRENT_SOURCE_DIR}/Inc/protocol
        ${CMAKE_CURRENT_SOURCE_DIR}/Inc/state_machine
        ${CMAKE_CURRENT_SOURCE_DIR}/Inc/task
    PRIVATE
        ${CMAKE_SOURCE_DIR}/APP/Inc
)

target_link_libraries(service_layer
    PUBLIC
        stm32cubemx
    PRIVATE
        bsp_layer
)</code></pre>
<p>这里的关键设计在 PRIVATE 的使用：</p>
<ul>
<li><code>bsp_layer</code> 作为 PRIVATE 链接——Service 可以调用 BSP 的函数，但 APP 不能通过 <code>target_link_libraries(app_layer service_layer)</code> 间接获得 BSP 的 include 路径</li>
<li><code>stm32cubemx</code> 作为 PUBLIC——因为 APP 最终也需要 HAL 的 <code>#include "stm32f1xx_hal.h"</code></li>
<li><code>APP/Inc</code> 作为 PRIVATE include 路径——Service 的某些实现需要引用 APP 的协议类型定义（如命令枚举、状态结构体），但不希望这些 APP 内部类型暴露给 Service 的用户</li>
</ul>
<p>这个设计使得分层边界在编译期被强制执行。如果有人试图在 APP 层代码中 <code>#include "bsp_gpio.h"</code> 直接操作 GPIO，编译器会报错——APP 没有 link bsp_layer，看不到 BSP/Inc 目录。</p>
<h3>第十二章：APP 层——依赖链的最顶层</h3>
<pre><code class="language-cmake">file(GLOB_RECURSE APP_SOURCES CONFIGURE_DEPENDS
    "${CMAKE_CURRENT_SOURCE_DIR}/Src/*.c"
)

add_library(app_layer STATIC)
target_sources(app_layer PRIVATE ${APP_SOURCES})

target_include_directories(app_layer PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}/Inc
)

target_link_libraries(app_layer PUBLIC
    stm32cubemx
    service_layer
    bsp_layer
)</code></pre>
<p>APP 把三层全部 PUBLIC link。这样主目标只需要 link app_layer，就自动获得了 BSP、Service、stm32cubemx 的全部符号和头文件可见性。</p>
<p>一个值得注意的实践：APP 的 <code>target_include_directories</code> 是 PUBLIC——这不是因为有人会链接 app_layer（通常它就是最顶层），而是为了在根 CMakeLists.txt 中可以访问 APP 的 include 路径。</p>
<h3>第十三章：根 CMakeLists.txt 的缝合</h3>
<pre><code class="language-cmake">cmake_minimum_required(VERSION 3.22)
set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_C_EXTENSIONS ON)
set(CMAKE_PROJECT_NAME final)
set(CMAKE_EXPORT_COMPILE_COMMANDS TRUE)
project(${CMAKE_PROJECT_NAME})
enable_language(C ASM)
add_executable(${CMAKE_PROJECT_NAME})

add_subdirectory(cmake/stm32cubemx)
add_subdirectory(BSP)
add_subdirectory(Service)
add_subdirectory(APP)

target_link_libraries(${CMAKE_PROJECT_NAME}
    stm32cubemx
    bsp_layer
    service_layer
    app_layer
)</code></pre>
<p>根 CMakeLists.txt 的职责被严格限定：声明可执行文件、加载子目录、链接最终目标。不在根 CMakeLists.txt 中写任何 include 路径或编译宏定义——这些下沉到了各自的子目录 CMakeLists.txt。如果将来要将某层抽成独立的 git submodule 或 package，根 CMakeLists.txt 不需要变化，只需要改 <code>add_subdirectory</code> 那一行。</p>
<h2>第五部分：CubeMX 集成——让生成本地代码共存</h2>
<h3>第十四章：CubeMX 生成结构的分析</h3>
<p>STM32CubeMX 生成的代码通常包含四个目录：Core（主程序、外设初始化、中断）、Drivers（HAL 驱动、CMSIS）、Middlewares（FreeRTOS、FatFS、USB 等）、startup（汇编启动文件）。</p>
<p>关键约束：CubeMX 的输出目录是 <code>Core/Src/</code> 下的 <code>main.c</code>、<code>gpio.c</code>、<code>usart.c</code> 等——这些文件每次 CubeMX 重新生成时会被覆盖。在这个项目的布局中，用户代码放在 <code>BSP/</code>、<code>Service/</code>、<code>APP/</code> 下，CubeMX 的输出留在一个单独的目录中。<strong>永远不修改 CubeMX 生成的源文件</strong>——如果需要在 <code>main.c</code> 中添加初始化代码，在 CubeMX 的 User Code Block 区域中添加，而不是直接编辑生成的文件。</p>
<p>CMakeLists.txt 中通过相对路径引用 CubeMX 输出：</p>
<pre><code class="language-cmake">set(MX_Application_Src
    ${CMAKE_CURRENT_SOURCE_DIR}/../../Core/Src/main.c
    ${CMAKE_CURRENT_SOURCE_DIR}/../../Core/Src/gpio.c
    ${CMAKE_CURRENT_SOURCE_DIR}/../../Core/Src/freertos.c
    # ... 每个外设一个文件
    ${CMAKE_CURRENT_SOURCE_DIR}/../../startup_stm32f103xe.s
)</code></pre>
<p><code>../../</code> 从 <code>cmake/stm32cubemx/</code> 向上两级回到项目根目录，再进入 <code>Core/Src/</code>。这个相对路径写法依赖于 CubeMX 的 Generate Code 输出目录约定，如果 CubeMX 配置改了输出路径，只需要修改 <code>../../</code> 后的路径段。</p>
<h2>第六部分：Linker Script——内存布局的精细控制</h2>
<h3>第十五章：MEMORY 区域声明</h3>
<pre><code class="language-ld">MEMORY
{
    RAM   (xrw) : ORIGIN = 0x20000000, LENGTH = 48K
    FLASH (rx)  : ORIGIN = 0x08000000, LENGTH = 256K
}</code></pre>
<p>STM32F103RCT6 的片上资源非常有限。256KB Flash 用于存放代码和只读数据，48KB RAM 用于运行时数据——包括任务栈、全局变量、堆、以及 FreeRTOS 内核对象。RAM 的 48KB 是 STM32F103 系列中的大容量版本（RC 后缀 = 256KB Flash + 48KB RAM），比起 RD（384KB+64KB）仍然紧张。</p>
<h3>第十六章：SECTIONS 布局与关键段设计</h3>
<pre><code class="language-ld">_estack = ORIGIN(RAM) + LENGTH(RAM);
_Min_Heap_Size  = 0x200;
_Min_Stack_Size = 0x400;</code></pre>
<p>栈顶 <code>_estack</code> 设置在 RAM 的最高地址（<code>0x20000000 + 48KB = 0x2000C000</code>）。栈向下生长，从最高地址开始使用。1KB 的最小栈空间（<code>0x400</code>）预留给主栈和中断嵌套。在有 FreeRTOS 的项目中，主栈只在启动阶段和空闲任务中使用，大部分任务上下文由 FreeRTOS 的独立任务栈管理。但中断嵌套仍然使用主栈——嵌套三层中断的每一层需要 256~512 字节，1KB 的预留是安全线。</p>
<p>几个关键段的职责：</p>
<ul>
<li><strong>.isr_vector</strong>——必须放在 Flash 起始地址（<code>0x08000000</code>），因为 Cortex-M3 复位后从 <code>0x00000000</code> 取栈指针、从 <code>0x00000004</code> 取 PC。芯片内部通过别名映射将 Flash 起始地址映射到 <code>0x00000000</code>。</li>
<li><strong>.text + .rodata</strong>——代码和只读数据。根据 <code>--print-memory-usage</code> 输出，当前项目占用约 120KB，Flash 利用率 47%</li>
<li><strong>.data</strong>——初始化值不为零的全局变量。LMA 在 Flash，VMA 在 RAM，启动代码负责从 Flash 拷贝到 RAM</li>
<li><strong>.bss</strong>——初始化值为零的全局变量。启动代码负责清零</li>
<li><strong>.noinit</strong>——上电不复位的数据段。在项目中用于存放故障记录——系统异常复位后，故障锁存器的值通过 noinit 段保留，供下一次启动时读取</li>
<li><strong>.tdata/.tbss</strong>——Thread Local Storage 段。CMSIS RTOS V2 的 <code>osThreadNew</code> 接口需要 TLS 支持</li>
</ul>
<h3>第十七章：内存占用实测</h3>
<p>项目实际链接内存统计（使用 <code>--print-memory-usage</code> 输出）：</p>
<div class="arcaea-table-wrap" data-bac-table-shell="1"><table>
<tr>
<th>内存区域</th>
<th>已用</th>
<th>总量</th>
<th>占比</th>
</tr>
<tr>
<td>Flash（.text + .rodata + .data 的 LMA 副本）</td>
<td>120.6 KB</td>
<td>256 KB</td>
<td>47.1%</td>
</tr>
<tr>
<td>RAM（.data + .bss + 栈 + 堆 + FreeRTOS 内核对象）</td>
<td>35.7 KB</td>
<td>48 KB</td>
<td>74.4%</td>
</tr>
</table></div>
<p>RAM 的 74% 利用率是项目目前最关注的数据。48KB 的片上 RAM 在容纳 7 个 FreeRTOS 任务（每个任务栈 256~1024 字节）、FreeRTOS 内核对象（队列、信号量、事件组、流缓冲区）、全局变量和 HAL 的中间缓冲区之后，剩余约 12KB 的余量。建议在 CI 脚本中添加 RAM 占用告警：超过 85% 输出 Warning，超过 95% 阻止合并。</p>
<h2>第七部分：FreeRTOS 集成——源码级管理</h2>
<h3>第十八章：FreeRTOS 源文件的 CMake 组织</h3>
<p>FreeRTOS 在 CubeMX 中作为 Middleware 配置生成。CMake 中的对应处理：</p>
<pre><code class="language-cmake">set(FreeRTOS_Src
    ${CMAKE_CURRENT_SOURCE_DIR}/../../Middlewares/Third_Party/FreeRTOS/Source/croutine.c
    ${CMAKE_CURRENT_SOURCE_DIR}/../../Middlewares/Third_Party/FreeRTOS/Source/event_groups.c
    ${CMAKE_CURRENT_SOURCE_DIR}/../../Middlewares/Third_Party/FreeRTOS/Source/list.c
    ${CMAKE_CURRENT_SOURCE_DIR}/../../Middlewares/Third_Party/FreeRTOS/Source/queue.c
    ${CMAKE_CURRENT_SOURCE_DIR}/../../Middlewares/Third_Party/FreeRTOS/Source/stream_buffer.c
    ${CMAKE_CURRENT_SOURCE_DIR}/../../Middlewares/Third_Party/FreeRTOS/Source/tasks.c
    ${CMAKE_CURRENT_SOURCE_DIR}/../../Middlewares/Third_Party/FreeRTOS/Source/timers.c
    ${CMAKE_CURRENT_SOURCE_DIR}/../../Middlewares/Third_Party/FreeRTOS/Source/CMSIS_RTOS_V2/cmsis_os2.c
    ${CMAKE_CURRENT_SOURCE_DIR}/../../Middlewares/Third_Party/FreeRTOS/Source/portable/MemMang/heap_4.c
    ${CMAKE_CURRENT_SOURCE_DIR}/../../Middlewares/Third_Party/FreeRTOS/Source/portable/GCC/ARM_CM3/port.c
)

add_library(FreeRTOS OBJECT)
target_sources(FreeRTOS PRIVATE ${FreeRTOS_Src})
target_link_libraries(FreeRTOS PUBLIC stm32cubemx)</code></pre>
<p>使用 OBJECT 库而非 STATIC 库的原因与 HAL 驱动相同：OBJECT 库的 <code>.o</code> 直接嵌入 ELF，<code>--gc-sections</code> 可以精确丢弃未被调用的 FreeRTOS 功能。例如项目中不使用 <code>event_groups.c</code>（事件组功能），OBJECT 模式下它不会被链接进最终固件。</p>
<p>Heap 策略选择 <code>heap_4.c</code>：</p>
<ul>
<li><strong>heap_1</strong>——最简单，只分配不释放，不适合实时系统</li>
<li><strong>heap_2</strong>——支持释放但会产生碎片，已废弃</li>
<li><strong>heap_3</strong>——包装标准库的 <code>malloc/free</code>，需要标准库线程安全支持</li>
<li><strong>heap_4</strong>——首次适应算法 + 相邻空闲块合并，STM32 上最常用的方案</li>
<li><strong>heap_5</strong>——heap_4 + 多非连续内存区域支持，需要外部 RAM 时才用到</li>
</ul>
<p>项目中选用 heap_4。它在 <code>FreeRTOSConfig.h</code> 中配置的总堆大小 <code>configTOTAL_HEAP_SIZE</code> 决定了可用于 FreeRTOS 任务栈、队列、信号量等内核对象的动态内存总量。</p>
<p>port.c 选择 <code>GCC/ARM_CM3/port.c</code>——这是针对 Cortex-M3 和 GCC 编译器的 FreeRTOS 移植层。它包含了 <code>vPortSVCHandler</code>（SVC 中断处理，用于启动第一个任务）、<code>xPortPendSVHandler</code>（PendSV 中断处理，用于上下文切换）、<code>vPortSetupTimerInterrupt</code>（SysTick 配置，用于时间片轮转调度）。</p>
<h3>第十九章：FreeRTOSConfig.h 的 CMake 控制</h3>
<p>FreeRTOS 的行为由 <code>FreeRTOSConfig.h</code> 配置。项目中这个文件放在 CubeMX 生成的 <code>Core/Inc/</code> 目录下，但 CMake 构建方式带来了额外的控制维度。</p>
<p>配置项示例：</p>
<pre><code class="language-c">#define configUSE_PREEMPTION            1
#define configUSE_IDLE_HOOK             0
#define configUSE_TICK_HOOK             1
#define configTICK_RATE_HZ              ((TickType_t)1000)
#define configMAX_PRIORITIES            (5)
#define configMINIMAL_STACK_SIZE        ((unsigned short)128)
#define configTOTAL_HEAP_SIZE           ((size_t)(8 * 1024))
#define configMAX_TASK_NAME_LEN         (16)
#define configUSE_TRACE_FACILITY        1
#define configUSE_16_BIT_TICKS          0
#define configIDLE_SHOULD_YIELD         1
#define configUSE_MUTEXES               1
#define configUSE_RECURSIVE_MUTEXES     1
#define configUSE_COUNTING_SEMAPHORES   1
#define configUSE_QUEUE_SETS            0
#define configUSE_TASK_NOTIFICATIONS    1
#define configSUPPORT_STATIC_ALLOCATION 1</code></pre>
<p>关键配置的决策逻辑：</p>
<ul>
<li><strong>configTOTAL_HEAP_SIZE</strong>——8KB。这是 heap_4 管理的总内存池大小，用于分配任务栈、队列、信号量、事件组等内核对象。计算方式：48KB 总 RAM 减去 .data + .bss 的 28KB、减去 FreeRTOS 内核对象本身的静态占用、减去各任务栈静态分配的部分，剩 8KB 作为动态分配池。如果后续新增任务或扩大栈空间，这个值需要相应调整。</li>
<li><strong>configSUPPORT_STATIC_ALLOCATION 1</strong>——启用静态分配 API（<code>xTaskCreateStatic</code>）。项目中大部分任务使用静态分配栈空间——栈在编译期分配为全局数组，不占用 heap 池。这样可以精确控制每个任务的栈大小，避免运行时 <code>pvPortMalloc</code> 失败。</li>
<li><strong>configUSE_TICK_HOOK 1</strong>——使能 Tick Hook 函数 <code>vApplicationTickHook</code>。用于在每次 SysTick 中断中执行短暂的时间敏感操作——如喂 IWDG、收集 CPU 利用率数据。注意 Tick Hook 在中断上下文中执行，必须极短，不能调用任何可能导致阻塞的 FreeRTOS API。</li>
<li><strong>configMAX_PRIORITIES 5</strong>——5 个优先级等级对 7 个任务的管理是足够的。优先级分配原则：时间敏感的中等优先级任务（串口收发、ADC 采样）放在中高优先级，协议处理和状态机放在中等优先级，监控和日志放在低优先级。</li>
</ul>
<p>CMake 可以在 Configure 阶段根据构建类型覆盖 FreeRTOS 配置：</p>
<pre><code class="language-cmake"># Debug 构建：增加 trace 支持、关闭 Tick Hook 避免调试中断
if(CMAKE_BUILD_TYPE STREQUAL "Debug")
    target_compile_definitions(FreeRTOS PRIVATE
        configUSE_TRACE_FACILITY=1
        configUSE_TICK_HOOK=0
    )
endif()</code></pre>
<p>这样 Debug 构建和 Release 构建使用不同的 FreeRTOS 配置——调试时开启跟踪功能、关闭 Tick Hook 避免断点冲突；发布时关闭跟踪、开启 Tick Hook 做 IWDG 喂狗。</p>
<h3>第二十章：任务的 CMake 管理——从宏定义到运行时</h3>
<p>项目中 FreeRTOS 的多个任务分布在不同的层中。CMake 的分层结构让任务的创建和管理有清晰的职责边界：</p>
<ul>
<li><strong>BSP 层</strong>——不定义任何任务，只提供硬件抽象的 API（UART 收发、GPIO 读写、ADC 采样启动、步进电机控制）。BSP 的 API 设计成非阻塞式——启动一个操作后立即返回，通过回调或标志通知完成，不阻塞调用者的任务上下文</li>
<li><strong>Service 层</strong>——定义通信调度任务和协议适配任务。Service 层的任务是 FreeRTOS 的独立任务实体，通过 <code>osThreadNew</code> 在系统初始化阶段创建。这些任务负责串口帧的接收与分发、打印机和屏幕等外设的阻塞式 I/O 调度。Service 层的任务不能直接调用 BSP 的硬件 API——必须通过 Service 层自身封装的动作编排接口</li>
<li><strong>APP 层</strong>——定义顶层控制任务：协议命令处理、状态机流转、系统监控、电机和加热的周期控制。这些任务通过 <code>osThreadNew</code> 在 APP 初始化中创建，它们编排 Service 层的 API 来完成业务逻辑，不直接接触硬件</li>
</ul>
<p>任务栈大小的管理使用集中宏定义：</p>
<pre><code class="language-c">// app_define.h——所有任务栈大小在此集中定义
#define APP_CFG_TASK_PROTO_STACK_SIZE     512   // 协议处理任务栈
#define APP_CFG_TASK_STATE_MACHINE_SIZE   1024  // 状态机任务栈（最大）
#define APP_CFG_TASK_MOTOR_STACK_SIZE     256   // 电机控制任务栈
#define APP_CFG_TASK_ADC_STACK_SIZE       256   // ADC 采样任务栈
#define APP_CFG_TASK_COMM_STACK_SIZE      512   // 通信调度任务栈
#define APP_CFG_TASK_MONITOR_STACK_SIZE   256   // 监控任务栈
#define APP_CFG_TASK_HEATER_STACK_SIZE    256   // 加热控制任务栈</code></pre>
<p>集中管理的关键好处：调整某个任务的栈大小时，只需要改一个宏定义，不需要在三个不同文件的 <code>osThreadNew</code> 调用处分别搜索和修改栈大小参数。栈大小的确定依据来自 <code>-fstack-usage</code> 的统计结果——GCC 针对每个函数输出栈使用量到 <code>.su</code> 文件，汇总每个任务的调用链路径后得到精确的栈需求。</p>
<p>状态机任务 1024 字节是最大的——因为状态机的状态处理函数调用链中包含了协议解析、动作编排和多步时序控制。Comm 通信任务 512 字节用于串口帧的接收缓冲区和协议解析的局部变量。电机任务和 ADC 任务只有 256 字节——它们的处理逻辑是纯数值运算，没有深层函数调用。</p>
<p>CMake 可以通过 <code>target_compile_definitions</code> 从构建系统层面控制这些宏：</p>
<pre><code class="language-cmake"># Debug 构建中，监控任务栈加倍以支持详细日志
if(CMAKE_BUILD_TYPE STREQUAL "Debug")
    target_compile_definitions(app_layer PRIVATE
        APP_CFG_TASK_MONITOR_STACK_SIZE=512
    )
endif()

# Release 构建中，使用静态分配的栈（不占用 heap）
# 通过编译标志选择 xTaskCreate 或 xTaskCreateStatic
target_compile_definitions(app_layer PRIVATE
    APP_CFG_USE_STATIC_ALLOCATION=1
)</code></pre>
<p>这样 Debug 构建和 Release 构建使用不同的栈配置——调试时给监控任务更多栈空间以容纳详细的调试日志，发布时缩小栈以节省 RAM。</p>
<h2>第八部分：构建与调试工作流</h2>
<h3>第二十一章：日常构建命令</h3>
<p>项目推荐的日常开发流程：</p>
<pre><code class="language-bash"># 1. 配置（仅首次 clone 或修改 CMakeLists.txt 后需要）
cmake --preset Debug

# 2. 构建
cmake --build --preset Debug --parallel 8

# 3. 检查链接内存
arm-none-eabi-size build/Debug/final.elf

# 4. 烧录（通过统一烧录脚本）
./tools/flash_firmware.sh openocd

# 5. 调试（启动 GDB 服务器 + 客户端）
openocd -f debug/openocd/stm32f103_daplink.cfg &amp;
arm-none-eabi-gdb build/Debug/final.elf 
    -x debug/gdb/gdbinit</code></pre>
<p><code>--preset</code> 是 CMake 3.20 引入的语法，它在 CMakePresets.json 中查找匹配的 preset，自动读取 preset 中定义的所有参数——generator、toolchainFile、binaryDir、cacheVariables。不需要在命令行中手动指定任何一个配置参数。</p>
<h3>第二十三章：clangd 与编译数据库</h3>
<p>clangd 是 LLVM 工具链中的 C/C++ 语言服务器，提供代码补全、跳转定义、引用查找、诊断等功能。它需要一份 <code>compile_commands.json</code> 来了解每个文件的编译参数。</p>
<p>CMake 在 <code>CMAKE_EXPORT_COMPILE_COMMANDS=ON</code> 时会在输出目录生成 <code>compile_commands.json</code>。这个文件记录了每个源文件的编译器路径、参数、工作目录和 include 路径。clangd 读取后就能准确模拟 GCC 的编译行为。</p>
<p>项目的 <code>.clangd</code> 配置：</p>
<pre><code class="language-yaml">CompileFlags:
  Add:
    - "-DSTM32F103xE"
    - "-DUSE_HAL_DRIVER"
    - "-mcpu=cortex-m3"
    - "-mthumb"
  Remove:
    - "-fstack-usage"
    - "-specs=*"
    - "-Wl,*"</code></pre>
<p>几个关键点：</p>
<ul>
<li>clangd 不支持 <code>-specs=*</code> 和 <code>-Wl,*</code> 这类 GCC 特定参数——如果不移除，clangd 会报 unknown argument 警告</li>
<li><code>-fstack-usage</code> 是 GCC 特有的输出选项，clangd 不识别</li>
<li>手动补充 <code>-DSTM32F103xE</code> 和 <code>-DUSE_HAL_DRIVER</code>——这些宏通过 CMake 的 <code>target_compile_definitions</code> 传到编译器中，但 clangd 有时对这些非标准路径的宏传播解析不完整</li>
</ul>
<h3>第二十四章：OpenOCD 调试集成</h3>
<p>项目使用 CMSIS-DAP 调试探针烧录和调试。OpenOCD 的配置文件：</p>
<pre><code class="language-text"># debug/openocd/stm32f103_daplink.cfg
source [find interface/cmsis-dap.cfg]
transport select swd
source [find target/stm32f1x.cfg]

# 烧录后复位并暂停（等待 GDB 连接）
reset_config srst_only srst_nogate
init
targets
reset halt</code></pre>
<p>烧录脚本封装了上述流程：</p>
<pre><code class="language-bash"># tools/flash_firmware.sh（简化）
openocd -f debug/openocd/stm32f103_daplink.cfg 
    -c "program build/Debug/final.elf verify reset exit"</code></pre>
<p><code>program</code> 命令将 ELF 文件写入 Flash，<code>verify</code> 校验写入的内容，<code>reset</code> 复位芯片，<code>exit</code> 退出 OpenOCD。</p>
<p>IWDG（独立看门狗）的处理：Debug 构建默认关闭看门狗（<code>#undef APP_CFG_IWDG_ENABLE</code>），避免在断点停顿时被看门狗拉复位。Release 构建开启看门狗。调试器侧在 flash 后通过 DBGMCU 寄存器写 <code>0x00000100</code> 让调试暂停时停止看门狗计数。</p>
<h3>第二十五章：代码格式化与持续集成中的代码质量</h3>
<p>CMake 构建系统可以与代码格式化工具集成，在构建过程中自动检查代码风格。项目中集成 clang-format 的方式：</p>
<pre><code class="language-cmake"># 在根 CMakeLists.txt 中添加格式化目标
add_custom_target(format
    COMMAND clang-format -i
        ${CMAKE_SOURCE_DIR}/BSP/Src/*.c
        ${CMAKE_SOURCE_DIR}/BSP/Inc/*.h
        ${CMAKE_SOURCE_DIR}/Service/Src/**/*.c
        ${CMAKE_SOURCE_DIR}/Service/Inc/**/*.h
        ${CMAKE_SOURCE_DIR}/APP/Src/*.c
        ${CMAKE_SOURCE_DIR}/APP/Inc/*.h
    WORKING_DIRECTORY ${CMAKE_SOURCE_DIR}
    COMMENT "Formatting source files with clang-format"
)

# CI 中只检查不格式化
add_custom_target(check-format
    COMMAND clang-format --dry-run --Werror
        ${CMAKE_SOURCE_DIR}/BSP/Src/*.c
        ${CMAKE_SOURCE_DIR}/BSP/Inc/*.h
        ${CMAKE_SOURCE_DIR}/Service/Src/**/*.c
        ${CMAKE_SOURCE_DIR}/Service/Inc/**/*.h
        ${CMAKE_SOURCE_DIR}/APP/Src/*.c
        ${CMAKE_SOURCE_DIR}/APP/Inc/*.h
    WORKING_DIRECTORY ${CMAKE_SOURCE_DIR}
    COMMENT "Checking code formatting"
)</code></pre>
<p>本地开发时运行 <code>cmake --build --preset Debug --target format</code>，CI 中运行 <code>cmake --build --preset Debug --target check-format</code>。这样 clang-format 的版本在 CI 和本地保持一致——都由 CMake 调用宿主的 clang-format，不需要额外配置 pre-commit hook 或 IDE 插件。</p>
<p>GitHub Actions 的 <code>.clang-format</code> 文件放在项目根目录，与 CMakeLists.txt 同级。CI 步骤：</p>
<pre><code class="language-yaml">- name: Check formatting
  run: cmake --build --preset Debug --target check-format</code></pre>
<p>如果提交的代码格式不符合 <code>.clang-format</code> 规则，CI 会失败并输出 diff。开发者本地运行 <code>cmake --build --preset Debug --target format</code> 自动修复后再提交。</p>
<h2>第九部分：CI/CD——超越手工构建</h2>
<h3>第二十六章：GitHub Actions 构建流程</h3>
<p>CI 的工作流定义在 <code>.github/workflows/build.yml</code>：</p>
<pre><code class="language-yaml">name: Firmware Build
on: [push, pull_request]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Restore toolchain cache
        uses: actions/cache@v4
        with:
          path: ~/.toolcache/
          key: arm-gcc-${{ hashFiles('.github/tool-versions.env') }}
      - name: Install toolchain
        run: .github/scripts/install-ci-tools.sh
      - name: Configure
        run: cmake --preset Debug
      - name: Build
        run: cmake --build --preset Debug --parallel $(nproc)
      - name: Memory report
        run: arm-none-eabi-size build/Debug/final.elf
      - name: Archive binary
        uses: actions/upload-artifact@v4
        with:
          name: firmware-debug
          path: build/Debug/final.bin</code></pre>
<p>工具链缓存的策略：</p>
<ul>
<li><code>.github/tool-versions.env</code> 声明工具版本来源（默认 <code>latest</code>）</li>
<li><code>.github/scripts/check-tool-updates.sh</code> 解析 Arm 官方下载页的最新版本</li>
<li>缓存 key 按 Arm GCC + CMake + Ninja 的版本组合生成</li>
<li>只有版本变化时才重新下载工具链，否则命中缓存</li>
<li>如果只有 CMake 升级，Ninja 和 GCC 的缓存仍然有效</li>
</ul>
<h2>第十部分：工程实践与陷阱</h2>
<h3>第二十三章：GLOB_RECURSE 的权衡</h3>
<p><code>file(GLOB_RECURSE)</code> 极大的简化了源文件管理，但它有两个需要注意的行为：</p>
<p><strong>正确定位：把目录结构作为源文件列表。</strong>你在 <code>Src/protocol/</code> 下创建 <code>serial_frame.c</code> 时不需要修改 CMakeLists.txt，重新 <code>cmake --build</code> 就会自动编译它——前提是加入了 <code>CONFIGURE_DEPENDS</code> 参数。<code>CONFIGURE_DEPENDS</code> 告诉 CMake 在每次构建前检查目录内容是否变化，如果有新增或删除文件，自动触发重新 Configure。</p>
<p><strong>不适用场景：条件编译。</strong>同一个文件在某些配置下需要包含、其他配置下需要排除时，GLOB_RECURSE 无法表达这种条件性。应该显式列出这些源文件并使用 generator expression 或 CMake 变量控制。</p>
<p><strong>GLOB_RECURSE 与 Ninja 的交互</strong>：Ninja 的 <code>build.ninja</code> 中所有 GLOB 收集的源文件都依赖于 CMakeLists.txt。修改 CMakeLists.txt（比如注释掉一行配置）会触发所有源文件重新编译。如果某次修改只需要重编少量文件，显式列出源文件比 GLOB 更高效。</p>
<h3>第二十四章：五个最常见陷阱</h3>
<p><strong>陷阱 1：Toolchain 文件没有在 project() 之前生效</strong></p>
<p>新手最容易犯的错误：在根 CMakeLists.txt 里写 <code>set(CMAKE_TOOLCHAIN_FILE cmake/gcc-arm-none-eabi.cmake)</code>。这个写法是无效的——<code>project()</code> 在 CMakeLists.txt 被解析时立即执行编译器检测，而 <code>set(CMAKE_TOOLCHAIN_FILE)</code> 的执行顺序在 <code>project()</code> 之后。正确的做法是通过 <code>CMakePresets.json</code> 的 <code>toolchainFile</code> 字段或 <code>-DCMAKE_TOOLCHAIN_FILE=</code> 命令行参数传入。</p>
<p><strong>陷阱 2：静态库的链接顺序</strong></p>
<p>GCC 的链接器是单遍扫描（single-pass）。链接命令行中，后面的库只会解析前面未被解析的符号。例如 <code>-lapp -lbsp -lservice</code> 会先处理 <code>libapp.a</code>，记录所有未解析的符号，然后依次扫描 <code>libbsp.a</code> 和 <code>libservice.a</code>。如果 <code>libbsp.a</code> 中有一个符号 A 被 <code>libapp.a</code> 引用、但 A 又依赖于 <code>libservice.a</code> 中的符号 B，那么必须确保 <code>libservice.a</code> 出现在 <code>libbsp.a</code> 之后或者使用 <code>--start-group/--end-group</code> 包装。</p>
<p>CMake 的 <code>target_link_libraries</code> 依据 PUBLIC/PRIVATE 的依赖图自动生成正确的链接顺序。不需要手动维护 <code>target_link_libraries(${CMAKE_PROJECT_NAME} ...)</code> 的书写顺序。</p>
<p><strong>陷阱 3：nano.specs 的浮点限制</strong></p>
<p>Newlib-nano 的 <code>printf</code> 实现明确移除了 <code>%f</code> 浮点格式化支持。如果你在代码中写 <code>printf("value = %fn", 3.14f)</code>，输出是 <code>value = 0.000000</code>。解决方案：</p>
<ul>
<li>将浮点数拆分为整数和小数部分：<code>printf("value = %d.%02dn", (int)val, (int)(val * 100) % 100)</code></li>
<li>使用 <code>sprintf</code> 到字符串缓冲区后再输出</li>
<li>如果非要完整浮点支持，替换 <code>nano.specs</code> 为标准 Newlib——代价是 Flash 占用增加 30~50KB</li>
</ul>
<p><strong>陷阱 4：Generator Expression 展开时机</strong></p>
<p>Generator Expression（如 <code>$&lt;$&lt;CONFIG:Debug&gt;:DEBUG&gt;</code>）是在生成构建系统时展开的，不是 CMake Configure 阶段。这意味着你不能把 generator expression 用在需要 Configure 阶段确定值的上下文中——比如 <code>if()</code> 判断、<code>set()</code> 赋值、<code>message()</code> 输出。如果你需要根据构建类型在 Configure 阶段做不同的事情，使用 <code>CMAKE_BUILD_TYPE</code> 变量配合 <code>if()</code> 判断。</p>
<p><strong>陷阱 5：linker script 中的符号与 C 代码的符号命名冲突</strong></p>
<p>linker script 中定义的一些符号以 <code>__</code> 开头（如 <code>__bss_start__</code>、<code>__data_start__</code>）。如果在 C 代码中声明 <code>extern uint32_t __bss_start__;</code> 然后取地址 <code>&amp;__bss_start__</code>，编译器会认为你在引用一个全局变量。正确的用法是 <code>extern uint32_t __bss_start__;</code> 后通过 <code>&amp;__bss_start__</code> 获取地址——C 语言中这会产生一个没有内存位置的符号地址。如果编译器报警告，用 <code>__attribute__((used))</code> 抑制。在 GNU C 中更推荐的写法是使用 <code>void __bss_start__(void)</code> 函数声明——不分配任何存储空间。</p>
<h3>第二十五章：从 CubeIDE 迁移到 CMake 的四步路线</h3>
<p>如果已经有一个正在跑的 CubeIDE 项目，不是必须一次性全部迁移。推荐的四步走策略，每一步都是可逆的，每一步产物都可以独立运行：</p>
<p><strong>第一步：只创建工具链文件。</strong>把 CubeIDE 的编译器参数翻译成 <code>cmake/gcc-arm-none-eabi.cmake</code>。这一步不需要改任何应用代码。用 <code>cmake -B build -DCMAKE_TOOLCHAIN_FILE=cmake/gcc-arm-none-eabi.cmake</code> 验证能识别编译器。</p>
<p><strong>第二步：导入 CubeMX 输出。</strong>在 <code>cmake/stm32cubemx/</code> 下创建 CMakeLists.txt，列出所有 HAL 源文件和 include 路径，以及 FreeRTOS 源文件。编译一次确认能从命令行生成 ELF。此时 CMake 构建和 CubeIDE 构建并行运行，互相独立。</p>
<p><strong>第三步：按层拆分。</strong>把用户代码按 BSP/Service/APP 分到三个目录，各自创建 CMakeLists.txt。每拆一层就编译一次，对比生成的 <code>.map</code> 文件确认内存布局一致。建议拆完一层后在硬件上运行确认功能正常。</p>
<p><strong>第四步：导入 Preset 和 CI。</strong>写 CMakePresets.json，配置 clangd，写 CI workflow。验证本地构建和 CI 构建产物的 <code>.bin</code> 文件哈希一致。</p>
<p>四步完成之后，CubeIDE 的工程文件可以保留作为可选入口——新人或纯调试场景仍然可以用 CubeIDE 打开，核心构建系统由 CMake 接管。CubeIDE 产物的 <code>.bin</code> 和 CMake 产物的 <code>.bin</code> 可以通过 <code>sha256sum</code> 交叉验证。</p>
<h3>第二十六章：多板型支持的设计</h3>
<p>如果项目需要支持多个硬件版本（比如 Rev A 和 Rev B 的引脚不同），CMake 的多板型支持方案：</p>
<ul>
<li>在 Preset 中使用 <code>cacheVariables</code> 传入 <code>BOARD_REV</code> 变量</li>
<li>在 CMakeLists.txt 中使用 <code>if(BOARD_REV STREQUAL "B")</code> 加载不同的源文件</li>
<li>在 BSP 层通过 <code>#ifdef BOARD_REV_B</code> 选择不同的引脚宏</li>
</ul>
<p>Preset 扩展：</p>
<pre><code class="language-json">{
    "name": "Debug-RevB",
    "inherits": "default",
    "cacheVariables": {
        "CMAKE_BUILD_TYPE": "Debug",
        "BOARD_REV": "B"
    }
}</code></pre>
<p>切换板型时：<code>cmake --preset Debug-RevB</code>。</p>
<p>多板型支持的典型场景：Rev A 使用 USART1 作为调试口、USART2 作为通信口；Rev B 交换了两个串口的角色。如果不做多板型支持，每次切换硬件版本都需要手动修改 <code>main.c</code> 中的外设初始化代码或维护两套代码分支。CMake 的多板型方案将板型差异的配置从代码中抽离到构建系统层面——在 BSP 层通过 <code>#ifdef BOARD_REV_B</code> 选择引脚宏，在 Service 层通过 <code>if(BOARD_REV STREQUAL "B")</code> 选择不同的协议初始化参数。</p>
<p>如果板型差异进一步扩大到芯片型号不同（比如 STM32F103RCT6 和 STM32F407VGT6），就需要在 Preset 之外再加一个芯片参数：</p>
<pre><code class="language-json">{
    "name": "Debug-F407-RevB",
    "inherits": "default",
    "cacheVariables": {
        "CMAKE_BUILD_TYPE": "Debug",
        "MCU": "STM32F407VG",
        "BOARD_REV": "B",
        "LINKER_SCRIPT": "STM32F407VG_FLASH.ld"
    }
}

{
    "name": "Debug-F103-RevA",
    "inherits": "default",
    "cacheVariables": {
        "CMAKE_BUILD_TYPE": "Debug",
        "MCU": "STM32F103RC",
        "BOARD_REV": "A",
        "LINKER_SCRIPT": "STM32F103XX_FLASH.ld"
    }
}</code></pre>
<p>这样两个芯片型号、两个硬件版本的构建入口都用同一个 CMakeLists.txt、同一份 CMakePresets.json管理。不需要维护两套根 CMakeLists.txt 或在构建前手动替换 linker script。</p>
<h3>第二十七章：关于 CTest 的现状与未来</h3>
<p>当前项目没有使用 CTest 做单元测试。STM32 裸机固件的测试分三个层次：</p>
<div class="arcaea-table-wrap" data-bac-table-shell="1"><table>
<tr>
<th>层次</th>
<th>方法</th>
<th>工具</th>
<th>当前状态</th>
</tr>
<tr>
<td>编译期测试</td>
<td>检查构建是否通过、链接内存是否超限</td>
<td>CMake + --print-memory-usage</td>
<td>已集成在 CI 中</td>
</tr>
<tr>
<td>逻辑层测试</td>
<td>在 x86_64 宿主上编译 Service/APP 的逻辑代码，mock BSP 接口</td>
<td>CTest + Unity/CMock</td>
<td>规划中</td>
</tr>
<tr>
<td>硬件回归测试</td>
<td>烧录固件到硬件，运行自动化协议脚本</td>
<td>Python + 串口</td>
<td>手动执行</td>
</tr>
</table></div>
<p>CMake 分层架构天然支持逻辑层测试：测试 Service 层的状态机代码时，只需要编译 Service 层的源文件、link 一个 mock 版的 bsp_layer，不需要烧录到硬件即可在 Linux 上运行测试用例。</p>
<h2>总结</h2>
<p>有几个要点再强调一下：第一，CMake 的价值不在于比 IDE 更智能，而在于把构建逻辑从 GUI 点击转换为可版本管理的纯文本脚本。第二，三层分层的核心优势不是代码组织美观，而是编译期的依赖控制——让错误的依赖在编译时暴露而不是在运行时崩。第三，从 CubeIDE 迁移到 CMake 不是全有或全无的选择，四步走的策略让每一步都可验证可逆。</p>
<p>几年前还在用 Keil 的时候，每个团队成员都要在本地维护一份 <code>.uvprojx</code>，谁改了一个文件不通知就等着构建炸锅。换到 CMake 之后，加文件、加层、加板型、换工具链都不需要手动同步工程配置了。团队的时间花在写逻辑上，而不是对齐构建环境。</p>
<p>STM32 的 CMake 体系核心就是四个文件：</p>
<ul>
<li><strong>工具链文件</strong>——告诉 CMake 编译器在哪、参数是什么</li>
<li><strong>CMakePresets.json</strong>——标准化构建入口，统一本地和 CI</li>
<li><strong>各层 CMakeLists.txt</strong>——定义编译单位的依赖关系和可见性</li>
<li><strong>Linker Script</strong>——定义内存布局，控制 section 放置</li>
</ul>
<p>理解了这四块的工作原理，比记住 IDE 界面上几百个配置项更持久。但一个健康的构建系统不仅仅是能编译——它还需要在团队协作中保持可复现性和可调试性。以下是从实际项目中提取的几个关键约束，适用于任何使用 CMake 的嵌入式固件项目：</p>
<div class="arcaea-table-wrap" data-bac-table-shell="1"><table>
<tr>
<th>约束</th>
<th>为什么重要</th>
<th>如何检查</th>
</tr>
<tr>
<td>Git 检出后执行两次命令即可构建</td>
<td>新人加入零配置时间</td>
<td>在空白 Linux 容器中 git clone → cmake --preset Debug → cmake --build</td>
</tr>
<tr>
<td>本地和 CI 使用相同 Preset</td>
<td>消除「CI 上能过、本地不能」</td>
<td>CI 和本地文档指向同一份 CMakePresets.json</td>
</tr>
<tr>
<td>CMakeLists.txt 中不含绝对路径</td>
<td>换机器不需要改构建文件</td>
<td>grep 检查所有 ${CMAKE_SOURCE_DIR} 的使用是否合理</td>
</tr>
<tr>
<td>改源文件不改 CMakeLists.txt</td>
<td>加文件动作不污染构建文件 diff</td>
<td>使用 GLOB_RECURSE 或显式列出但不混用</td>
</tr>
<tr>
<td>各层 CMakeLists.txt 独立可读</td>
<td>按目录定位问题，不需要理解全貌</td>
<td>新成员能否只读一个子目录就理解该层的构建</td>
</tr>
</table></div>
<p>多年前还在用 Keil 的时候，每个团队成员都要在本地维护一份 <code>.uvprojx</code>，谁改了一个文件不通知就等着构建炸锅。换到 CMake 之后，加文件、加层、加板型、换工具链都不需要手动同步工程配置了。团队的时间花在写逻辑上，而不是对齐构建环境。更重要的是，当项目规模从几万行代码增长到十几万行时，CMake 的分层结构让增量修改的影响范围变得可预测——改 BSP 不会碰 Service 的缓存，改一个任务的栈大小不需要搜遍整个代码库。</p>
<hr>
<p style="color: var(--text-muted); font-size: 0.9em;">基于 /root/develop/Packaging_machine_V1.0 真实生产项目撰写</p>
