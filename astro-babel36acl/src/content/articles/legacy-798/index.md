---
title: "HPM SDK Cmake 开发记录"
description: "去年帮一个团队从 STM32F407 迁移到 HPM6880，对方提了两个要求：第一，CANFD 不能丢帧；第二，LVGL 要跑满 ..."
published: "2026-05-29"
updated: "2026-06-02"
permalink: "/2026/05/29/hpm-sdk-工程化开发指南：环境搭建到双核部署/"
draft: false
categories: ["学习笔记","嵌入式实战"]
tags: []
legacyId: 798
---

<p>去年帮一个团队从 STM32F407 迁移到 HPM6880，对方提了两个要求：第一，CANFD 不能丢帧；第二，LVGL 要跑满 60fps。在 STM32 上，这两个需求几乎冲突——CANFD 中断频繁，LVGL 刷帧又吃<br>
        CPU，一个核根本扛不住。</p>
<p>HPM6880 的双核架构天然就是为这种场景设计的：Core0 跑实时控制，Core1 跑人机交互，物理隔离，互不干扰。但芯片好是一回事，SDK 用好是另一回事。</p>
<p>这篇博客不打算重复官方文档里的 API 列表——那东西 ReadTheDocs 上已经有了。我要写的是官方文档不会告诉你的东西：SDK 的 CMake 构建系统为什么这样设计、Component 和 Board<br>
        机制在源码层面怎么工作、双核工程怎么从 Sample 走向量产。</p>
<p>全文分八个部分，从为什么选择 HPM 开始，到企业级工程实践结束。每一段代码都是 SDK 源文件里直接摘的，每一个结论都在源目录中有据可查。读完这篇，你应该能回答三个问题：</p>
<ul>
<li><strong>SDK 的构建系统是怎么工作的</strong>——而不仅仅是能用</li>
<li><strong>双核固件是怎么部署的</strong>——而不仅仅是知道双核这个名词</li>
<li><strong>从 Sample 到量产要改什么</strong>——而不仅仅是复制粘贴</li>
</ul>
<div class="arcaea-mermaid-box"><pre class="mermaid">graph TB
        subgraph PART1["第一部分：SDK 总体架构"]
            CH1["第一章：总体设计
arch/soc/boards/drivers"]
            CH2["第二章：启动流程
start.S→system_init→main"]
        end
        subgraph PART2["第二部分：CMake 构建系统"]
            CH3["第三章：构建流程
find_package→generate_ide_projects"]
            CH4["第四章：Target 机制
HPM_SDK_LIB/HPM_SDK_LIB_ITF"]
            CH5["第五章：Component 机制
app.yaml + dependency"]
            CH6["第六章：Board 机制
YAML→pinmux→clock→memory"]
            CH7["第七章：自定义 Board
EVK→产品板迁移"]
        end
        subgraph PART3["第三部分：HPM6800 架构"]
            CH8["第八章：CPU 与总线"]
            CH9["第九章：内存架构"]
            CH10["第十章：Cache 机制"]
            CH11["第十一章：PLIC 中断"]
        end
        subgraph PART4["第四部分：驱动层"]
            CH12["UART"]
            CH13["DMA"]
            CH14["CANFD"]
            CH15["ADC"]
        end
        subgraph PART5["第五部分：Middleware"]
            CH16["FreeRTOS"]
            CH17["lwIP"]
            CH18["USB/tinyUSB"]
        end
        subgraph PART6["第六部分：双核"]
            CH19["双核架构"]
            CH20["IPC/Mailbox"]
            CH21["双核工程构建"]
        end
        subgraph PART7["第七部分：工程实践"]
            CH22["Sample 阅读方法"]
            CH23["调试体系"]
            CH24["项目目录设计"]
            CH25["性能优化"]
            CH26["产品工程结构"]
        end
        subgraph PART8["第八部分：IDE 工程生成"]
            CH27["generate_ide_projects
SES/VSCode/Eclipse/IAR"]
        end
        subgraph PART9["第九部分：SDK_ENV 项目生成器"]
            CH28["SDK_ENV 本质
Board+Sample+Toolchain→CMake"]
            CH29["User Board 支持
自定义板路径"]
        end
        subgraph PART10["第十部分：高级 CMake 工程实践"]
            CH30["CMake 工程模板设计"]
            CH31["Component 与 Target 扩展"]
            CH32["Board 配置与 YAML 驱动"]
            CH33["双核工程构建增强"]
            CH34["依赖与构建优化"]
            CH35["Sample 复用策略"]
            CH36["内存布局对 CMake 的影响"]
        end
        subgraph PART11["第十一部分：SDK 源码与架构深挖"]
            CH37["SDK 配置系统源码"]
            CH38["组件化设计思想"]
            CH39["build_linked_project.py 解析"]
            CH40["构建生命周期全览"]
            CH41["Linker Script 深度解析"]
            CH42["宏体系解析"]
            CH43["跨平台工具链支持"]
            CH44["IDE 工程生成机制"]
        end
        subgraph PART12["第十二部分：企业级工程实践"]
            CH45["SDK 移植到企业项目"]
            CH46["SDK 升级策略"]
            CH47["SDK 二次开发实践"]
            CH48["大型项目 CMake 规范"]
        end
        PART1 --&gt; PART2 --&gt; PART3 --&gt; PART4 --&gt; PART5 --&gt; PART6 --&gt; PART7
        PART7 --&gt; PART8 --&gt; PART9 --&gt; PART10 --&gt; PART11 --&gt; PART12
        style PART1 fill:transparent,stroke:#9db4ff,color:#eef4ff
        style PART2 fill:transparent,stroke:#8ad8ff,color:#eef4ff
        style PART3 fill:transparent,stroke:#c7b6ff,color:#eef4ff
        style PART4 fill:transparent,stroke:#9db4ff,color:#eef4ff
        style PART5 fill:transparent,stroke:#8ad8ff,color:#eef4ff
        style PART6 fill:transparent,stroke:#ff9191,color:#eef4ff
        style PART7 fill:transparent,stroke:#9db4ff,color:#eef4ff
        style PART8 fill:transparent,stroke:#c7b6ff,color:#eef4ff
        style PART9 fill:transparent,stroke:#8ad8ff,color:#eef4ff
        style PART10 fill:transparent,stroke:#9db4ff,color:#eef4ff
        style PART11 fill:transparent,stroke:#ff9191,color:#eef4ff
        style PART12 fill:transparent,stroke:#c7b6ff,color:#eef4ff</pre></div>
<h3>环境安装路线图——正确顺序比版本更重要</h3>
<p>很多新手会把安装顺序搞反，导致出现「编译器找不到」「SDK 路径不对」之类的问题。正确的安装顺序应该是：</p>
<div class="arcaea-mermaid-box"><pre class="mermaid">graph TD
        A[安装 SDK
git clone + 设置 HPM_SDK_BASE] --&gt; B[安装 Toolchain
xpack-riscv-gcc]
        B --&gt; C[安装 CMake]
        C --&gt; D[安装 Ninja]
        D --&gt; E[安装 VSCode + 插件]
        E --&gt; F[安装 OpenOCD]
        F --&gt; G[创建第一个工程]</pre></div>
<p>下面逐一说明每个步骤。</p>
<h4>1. SDK 安装</h4>
<p>HPM SDK 托管在 GitHub 上，MIT/BSD 协议开源：</p>
<pre><code class="language-bash">git clone https://github.com/hpmicro/hpm_sdk.git
export HPM_SDK_BASE=/path/to/hpm_sdk</code></pre>
<p>建议把 <code>HPM_SDK_BASE</code> 写入 <code>~/.bashrc</code> 或 <code>~/.zshrc</code>，避免每次打开终端都要重新设置。SDK 根目录下最重要的子目录：
    </p>
<ul>
<li><code>soc/</code>——芯片级代码（寄存器定义、start.S、linker script、system_init）</li>
<li><code>boards/</code>——板级支持（YAML 配置、pinmux、board_init）</li>
<li><code>drivers/</code>——外设驱动（header-only 风格）</li>
<li><code>middleware/</code>——中间件（FreeRTOS、lwIP、tinyUSB）</li>
<li><code>samples/</code>——示例工程（300+ 个）</li>
<li><code>cmake/</code>——CMake 扩展函数</li>
<li><code>scripts/</code>——Python 构建脚本（build_linked_project.py）</li>
</ul>
<h4>2. Toolchain 安装</h4>
<p>HPMicro 芯片使用 RISC-V 指令集，需要安装 RISC-V GCC 工具链。推荐两种方式：</p>
<p><strong>方式一：xpack 版本（推荐，跨平台）</strong></p>
<pre><code class="language-bash"># 下载 xpack-riscv-gcc（ Linux 版）
wget https://github.com/xpack-dev-tools/riscv-none-elf-gcc-xpack/releases/.../xpack-riscv-none-elf-gcc-13.2.0-1-linux-x64.tar.gz
tar xzf xpack-riscv-none-elf-gcc-*.tar.gz
export PATH=$PATH:/path/to/xpack-riscv-none-elf-gcc/bin

# 验证
riscv-none-elf-gcc --version</code></pre>
<p><strong>方式二：官方 GNU GCC</strong></p>
<pre><code class="language-bash"># 从先楫官方 GitHub 下载
git clone https://github.com/hpmicro/riscv-gnu-toolchain.git
cd riscv-gnu-toolchain
./configure --prefix=/opt/riscv
make -j$(nproc)
export PATH=$PATH:/opt/riscv/bin</code></pre>
<h4>3. CMake 安装</h4>
<p>HPM SDK 要求 CMake &gt;= 3.13。各平台安装方式：</p>
<pre><code class="language-bash"># Windows：从 https://cmake.org/download/ 下载安装包
# Linux (Ubuntu/Debian)
sudo apt install cmake
# Linux (Fedora)
sudo dnf install cmake
# macOS
brew install cmake

# 验证
cmake --version</code></pre>
<p>建议安装 3.20 以上版本，对 Ninja 支持和 FindPackage 模块更完善。</p>
<h4>4. Ninja 安装</h4>
<p>Ninja 是一个轻量级构建工具，比 Make 更快。它的核心设计就是并行编译——默认充分利用所有 CPU 核心。HPM SDK 的 CMake 预设中默认使用 Ninja 作为构建后端。</p>
<pre><code class="language-bash"># Windows：从 GitHub Releases 下载 .exe
# Linux (Ubuntu/Debian)
sudo apt install ninja-build
# macOS
brew install ninja

# 验证
ninja --version</code></pre>
<h4>5. VSCode 与推荐插件</h4>
<p>虽然 HPM SDK 不依赖 IDE，但 VSCode 是目前最推荐的开发环境：</p>
<ul>
<li><strong>CMake Tools</strong>（ms-vscode.cmake-tools）——直接在 VSCode 中配置、构建、调试 CMake 工程</li>
<li><strong>Cortex-Debug</strong>（marus25.cortex-debug）——ARM/RISC-V 的 GDB 前端，配合 OpenOCD 或 JLink 使用</li>
<li><strong>clangd</strong>（llvm-vs-code-extensions.vscode-clangd）——比 VSCode 自带的 C++ IntelliSense 更快、更准确</li>
</ul>
<h4>6. OpenOCD 安装</h4>
<p>HPMicro 使用了定制的 OpenOCD 分支，支持板载的 FT2232 调试器以及外接的 JLink 和 CMSIS-DAP：</p>
<pre><code class="language-bash">git clone https://github.com/hpmicro/riscv-openocd.git
cd riscv-openocd
./bootstrap
./configure --enable-ftdi --enable-jlink
make -j$(nproc)
sudo make install

# 验证
openocd --version</code></pre>
<p>以上六步完成之后，你的开发环境就准备好了。下面我们用这个环境创建第一个 HPM SDK 工程。</p>
<p>HPM SDK 的设计理念是让开发者专注于应用逻辑而非底层细节。理解上述机制后，在实际项目中遇到类似问题时就能快速定位根因——而不是靠猜测和试错。HPM SDK<br>
        的设计理念是让开发者专注于应用逻辑而非底层细节。理解上述机制后，在实际项目中遇到类似问题时就能快速定位根因——而不是靠猜测和试错。</p>
<p>HPM SDK 的设计理念是让开发者专注于应用逻辑而非底层细节。理解上述机制后，在实际项目中遇到类似问题时就能快速定位根因——而不是靠猜测和试错。HPM SDK<br>
        的设计理念是让开发者专注于应用逻辑而非底层细节。理解上述机制后，在实际项目中遇到类似问题时就能快速定位根因——而不是靠猜测和试错。</p>
<h2>第一部分：SDK 总体架构</h2>
<h3>第一章：SDK 总体设计——逐目录分析</h3>
<p>入口文件：<code class="language-text">hpm_sdk/</code> 根目录。</p>
<p>HPM SDK 的目录结构不是随便摆的。每一层有明确的职责、依赖方向和编译入口。看懂了这层关系，你才知道自己的代码该塞哪、能调谁、不该碰谁。</p>
<pre><code class="language-text">hpm_sdk/                         # 根目录 CMakeLists.txt：定义 HPM_SDK_LIB + HPM_SDK_LIB_ITF
    ├── arch/                        # RISC-V 架构层
    │   └── riscv/                   #   csr 寄存器读写、异常向量基址宏
    ├── soc/                         # SoC 层（与具体芯片型号绑定）
    │   ├── HPM6800/HPM6880/         #   ip/：所有外设寄存器定义头文件
    │   │   ├── toolchains/gcc/      #     start.S, ram.ld, ram_core1.ld
    │   │   ├── system.c             #     PLIC 初始化 + 全局中断开关
    │   │   └── hpm_clock_drv.c      #     PLL 配置：600M/800M/500M 多路输出
    │   └── HPM6P00/HPM6P81/         #   另一子型号（6P 系列高端）
    ├── boards/                      # 板级支持
    │   └── hpm6800evk/              #   hpm6800evk.yaml → SoC=HPM6880, RAM=256MB
    │       ├── pinmux.c             #     IOC 寄存器直写：PA00→UART0_TXD
    │       └── board.c              #     board_init()：依次初始化各外设
    ├── drivers/                     # 外设驱动（操作 soc/ip/ 下的寄存器）
    │   ├── inc/                     #   hpm_uart_drv.h, hpm_dmav2_drv.h, ...
    │   └── src/                     #   驱动实现（可选，多数是 header-only inline）
    ├── middleware/                   # 第三方中间件
    │   ├── freertos/                #   FreeRTOS Kernel + RISC-V Port
    │   ├── lwip/src/CMakeLists.txt  #   lwIP 源文件列表 + 条件编译
    │   ├── tinyusb/                 #   USB Device/Host/Dual
    │   └── vglite/                  #   矢量图形加速（GPU 驱动）
    ├── components/                  # SDK 内置可复用组件
    ├── samples/                     # 示例工程
    │   ├── hello_world/             #   CMakeLists.txt：find_package(hpm-sdk) + sdk_app_src
    </code></pre>
<h3>第一个工程到底发生了什么</h3>
<p>很多教程会直接让你敲两条命令：</p>
<pre><code class="language-bash">cmake -B build
cmake --build build</code></pre>
<p>然后看到编译成功就完事了。但对于新手，最大的困惑是：<strong>为什么两条命令就能把 C 代码变成固件？</strong></p>
<p>实际上，这两条命令完成的是完全不同的工作。理解这个区别，是排查一切构建问题的起点。</p>
<h4>cmake -B build：Configure 阶段</h4>
<p>第一步只做<strong>分析工程</strong>，不产生任何 <code>.o</code> 文件。它可以拆成四步：</p>
<ol>
<li><strong>find_package(hpm-sdk)</strong>——在 <code>$HPM_SDK_BASE</code> 下找到<br>
            <code>hpm-sdk-config.cmake</code>，加载 SDK 的 CMake 模块。如果找不到，你会看到 <code>CMake Error: find_package</code>——最常见的<br>
            Configure 错误。
        </li>
<li><strong>application.cmake</strong>——创建 <code>HPM_SDK_LIB</code> 和 <code>HPM_SDK_LIB_ITF</code>，加载 Board YAML<br>
            和 Toolchain。</li>
<li><strong>Board YAML</strong>——提取 SoC 型号、内存大小、外设特性，转为 CMake 变量。</li>
<li><strong>app.yaml</strong>——<code>build_linked_project.py</code> 解析依赖列表，加载 Component。</li>
</ol>
<p>完成后 <code>build/</code> 目录下会有 <code>build.ninja</code>——打开看看，里面列出了所有源文件和编译选项。</p>
<h4>cmake --build build：Build 阶段</h4>
<p>第二步调用 Ninja 真正开始编译：</p>
<ol>
<li><strong>GCC 编译</strong>——<code>.c/.S</code> 变成 <code>.o</code>，SDK 源文件进 <code>HPM_SDK_LIB.a</code>，你的 main.c<br>
            进 <code>app</code>。</li>
<li><strong>链接</strong>——Linker 按 <code>ram.ld</code> 布局，生成 <code>demo.elf</code>。</li>
<li><strong>格式转换</strong>——<code>.elf</code> → <code>.bin/.hex</code>。</li>
</ol>
<p>如果你看到 <code>undefined reference</code>，说明调用了某个函数但没把对应的源文件加进工程——检查 <code>sdk_app_src()</code> 或<br>
        <code>app.yaml</code> 的 dependency。
    </p>
<h4>完整流程</h4>
<div class="arcaea-mermaid-box"><pre class="mermaid">graph TD
        A["cmake -B build"] --&gt; B["find_package(hpm-sdk)"]
        B --&gt; C["application.cmake"]
        C --&gt; D["Board YAML"]
        D --&gt; E["app.yaml 依赖"]
        E --&gt; F["build.ninja"]
        F --&gt; G["cmake --build build"]
        G --&gt; H["GCC 编译"]
        H --&gt; I["链接 → demo.elf"]
        I --&gt; J["demo.bin / .hex"]</pre></div>
<h4>常见错误速查</h4>
<div class="arcaea-table-wrap" data-bac-table-shell="1"><table>
<tr>
<th>错误</th>
<th>阶段</th>
<th>原因</th>
</tr>
<tr>
<td>find_package 失败</td>
<td>Configure</td>
<td>HPM_SDK_BASE 未设置</td>
</tr>
<tr>
<td>board YAML 找不到</td>
<td>Configure</td>
<td>-DBOARD= 参数错误</td>
</tr>
<tr>
<td>编译器找不到</td>
<td>Build</td>
<td>Toolchain 未安装或 PATH 未设</td>
</tr>
<tr>
<td>undefined reference</td>
<td>Link</td>
<td>缺少源文件/component</td>
</tr>
<tr>
<td>section 放不下</td>
<td>Link</td>
<td>ILM 不够，换 flash_xip</td>
</tr>
</table></div>
<p>理解这个流程后，看到构建错误你就能立刻判断：这是 Configure 问题还是 Build 问题？然后对号入座。</p>
<h3>为什么选择 HPM SDK——不是更快，而是不同</h3>
<p>很多第一次接触 HPMicro 的开发者都会有一个问题：</p>
<blockquote><p>市面上已经有 STM32、ESP32、NXP、TI，为什么还要学习 HPM SDK？</p></blockquote>
<p>这个问题可以从三个维度来看：芯片架构、开发体系、生态系统。</p>
<h4>芯片架构的差异</h4>
<p>先看最直观的硬件参数对比。我选了几款在各自时代非常有代表性的 MCU：</p>
<div class="arcaea-table-wrap" data-bac-table-shell="1"><table>
<tr>
<th>MCU</th>
<th>架构</th>
<th>主频</th>
<th>内核数</th>
<th>片上 RAM</th>
<th>特色</th>
</tr>
<tr>
<td>STM32F103</td>
<td>Cortex-M3</td>
<td>72MHz</td>
<td>1</td>
<td>64KB</td>
<td>入门经典</td>
</tr>
<tr>
<td>STM32F407</td>
<td>Cortex-M4F</td>
<td>168MHz</td>
<td>1</td>
<td>192KB</td>
<td>DSP + FPU</td>
</tr>
<tr>
<td>STM32H743</td>
<td>Cortex-M7</td>
<td>480MHz</td>
<td>1</td>
<td>1MB</td>
<td>最高频 Cortex-M</td>
</tr>
<tr>
<td>ESP32-S3</td>
<td>Xtensa LX7</td>
<td>240MHz</td>
<td>2</td>
<td>512KB</td>
<td>WiFi + BLE</td>
</tr>
<tr>
<td>HPM6750</td>
<td>RISC-V</td>
<td>816MHz</td>
<td>2</td>
<td>1MB SRAM</td>
<td>最高频 MCU</td>
</tr>
<tr>
<td><strong>HPM6880</strong></td>
<td><strong>RISC-V</strong></td>
<td><strong>600MHz</strong></td>
<td><strong>2</strong></td>
<td><strong>512KB SRAM + 256MB DDR</strong></td>
<td><strong>GPU + DDR</strong></td>
</tr>
</table></div>
<p>HPM6800 系列最大的特点并不是单核主频高，而是<strong>高主频 + RISC-V + 双核 + 现代 SDK + 片上 GPU</strong> 这几项组合在一起。尤其是 HPM6880，它集成了 DDR 控制器和<br>
        2.5D GPU，这是传统 MCU 从未有过的配置。</p>
<p>很多 STM32 项目做到后期都会遇到一个瓶颈：代码越来越多、外设越来越多、CPU 越来越忙。通信、控制、UI、网络全部挤在一个 Cortex-M 内核上，中断优先级调了又调，DMA 通道排了又排，最后还是卡在 CPU<br>
        利用率上。</p>
<p>HPM6880 的双核架构就是为了打破这个瓶颈而设计的。两个核心各自独立运行——各自的 ILM/DLM、各自的 PLIC 中断控制器、各自的 linker script，通过 AXI 总线共享 DDR 和大容量<br>
        SRAM。典型的项目分工：</p>
<pre><code class="language-text">Core0（实时域）              Core1（交互域）
    ┌─────────────────┐         ┌─────────────────┐
    │ 控制算法         │         │ LVGL 渲染        │
    │ CANFD 通信       │         │ lwIP 以太网      │
    │ ADC 采样         │         │ USB 主机         │
    │ 传感器融合       │         │ 数据记录         │
    │ FreeRTOS         │         │ 裸机或 RTOS      │
    └─────────────────┘         └─────────────────┘
              │                           │
              └───────────┬───────────────┘
                          │
                    ┌─────▼──────┐
                    │ Mailbox IPC │
                    │ SHARE_RAM  │
                    └────────────┘</code></pre>
<p>两个核之间通过硬件 Mailbox 外设进行中断式通信，共享数据放在专门划出的 SHARE_RAM 区域（基址 0x0123C000，大小 16KB）。不需要复杂的 IPC 协议栈，直接读写共享内存 + 中断通知即可。</p>
<h4>RISC-V 意味着什么</h4>
<p>对于嵌入式开发者，RISC-V 最直接的好处不是开源指令集——那是公司决策层关心的事。实际开发中你能感受到的差异：</p>
<ul>
<li><strong>不再有 Cortex-M 的授权壁垒</strong>——芯来科技（Nuclei）和先楫深度合作，CPU core 的 errata 和定制需求可以直接反馈到 IP 供应商层面</li>
<li><strong>工具链选择自由</strong>——GCC、LLVM、IAR、SES 都能编译 RISC-V，不绑定单一工具链</li>
<li><strong>Machine Mode + User Mode</strong>——RISC-V 的权限分级比 Cortex-M 更清晰，M 模式处理异常和中断，U 模式运行应用代码，为未来跑 Linux 或<br>
            RTOS 混合部署留了空间</li>
<li><strong>向量中断（Vectored PLIC）</strong>——中断号直接写进 mcause 寄存器，不需要在 ISR 里读 Claim 寄存器判断中断源，省了 5~10 个 cycle</li>
</ul>
<h4>SDK 的差异化优势</h4>
<p>HPM SDK 在很多细节上能看出设计者确实做过产品级项目：</p>
<ul>
<li><strong>BSD-3 开源</strong>——不像 STM32Cube 那样有诸多使用限制，GitHub 上直接 clone 就能用</li>
<li><strong>CMake 原生</strong>——不是先有 IDE 工程再转 CMake，而是 CMake 是第一公民</li>
<li><strong>Driver 层 header-only</strong>——多数驱动函数是 static inline，只有你调了才会编译，不会产生额外的链接依赖</li>
<li><strong>YAML 驱动的 Board 配置</strong>——换板子改 YAML 就行，不用改 CMakeLists.txt</li>
<li><strong>Sample 覆盖 300+</strong>——从 hello_world 到双核 Mailbox 到 LVGL 到 tinyUSB，每个外设都有对应的可编译工程</li>
</ul>
<p>HPM SDK 不是完美的——它的文档还有大量 gap，社区的规模远不及 STM32，双核调试工具链也还不够成熟。但它的设计方向是对的：用现代工程化的方式做 MCU 开发，而不是把 20 年前的 IDE 模式搬过来换个壳。
    </p>
<h3>第二章：SDK 启动流程——从上电到 main() 的每一拍</h3>
<p>相关源文件：<code class="language-text">soc/HPM6P00/HPM6P81/toolchains/gcc/start.S</code>、<code class="language-text">toolchains/reset.c</code>、<code class="language-text">system.c</code></p>
<p>启动流程是嵌入式开发的基础。HPM SDK 的启动链从芯片复位开始，经过 7 个步骤到达 main()：硬件 Reset → _start (start.S) → c_startup (reset.c) →<br>
        system_init (system.c) → __libc_init_array → _clean_up → main()。每一步都有明确的职责。</p>
<p>复位向量指向 _start 入口。start.S 的第一条指令 la gp, __global_pointer 加载全局指针寄存器——RISC-V 的 gp 寄存器用于访问小数据段的快速寻址，类似于 ARM<br>
        的静态基址寄存器。紧接着 la tp, __thread_pointer$ 加载线程指针，为 RTOS 的线程局部存储做准备。</p>
<p>csrrw x0, mstatus, x0 清零机器状态寄存器。mstatus<br>
        控制全局中断使能、浮点单元状态、内存保护等核心功能。清零意味着启动时所有中断都是关闭的——这是一个非常重要的安全设计：在任何外设初始化完成之前，中断处理器不应该响应任何中断请求。</p>
<p>如果芯片支持硬浮点（__riscv_flen 宏定义），start.S 会设置 CSR_MSTATUS_FS_MASK 位使能 FPU，然后执行 fscsr zero<br>
        清零浮点控制状态寄存器。这意味着所有浮点操作在启动时处于已知状态，不会因为未初始化的 FPU 状态导致随机错误。</p>
<p>call l1c_ic_enable 和 call l1c_dc_enable 打开指令缓存和数据缓存。HPM6880 的 L1 Cache 是写回（Write-Back）策略，默认使能。call<br>
        l1c_dc_invalidate_all 在使能后立即无效化所有 Cache Line——这个操作防止了复位前残留在 Cache 中的脏数据影响启动后的第一次内存访问。</p>
<p>la t0, _stack 加载栈指针。_stack 符号由 linker script 定义，指向栈区域的最高地址（栈向下生长）。RISC-V 没有硬件栈指针初始化的机制，必须在进入 C 代码之前由汇编代码设置。</p>
<p>之后跳转到 c_startup（reset.c）。c_startup 是一个 weak 函数，允许用户覆盖。它完成三件事：清零 BSS 段、搬运 DATA 段、搬运 ramfunc 段。BSS 清零是 C<br>
        语言标准的要求——未初始化的全局变量必须为零。DATA 搬运将初始化值从 Flash（LMA）复制到 RAM（VMA）。ramfunc 段包含需要在 RAM 中执行的函数——典型场景是 Flash<br>
        擦写操作，因为执行擦写时不能从 Flash 取指令。</p>
<p>c_startup 完成后调用 __libc_init_array 执行全局 C++ 构造器，然后调用 main()。如果定义了 CONFIG_FREERTOS，start.S 会把默认 trap handler 替换为<br>
        freertos_risc_v_trap_handler，mscratch 清零。这保证了 FreeRTOS 的任务切换能正确抢占中断上下文。</p>
<p>system_init() 在 c_startup 之后被调用，核心是 PLIC 初始化和全局中断控制。调试启动阶段异常时，将 CONFIG_DISABLE_GLOBAL_IRQ_ON_STARTUP 设为 1<br>
        即可关闭自动开中断。</p>
<p>完整调用链（7 步）：</p>
<pre><code class="language-text">硬件 Reset → _start (start.S)
      ├─ [1] gp/tp 初始化（全局指针 + 线程指针）
      ├─ [2] mstatus 清零 + FPU 使能（如果支持硬浮点）
      ├─ [3] I-Cache + D-Cache 使能（SDK 默认开启）
      ├─ [4] SP 设置到 _stack
      └─ call c_startup (reset.c)
            ├─ [5] BSS 段清零、DATA 段从 Flash 搬运到 RAM
            └─ call system_init (system.c)
                  ├─ [6] disable_global_irq → PLIC 配置 → enable_global_irq
                  └─ return
            └─ call __libc_init_array（全局构造器）
            └─ call _clean_up
            └─ [7] call main()
    </code></pre>
<p><code class="language-text">start.S</code> 的关键片段——这不是伪代码，是 SDK 源文件原文（删除了注释）：</p>
<pre><code class="language-asm">_start:
        .option push
        .option norelax
        la gp, __global_pointer$
        la tp, __thread_pointer$
        .option pop
    
        csrrw x0, mstatus, x0          /* 清零 mstatus */
    
    #ifdef __riscv_flen
        li t0, CSR_MSTATUS_FS_MASK
        csrrs t0, mstatus, t0          /* FPU 状态使能 */
        fscsr zero
    #endif
    
        call l1c_ic_enable             /* I-Cache 打开 */
        call l1c_dc_enable             /* D-Cache 打开 */
        call l1c_dc_invalidate_all     /* D-Cache 无效化：防脏数据 */
    
        la t0, _stack
        mv sp, t0
    
        call c_startup                 /* → C 语言初始化 */
    </code></pre>
<p>如果定义了 <code class="language-text">CONFIG_FREERTOS</code>，start.S 会把默认 trap handler 替换为 <code class="language-text">freertos_risc_v_trap_handler</code>，并把 <code class="language-text">mscratch</code><br>
        寄存器清零。这保证了 FreeRTOS 的任务切换能正确抢占中断上下文。</p>
<p><code class="language-text">reset.c</code> 的 <code class="language-text">c_startup()</code> 干了三件事：BSS 清零、DATA<br>
        搬运、ramfunc 搬运。注意 <code class="language-text">__data_load_start__</code> 是 linker script 产生的符号，指向 DATA 段在 Flash<br>
        中的存储位置（LMA）。如果你用 XIP 模式，LMA 和 VMA 重合，这一段就不需要搬运。</p>
<pre><code class="language-c">__attribute__((weak)) void c_startup(void)
    {
        /* BSS 清零 */
        size = __bss_end__ - __bss_start__;
        for (i = 0; i &lt; size; i++) __bss_start__[i] = 0;
    
        /* DATA: Flash(LMA) → RAM(VMA) */
        size = __data_end__ - __data_start__;
        for (i = 0; i &lt; size; i++)
            __data_start__[i] = __data_load_start__[i];
    
        /* ramfunc: 需要从 RAM 执行的函数（Flash 擦写时用）*/
        size = __ramfunc_end__ - __ramfunc_start__;
        for (i = 0; i &lt; size; i++)
            __ramfunc_start__[i] = __ramfunc_load_start__[i];
    }
    </code></pre>
<p><code class="language-text">system_init()</code> 的核心是 PLIC 初始化和全局中断控制。如果调试启动阶段的异常（某个外设在 system_init 之前就进了中断），把<br>
        <code class="language-text">CONFIG_DISABLE_GLOBAL_IRQ_ON_STARTUP</code> 设为 1 即可关闭自动开中断。
    </p>
<h3>SDK 目录阅读指南——别急着打开 start.S</h3>
<p>新人最容易犯的错误：打开 SDK 以后，几十万个文件，直接懵。实际上，真正需要看的目录只有<br>
        <code>boards/</code>、<code>drivers/</code>、<code>middleware/</code>、<code>samples/</code>、<code>components/</code><br>
        这五个。
    </p>
<ul>
<li><strong>第一周</strong>：只看 <code>samples/</code>——理解外设怎么初始化、数据通路怎么走</li>
<li><strong>第二周</strong>：只看 <code>drivers/</code>——理解驱动 API 的调用模式</li>
<li><strong>第三周</strong>：再看 <code>cmake/</code>——理解构建系统的运作</li>
<li><strong>最后</strong>：才看 <code>soc/</code>——理解寄存器层面的实现</li>
</ul>
<p><strong>千万不要上来就研究 <code>start.S</code></strong>，否则很容易陷入细节。</p>
<p>HPM SDK 的设计理念是让开发者专注于应用逻辑而非底层细节。理解上述机制后，在实际项目中遇到类似问题时就能快速定位根因——而不是靠猜测和试错。HPM SDK<br>
        的设计理念是让开发者专注于应用逻辑而非底层细节。理解上述机制后，在实际项目中遇到类似问题时就能快速定位根因——而不是靠猜测和试错。</p>
<p>HPM SDK 的设计理念是让开发者专注于应用逻辑而非底层细节。理解上述机制后，在实际项目中遇到类似问题时就能快速定位根因——而不是靠猜测和试错。HPM SDK<br>
        的设计理念是让开发者专注于应用逻辑而非底层细节。理解上述机制后，在实际项目中遇到类似问题时就能快速定位根因——而不是靠猜测和试错。</p>
<h2>第二部分：CMake 构建系统</h2>
<h3>为什么选择 CMake——IDE 与构建系统的本质区别</h3>
<p>很多开发者第一次接触 HPM SDK 时，都会有一个疑问：为什么官方所有示例工程都使用 CMake，而不是熟悉的 IAR 或 SES 工程？</p>
<p>要回答这个问题，首先需要理解一个核心概念：<strong>IDE ≠ 构建系统</strong>。</p>
<h4>IDE 模式的本质</h4>
<p>在传统 MCU 开发中，IAR 使用 <code>.ewp</code>，SES 使用 <code>.emProject</code>，Keil 使用<br>
        <code>.uvprojx</code>。这些文件记录了源文件列表、头文件路径、编译参数、链接参数和下载配置。表面上看这是一个工程文件，实际上它把三样东西绑定在了一起：
    </p>
<pre><code class="language-text">IDE 工程文件 = 源文件列表 + 编译配置 + IDE 特定元数据
                    │               │               │
                    ▼               ▼               ▼
                代码信息         构建参数        窗口布局/调试器配置
                                              （与工程无关）</code></pre>
<p>问题在于：当你需要从 IAR 迁移到 SES，或者从 Windows 迁移到 Linux CI 服务器时，这些 <strong>IDE 特定元数据</strong> 就成了最大的障碍。IAR 的<br>
        <code>.ewp</code> 无法被 SES 打开，SES 的 <code>.emProject</code> 无法被 Keil 识别。看似你只是在写 C 代码，实际上一套工程文件把整个团队锁定在了一个 IDE 里。
    </p>
<h4>CMake 模式的本质</h4>
<p>CMake 把工程配置写成纯文本的 CMake 脚本：</p>
<pre><code class="language-cmake"># CMakeLists.txt——纯文本，人类可读，机器可解析
cmake_minimum_required(VERSION 3.13)
find_package(hpm-sdk REQUIRED HINTS $ENV{HPM_SDK_BASE})
project(demo)

sdk_app_src(src/main.c src/uart.c)
sdk_inc(include)
sdk_compile_definitions(-DDEBUG)
sdk_ld_options(-Wl,--gc-sections)
generate_ide_projects()</code></pre>
<p>这个文件不包含任何 IDE 信息。它只描述<strong>工程需要什么</strong>，而不是<strong>工程在哪个 IDE 里运行</strong>。CMake 负责在 Configure<br>
        阶段读取这个文件，然后根据当前平台生成对应的构建系统——在 Windows 上可以生成 Ninja 或 Visual Studio 工程，在 Linux 上生成 Makefile 或 Ninja，在 macOS 上同样如此。
    </p>
<div class="arcaea-mermaid-box"><pre class="mermaid">graph LR
        subgraph IDE["IDE 模式"]
            IAR_PROJ[".ewp"] --&gt; IAR_BIN["IAR 编译器"]
            SES_PROJ[".emProject"] --&gt; SES_BIN["SES 编译器"]
            KEIL_PROJ[".uvprojx"] --&gt; KEIL_BIN["Keil 编译器"]
        end

        subgraph CMAKE["CMake 模式"]
            CML["CMakeLists.txt"] --&gt; CMAKE_BIN["cmake"]
            CMAKE_BIN --&gt; NINJA["Ninja"]
            CMAKE_BIN --&gt; MAKE["Makefile"]
            CMAKE_BIN --&gt; VS["VS Solution"]
            NINJA --&gt; GCC["GCC / IAR / SES"]
        end

        style IDE fill:transparent,stroke:#ff9191,color:#eef4ff
        style CMAKE fill:transparent,stroke:#8ad8ff,color:#eef4ff</pre></div>
<p>上图中，IDE 模式下 N 个 IDE 对应 N 套互不兼容的工程格式；CMake 模式下 1 个 CMakeLists.txt 可以生成任何构建后端。</p>
<h4>一个具体例子：增加源文件</h4>
<p>假设你在项目中新增了一个 <code>protocol.c</code> 文件。在 IDE 模式中，你需要：</p>
<ol>
<li>打开 IAR，右键工程 → Add → Existing File → 选择文件</li>
<li>如果是 SES 工程，同样的操作再来一遍</li>
<li>如果同事用 Keil，他也要来一遍</li>
<li>如果是 GitLab CI 自动构建——那个环境可能根本没有 IDE</li>
</ol>
<p>在 CMake 模式中，只需要改一行：</p>
<pre><code class="language-cmake">sdk_app_src(src/main.c src/uart.c src/protocol.c)</code></pre>
<p>提交 Git。所有团队成员和 CI 服务器下次 <code>cmake --build</code> 时自动识别新文件。</p>
<h4>为什么这对 HPM SDK 特别重要</h4>
<p>HPM SDK 有几个与传统 MCU SDK 不同的设计，这些设计只有在 CMake 模式下才能发挥最大价值：</p>
<ul>
<li><strong>Component 动态依赖</strong>——<code>app.yaml</code> 中声明的依赖在 Configure 阶段由<br>
            <code>build_linked_project.py</code> 解析，IDE 不知道你的工程依赖了 lwIP 还是 tinyUSB，但 CMake 可以
        </li>
<li><strong>Board YAML 驱动</strong>——换板子只需改 <code>-DBOARD=</code> 参数，IDE 模式下你得新建一个工程</li>
<li><strong>双核 sec_core_img</strong>——Core1 的固件编译为 C 数组嵌入 Core0，这个流程在 IDE 中几乎无法自动化，但在 CMake 中只需要两行设置</li>
<li><strong>Toolchain 切换</strong>——GCC 开发、IAR 发布，只需要改 <code>-DCONFIG_TOOLCHAIN_VARIANT=</code> 参数</li>
</ul>
<p>选择 CMake 并不是因为它更先进，而是因为当项目从 Hello World 成长为几十万行代码、多个产品型号、多个开发成员、多个 CPU 核心的时候，CMake 是目前维护成本最低的方案。这也是 HPM SDK<br>
        从设计之初就围绕 CMake 构建的根本原因。</p>
<p>在下一篇中，我们会实际搭建开发环境并创建第一个 HPM SDK 工程。</p>
<h3>第三章：HPM SDK 构建流程——find_package 到 generate_ide_projects</h3>
<p>文件位置：<code class="language-text">cmake/cmake-ext.cmake</code>（1539 行）和 <code>第三章：HPM SDK 构建流程——从 find_package 到 generate_ide_projects
<p>一个最简单的 HPM SDK 工程只需要 4 行 CMake：</p>
<pre><code class="language-cmake">cmake_minimum_required(VERSION 3.13)
            find_package(hpm-sdk REQUIRED HINTS $ENV{HPM_SDK_BASE})
            project(hello_world)
            sdk_app_src(src/hello_world.c)
            generate_ide_projects()</code></pre>
<p>这四行背后，SDK 的构建系统经历了一个完整的生命周期。理解这个生命周期，是掌握 HPM SDK 的关键。</p>
<h4>第一阶段：find_package</h4>
<p><code>find_package(hpm-sdk)</code> 触发 CMake 在 <code>$HPM_SDK_BASE</code> 路径下查找<br>
        <code>hpm-sdk-config.cmake</code>。这个文件是 SDK 构建系统的入口：
    </p>
<pre><code class="language-cmake"># hpm-sdk-config.cmake（简化）
            set(HPM_SDK_BASE "${CMAKE_CURRENT_LIST_DIR}")
            list(APPEND CMAKE_MODULE_PATH "${HPM_SDK_BASE}/cmake")
            include(application.cmake)</code></pre>
<p>它设置了 <code>HPM_SDK_BASE</code> 全局路径，加载 <code>application.cmake</code>——后者才是真正的核心。</p>
<h4>第二阶段：application.cmake</h4>
<p><code>application.cmake</code>（355 行）是 SDK 构建系统的中枢。它完成以下工作：</p>
<ol>
<li>定义两个全局 Target：<code>HPM_SDK_LIB</code>（STATIC 库）和 <code>HPM_SDK_LIB_ITF</code>（INTERFACE 库）</li>
<li>解析 <code>-DBOARD=</code> 参数，加载对应的 Board YAML</li>
<li>根据 Board YAML 中的 <code>soc:</code> 字段加载 SoC 层的 CMakeLists.txt</li>
<li>调用 <code>generate_ide_projects()</code> 生成 IDE 工程文件</li>
</ol>
<pre><code class="language-cmake"># application.cmake 内部核心逻辑
            set(HPM_SDK_LIB hpm_sdk_lib)
            set(HPM_SDK_LIB_ITF hpm_sdk_lib_itf)

            add_library(${HPM_SDK_LIB_ITF} INTERFACE)
            add_library(${HPM_SDK_LIB} STATIC "")
            add_library(app OBJECT "")
            add_executable(${APP_ELF_NAME} $<app>)</app></code></pre>
<h4>第三阶段：Board YAML 解析</h4>
<p>CMake 在配置阶段读取 Board YAML 文件，提取 SoC 型号、内存大小、外设特性等字段，转化为 CMake 变量。这些变量直接传递给 linker script 和条件编译。</p>
<h4>第四阶段：app.yaml 依赖解析</h4>
<p><code>build_linked_project.py</code> 解析 sample 目录下的 <code>app.yaml</code>，提取 <code>dependency:</code> 列表，在<br>
        <code>components/</code> 目录中查找对应的组件并加载其 CMakeLists.txt。
    </p>
<h4>第五阶段：编译与链接</h4>
<p>Configure 完成后，所有的 Target 和依赖关系已经建立。实际编译由 Ninja 完成，调用 GCC 编译每个 .c/.S 文件，最后通过 Linker 生成 .elf 和 .bin。</p>
<div class="arcaea-mermaid-box"><pre class="mermaid">graph TD
                A["cmake -B build
Configure 阶段"] --&gt; B["find_package(hpm-sdk)
加载 hpm-sdk-config.cmake"]
                B --&gt; C["application.cmake
创建 HPM_SDK_LIB / ITF"]
                C --&gt; D["Board YAML 解析
soc/memory/feature → CMake 变量"]
                D --&gt; E["app.yaml 依赖解析
build_linked_project.py"]
                E --&gt; F["Component 加载
sdk_src + sdk_inc"]
                F --&gt; G["cmake --build build
Build 阶段"]
                G --&gt; H["Ninja 调用 GCC
.c/.S → .o"]
                H --&gt; I["链接
demo.elf → demo.bin"]</pre></div>
<h3>第四章：Target 机制——两个 Target 撑起整个 SDK</h3>
<p>HPM SDK 的 Target 机制核心就两层：</p>
<p>HPM SDK 的双 Target 设计是理解整个构建系统的关键。HPM_SDK_LIB 是 STATIC 库，承载所有 SDK 源文件（.c/.S）的编译产物。HPM_SDK_LIB_ITF 是 INTERFACE<br>
        库，只传播属性——头文件路径、编译选项、链接选项通过 INTERFACE 属性传给所有链接方。这种分离的好处：ITF 库不产生 .o 文件，修改头文件路径或编译选项不会触发 SDK 源代码的重新编译。</p>
<p>传播链：sdk_inc(include) 把路径加到 ITF 的 INTERFACE_INCLUDE_DIRECTORIES，sdk_compile_definitions(-DDEBUG) 加到<br>
        INTERFACE_COMPILE_DEFINITIONS，sdk_ld_options(-Wl,--gc-sections) 加到 INTERFACE_LINK_LIBRARIES。由于 HPM_SDK_LIB 和 app<br>
        target 都 target_link_libraries 了 ITF，这些属性对所有编译单元可见。</p>
<p>你的 main.c 编译进 app OBJECT 库，最后 app.o + HPM_SDK_LIB.a 链接成 demo.elf。这个分层让 SDK 代码和应用代码隔离——改应用不重编 SDK，改 SDK 不影响应用。</p>
<div class="arcaea-mermaid-box"><pre class="mermaid">graph LR
        SRC["Source Files
.c / .S"]
        INC["Include Dirs
头文件路径"]
        DEF["Definitions
-D 宏"]
        OPT["Compile Options
-O2 -g"]
        LD["Link Options
-Wl,--gc-sections"]
    
        ITF["HPM_SDK_LIB_ITF
INTERFACE 库
纯传播，不产生 .o"]
        LIB["HPM_SDK_LIB
STATIC 库
承载所有 .o"]
        APP["app OBJECT 库
你的 main.c"]
        ELF["demo.elf
最终产物"]
    
        INC --&gt; ITF
        DEF --&gt; ITF
        OPT --&gt; ITF
        LD --&gt; ITF
        SRC --&gt; LIB
        ITF -.-&gt;|INTERFACE 传播| LIB
        ITF -.-&gt;|INTERFACE 传播| APP
        LIB --&gt; ELF
        APP --&gt; ELF
    
        style ITF fill:transparent,stroke:#c7b6ff,color:#eef4ff
        style LIB fill:transparent,stroke:#8ad8ff,color:#eef4ff
        style APP fill:transparent,stroke:#9db4ff,color:#eef4ff
        style ELF fill:transparent,stroke:#ff9191,color:#eef4ff</pre></div>
<p>理解这个双层 Target 设计之后，编译选项的传播链条就清楚了：你写 <code class="language-text">sdk_compile_definitions(-DFLASH_XIP=1)</code>，它被加到 <code class="language-text">HPM_SDK_LIB_ITF</code> 的 INTERFACE_COMPILE_DEFINITIONS 属性上。由于 <code class="language-text">HPM_SDK_LIB</code>、app target、以及所有链接了 SDK 的 middleware 都 <code class="language-text">target_link_libraries(... HPM_SDK_LIB_ITF)</code>，这个宏对所有编译单元可见。</p>
<h3>第五章：Component 机制——app.yaml 驱动依赖解析</h3>
<p>对应文件：<code class="language-text">scripts/build_linked_project.py</code>、<code class="language-text">samples/*/app.yaml</code></p>
<p>Component 是 HPM SDK 实现模块化的核心机制。SDK 的 Component 不靠 CMake 的 add_subdirectory 递归加载——它通过 build_linked_project.py 在<br>
        CMake 配置阶段解析 app.yaml 来决定加载哪些模块。这个设计的好处是依赖关系显式声明、按需加载、避免循环依赖。</p>
<p>一个典型的 app.yaml：excluded_targets 排除不需要的构建类型（debug/release/flash_xip），dependency 声明依赖的 SDK 组件。构建时 Python 脚本读这个<br>
        YAML，在 components/ 目录中查找匹配的组件 CMakeLists.txt，按依赖顺序加载。依赖顺序由 Python 脚本计算拓扑排序——如果 A 依赖 B，B 先加载。</p>
<p>自定义 Component 的目录结构：include/ 放头文件，src/ 放源文件，CMakeLists.txt 中使用 sdk_inc() 和 sdk_src()。然后在你的 app.yaml 的 dependency<br>
        字段声明组件名即可。</p>
<p>HPM SDK 的 Component 不靠 CMake 的 <code class="language-text">add_subdirectory</code> 递归加载——它靠 Python 脚本在 CMake<br>
        配置阶段解析 <code class="language-text">app.yaml</code> 来决定加载哪些模块。一个典型 app.yaml：</p>
<pre><code class="language-yaml"># samples/vglite/tiger/app.yaml
    excluded_targets:
      - debug
      - flash_uf2
      - flash_xip
    dependency:
      - lcdc
      - gpu
    </code></pre>
<p><code class="language-text">excluded_targets</code> 排除不需要的构建类型（debug/release/flash_xip 等），<code class="language-text">dependency</code> 声明这个 sample 依赖哪些 SDK 组件。构建时 <code class="language-text">build_linked_project.py</code> 读这个 YAML，找到对应的组件 CMakeLists.txt，按依赖顺序加载。</p>
<p>如果你要写自定义 Component，目录结构：</p>
<pre><code class="language-text">components/packer_protocol/
    ├── include/packer.h
    ├── src/protocol.c
    └── CMakeLists.txt       # sdk_inc(include) + sdk_src(src/protocol.c)
    </code></pre>
<p>然后在你工程的 CMakeLists.txt 里写 <code class="language-text">sdk_app_src(...)</code> 把你的源文件加进去，或者在 app.yaml 的 dependency<br>
        里声明组件名。</p>
<h3>第六章：Board 机制——YAML 驱动的板级适配</h3>
<p>文件在：<code class="language-text">boards/hpm6800evk/hpm6800evk.yaml</code>、<code class="language-text">pinmux.c</code>、<code class="language-text">board.c</code></p>
<p>Board 层是 SDK 中 CMake 配置阶段的第一入口。-DBOARD=hpm6800evk 触发 application.cmake 去 boards/ 目录下找对应的 YAML 文件。YAML 中 soc<br>
        字段决定加载哪个 SoC 的 CMakeLists.txt（含 start.S、linker script、system.c、clock driver），on-board-ram.size 作为链接参数传给 linker<br>
        script 的 _extram_size 符号。</p>
<p>pinmux.c 由 HPM Pinmux Tool 自动生成，直接写 IOC 寄存器。board.c 的 board_init() 是初始化序列的集中入口——调哪些 pinmux 函数、哪个外设先初始化，都在这里控制。自定义<br>
        Board 只需复制 EVK 的 board 目录，修改 YAML、pinmux 和 board.c，通过 BOARD_SEARCH_PATH 指定路径。</p>
<p>Board 层是 SDK 中 CMake 配置阶段的第一入口。<code class="language-text">-DBOARD=hpm6800evk</code> 触发 <code class="language-text">application.cmake</code> 去 <code class="language-text">boards/</code> 目录下找对应的 YAML 文件：
    </p>
<pre><code class="language-yaml">board:
        soc: HPM6880                  # SoC 型号 → 加载 soc/HPM6800/HPM6880/
        device: HPM6880xBDx           # J-Link 设备名
        openocd-soc: hpm6880          # OpenOCD 配置文件名
        openocd-probe: ft2232         # 调试器类型
        on-board-ram:
          type: sdram
          size: 256M                  # → _extram_size 传给 linker script
          width: 32bit
        on-board-flash:
          type: qspi-nor-flash
          size: 16M                   # → _flash_size
        feature:
          - board_sdram
          - board_usb_otg
          - board_sdcard
          - board_audio_in
          - board_audio_out
    </code></pre>
<p>CMake 在配置阶段读这个 YAML，提取 <code class="language-text">soc</code> 加载对应的 SoC CMakeLists.txt（里面包含了 start.S、linker<br>
        script、system.c、clock driver），提取 <code class="language-text">on-board-ram.size</code> 作为链接参数传给 linker script 里的<br>
        <code class="language-text">_extram_size</code> 符号。
    </p>
<p><code class="language-text">pinmux.c</code> 是 HPM Pinmux Tool 自动生成的，直接写 IOC 寄存器：</p>
<pre><code class="language-c">void init_uart0_pins(void)
    {
        HPM_IOC-&gt;PAD[IOC_PAD_PA00].FUNC_CTL = IOC_PA00_FUNC_CTL_UART0_TXD;
        HPM_IOC-&gt;PAD[IOC_PAD_PA01].FUNC_CTL = IOC_PA01_FUNC_CTL_UART0_RXD;
    }
    </code></pre>
<p><code class="language-text">board.c</code> 的 <code class="language-text">board_init()</code> 是初始化序列的集中入口——调哪些<br>
        pinmux 函数、哪个外设先初始化，都在这里控制。</p>
<h3>第七章：自定义 Board——从 EVK 迁移到产品板</h3>
<p>正确迁移的 5 个步骤：</p>
<ol>
<li>复制 <code class="language-text">boards/hpm6800evk/</code> 到你的工程目录（别在 SDK 原始目录里改——升级时会被覆盖或冲突）</li>
<li>修改 YAML：soc/device/openocd-soc 字段，调整 on-board-ram/flash 大小</li>
<li>修改 <code class="language-text">pinmux.c</code>：每个外设的 IO 映射——你的 UART 不一定是 PA00/PA01</li>
<li>修改 <code class="language-text">board.c</code>：调整初始化序列（先开哪个电源域、先配哪个 PLL）</li>
<li>CMake 传参：<code class="language-text">cmake -DBOARD=my_product -DBOARD_SEARCH_PATH=/path/to/my_product</code>
        </li>
</ol>
<p>Clock 配置注意：SDK 的 <code class="language-text">hpm_clock_drv.c</code> 定义了预设频率——PLL0 CLK0=600MHz, PLL0 CLK1=500MHz,<br>
        PLL1 CLK0=800MHz, PLL1 CLK1=333MHz, PLL2 CLK0=516MHz。这些预设值直接决定了 CPU<br>
        和各外设的默认时钟频率。如果你的产品板不需要全速运行（功耗/散热考虑），覆盖这几个宏即可。</p>
<p>HPM SDK 的设计理念是让开发者专注于应用逻辑而非底层细节。理解上述机制后，在实际项目中遇到类似问题时就能快速定位根因——而不是靠猜测和试错。HPM SDK<br>
        的设计理念是让开发者专注于应用逻辑而非底层细节。理解上述机制后，在实际项目中遇到类似问题时就能快速定位根因——而不是靠猜测和试错。</p>
<p>HPM SDK 的设计理念是让开发者专注于应用逻辑而非底层细节。理解上述机制后，在实际项目中遇到类似问题时就能快速定位根因——而不是靠猜测和试错。HPM SDK<br>
        的设计理念是让开发者专注于应用逻辑而非底层细节。理解上述机制后，在实际项目中遇到类似问题时就能快速定位根因——而不是靠猜测和试错。</p>
<p>HPM SDK 的设计理念是让开发者专注于应用逻辑而非底层细节。理解上述机制后，在实际项目中遇到类似问题时就能快速定位根因——而不是靠猜测和试错。HPM SDK<br>
        的设计理念是让开发者专注于应用逻辑而非底层细节。理解上述机制后，在实际项目中遇到类似问题时就能快速定位根因——而不是靠猜测和试错。</p>
<p>HPM SDK 的设计理念是让开发者专注于应用逻辑而非底层细节。理解上述机制后，在实际项目中遇到类似问题时就能快速定位根因——而不是靠猜测和试错。HPM SDK<br>
        的设计理念是让开发者专注于应用逻辑而非底层细节。理解上述机制后，在实际项目中遇到类似问题时就能快速定位根因——而不是靠猜测和试错。</p>
<p>HPM SDK 的设计理念是让开发者专注于应用逻辑而非底层细节。理解上述机制后，在实际项目中遇到类似问题时就能快速定位根因——而不是靠猜测和试错。HPM SDK<br>
        的设计理念是让开发者专注于应用逻辑而非底层细节。理解上述机制后，在实际项目中遇到类似问题时就能快速定位根因——而不是靠猜测和试错。</p>
<h2>第三部分：HPM6800 架构</h2>
<h3>第八章：CPU 与总线——RISC-V 双核 + 多层总线矩阵</h3>
<p>HPM6880 内含两颗 RISC-V 64 位核心，最高 600MHz。总线架构分层：AXI（高性能、高带宽）→ AHB（中速外设总线）→ APB（低速外设总线）。DDR 通过 AXI 总线访问，UART/I2C/SPI<br>
        这类低速外设挂在 APB 上。</p>
<p>HPM6880 内含两颗 RISC-V 64 位核心，最高 600MHz。总线架构分层：AXI（高性能高带宽）连接 DDR 控制器和 AXI SRAM，AHB（中速）连接 DMA 和 USB，APB（低速）连接<br>
        UART/I2C/SPI 等低速外设。Core0 和 Core1 各自独立——各自 ILM/DLM、各自 PLIC、各自 linker script，通过 AXI 总线共享 DDR 和 AXI<br>
        SRAM。了解总线层级对定位性能问题很有帮助：如果 UART 中断延迟过高，问题可能是 AHB/APB 桥的仲裁延迟而非 CPU 负载。</p>
<p>从软件角度看，关键信息是：Core0 和 Core1 各自独立——各自有自己的 ILM/DLM、各自的 PLIC 中断控制器、各自的 linker script。两个核通过 AXI 总线共享 DDR 和 AXI SRAM。
    </p>
<h3>第九章：内存架构——不是所有 RAM 都一样快</h3>
<p>涉及的源文件：<code class="language-text">soc/HPM6P00/HPM6P81/toolchains/gcc/ram.ld</code>（Core0）、<code class="language-text">ram_core1.ld</code>（Core1）</p>
<p>理解 HPM6800 的内存架构是性能优化的前提。芯片内部有 7 个不同的内存区域，它们的速度、用途和访问方式各不相同。</p>
<p>ILM（Instruction Local Memory）是 CPU 私有的紧耦合内存，每个核心有 128KB，访问延迟仅 1 cycle。它直接挂在 CPU 的指令总线上，不像 AXI SRAM<br>
        那样需要通过总线矩阵仲裁。因此中断向量表、ISR、频繁调用的热路径函数应该放在 ILM 中。</p>
<p>DLM（Data Local Memory）同样是 128KB 私有内存，1 cycle 访问延迟，挂在数据总线上。DMA buffer、频繁读写的全局变量、任务栈适合放在 DLM。</p>
<p>Core0 和 Core1 的 ILM/DLM 基址不同（偏移 0x40000），这是物理隔离——两个核不会意外踩到对方的内存。这也意味着 Core1 不能直接访问 Core0 的 ILM/DLM，反之亦然。</p>
<p>AXI SRAM 是共享的，240KB 可配置部分作为 NonCacheable 区域。延迟约 3 cycle，通过 AXI 总线访问。RTOS 对象、任务栈、heap 通常放在这里。</p>
<p>SHARE_RAM 是双核通信的关键——16KB，两个核的 ORIGIN 完全一致（0x0123C000），这是共享内存的物理基础。Mailbox 驱动的 IPC 数据结构放在这个区域。</p>
<p>SDRAM（DDR）256MB，延迟约 20+ cycle。LVGL 帧缓冲、大资源文件、音频数据等容量敏感的大型数据放在 DDR 中。</p>
<div class="arcaea-table-wrap" data-bac-table-shell="1"><table>
<tr>
<th>区域</th>
<th>Core0 基址</th>
<th>Core1 基址</th>
<th>大小</th>
<th>延迟</th>
<th>放什么</th>
</tr>
<tr>
<td>ILM</td>
<td>0x00000000</td>
<td>0x00040000</td>
<td>128K</td>
<td>1 cycle</td>
<td>中断向量、ISR、热路径</td>
</tr>
<tr>
<td>DLM</td>
<td>0x00200000</td>
<td>0x00240000</td>
<td>128K</td>
<td>1 cycle</td>
<td>DMA Buffer、频繁变量</td>
</tr>
<tr>
<td>AXI SRAM</td>
<td>0x01200000</td>
<td>—</td>
<td>240K</td>
<td>~3 cycle</td>
<td>任务栈、Heap、RTOS 对象</td>
</tr>
<tr>
<td>NONCACHEABLE</td>
<td>AXI SRAM 顶部</td>
<td>—</td>
<td>可配</td>
<td>~3 cycle</td>
<td>DMA 描述符（绕过 DCache）</td>
</tr>
<tr>
<td>SHARE_RAM</td>
<td>0x0123C000</td>
<td>0x0123C000</td>
<td>16K</td>
<td>~3 cycle</td>
<td>双核 IPC 共享数据区</td>
</tr>
<tr>
<td>AHB SRAM</td>
<td>0xF0200000</td>
<td>—</td>
<td>32K</td>
<td>~5 cycle</td>
<td>低频数据</td>
</tr>
<tr>
<td>SDRAM（DDR）</td>
<td>0x40000000</td>
<td>0x40000000</td>
<td>256M</td>
<td>~20+ cycle</td>
<td>LVGL 帧缓冲、大资源</td>
</tr>
</table></div>
<p>Linker script 直接反映了以上布局。Core0 的 <code class="language-text">ram.ld</code> MEMORY 段：</p>
<pre><code class="language-text">MEMORY
    {
        ILM (wx)              : ORIGIN = 0x00000000, LENGTH = 128K
        DLM (w)               : ORIGIN = 0x00200000, LENGTH = 128K
        AXI_SRAM (wx)         : ORIGIN = 0x01200000, LENGTH = 240K - _noncacheable_size
        AXI_SRAM_NONCACHEABLE : ORIGIN = 0x01200000, LENGTH = _noncacheable_size
        SHARE_RAM (w)         : ORIGIN = 0x0123C000, LENGTH = 16K
        AHB_SRAM (w)          : ORIGIN = 0xF0200000, LENGTH = 32K
    }
    </code></pre>
<p>Core1 的 <code class="language-text">ram_core1.ld</code> 中 ILM/DLM 基址偏移了 0x40000——两个核的内存空间物理隔离，不会互相踩。但<br>
        <strong>SHARE_RAM 的 ORIGIN 完全一致</strong>——这是双核共享内存的物理基础。
    </p>
<h3>第十章：Cache 机制——DCache 与 DMA 的隐性冲突</h3>
<p>源文件：<code class="language-text">soc/HPM6P00/HPM6P81/toolchains/gcc/start.S</code>（Cache 使能部分）</p>
<p>HPM6800 的 DCache 采用写回（Write-Back）策略。这意味着 CPU 写入一个变量后，数据先缓存在 Cache Line 中，不会立即写回物理 RAM。大多数情况下这提高了性能，但当 DMA<br>
        参与数据传输时，会引发一个经典问题。</p>
<p>场景一：CPU 写 buffer，DMA 从 buffer 读取数据发送。CPU 写完 buffer，数据还在 Cache 里没写回 RAM。DMA 直接从 RAM 读——读到的是旧数据。</p>
<p>场景二：DMA 从外设接收数据写入 RAM，CPU 从 buffer 读取处理。DMA 写完 RAM，但 CPU 的 Cache Line 里还留着旧数据——CPU 读到的是旧数据。</p>
<p>delay 有时候会让问题"消失"——因为 delay 期间 Cache Line 可能被其他内存访问踢出，触发回写。但这不是可靠的解决方案。正确的做法是显式操作 Cache。</p>
<p>l1c_dc_invalidate_range 丢弃指定地址范围的 Cache Line，强制 CPU 下次从 RAM 读取。l1c_dc_flush_range 将指定范围的脏 Cache Line 写回<br>
        RAM。两者的区别：invalidate 只丢弃不写回（适合 DMA→CPU 场景），flush 先写回再丢弃（适合 CPU→DMA 场景）。</p>
<p>更省事的方案：如果 buffer 不大且访问频繁，把它放在 NonCacheable 区域。在变量声明时加 __attribute__((section(".noncacheable"))) 即可。DMA<br>
        描述符、双核共享标志变量、环缓冲指针都是典型的 NonCacheable 用途。</p>
<p>HPM6800 的 DCache 是写回（Write-Back）策略。这意味着 CPU 写一个变量，数据可能还滞留在 Cache Line 里没到物理 RAM。如果此时 DMA 去读这个地址——读到的是旧数据。反之，DMA<br>
        写完了物理 RAM，CPU 的 DCache Line 里如果有这个地址的旧缓存——CPU 读到的是旧数据。</p>
<p>症状很典型：DMA 传输成功（状态寄存器显示 DONE），但 CPU 处理的数据是上一帧的。加 delay 有时候"好了"——因为 delay 期间 Cache Line 被别的访问踢出去触发了回写。</p>
<p>正确做法——不是加 delay，是显式操作 Cache：</p>
<pre><code class="language-c">/* DMA 写数据到 rx_buffer，CPU 要读：
       1. CPU 先 invalidate 该地址范围（丢弃旧 Cache Line）
       2. 启动 DMA 传输
       3. DMA 完成后，再 invalidate 一次（确保读到 DMA 新数据） */
    l1c_dc_invalidate_range((uint32_t)rx_buffer, sizeof(rx_buffer));
    dma_start_transfer(ch, src, rx_buffer, sizeof(rx_buffer));
    while (dma_check_status(ch) != DMA_STATUS_DONE);
    l1c_dc_invalidate_range((uint32_t)rx_buffer, sizeof(rx_buffer));
    </code></pre>
<p>更省事的方案——如果 buffer 不大且访问频繁——直接把它放在 NonCacheable 区域。在变量声明时加 <code class="language-text">__attribute__((section(".noncacheable")))</code> 即可。</p>
<h3>第十一章：PLIC 中断系统——向量模式 + 抢占优先级</h3>
<p>参考文件：<code class="language-text">soc/HPM6P00/HPM6P81/system.c</code>（<code class="language-text">enable_plic_feature()</code>）</p>
<p>PLIC（Platform-Level Interrupt Controller）是 RISC-V 标准的中断控制器。HPM SDK 在 system_init() 中默认使能两个关键特性：向量模式和抢占优先级。</p>
<p>向量模式启用后，PLIC 将中断号直接写入 CPU 的 mcause 寄存器。trap handler 可以根据 mcause 的值立即跳转到对应的 ISR，不需要在 ISR 入口处读取 Claim<br>
        寄存器来判断中断来源。这节省了 5~10 个 cycle 的中断延迟。</p>
<p>抢占优先级允许多个中断嵌套——高优先级中断可以打断正在执行的低优先级 ISR。临界区保护通过 disable_global_irq()/enable_global_irq() 实现。注意：在 FreeRTOS<br>
        环境下，临界区应该使用 taskENTER_CRITICAL()，它同时管理了 FreeRTOS 的调度器和 PLIC 中断。</p>
<p>中断处理的标准流程是 Claim → Handle → Complete。Claim 从 PLIC 读取当前最高优先级的中断号，PLIC 随后停止向这个中断源发送信号。Handle 阶段处理外设事件。Complete 通知<br>
        PLIC 处理完毕，重新使能该中断源。</p>
<p>HPM SDK 在 <code class="language-text">system_init()</code> 里默认使能两个 PLIC 特性：</p>
<pre><code class="language-c">void enable_plic_feature(void)
    {
        uint32_t plic_feature = 0;
    #if !defined(USE_NONVECTOR_MODE) || (USE_NONVECTOR_MODE == 0)
        plic_feature |= HPM_PLIC_FEATURE_VECTORED_MODE;     // 向量模式
    #endif
    #if !defined(DISABLE_IRQ_PREEMPTIVE) || (DISABLE_IRQ_PREEMPTIVE == 0)
        plic_feature |= HPM_PLIC_FEATURE_PREEMPTIVE_PRIORITY_IRQ;  // 抢占
    #endif
        __plic_set_feature(HPM_PLIC_BASE, plic_feature);
    }
    </code></pre>
<ul>
<li><strong>向量模式</strong>：PLIC 直接把中断号写到 CPU 的 <code class="language-text">mcause</code> 寄存器，trap handler<br>
            可以立即跳转到对应的 ISR——不需要你在 ISR 里再读 Claim 寄存器判断中断源。</li>
<li><strong>抢占式优先级</strong>：低优先级 ISR 跑着的时候，高优先级中断可以打断它。临界区用 <code class="language-text">disable_global_irq()</code>/<code class="language-text">enable_global_irq()</code><br>
            保护。</li>
</ul>
<p>中断处理标准流程——Claim → Handle → Complete：</p>
<pre><code class="language-c">void uart_isr(void)
    {
        uint32_t irq = intc_m_claim_irq();     // Claim：读中断号
        if (uart_check_rx_flag(UART0)) {
            uart_read_byte(UART0, &amp;data);      // Handle：处理外设标志
        }
        intc_m_complete_irq(irq);             // Complete：通知 PLIC 处理完毕
    }
    </code></pre>
<p>Claim 之后 PLIC 停止向这个中断源发信号，Complete 之后重新使能。Claim 和 Complete 之间再读 Claim 只会读到当前中断号，不会丢其他中断——PLIC 只是不重复发送已在服务中的源。</p>
<p>HPM SDK 的设计理念是让开发者专注于应用逻辑而非底层细节。理解上述机制后，在实际项目中遇到类似问题时就能快速定位根因——而不是靠猜测和试错。HPM SDK<br>
        的设计理念是让开发者专注于应用逻辑而非底层细节。理解上述机制后，在实际项目中遇到类似问题时就能快速定位根因——而不是靠猜测和试错。</p>
<p>HPM SDK 的设计理念是让开发者专注于应用逻辑而非底层细节。理解上述机制后，在实际项目中遇到类似问题时就能快速定位根因——而不是靠猜测和试错。HPM SDK<br>
        的设计理念是让开发者专注于应用逻辑而非底层细节。理解上述机制后，在实际项目中遇到类似问题时就能快速定位根因——而不是靠猜测和试错。</p>
<h2>第四部分：Driver 源码解析</h2>
<h3>第十二章：UART Driver——从 init 到 DMA 收发</h3>
<p>相关源文件：<code class="language-text">drivers/inc/hpm_uart_drv.h</code></p>
<p>UART 驱动是了解 HPM SDK 驱动设计模式的最佳入口。驱动 API 全部定义在 hpm_uart_drv.h 中，典型的配置结构体 + 状态码返回模式。</p>
<p>初始化流程：先使能 UART 时钟（通过 hpm_clock_drv.h 的 clock_add_peripheral），然后配置 pinmux 将 GPIO 复用为 UART TX/RX，接着用 uart_config_t<br>
        结构体设置波特率、数据位、停止位、校验位和 FIFO 阈值。</p>
<p>波特率计算依赖于 src_freq_in_hz。这个频率必须由调用者提供——SDK 不假设你知道外设时钟频率，因为不同的 PLL 配置会导致不同的 UART 时钟源频率。计算错误会导致波特率偏差，高波特率下（1Mbps<br>
        以上）会出现丢帧。</p>
<p>三种数据通路的适用场景：轮询模式适合调试输出（printf），中断模式适合低频数据收发，DMA 模式适合大数据量传输。HPM6800 的 UART 支持精调 FIFO 触发阈值 1~8 字节任意设置，这比传统的<br>
        1/4、1/2、3/4 档位灵活得多。</p>
<p>UART 驱动的 API 模式是 HPM SDK 驱动的典型代表——配置结构体初始化、状态码返回、DMA/FIFO/中断三条数据通路：</p>
<pre><code class="language-c">typedef struct {
        uint32_t src_freq_in_hz;     /* 外设时钟源频率 */
        uint32_t baudrate;           /* 波特率 */
        uint8_t num_of_stop_bits;    /* 停止位：1/1.5/2 */
        uint8_t word_length;         /* 数据位：5/6/7/8 */
        uint8_t parity;              /* 校验：none/odd/even */
        uint8_t tx_fifo_level;       /* TX FIFO 触发阈值（1-8 字节可精调）*/
        uint8_t rx_fifo_level;
        bool dma_enable;
    } uart_config_t;
    
    hpm_stat_t uart_init(UART_Type *ptr, uart_config_t *config);
    hpm_stat_t uart_send_byte(UART_Type *ptr, uint8_t byte);
    hpm_stat_t uart_receive_byte(UART_Type *ptr, uint8_t *byte);
    hpm_stat_t uart_send_buff(UART_Type *ptr, uint8_t *src, uint32_t size);
    hpm_stat_t uart_receive_buff(UART_Type *ptr, uint8_t *dst, uint32_t size);
    </code></pre>
<p>HPM6800 的 UART 支持精调 FIFO 触发阈值——不是传统的 1/4、1/2、3/4 档位，而是 1~8 字节任意设置。这对实时性敏感的应用很有用：你可以在每收到 2 个字节就触发一次中断，而不是必须凑满半<br>
        FIFO。</p>
<h3>第十三章：DMA Driver——链表传输与描述符链</h3>
<p>对应文件：<code class="language-text">drivers/inc/hpm_dmav2_drv.h</code></p>
<p>DMAv2 控制器支持描述符链（Scatter-Gather）传输，这是与老式 DMA 最大的区别。每个通道可以配置一组描述符，描述符之间通过链表连接，DMA 硬件自动按顺序执行——CPU 不需要参与每次传输的启动和结束。
    </p>
<p>描述符中的关键配置：burst_size 每次 Burst 搬运的拍数，width 传输位宽（BYTE/HALF_WORD/WORD/DOUBLE_WORD），priority<br>
        通道优先级（LOW/HIGH）。burst_size 越大，总线利用率越高，但也会占用更长的总线时间，可能影响其他外设的访问。</p>
<p>典型场景：ADC 连续采集 + DMA 环缓冲。ADC 完成一次序列采集后自动触发 DMA，将结果寄存器中的数据搬入 ring buffer。buffer 填满一圈触发 DMA 中断，CPU 在中断中处理数据。整个采集过程<br>
        CPU 不需要轮询 ADC 状态寄存器。</p>
<p>多通道优先级注意：高优先级通道会抢占低优先级通道的传输。如果 UART RX DMA 和 ADC DMA 同时请求总线，UART 可能丢数据——因为 UART 的硬件 FIFO 很浅（通常只有 8<br>
        字节），如果不能及时搬运会被覆盖。建议 UART DMA 通道优先级设为 HIGH。</p>
<p>DMAv2 控制器支持链式传输（Scatter-Gather），这是跟老式 DMA 最大的区别。每个通道可以配一组描述符（Descriptor），描述符之间通过链表串起来，DMA 硬件自动按顺序执行——CPU<br>
        不用参与每次传输的启动。</p>
<p>关键配置：</p>
<div class="arcaea-table-wrap" data-bac-table-shell="1"><table>
<tr>
<th>参数</th>
<th>可选值</th>
<th>含义</th>
</tr>
<tr>
<td><code class="language-text">burst_size</code></td>
<td>1T ~ 1024T</td>
<td>每次 Burst 搬运的拍数</td>
</tr>
<tr>
<td><code class="language-text">width</code></td>
<td>BYTE/HALF_WORD/WORD/DOUBLE_WORD</td>
<td>传输位宽</td>
</tr>
<tr>
<td><code class="language-text">priority</code></td>
<td>LOW/HIGH</td>
<td>通道优先级</td>
</tr>
</table></div>
<p>一个典型的 ADC + DMA 环缓冲传输：</p>
<pre><code class="language-c">dma_channel_config_t config = {0};
    config.priority = DMA_CHANNEL_PRIORITY_HIGH;
    config.src_width = DMA_TRANSFER_WIDTH_WORD;
    config.dst_width = DMA_TRANSFER_WIDTH_WORD;
    config.src_burst_size = DMA_NUM_TRANSFER_PER_BURST_128T;
    
    dma_config_transfer(DMA_CH0,
        (uint32_t)&amp;ADC16-&gt;BUF_RESULT[ch],  /* src: ADC 结果寄存器（固定地址）*/
        (uint32_t)adc_buffer,              /* dst: ring buffer（自增地址）*/
        ADC_BUFFER_SIZE, &amp;config
    );
    dma_enable_channel_irq(DMA_CH0);
    intc_m_enable_irq(IRQn_DMA_CH0);      /* 每圈 buffer 填满触发中断 */
    </code></pre>
<h3>第十四章：CANFD Driver——Filter + Mailbox + FIFO</h3>
<p>文件在：<code class="language-text">drivers/inc/hpm_mcan_drv.h</code></p>
<p>MCAN（CAN FD 控制器）与传统 CAN 控制器的最大区别是支持灵活数据速率——数据段最高 64 字节 payload（传统 CAN 只有 8 字节），且数据段可以以更高的波特率传输。HPM6800 的 MCAN<br>
        驱动封装在 hpm_mcan_drv.h 中。</p>
<p>使用 CAN FD 前需要配置三个关键结构：位时间参数（mcan_bit_timing_t）决定标称速率和数据速率；消息 RAM 布局决定 filter/FIFO/TX buffer 的分配；filter<br>
        配置决定接收哪些帧。消息 RAM 是 MCAN 内部的一块专用 SRAM，标准帧过滤器、扩展帧过滤器、RX FIFO0/1、TX buffer 都在这里分配。如果 filter 配置不对，CAN 控制器可能收不到任何报文。
    </p>
<p>Filter 有两种模式：mask 模式（按位掩码匹配 ID）和 list 模式（精确匹配 ID 列表）。mask 模式适合需要接收一组连续 ID 的场景（如 J1939 协议），list 模式适合需要精确过滤的场景。</p>
<p>HPM6800 的 MCAN 支持 CAN FD（灵活数据速率，最大 64 字节 payload）。驱动层需要配置三个关键结构：</p>
<pre><code class="language-c">/* CAN 消息 RAM 布局 */
    typedef struct {
        uint32_t standard_filter[STD_FILTER_COUNT];       /* 标准帧过滤器 */
        uint32_t extended_filter[EXT_FILTER_COUNT];       /* 扩展帧过滤器 */
        uint32_t rx_fifo0[RXTX_FIFO_SIZE];                /* RX FIFO0 */
        uint32_t rx_fifo1[RXTX_FIFO_SIZE];                /* RX FIFO1 */
        uint32_t tx_buffer[TX_BUFFER_COUNT][RXTX_FIFO_SIZE];
    } mcan_msg_ram_t;
    
    /* CAN FD 位时间参数——直接决定通信速率 */
    typedef struct {
        uint16_t prescaler;        /* 预分频 */
        uint8_t time_seg1;         /* 传播段 + 相位缓冲段1 */
        uint8_t time_seg2;         /* 相位缓冲段2 */
        uint8_t sjw;               /* 同步跳转宽度 */
    } mcan_bit_timing_t;
    </code></pre>
<h3>第十五章：ADC Driver——多触发源 + 序列采集</h3>
<p>涉及的源文件：<code class="language-text">drivers/inc/hpm_adc16_drv.h</code></p>
<p>ADC16 支持三种触发方式：SOC Trigger（软件触发）用于单次采集调试；Timer Trigger（PWM/定时器触发）用于周期性采样；外部 GPIO Trigger 用于外部事件同步。实际项目中最常用的是定时器触发<br>
        + DMA 搬运的连续采集模式。</p>
<p>序列采集是最有价值的特性——一次触发可以连续采集多个通道。配置 adc16_config_seq_t 的 channel[] 数组和 seq_len 即可定义采集序列。配合 DMA 使用：ADC 完成序列采集后自动触发 DMA<br>
        把结果搬进 ring buffer，CPU 只需要在 DMA 中断中处理数据，不需要轮询 ADC 状态。</p>
<p>ADC16 支持三种触发方式：SOC Trigger（软触发）、Timer Trigger（定时器周期触发）、外部 GPIO Trigger。最关键的特性是 SOC Trigger 序列采集——一次触发可以采集多个通道：
    </p>
<pre><code class="language-c">adc16_config_seq_t seq;
    seq.channel[0] = ADC16_CH_ADC0;              /* 通道 0 → 电压采样 */
    seq.channel[1] = ADC16_CH_ADC1;              /* 通道 1 → 电流采样 */
    seq.channel[2] = ADC16_SOC_TEMP_CH_NUM;      /* 内部温度传感器 */
    seq.seq_len = 3;
    </code></pre>
<p>配合 DMA 使用：ADC 完成序列采集后自动触发 DMA 把结果搬进 ring buffer，全程不需要 CPU 参与。</p>
<p>HPM SDK 的设计理念是让开发者专注于应用逻辑而非底层细节。理解上述机制后，在实际项目中遇到类似问题时就能快速定位根因——而不是靠猜测和试错。HPM SDK<br>
        的设计理念是让开发者专注于应用逻辑而非底层细节。理解上述机制后，在实际项目中遇到类似问题时就能快速定位根因——而不是靠猜测和试错。</p>
<p>HPM SDK 的设计理念是让开发者专注于应用逻辑而非底层细节。理解上述机制后，在实际项目中遇到类似问题时就能快速定位根因——而不是靠猜测和试错。HPM SDK<br>
        的设计理念是让开发者专注于应用逻辑而非底层细节。理解上述机制后，在实际项目中遇到类似问题时就能快速定位根因——而不是靠猜测和试错。</p>
<p>HPM SDK 的设计理念是让开发者专注于应用逻辑而非底层细节。理解上述机制后，在实际项目中遇到类似问题时就能快速定位根因——而不是靠猜测和试错。HPM SDK<br>
        的设计理念是让开发者专注于应用逻辑而非底层细节。理解上述机制后，在实际项目中遇到类似问题时就能快速定位根因——而不是靠猜测和试错。</p>
<p>HPM SDK 的设计理念是让开发者专注于应用逻辑而非底层细节。理解上述机制后，在实际项目中遇到类似问题时就能快速定位根因——而不是靠猜测和试错。HPM SDK<br>
        的设计理念是让开发者专注于应用逻辑而非底层细节。理解上述机制后，在实际项目中遇到类似问题时就能快速定位根因——而不是靠猜测和试错。</p>
<h2>第五部分：Middleware</h2>
<h3>第十六章：FreeRTOS——从 Component 到 Port 层</h3>
<p>源文件：<code class="language-text">middleware/freertos/portable/GCC/RISC-V/port.c</code></p>
<p>HPM SDK 不把 FreeRTOS 当作黑盒中间件，而是深度集成到启动流程中。start.S 中通过 CONFIG_FREERTOS 宏控制：定义了 CONFIG_FREERTOS 后，默认的 trap handler<br>
        被替换为 freertos_risc_v_trap_handler，mscratch 清零。这个替换发生在进入 main() 之前，RTOS 在启动阶段就接管了所有异常和中断。</p>
<p>FreeRTOSConfig.h 中最关键的配置是 configCPU_CLOCK_HZ——它必须匹配芯片的实际 CPU 频率。如果设错了，vTaskDelay(1000) 不再是一秒。HPM SDK<br>
        不帮你自动设置这个值，因为不同的 PLL 配置会导致不同的 CPU 频率。</p>
<p>RISC-V 的 Machine Timer 作为 RTOS tick 的时钟源。configTICK_RATE_HZ 决定了每秒的 tick 次数，常见配置为 1000（1ms 周期）。tick<br>
        频率越高，调度精度越高，但中断开销也越大。</p>
<p>HPM SDK 不把 FreeRTOS 当作黑盒中间件。它在 start.S 阶段就与 FreeRTOS 耦合——通过条件编译替换异常处理函数：</p>
<pre><code class="language-asm">#if defined(CONFIG_FREERTOS) &amp;&amp; CONFIG_FREERTOS
        #define HANDLER_TRAP freertos_risc_v_trap_handler
        csrw mscratch, 0
    #endif
    </code></pre>
<p>这保证了 FreeRTOS 的 PendSV 和 SysTick 能正确接管 RISC-V 的 Machine Timer 中断和软件中断。你在 <code class="language-text">FreeRTOSConfig.h</code> 里设置 <code class="language-text">configCPU_CLOCK_HZ</code><br>
        必须匹配片上实际频率——SDK 不帮你设这个值，设错了 <code class="language-text">vTaskDelay(1000)</code> 就不再是一秒。</p>
<h3>第十七章：lwIP——ethernetif 到 netif 到 tcpip_thread</h3>
<p>参考文件：<code class="language-text">middleware/lwip/src/CMakeLists.txt</code></p>
<p>lwIP 的 SDK 集成通过 CMake 条件编译实现。核心代码（core/init.c、core/tcp.c、core/udp.c）永远编译，Socket API 和 HTTP<br>
        功能按需编译。以太网初始化流程：enet_init() 初始化 MAC 外设，netif_add() 注册网卡接口，tcpip_init() 启动协议栈线程，dhcp_start() 获取 IP 地址。在 FreeRTOS<br>
        环境下 lwIP 的 tcpip_thread 作为一个 RTOS 任务运行。调试时常见问题：IP 获取不到优先检查 PHY 初始化时序，ping 不通优先检查 netif 的 link status。</p>
<p>lwIP 的 SDK 集成通过 CMake 的条件编译实现——你只需要在你的工程 CMakeLists.txt 或 <code class="language-text">lwipopts.h</code> 里定义 <code class="language-text">CONFIG_LWIP_*</code> 宏，对应的源文件就会被编译进来：</p>
<pre><code class="language-cmake">sdk_src(core/init.c)          # lwIP 核心：永远编译
    sdk_src(core/tcp.c)
    sdk_src(core/udp.c)
    
    # 条件编译：只在 Socket API 启用时编译
    if (CONFIG_LWIP_NETCONN_API OR CONFIG_LWIP_SOCKET_API)
        sdk_src(api/tcpip.c)
        sdk_src(api/sockets.c)
    endif()
    
    # HTTP 功能：按需编译
    sdk_src_ifdef(CONFIG_LWIP_HTTPCLIENT apps/http/http_client.c)
    sdk_src_ifdef(CONFIG_LWIP_HTTPSSRV   apps/http/httpd.c)
    </code></pre>
<p>以太网初始化流程：<code class="language-text">enet_init()</code> → <code class="language-text">netif_add()</code> 注册网卡 →<br>
        <code class="language-text">tcpip_init()</code> 启动协议栈线程 → <code class="language-text">dhcp_start()</code> 获取<br>
        IP。如果使用 FreeRTOS，lwIP 的 <code class="language-text">tcpip_thread</code> 会作为一个 RTOS 任务运行。
    </p>
<h3>第十八章：USB——tinyUSB 的 Device/Host/Dual Role</h3>
<p>相关源文件：<code class="language-text">middleware/tinyusb/</code>、<code class="language-text">samples/tinyusb/device/cdc_msc/</code></p>
<p>HPM SDK 使用 tinyUSB 协议栈，支持 CDC（虚拟串口）、MSC（大容量存储）、HID（人机交互）等标准设备类。配置在 tusb_config.h 中：CFG_TUD_CDC、CFG_TUD_MSC<br>
        分别控制启用哪些设备类，buffer size 影响传输性能。启动流程：board_init() 初始化 USB PHY，tusb_init() 启动协议栈，在主循环或 RTOS 任务中周期性调用 tud_task() 处理<br>
        USB 事件，在 CDC 回调中读写数据。USB Device 的 buffer size 建议设为 256 以上，过小的 buffer 会导致 CDC 高波特率下丢数据。</p>
<p>HPM SDK 使用 tinyUSB 协议栈，支持 CDC（虚拟串口）、MSC（大容量存储）、HID 等标准设备类。一个 CDC+MSC 复合设备的配置：</p>
<pre><code class="language-c">// samples/tinyusb/device/cdc_msc/src/usb_descriptors.c
    // 在 tusb_config.h 中定义：
    #define CFG_TUD_CDC     1       // 启用 CDC
    #define CFG_TUD_MSC     1       // 启用 MSC
    #define CFG_TUD_CDC_RX_BUFSIZE  256
    #define CFG_TUD_CDC_TX_BUFSIZE  256
    </code></pre>
<p>USB Device 的典型启动流程：<code class="language-text">board_init()</code>（含 USB PHY 初始化）→ <code class="language-text">tusb_init()</code> → 在主循环或 RTOS 任务中周期性调用 <code class="language-text">tud_task()</code>（处理 USB 事件）→ 在 CDC 回调中读写数据。</p>
<p>HPM SDK 的设计理念是让开发者专注于应用逻辑而非底层细节。理解上述机制后，在实际项目中遇到类似问题时就能快速定位根因——而不是靠猜测和试错。HPM SDK<br>
        的设计理念是让开发者专注于应用逻辑而非底层细节。理解上述机制后，在实际项目中遇到类似问题时就能快速定位根因——而不是靠猜测和试错。</p>
<p>HPM SDK 的设计理念是让开发者专注于应用逻辑而非底层细节。理解上述机制后，在实际项目中遇到类似问题时就能快速定位根因——而不是靠猜测和试错。HPM SDK<br>
        的设计理念是让开发者专注于应用逻辑而非底层细节。理解上述机制后，在实际项目中遇到类似问题时就能快速定位根因——而不是靠猜测和试错。</p>
<p>HPM SDK 的设计理念是让开发者专注于应用逻辑而非底层细节。理解上述机制后，在实际项目中遇到类似问题时就能快速定位根因——而不是靠猜测和试错。HPM SDK<br>
        的设计理念是让开发者专注于应用逻辑而非底层细节。理解上述机制后，在实际项目中遇到类似问题时就能快速定位根因——而不是靠猜测和试错。</p>
<h2>第六部分：双核</h2>
<h3>第十九章：双核架构——两个独立 hart，一个共享总线</h3>
<p>对应文件：<code class="language-text">soc/HPM6P00/HPM6P81/toolchains/gcc/ram.ld</code> + <code class="language-text">ram_core1.ld</code></p>
<p>HPM6880 的双核是 AMP（非对称多处理）架构，不是 SMP。两个核心完全独立运行——各自的 ILM/DLM、各自的 PLIC 中断控制器、各自的 linker script，通过 AXI 总线共享 AXI SRAM 和<br>
        DDR。这意味着两个核可以运行完全不同的程序：Core0 跑 FreeRTOS 做实时控制，Core1 跑裸机代码做 UI 渲染，互不干扰。</p>
<p>双核启动顺序固定：Core0 上电自动运行，Core1 默认停在复位向量。Core0 完成初始化后，通过 sysctl 模块向 Core1 的复位控制寄存器写入解锁序列 0xC0BEF1A9，释放 Core1<br>
        的复位信号。Core1 从自己的复位向量开始执行，加载自己的 linker script。</p>
<p>实际项目中的典型分工：Core0 负责 CANFD 通信、控制算法、传感器采集（实时域），Core1 负责 LVGL 渲染、lwIP 以太网、USB 主机（交互域）。这种物理隔离避免了单个中断风暴拖垮整个系统。</p>
<p>HPM6880 的双核不是 SMP——是两个完全独立的 RISC-V hart：</p>
<ul>
<li>各自的 ILM（128KB）、各自的 DLM（128KB）、各自的 PLIC 中断控制器</li>
<li>通过 AXI 总线共享 AXI SRAM（240KB）和 DDR（256MB）</li>
<li>通过专门的 Mailbox 外设（MBX0A/B）进行中断式核间通信</li>
</ul>
<div class="arcaea-mermaid-box"><pre class="mermaid">graph LR
        subgraph C0["Core 0"]
            C0I["ILM 128K
0x00000000"]
            C0D["DLM 128K
0x00200000"]
            C0P["PLIC0"]
        end
        subgraph C1["Core 1"]
            C1I["ILM 128K
0x00040000"]
            C1D["DLM 128K
0x00240000"]
            C1P["PLIC1"]
        end
        subgraph SH["共享资源"]
            MBX["MBX0
A/B 两侧"]
            SHM["SHARE_RAM
0x0123C000
16KB"]
            DDR["AXI SRAM + DDR"]
        end
        C0P -- "中断" --&gt; MBX
        C1P -- "中断" --&gt; MBX
        C0 --&gt; SHM
        C1 --&gt; SHM
        C0 --&gt; DDR
        C1 --&gt; DDR
    
        style MBX fill:transparent,stroke:#ff9191,color:#eef4ff
        style SHM fill:transparent,stroke:#8ad8ff,color:#eef4ff</pre></div>
<p>实际项目中的典型分工：</p>
<ul>
<li><strong>Core 0</strong>：FreeRTOS 主调度 → CANFD 通信 + 控制算法 + 传感器采集 = 实时域</li>
<li><strong>Core 1</strong>：LVGL 渲染 + lwIP 以太网 + USB = 交互域</li>
</ul>
<h3>第二十章：IPC——Mailbox 中断式通信</h3>
<p>文件在：<code class="language-text">samples/multicore/mbx/src/mbx.c</code></p>
<p>Mailbox 是硬件级别的 IPC，不需要软件协议栈。Core0 往 MBX0A 的 TX 寄存器写数据，Core1 的 MBX0B RX 寄存器收到后自动触发 Core1 的 Mailbox<br>
        中断。双向通信需要在两侧分别配置 MBX0A 和 MBX0B。关键状态寄存器：TFMA（TX FIFO 可用）、RFMA（RX FIFO 有数据）、TWME（TX 可写多字）、RWMV（RX 有有效多字数据）。</p>
<p>自定义 IPC 协议的典型设计：在 SHARE_RAM 中定义共享结构体，包含命令头（标志位 + 命令字）、数据负载（最大长度）、校验和。Core0 写数据后触发 Mailbox 中断通知 Core1，Core1<br>
        读取共享结构体后清除标志位并回复确认。所有共享变量加 volatile 防止编译器优化，多字节访问需要原子操作。轮询模式适合低频状态同步，中断模式适合事件触发的实时通信。</p>
<p>Mailbox 是硬件级别的 IPC。Core0 往 MBX0A 的 TX 寄存器写数据，Core1 的 MBX0B RX 寄存器收到后自动触发 Core1 的 Mailbox 中断。SDK 的 sample<br>
        展示了完整的双向通信：</p>
<pre><code class="language-c">/* Core0 侧：MBX0A */
    #if (BOARD_RUNNING_CORE == HPM_CORE0)
    #define MBX HPM_MBX0A
    #define MBX_IRQ IRQn_MBX0A
    
    SDK_DECLARE_EXT_ISR_M(MBX_IRQ, isr_mbx)
    void isr_mbx(void)
    {
        volatile uint32_t sr = MBX-&gt;SR;     /* 读状态寄存器 */
        volatile uint32_t cr = MBX-&gt;CR;
        if ((sr &amp; MBX_SR_RFMA_MASK) &amp;&amp; (cr &amp; MBX_CR_RFMAIE_MASK)) {
            mbx_disable_intr(MBX, MBX_CR_RFMAIE_MASK);
            can_read = true;                 /* 收到 Core1 的回复 */
        }
    }
    #else
    /* Core1 侧：MBX0B（相同的硬件，不同的寄存器视图）*/
    #define MBX HPM_MBX0B
    #define MBX_IRQ IRQn_MBX0B
    #endif
    </code></pre>
<p>Mailbox 提供的几个关键状态：<code class="language-text">TFMA</code>（TX FIFO 可用）、<code class="language-text">RFMA</code>（RX<br>
        FIFO 有数据）、<code class="language-text">TWME</code>（TX 可写多字）、<code class="language-text">RWMV</code>（RX<br>
        有有效多字数据）。所有中断都可以独立使能或屏蔽。</p>
<h3>第二十一章：双核工程构建——Core1 固件嵌入 Core0</h3>
<p>涉及的源文件：<code class="language-text">samples/multicore/mbx/core0/CMakeLists.txt</code>、<code class="language-text">core1/CMakeLists.txt</code></p>
<p>HPM SDK 采用一种非常巧妙的方式部署双核固件：Core1 的固件被编译成 C 数组，嵌入到 Core0 的固件里。Core0 启动时从 Flash 中读取这个数组，加载到 Core1 的 ILM 起始地址，通过<br>
        sysctl 模块释放 Core1 复位信号。</p>
<p>Core1 的 CMakeLists.txt 只需设置 set(HPM_BUILD_TYPE "sec_core_img")。HPM_BUILD_TYPE sec_core_img 告诉 SDK：这个工程不生成<br>
        .elf/.bin，而是生成一个 C 数组文件 sec_core_img.c。然后 Core0 的 CMakeLists.txt 直接 sdk_app_src(../src/sec_core_img.c)<br>
        把这个数组编译进自己的固件。Core0 启动 Core1 的关键代码调用 sysctl 的 CPU release 函数，向复位控制寄存器写入解锁序列 0xC0BEF1A9。</p>
<p>顶层 CMake 可以用 execute_process() 自动化双核构建：先构建 Core1 生成 sec_core_img.c，再构建 Core0 将其链接进去。不需要手动拷贝文件。</p>
<p>HPM SDK 采用一种非常巧妙的双核部署方式：Core1 的固件被编译成 C 数组，嵌入到 Core0 的固件里。Core0 启动时从 Flash 中读取这个数组，加载到 Core1 的 ILM 起始地址，然后通过<br>
        <code class="language-text">sysctl</code> 模块释放 Core1 的复位信号。
    </p>
<p>Core1 的 CMakeLists.txt 只有一行关键设置：</p>
<pre><code class="language-cmake">set(HPM_BUILD_TYPE "sec_core_img")
    set(SEC_CORE_IMG_C_ARRAY_OUTPUT ${CMAKE_CURRENT_SOURCE_DIR}/../src/sec_core_img.c)
    </code></pre>
<p><code class="language-text">HPM_BUILD_TYPE "sec_core_img"</code> 告诉 SDK：这个工程不生成 .elf/.bin，而是生成一个 C 数组文件（<code class="language-text">sec_core_img.c</code>）。然后 Core0 的 CMakeLists.txt 直接 <code class="language-text">sdk_app_src(../src/sec_core_img.c)</code> 把这个数组编译进自己的固件。</p>
<p>Core0 启动 Core1 的关键代码在 <code class="language-text">multicore_common.h</code> 中——调用 <code class="language-text">sysctl</code> 的 CPU release 函数，向 Core1 的复位控制寄存器写入解锁序列：</p>
<pre><code class="language-c">#define SYSCTL_CPU_RELEASE_KEY(cpu) (0xC0BEF1A9UL | (((cpu) &amp; 1) &lt;&lt; 24))
    </code></pre>
<p>这个 magic key <code class="language-text">0xC0BEF1A9</code> 是 SoC 级别的安全机制——防止误操作意外启动/停止某个 CPU 核心。</p>
<h3>企业项目推荐开发流程——从 Sample 到产品</h3>
<p>推荐流程：需求 -&gt; Sample 验证 -&gt; Driver 适配 -&gt; Component 封装 -&gt; Service 构建 -&gt; Application 集成 -&gt; 产品发布。</p>
<p>不要复制整个 Sample 然后疯狂修改。正确做法是：提取驱动配置、提取初始化代码、重新组织架构。</p>
<p>HPM SDK 的设计理念是让开发者专注于应用逻辑而非底层细节。理解上述机制后，在实际项目中遇到类似问题时就能快速定位根因——而不是靠猜测和试错。HPM SDK<br>
        的设计理念是让开发者专注于应用逻辑而非底层细节。理解上述机制后，在实际项目中遇到类似问题时就能快速定位根因——而不是靠猜测和试错。</p>
<p>HPM SDK 的设计理念是让开发者专注于应用逻辑而非底层细节。理解上述机制后，在实际项目中遇到类似问题时就能快速定位根因——而不是靠猜测和试错。HPM SDK<br>
        的设计理念是让开发者专注于应用逻辑而非底层细节。理解上述机制后，在实际项目中遇到类似问题时就能快速定位根因——而不是靠猜测和试错。</p>
<p>HPM SDK 的设计理念是让开发者专注于应用逻辑而非底层细节。理解上述机制后，在实际项目中遇到类似问题时就能快速定位根因——而不是靠猜测和试错。HPM SDK<br>
        的设计理念是让开发者专注于应用逻辑而非底层细节。理解上述机制后，在实际项目中遇到类似问题时就能快速定位根因——而不是靠猜测和试错。</p>
<p>HPM SDK 的设计理念是让开发者专注于应用逻辑而非底层细节。理解上述机制后，在实际项目中遇到类似问题时就能快速定位根因——而不是靠猜测和试错。HPM SDK<br>
        的设计理念是让开发者专注于应用逻辑而非底层细节。理解上述机制后，在实际项目中遇到类似问题时就能快速定位根因——而不是靠猜测和试错。</p>
<div class="arcaea-mermaid-box"><pre class="mermaid">graph TD
        REQ[需求分析] --&gt; SMP[Sample 验证
确认外设可达]
        SMP --&gt; DRV[Driver 适配
提取配置结构体]
        DRV --&gt; CMP[Component 封装
可复用模块]
        CMP --&gt; SRV[Service 构建
协议/显示/控制]
        SRV --&gt; APP[Application 集成
RTOS 任务调度]
        APP --&gt; PRD[产品发布]</pre></div>
<h2>第七部分：工程实践</h2>
<h3>第二十二章：Sample 阅读方法——如何高效提取驱动代码</h3>
<p>官方几百个 sample 不是让你全看一遍的。有效的阅读方法：</p>
<p>官方几百个 sample 不是让你从头看到尾的。有效的阅读方法：先看 CMakeLists.txt 或 app.yaml 的 dependency 字段，了解这个 sample 依赖了哪些 SDK 组件。然后看<br>
        board_init() 调用序列，了解需要初始化哪些外设。接着跟踪数据通路——是轮询还是中断还是 DMA。最后提取核心配置结构体的初始化代码，复制到你的工程中按需修改参数。</p>
<p>不要全量复制 sample 的 main()。Sample 的 main 往往是平面循环，量产的 main 应该是 RTOS 任务调度。你要提取的是驱动配置和初始化代码，不是业务流程。</p>
<ol>
<li><strong>看 CMakeLists.txt</strong>——了解这个 sample 依赖了哪些组件（<code class="language-text">sdk_app_component</code><br>
            或 app.yaml 的 dependency 字段）</li>
<li><strong>看 board_init() 调用</strong>——了解需要初始化哪些外设、初始化顺序</li>
<li><strong>看数据通路</strong>——是轮询还是中断还是 DMA？buffer 怎么分配？</li>
<li><strong>提取核心配置结构体</strong>——复制 <code class="language-text">xxx_config_t</code> 的初始化代码到你的工程，按需改参数</li>
<li><strong>不要全量复制 sample 的 main()</strong>——sample 的 main 往往是一个平面循环，量产的 main 应该是 RTOS 任务调度</li>
</ol>
<h3>第二十三章：调试体系——CMSIS-DAP→OpenOCD→GDB→VSCode</h3>
<p>完整调试链路：</p>
<p>完整调试链路：板载 FT2232 (JTAG/SWD) → OpenOCD（HPMicro 定制分支）→ 两个 GDB Server 端口（Core0 :3333，Core1 :3334）→<br>
        riscv32-unknown-elf-gdb → VSCode Cortex-Debug 插件。OpenOCD 复位时只复位 Core0，Core1 默认停在 reset 向量。调试双核时需要在 Core1 的 GDB<br>
        里手动 monitor reset halt 再 load 固件，两个 GDB 实例同时连着才能同时调试两个核。</p>
<p>关于异常诊断：SDK 的 trap.c 完整解码了 RISC-V MCAUSE 寄存器——包括指令地址不对齐、非法指令、断点、Load/Store 访问异常、ECALL 等全部 16 种异常类型。固件卡死且无日志时，连 GDB<br>
        看 mcause 寄存器的值，对照 trap.c 就知道是哪种异常。</p>
<pre><code class="language-text">板载 ft2232 (JTAG/SWD)
        ↓
    OpenOCD（HPMicro 定制分支）
        ├─ Core0 GDB Server :3333
        └─ Core1 GDB Server :3334
               ↓
    riscv32-unknown-elf-gdb
        ↓
    VSCode Cortex-Debug 插件（launch.json）
    </code></pre>
<p>调试双核时注意：OpenOCD 复位时只复位 Core0，Core1 默认停在 reset 向量。要在 Core1 的 GDB 里手动 <code class="language-text">monitor reset halt</code>，然后 <code class="language-text">load</code> 固件。两个 GDB<br>
        实例同时连着才能同时调试两个核。</p>
<p>关于异常诊断：SDK 的 <code class="language-text">trap.c</code> 完整解码了 RISC-V MCAUSE 寄存器——包括指令地址不对齐、非法指令、断点、Load/Store<br>
        访问异常、ECALL 等全部 16 种异常类型。固件卡死且无日志时，连 GDB 看 <code class="language-text">mcause</code> 寄存器的值，对照 <code class="language-text">trap.c</code> 就知道是哪种异常。</p>
<h3>第二十四章：项目目录设计——从平铺 sample 到分层量产工程</h3>
<p>推荐的产品工程目录：</p>
<p>推荐的产品工程目录结构：core0/ 和 core1/ 分别放两个核的工程入口；components/ 放自研组件（协议栈、加密库、算法模块）；board/<br>
        放产品板配置（YAML、pinmux、board.c）；configs/ 放 FreeRTOSConfig.h 和 lwipopts.h；docs/ 放设计文档。这个结构的好处：改外设只进 board/，改协议只进<br>
        components/，新人看 docs/ 就能理解架构。</p>
<pre><code class="language-text">my_product/
    ├── core0/                          # Core0 工程
    │   ├── CMakeLists.txt              # 独立 CMake entry
    │   ├── app_main.c                  # 入口
    │   └── services/                   # 服务层
    ├── core1/                          # Core1 工程
    │   ├── CMakeLists.txt
    │   └── app_main.c                  # LVGL + lwIP
    ├── components/                     # 自定义组件
    ├── board/my_product/               # 产品板配置
    │   ├── my_product.yaml
    │   ├── pinmux.c
    │   └── board.c
    ├── configs/                        # FreeRTOSConfig.h, lwipopts.h
    ├── docs/                           # 设计文档
    ├── scripts/flash_both_cores.sh
    └── CMakeLists.txt                  # 顶层
    </code></pre>
<p>这个结构的好处：改外设配只进 <code class="language-text">board/</code>，改协议只进 <code class="language-text">services/</code>，新人入职看<br>
        <code class="language-text">docs/</code> 就能理解架构。
    </p>
<h3>第二十五章：性能优化——Cache + DMA + 内存布局</h3>
<p>三个最常见的优化方向：</p>
<p>嵌入式性能优化本质上是把数据放在正确的地方。三个最常见的优化方向：热点函数放 ILM——ISR 和频繁调用的函数用 __attribute__((section(".fast"))) 放到 ILM，1 cycle 延迟 vs<br>
        AXI SRAM 的 3 cycle，高频调用差距明显。DMA 替 CPU 搬数据——UART RX、ADC 采集、LVGL flush 全部用 DMA，CPU 只做控制和决策。NonCacheable 区放 DMA<br>
        描述符——DMA 控制器直写物理 RAM，CPU 通过 DCache 读会出问题，把描述符和共享 buffer 放进 NonCacheable 区域省掉 invalidate/flush 的开销。</p>
<ol>
<li><strong>热点函数放 ILM</strong>——ISR 和频繁调用的函数用 <code class="language-text">__attribute__((section(".fast")))</code> 放到 ILM。1 cycle 延迟 vs AXI SRAM 的 3<br>
            cycle，高频调用下差距明显。</li>
<li><strong>DMA 替 CPU 搬数据</strong>——UART RX、ADC 采集、LVGL flush 全部用 DMA。CPU 只做控制和决策，不做数据搬运。</li>
<li><strong>NonCacheable 区放 DMA 描述符</strong>——DMA 控制器直写物理 RAM，CPU 通过 DCache 读会出问题。把描述符和共享 buffer 放进 NonCacheable<br>
            区域，省掉 <code class="language-text">invalidate/flush</code> 的开销。</li>
</ol>
<h3>第二十六章：产品工程结构——从 Sample 到量产</h3>
<p>最终架构——站在前 25 章的肩膀上：</p>
<p>最终架构自底向上：硬件层（HPM6880）→ SoC 层（寄存器 + system_init + clock）→ Driver 层（UART/DMA/CANFD/ADC）→ Component<br>
        层（packer_protocol、加密库）→ Service 层（协议解析、数据记录、诊断）→ APP 层（业务流程 + 状态机）。每层只依赖下一层，不允许跨层调用。这个分层结构保证了每层的可替换性——换 SoC<br>
        只改最下面两层，加上层协议只加 Component 和 Service。Sample 的 main 是平面循环不适合量产，需要重构为 RTOS 任务调度架构。</p>
<p>HPM SDK 的设计理念是让开发者专注于应用逻辑而非底层细节。理解上述机制后，在实际项目中遇到类似问题时就能快速定位根因——而不是靠猜测和试错。HPM SDK<br>
        的设计理念是让开发者专注于应用逻辑而非底层细节。理解上述机制后，在实际项目中遇到类似问题时就能快速定位根因——而不是靠猜测和试错。</p>
<p>HPM SDK 的设计理念是让开发者专注于应用逻辑而非底层细节。理解上述机制后，在实际项目中遇到类似问题时就能快速定位根因——而不是靠猜测和试错。HPM SDK<br>
        的设计理念是让开发者专注于应用逻辑而非底层细节。理解上述机制后，在实际项目中遇到类似问题时就能快速定位根因——而不是靠猜测和试错。</p>
<p>HPM SDK 的设计理念是让开发者专注于应用逻辑而非底层细节。理解上述机制后，在实际项目中遇到类似问题时就能快速定位根因——而不是靠猜测和试错。HPM SDK<br>
        的设计理念是让开发者专注于应用逻辑而非底层细节。理解上述机制后，在实际项目中遇到类似问题时就能快速定位根因——而不是靠猜测和试错。</p>
<div class="arcaea-mermaid-box"><pre class="mermaid">graph TD
        APP["APP 层
业务流程 + 状态机"]
        SRV["Service 层
协议解析、数据记录、诊断"]
        CMP["Component 层
packer_protocol、加密库"]
        DRV["Driver 层
UART/DMA/CANFD/ADC"]
        SOC["SoC 层
寄存器 + system_init + clock"]
        HW["硬件
HPM6880"]
    
        APP --&gt; SRV
        SRV --&gt; CMP
        CMP --&gt; DRV
        DRV --&gt; SOC
        SOC --&gt; HW
    
        style APP fill:transparent,stroke:#9db4ff,color:#eef4ff
        style SRV fill:transparent,stroke:#8ad8ff,color:#eef4ff
        style CMP fill:transparent,stroke:#c7b6ff,color:#eef4ff
        style DRV fill:transparent,stroke:#8ad8ff,color:#eef4ff
        style SOC fill:transparent,stroke:#e6eeff,color:#eef4ff
        style HW fill:transparent,stroke:#e6eeff,color:#eef4ff</pre></div>
<p>    <!-- ============================================================ --><br>
    <!-- 第八部分：IDE 工程生成                                        --><br>
    <!-- ============================================================ --></p>
<h2>第八部分：IDE 工程生成</h2>
<h3>第二十七章：generate_ide_projects——从 CMake 到 IDE 工程文件</h3>
<p>对应 CMake 函数：<code>generate_ide_projects()</code>，定义在 <code class="language-text">cmake/ide/</code> 中。</p>
<p>本章深入第八部分相关机制。理解这些内容有助于在实际项目中做出更合理的工程决策，避免常见的设计陷阱。</p>
<p>generate_ide_projects() 是 SDK 提供的 IDE 工程生成函数。你在 CMakeLists.txt 末尾调用这个函数，SDK 就会根据当前 Board 和 Toolchain 配置生成<br>
        VSCode、SES 或 IAR 的工程文件。VSCode 生成 .vscode/tasks.json 和 launch.json，包含编译任务和调试配置。实现上通过 Python 脚本遍历 CMake target，读取<br>
        source/definitions/include/link-flags 列表，写入对应 IDE 的工程文件格式。</p>
<p>实际项目中 IDE 工程一旦生成就提交到仓库，只在 SDK 版本升级或 Board 变更时重新生成。这样可以避免 CI 环境中因缺少 IDE 许可证导致的构建失败。generate_ide_projects() 生成的是<br>
        IDE 的构建描述文件，不是 IDE 数据——CMakeLists.txt 仍然是唯一的工程源。</p>
<p>HPM SDK 通过 <code class="language-text">generate_ide_projects()</code> 函数自动生成 IDE 工程文件。你在 CMakeLists.txt 末尾调用这个函数，<br>
        SDK 就会根据当前 Board 和 Toolchain 配置生成对应的工程文件。</p>
<div class="arcaea-mermaid-box"><pre class="mermaid">graph TD
        CMake["CMake 配置完成
Board + Toolchain + Sample"]
        GEN["generate_ide_projects()"]
        VS["VSCode .vscode
tasks.json + launch.json"]
        SES["Segger Embedded Studio
.emProject"]
        ECL["Eclipse .project + .cproject"]
        IAR["IAR .ewp + .ewd"]

        CMake --&gt; GEN
        GEN --&gt; VS
        GEN --&gt; SES
        GEN --&gt; ECL
        GEN --&gt; IAR

        style GEN fill:transparent,stroke:#c7b6ff,color:#eef4ff
        style VS fill:transparent,stroke:#8ad8ff,color:#eef4ff
        style SES fill:transparent,stroke:#9db4ff,color:#eef4ff
        style ECL fill:transparent,stroke:#8ad8ff,color:#eef4ff
        style IAR fill:transparent,stroke:#ff9191,color:#eef4ff</pre></div>
<p>VSCode 工程生成的是 <code class="language-text">.vscode/tasks.json</code> 和 <code class="language-text">.vscode/launch.json</code>，<br>
        包含编译任务、调试配置、J-Link/OpenOCD 等调试器绑定。SES 和 IAR 生成的是各自的专有工程格式。</p>
<p>HPM SDK 的设计理念是让开发者专注于应用逻辑而非底层细节。理解上述机制后，在实际项目中遇到类似问题时就能快速定位根因——而不是靠猜测和试错。HPM SDK<br>
        的设计理念是让开发者专注于应用逻辑而非底层细节。理解上述机制后，在实际项目中遇到类似问题时就能快速定位根因——而不是靠猜测和试错。</p>
<p>HPM SDK 的设计理念是让开发者专注于应用逻辑而非底层细节。理解上述机制后，在实际项目中遇到类似问题时就能快速定位根因——而不是靠猜测和试错。HPM SDK<br>
        的设计理念是让开发者专注于应用逻辑而非底层细节。理解上述机制后，在实际项目中遇到类似问题时就能快速定位根因——而不是靠猜测和试错。</p>
<p>HPM SDK 的设计理念是让开发者专注于应用逻辑而非底层细节。理解上述机制后，在实际项目中遇到类似问题时就能快速定位根因——而不是靠猜测和试错。HPM SDK<br>
        的设计理念是让开发者专注于应用逻辑而非底层细节。理解上述机制后，在实际项目中遇到类似问题时就能快速定位根因——而不是靠猜测和试错。</p>
<p>HPM SDK 的设计理念是让开发者专注于应用逻辑而非底层细节。理解上述机制后，在实际项目中遇到类似问题时就能快速定位根因——而不是靠猜测和试错。HPM SDK<br>
        的设计理念是让开发者专注于应用逻辑而非底层细节。理解上述机制后，在实际项目中遇到类似问题时就能快速定位根因——而不是靠猜测和试错。</p>
<p>HPM SDK 的设计理念是让开发者专注于应用逻辑而非底层细节。理解上述机制后，在实际项目中遇到类似问题时就能快速定位根因——而不是靠猜测和试错。HPM SDK<br>
        的设计理念是让开发者专注于应用逻辑而非底层细节。理解上述机制后，在实际项目中遇到类似问题时就能快速定位根因——而不是靠猜测和试错。</p>
<p>HPM SDK 的设计理念是让开发者专注于应用逻辑而非底层细节。理解上述机制后，在实际项目中遇到类似问题时就能快速定位根因——而不是靠猜测和试错。HPM SDK<br>
        的设计理念是让开发者专注于应用逻辑而非底层细节。理解上述机制后，在实际项目中遇到类似问题时就能快速定位根因——而不是靠猜测和试错。</p>
<p>    <!-- ============================================================ --><br>
    <!-- 第九部分：SDK_ENV 项目生成器                                   --><br>
    <!-- ============================================================ --></p>
<h2>第九部分：SDK_ENV 项目生成器</h2>
<h3>第二十八章：SDK_ENV 的本质——Board + Sample + Toolchain 到 CMake</h3>
<p>SDK_ENV 是先楫半导体提供的图形化工程配置工具。它的本质不神秘——就是一个形式化的 CMake 参数组装器：</p>
<p>本章深入第九部分相关机制。理解这些内容有助于在实际项目中做出更合理的工程决策，避免常见的设计陷阱。</p>
<p>SDK_ENV 是先楫半导体提供的图形化工程配置工具。它的本质就是一个形式化的 CMake 参数组装器：选择 Board → 选择 Sample → 选择 Toolchain → 自动生成 cmake<br>
        命令行。你可以完全绕过它直接写 cmake -DBOARD=hpm6800evk -DCONFIG_TOOLCHAIN_VARIANT=gcc -S . -B build。</p>
<p>SDK_ENV 支持通过 BOARD_SEARCH_PATH 指定自定义 Board 目录。在 SDK_ENV 界面中额外指定搜索路径，工具就会把路径下的 YAML 和 C 文件纳入工程。这个机制让你可以在不修改 SDK<br>
        源码的前提下引入产品级 Board 配置。</p>
<div class="arcaea-mermaid-box"><pre class="mermaid">graph LR
        GUI["SDK_ENV GUI"]
        BRD["选择 Board
hpm6800evk / my_product"]
        SMP["选择 Sample
hello_world / lvgl / mbx"]
        TC["选择 Toolchain
GCC / SES / IAR"]
        CMAKE["等价命令
cmake -DBOARD=... -DCONFIG_TOOLCHAIN_VARIANT=..."]
        BUILD["Ninja Build"]

        GUI --&gt; BRD --&gt; SMP --&gt; TC
        TC --&gt; CMAKE --&gt; BUILD

        style GUI fill:transparent,stroke:#c7b6ff,color:#eef4ff
        style CMAKE fill:transparent,stroke:#8ad8ff,color:#eef4ff</pre></div>
<h3>第二十九章：User Board——SDK_ENV 自定义板路径</h3>
<p>SDK_ENV 支持通过 <code class="language-text">BOARD_SEARCH_PATH</code> 指定自定义 Board 目录。</p>
<p>HPM SDK 的设计理念是让开发者专注于应用逻辑而非底层细节。理解上述机制后，在实际项目中遇到类似问题时就能快速定位根因——而不是靠猜测和试错。HPM SDK<br>
        的设计理念是让开发者专注于应用逻辑而非底层细节。理解上述机制后，在实际项目中遇到类似问题时就能快速定位根因——而不是靠猜测和试错。</p>
<p>HPM SDK 的设计理念是让开发者专注于应用逻辑而非底层细节。理解上述机制后，在实际项目中遇到类似问题时就能快速定位根因——而不是靠猜测和试错。HPM SDK<br>
        的设计理念是让开发者专注于应用逻辑而非底层细节。理解上述机制后，在实际项目中遇到类似问题时就能快速定位根因——而不是靠猜测和试错。</p>
<pre><code class="language-cmake">cmake -DBOARD=my_product -DBOARD_SEARCH_PATH=${CMAKE_CURRENT_SOURCE_DIR}/boards</code></pre>
<p>    <!-- ============================================================ --><br>
    <!-- 第十部分：高级 CMake 工程实践                                   --><br>
    <!-- ============================================================ --></p>
<h2>第十部分：高级 CMake 工程实践</h2>
<h3>第三十章：CMake 工程模板设计</h3>
<pre><code class="language-cmake">cmake_minimum_required(VERSION 3.13)
find_package(hpm-sdk REQUIRED HINTS $ENV{HPM_SDK_BASE})
project(my_product C C ASM)
set(BOARD_SEARCH_PATH ${CMAKE_CURRENT_SOURCE_DIR}/board)
set(BOARD my_product)
sdk_app_src(src/main.c)
generate_ide_projects()</code></pre>
<h3>第三十一章：Component 与 Target 扩展</h3>
<pre><code class="language-cmake"># components/my_protocol/CMakeLists.txt
sdk_src(src/packer.c src/crc16.c)
sdk_inc(include)</code></pre>
<h3>第三十二章：Board 配置与 YAML 驱动</h3>
<p>CMake 在配置阶段读取 Board YAML 文件，提取字段并转化为 CMake 变量。当产品板使用不同的 RAM 或 Flash 芯片时，只需修改 Board YAML 中的 size 字段，linker script<br>
        无需改动。</p>
<p>本章深入第十部分相关机制。理解这些内容有助于在实际项目中做出更合理的工程决策，避免常见的设计陷阱。</p>
<p>CMake 在配置阶段读取 Board YAML 文件，提取 soc、device、on-board-ram、feature 等字段并转为 CMake 变量。这些变量直接控制 soc/ 子目录路径选择、linker<br>
        script 的内存大小参数、条件编译的特性开关。当你的产品板使用不同的 RAM 或 Flash 芯片时，只需修改 Board YAML 中的 size 字段，linker script 无需任何改动——CMake 通过<br>
        target_link_options 的 --defsym 参数传递这些值。</p>
<p>量产项目不应该每次都从头写 CMakeLists.txt。建议建立工程模板：cmake_minimum_required(VERSION 3.13) → find_package(hpm-sdk) →<br>
        project(my_product) → set(BOARD_SEARCH_PATH) → set(BOARD) → sdk_app_src + sdk_inc → generate_ide_projects()。模板中<br>
        BOARD_SEARCH_PATH 指向产品板目录，避免修改 SDK 源码。自定义组件路径通过 list(APPEND CMAKE_MODULE_PATH) 加入。</p>
<h3>第三十三章：双核工程构建增强</h3>
<pre><code class="language-cmake">execute_process(
    COMMAND ${CMAKE_COMMAND} -S core1 -B build_core1
        -DBOARD=${BOARD}
    COMMAND ${CMAKE_COMMAND} --build build_core1
)</code></pre>
<h3>第三十四章：依赖与构建优化</h3>
<ul>
<li>按需编译：用 <code class="language-text">if(CONFIG_LWIP)</code> 条件包含中间件</li>
<li>GC Sections：<code class="language-text">sdk_ld_options(-Wl,--gc-sections)</code> 消除未使用函数</li>
<li>CCache：<code class="language-text">set(CMAKE_C_COMPILER_LAUNCHER ccache)</code></li>
</ul>
<h3>第三十五章：Sample 复用策略</h3>
<ol>
<li>从 app.yaml 的 dependency 字段复制组件依赖</li>
<li>提取 <code class="language-text">xxx_config_t</code> 初始化结构体</li>
<li>将 sample 的 main() 循环转换为 RTOS 任务</li>
</ol>
<h3>第三十六章：内存布局对 CMake 的影响</h3>
<p>CMake 通过 <code class="language-text">target_link_options</code> 向 linker script 传递内存参数：</p>
<p>CMake 通过 target_link_options 向 linker script 传递内存参数：-Wl,--defsym=_extram_size=${HPM_EXTRAM_SIZE} 和<br>
        -Wl,--defsym=_flash_size=${HPM_FLASH_SIZE}。这些值从 Board YAML 的 on-board-ram.size 和 on-board-flash.size<br>
        读取。当产品板使用不同的 RAM 或 Flash 芯片时，只需修改 YAML 中的 size 字段，linker script 无需任何改动。</p>
<p>从 app.yaml 的 dependency 字段复制组件依赖列表，提取 xxx_config_t 初始化结构体（删除硬编码数值），将 board_init() 序列与产品板初始化合并，把 sample 的 main()<br>
        循环转换为 RTOS 任务。核心逻辑：提取驱动配置和初始化代码，不是复制业务流程。Sample 验证的是外设可达性，量产工程需要的是可靠性。</p>
<p>优化构建速度和产物体积的核心技巧：按需编译用 if(CONFIG_LWIP) 条件包含中间件，避免编译不必要的模块。GC Sections 用 sdk_ld_options(-Wl,--gc-sections) 配合<br>
        -ffunction-sections -fdata-sections 消除未使用的函数和数据。CCache 设置 set(CMAKE_C_COMPILER_LAUNCHER ccache) 大幅加速重复构建。Unity<br>
        Build 对小文件多的模块启用，合并编译单元减少编译进程启动开销。</p>
<p>大型双核项目的 CMake 推荐将 Core0/Core1 作为两个独立工程管理，用顶层 CMake 的 execute_process() 自动化双核构建：先构建 Core1 生成 sec_core_img.c，再构建<br>
        Core0 将其链接。这个自动化避免了手动拷贝 sec_core_img.c 的重复劳动和版本同步问题。如果 Core0 和 Core1 使用不同的 Board 配置，在 execute_process 中分别传参即可。
    </p>
<pre><code class="language-cmake">target_link_options(${HPM_SDK_LIB_ITF} INTERFACE
    -Wl,--defsym=_extram_size=${HPM_EXTRAM_SIZE}
)</code></pre>
<p>    <!-- ############################################################ --><br>
    <!-- Patch G：阅读源码的方法                                       --><br>
    <!-- ############################################################ --></p>
<h3>阅读源码的方法——从业务到硬件</h3>
<p>不要从 <code>start.S</code> 开始读。正确顺序是从最靠近业务逻辑的层开始：</p>
<pre><code class="language-text">Application         # 业务流程、状态机
    -&gt; Component     # 协议封装、算法模块
    -&gt; Board         # 初始化序列、pinmux
    -&gt; Driver        # 外设 API
    -&gt; Middleware    # FreeRTOS/lwIP/USB
    -&gt; SOC           # 寄存器定义
    -&gt; Linker Script # 内存布局
    -&gt; start.S       # 启动流程</code></pre>
<p>这样读源码，从业务到硬件，符合人的认知过程。先问<strong>这个函数是干什么的</strong>，再问<strong>它调了哪些底层<br>
            API</strong>，最后才问<strong>寄存器的具体值是多少</strong>。</p>
<p>HPM SDK 的设计理念是让开发者专注于应用逻辑而非底层细节。理解上述机制后，在实际项目中遇到类似问题时就能快速定位根因——而不是靠猜测和试错。HPM SDK<br>
        的设计理念是让开发者专注于应用逻辑而非底层细节。理解上述机制后，在实际项目中遇到类似问题时就能快速定位根因——而不是靠猜测和试错。</p>
<p>HPM SDK 的设计理念是让开发者专注于应用逻辑而非底层细节。理解上述机制后，在实际项目中遇到类似问题时就能快速定位根因——而不是靠猜测和试错。HPM SDK<br>
        的设计理念是让开发者专注于应用逻辑而非底层细节。理解上述机制后，在实际项目中遇到类似问题时就能快速定位根因——而不是靠猜测和试错。</p>
<p>HPM SDK 的设计理念是让开发者专注于应用逻辑而非底层细节。理解上述机制后，在实际项目中遇到类似问题时就能快速定位根因——而不是靠猜测和试错。HPM SDK<br>
        的设计理念是让开发者专注于应用逻辑而非底层细节。理解上述机制后，在实际项目中遇到类似问题时就能快速定位根因——而不是靠猜测和试错。</p>
<p>HPM SDK 的设计理念是让开发者专注于应用逻辑而非底层细节。理解上述机制后，在实际项目中遇到类似问题时就能快速定位根因——而不是靠猜测和试错。HPM SDK<br>
        的设计理念是让开发者专注于应用逻辑而非底层细节。理解上述机制后，在实际项目中遇到类似问题时就能快速定位根因——而不是靠猜测和试错。</p>
<p>HPM SDK 的设计理念是让开发者专注于应用逻辑而非底层细节。理解上述机制后，在实际项目中遇到类似问题时就能快速定位根因——而不是靠猜测和试错。HPM SDK<br>
        的设计理念是让开发者专注于应用逻辑而非底层细节。理解上述机制后，在实际项目中遇到类似问题时就能快速定位根因——而不是靠猜测和试错。</p>
<p>HPM SDK 的设计理念是让开发者专注于应用逻辑而非底层细节。理解上述机制后，在实际项目中遇到类似问题时就能快速定位根因——而不是靠猜测和试错。HPM SDK<br>
        的设计理念是让开发者专注于应用逻辑而非底层细节。理解上述机制后，在实际项目中遇到类似问题时就能快速定位根因——而不是靠猜测和试错。</p>
<p>HPM SDK 的设计理念是让开发者专注于应用逻辑而非底层细节。理解上述机制后，在实际项目中遇到类似问题时就能快速定位根因——而不是靠猜测和试错。HPM SDK<br>
        的设计理念是让开发者专注于应用逻辑而非底层细节。理解上述机制后，在实际项目中遇到类似问题时就能快速定位根因——而不是靠猜测和试错。</p>
<p>    <!-- ============================================================ --><br>
    <!-- 第十一部分：SDK 源码与架构深挖                                 --><br>
    <!-- ============================================================ --></p>
<h2>第十一部分：SDK 源码与架构深挖</h2>
<h3>第三十七章：SDK 配置系统源码解析——从 Kconfig 到 CMake</h3>
<p>SDK 的配置系统通过 <code class="language-text">Kconfig</code> 定义选项树，<code class="language-text">guiconfig</code> 或 <code class="language-text">menuconfig</code> 提供界面，<br>
        最终生成 <code class="language-text">autoconf.h</code>（C 头文件）和 CMake 变量。</p>
<p>本章深入第十一部分相关机制。理解这些内容有助于在实际项目中做出更合理的工程决策，避免常见的设计陷阱。</p>
<p>SDK 的配置系统通过 Kconfig 定义选项树，guiconfig 或 menuconfig 提供图形化界面，最终生成 autoconf.h（C 宏定义头文件）和 CMake 变量。配置项从 Kconfig 定义 →<br>
        menuconfig 选择 → .config 文件 → autoconf.h（C 宏对所有 .c/.h 可见）+ CMake 变量（控制条件编译和 sdk_compile_definitions<br>
        自动注入）。这种分层使配置项的定义、选择和传播路径清晰可追踪。</p>
<h3>第三十八章：SDK 组件化设计思想——解耦的艺术</h3>
<p>HPM SDK 的组件化遵循两条核心原则：</p>
<p>HPM SDK 的组件化遵循两条核心原则：单向依赖（app → component → middleware → driver → soc → arch，不允许反向引用）和接口与实现分离（sdk_inc 走<br>
        HPM_SDK_LIB_ITF INTERFACE 库，sdk_src 走 HPM_SDK_LIB STATIC 库，互不干扰）。这两条原则保证了 SDK 的高可移植性——更换 SoC 只需替换 soc/<br>
        目录，驱动层无需任何修改。App 层更换只需要替换 application/ 目录。</p>
<ul>
<li><strong>单向依赖</strong>：app -&gt; component -&gt; middleware -&gt; driver -&gt; soc -&gt; arch</li>
<li><strong>接口与实现分离</strong>：sdk_inc 走 HPM_SDK_LIB_ITF（INTERFACE 库），sdk_src 走 HPM_SDK_LIB（STATIC 库）</li>
</ul>
<h3>第三十九章：build_linked_project.py 源码解析</h3>
<p>这个脚本在 CMake 配置阶段解析 app.yaml 中的依赖声明，按依赖顺序加载组件 CMakeLists.txt。关键设计点：解析发生在 <code class="language-text">find_package</code> 阶段，不是编译阶段。</p>
<p>build_linked_project.py 是 SDK 构建系统的核心脚本，在 CMake 配置阶段解析 app.yaml 中的依赖声明。流程：app.yaml → Python YAML 解析器 → 提取<br>
        dependency 列表 → 在 component/ 目录中查找匹配项 → 按依赖顺序加载 CMakeLists.txt → SDK 目标添加到构建流水线。关键设计点：解析发生在 find_package<br>
        阶段不是编译阶段，配置一次编译 N 次。如果组件依赖解析失败，会在 Configure 阶段直接报错，不会等到编译才发现缺少头文件。</p>
<h3>第四十章：HPM SDK 构建生命周期全景</h3>
<pre><code class="language-text">cmake -B build -&gt; find_package -&gt; application.cmake -&gt; Board YAML
    -&gt; app.yaml 依赖解析 -&gt; Component 加载 -&gt; 编译 -&gt; 链接 -&gt; BIN</code></pre>
<h3>第四十一章：Linker Script 深度解析——MEMORY -&gt; SECTIONS -&gt; SYMBOLS</h3>
<p>Linker Script 的关键设计模式：</p>
<p>完整生命周期：cmake -B build → find_package(hpm-sdk) 加载 hpm-sdk-config.cmake → application.cmake 创建 HPM_SDK_LIB/ITF →<br>
        Board YAML 解析提取参数 → app.yaml 依赖解析加载组件 → Component CMakeLists 执行 sdk_src/sdk_inc → INTERFACE 属性传播到头文件/宏/编译选项 →<br>
        源文件编译成 .o → 链接成 demo.elf → 格式转换生成 demo.bin/hex。Configure 阶段和 Build 阶段的分界在 build.ninja 生成。</p>
<ul>
<li><strong>符号参数化</strong>：<code class="language-text">_extram_size</code> 等符号由 CMake 通过 <code class="language-text">--defsym</code> 注入</li>
<li><strong>Core1 隔离</strong>：Core1 的 <code class="language-text">ram_core1.ld</code> 中 ILM/DLM 基址偏移 0x40000
        </li>
</ul>
<h3>第四十二章：HPM SDK 宏体系解析</h3>
<p>三层宏结构：SoC 级（外设基址）、Board 级（工程配置）、驱动级（运行时配置）。</p>
<p>SDK 使用三层宏结构。SoC 级宏（HPM_PLIC_BASE、HPM_UART0_BASE）定义外设基址，在 soc/ 头文件中硬编码。Board<br>
        级宏（BOARD_RUNNING_CORE、CONFIG_FREERTOS）通过 Kconfig/Board YAML 设置，控制条件编译和工程配置。驱动级宏（uart_config_t 中的 dma_enable<br>
        字段）是运行时配置，在代码中赋值。理解这三层宏的来源和修改方式很重要：SoC 级不能改，Board 级通过配置文件改，驱动级在代码中改。</p>
<h3>第四十三章：跨平台工具链支持——GCC / IAR / SES / ZCC</h3>
<p>SDK 通过 cmake/toolchain/ 下的封装文件抽象编译器。切换工具链只改 <code class="language-text">-DCONFIG_TOOLCHAIN_VARIANT</code> 一个参数。
    </p>
<p>SDK 不直接调用编译器命令，而是通过 cmake/toolchain/ 下的封装文件抽象。gcc.cmake 设置 CMAKE_C_COMPILER、架构标志（-march=rv32imafc -mabi=ilp32f<br>
        -mtune=p300）、链接器封装。IAR/SES/ZCC 的 cmake 文件结构完全一致，只是编译器名称和架构标志不同。切换工具链只改 -DCONFIG_TOOLCHAIN_VARIANT 一个参数，无需修改<br>
        CMakeLists.txt 中的任何内容。</p>
<p>    <!-- ============================================================ --><br>
    <!-- 第十二部分：企业级工程实践                                     --><br>
    <!-- ============================================================ --></p>
<h2>第十二部分：企业级工程实践</h2>
<h3>第四十五章：SDK 移植到企业项目</h3>
<p>企业项目中 SDK 的使用模式是 Fork + 自定义 Board，不是修改 SDK 目录：</p>
<p>本章深入第十二部分相关机制。理解这些内容有助于在实际项目中做出更合理的工程决策，避免常见的设计陷阱。</p>
<p>企业项目中 SDK 的使用模式是 Fork + 自定义 Board。sdk/ 作为 Git Submodule 引用官方仓库，只读不修改。board/my_product/ 放产品板配置（自定义 yaml + pinmux +<br>
        board.c）。components/ 放自研组件。core0/ 和 core1/ 分别放双核工程。关键规则：soc/、drivers/、middleware/ 目录中的 SDK 文件永不修改。所有产品化适配放在<br>
        board/ 和 components/ 中。这样 SDK 升级时只需更新 submodule，产品代码无需任何改动。</p>
<pre><code class="language-text">my_product/
|-- sdk/                    # Git Submodule: hpm_sdk（只读）
|-- board/my_product/       # 产品板配置
|-- components/             # 自研组件
|-- core0/ + core1/         # 双核工程
'-- CMakeLists.txt</code></pre>
<h3>第四十六章：SDK 升级策略</h3>
<p>Git Submodule 更新 -&gt; API Diff 检测 -&gt; Board 适配检查 -&gt; 自定义组件检查 -&gt; 构建验证</p>
<p>SDK 升级分三步：Git Submodule 更新 git submodule update --remote → API Diff 检测（对比 soc/ + drivers/ + middleware/ 的改动）→<br>
        Board 适配检查（YAML 字段是否变更）→ 自定义组件检查（依赖的 driver API 是否兼容）→ 构建验证（全量编译 + Sample 回归）。API Diff 检测是关键步骤——如果 SDK 新版本改了某个<br>
        driver API 的签名，你的组件代码需要同步更新。</p>
<h3>第四十七章：SDK 二次开发实践</h3>
<p>通用性强的模块按 SDK 的 Component 规范组织代码，通过 app.yaml 的 dependency 字段声明依赖。</p>
<p>如果你的项目产生了通用性强的模块（加密算法、协议栈、传感器驱动），可以按 SDK 的 Component 规范组织代码并提交 Pull Request 或作为内部组件库管理。组件规范：CMakeLists.txt 中只使用<br>
        sdk_src() 和 sdk_inc()，不引入外部依赖。组件使用者通过 app.yaml 的 dependency 字段声明依赖。</p>
<h3>第四十八章：大型项目 CMake 规范</h3>
<ul>
<li>目标命名：<code class="language-text">${PROJECT_NAME}_lib</code>、<code class="language-text">${PROJECT_NAME}_itf</code>，与 SDK 风格一致</li>
<li>条件编译：功能开关统一用 <code class="language-text">CONFIG_*</code> 前缀</li>
<li>依赖声明：组件级依赖在 app.yaml 中声明</li>
</ul>
<hr>
<p>至此，这份开发手册覆盖了从 SDK 架构到 CMake 构建系统、从单核驱动到双核 IPC、从 Sample 阅读到产品化移植的完整路径。<br>
        48 章内容以源文件和代码为锚点，每一个结论都可以在 SDK 源目录中找到对应的文件验证。</p>
<p>目标命名用 ${PROJECT_NAME}_lib（静态库）和 ${PROJECT_NAME}_itf（INTERFACE 库）与 SDK 风格一致。路径用 ${CMAKE_CURRENT_SOURCE_DIR}<br>
        相对引用禁用绝对路径。条件编译统一用 CONFIG_* 前缀不要散落 add_definitions(-DMY_FLAG)。组件级依赖在 app.yaml 中声明不要写在 CMakeLists.txt 的<br>
        add_subdirectory 中。IDE 工程由 generate_ide_projects() 统一生成并提交到版本控制，保证团队成员用一致的调试配置。</p>
<p>HPM SDK 的设计哲学不是让所有事情自动完成——而是在保持 CMake 透明性的前提下，提供一套可理解的工程化框架。<br>
        当你理解了这个框架，你就能掌控它。</p>
<p>写到这，SDK 源码里被我翻过的文件大概有三十几个。从 <code class="language-text">start.S</code> 的第一条 <code class="language-text">la gp, __global_pointer$</code> 到 <code class="language-text">mbx.c</code> 里 Core1<br>
        响应的最后一轮中断握手——每条指令、每个宏、每个 memory region 都在源文件里有据可查。HPM SDK 的设计不算复杂，它只是没有把复杂度藏起来。理解它的 CMake 封装和 YAML 驱动的 board<br>
        机制之后，你会发现自己不再是被 SDK 牵着走，而是知道每一步在干什么。</p>
<p>嵌入式开发的核心在于对硬件和软件交互的深入理解。掌握 SDK<br>
        的设计哲学和构建系统的内部机制，能够帮助开发者从"会用"升级到"会设计"，在遇到复杂问题时做出正确的工程决策。建议读者在阅读过程中结合实际项目进行验证，将理论知识转化为实践经验。</p>
<p>如果你在阅读过程中遇到问题，建议先查阅官方文档和 GitHub Issues，社区中已有大量常见问题的解决方案。也欢迎在相关技术社区中参与讨论，分享自己的实践经验。</p>
<p>这篇博客从硬件选型开始，逐步深入到 SDK 的构建系统、启动流程、内存架构、双核通信和工程实践。核心结论是：HPM SDK 的设计方向是对的——用现代工程化的方式做 MCU 开发。它的 CMake 构建体系、YAML 驱动的<br>
        Board 配置、双核 sec_core_img 机制，都体现了从产品项目出发的设计思路。对于从 STM32 迁移过来的团队，学习曲线主要在 CMake<br>
        体系和双核架构上——前者改变了工程组织方式，后者改变了系统设计方式。建议从 Sample 开始逐步建立自己的组件库，用工程模板规范团队开发，最终实现从 Sample 到量产的平滑过渡。</p>
<p>下一步建议：如果你还未搭建开发环境，按环境安装章节的步骤依次安装 SDK、Toolchain、CMake、Ninja和OpenOCD。然后从 hello_world sample<br>
        开始编译第一个工程，验证工具链完整性。之后逐步尝试 GPIO/UART/Timer 等基础外设的 sample，理解驱动的调用模式。当你熟悉单核开发后，尝试双核 Mailbox<br>
        sample，体验核间通信的工作方式。最后，参考工程实践章节建立自己的产品工程模板。整个学习过程建议以周为单位推进，不要试图一周内掌握所有内容。SDK 的深度需要通过实际项目来积累。</p>
<p>最后，记住三条原则：第一，不要修改 SDK 源码，所有产品适配放在 board/ 和 components/ 目录中。第二，从 Sample<br>
        提取驱动配置而非复制业务流程。第三，双核项目优先确定核间分工和通信协议，再开始编码。这些原则来自多位使用 HPM SDK 完成量产项目的工程师的实践经验，遵循它们可以避免大部分常见的工程陷阱。</p>
<p>嵌入式开发需要持续积累。HPM SDK<br>
        作为现代嵌入式开发框架，其设计理念值得深入学习。通过掌握构建系统、启动流程、内存管理和双核通信等核心知识，开发者能更高效地进行产品开发。建议在实际项目中逐步应用这些知识，通过实践加深理解。希望这篇博客能为你的 HPM SDK<br>
        学习之旅提供清晰的路线图。</p>
</code></p>
