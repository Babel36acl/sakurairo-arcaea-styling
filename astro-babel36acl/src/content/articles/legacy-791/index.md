---
title: "嵌入式开发环境搭建完全指南：从 WSL2 到完整 STM32 工具链"
description: "嵌入式开发环境的搭建是对接硬件之前的第一个坑。本文把整套环境从零到完整的搭建过程整合为一，覆盖 WSL2 配置、工具链安装、VSC ..."
published: "2026-05-29"
updated: "2026-06-02"
permalink: "/2026/05/29/嵌入式开发环境搭建完全指南：从-wsl2-到完整-stm32-工具/"
draft: false
categories: ["嵌入式实战","方法与工具"]
tags: []
legacyId: 791
---

<p>嵌入式开发环境的搭建是对接硬件之前的第一个坑。本文把整套环境从零到完整的搭建过程整合为一，覆盖 WSL2 配置、工具链安装、VSCode 工程化配置、调试链和 CMake 构建系统。</p>
<h2>一、整体架构</h2>
<p>这套环境的核心思路：</p>
<div class="arcaea-mermaid-box"><pre class="mermaid">flowchart TB
    subgraph WSL2[WSL2 环境]
        W1[Ubuntu/Arch]
        W2[工具链安装]
    end
    subgraph VSC[VSCode 配置]
        V1[CMake Presets]
        V2[Cortex-Debug]
        V3[OpenOCD]
    end
    subgraph CHAIN[调试链]
        C1[OpenOCD → GDB]
        C2[Semihosting]
    end
    WSL2 --&gt; VSC --&gt; CHAIN
    style WSL2 fill:transparent,stroke:#8dc7ff,color:#eaf4ff
    style VSC fill:transparent,stroke:#8dc7ff,color:#eaf4ff
    style CHAIN fill:transparent,stroke:#8dc7ff,color:#eaf4ff</pre></div>
<ul>
<li><strong>Windows</strong> 管 UI、浏览器、微信、Office</li>
<li><strong>Linux (WSL2 + Arch)</strong> 管编译、调试、脚本、自动化</li>
<li><strong>AI</strong> 管代码审查、知识管理、技术写作</li>
</ul>
<p>三层各司其职，全部在 Windows 11 24H2 上运行。</p>
<h2>二、WSL2 + Arch Linux 基础搭建</h2>
<h3>2.1 启用 WSL2</h3>
<pre><code class="language-bash"># 以管理员身份运行 PowerShell
dism.exe /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart
dism.exe /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart
# 重启后
wsl --set-default-version 2</code></pre>
<h3>2.2 安装 ArchWSL</h3>
<pre><code class="language-bash"># 下载 ArchWSL (yuk7 版)
# 解压后双击 Arch.exe 运行，会自动安装到 %LOCALAPPDATA%\Arch\
# 进入 WSL 后立即配置:
echo 'Server = https://mirrors.tuna.tsinghua.edu.cn/archlinux/$repo/os/$arch' &gt; /etc/pacman.d/mirrorlist
pacman-key --init
pacman-key --populate archlinux
pacman -Syu</code></pre>
<h3>2.3 嵌入式工具链</h3>
<pre><code class="language-text"> ARM GCC 14.2.0（AUR 安装）
pacman -S arm-none-eabi-gcc arm-none-eabi-binutils arm-none-eabi-newlib
# CMake + Ninja（pacman 最新版）
pacman -S cmake ninja
# OpenOCD 0.12.0（AUR）
pacman -S openocd
# clangd + clang-format
pacman -S clang
# 其他工具
pacman -S git python python-pip gdb-multiarch minicom</code></pre>
<h3>2.4 Shell 环境</h3>
<pre><code class="language-text"> Zsh + Oh My Zsh + Powerlevel10k
pacman -S zsh
sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)"
git clone --depth=1 https://github.com/romkatv/powerlevel10k.git ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/themes/powerlevel10k
# .zshrc 中设置 ZSH_THEME="powerlevel10k/powerlevel10k"</code></pre>
<h3>2.5 USB 调试器转发</h3>
<p>Windows 端安装 usbipd-win，WSL 内转发 DAPLink：</p>
<pre><code class="language-text"> Windows 端（管理员 PowerShell）
winget install usbipd
usbipd bind --busid &lt;DAPLink的busid&gt;
# WSL 端
sudo modprobe usbip-core
sudo usbip attach -r $(hostname).local -b &lt;busid&gt;</code></pre>
<h2>三、VSCode 配置</h2>
<h3>3.1 工作区结构</h3>
<p>双仓库 Multi-root Workspace：MCU 固件仓库 + HMI Flutter 仓库，各自独立 Git 但共用一个 .code-workspace。</p>
<h3>3.2 settings.json 核心配置</h3>
<pre><code class="language-json">{
  "C_Cpp.default.compilerPath": "/usr/bin/arm-none-eabi-gcc",
  "C_Cpp.default.intelliSenseMode": "gcc-arm",
  "cmake.configureOnEdit": true,
  "cmake.buildDirectory": "${workspaceFolder}/build",
  "clangd.path": "/usr/bin/clangd",
  "clangd.arguments": ["--background-index", "--clang-tidy"],
  "editor.formatOnSave": true,
  "files.associations": {
    "*.h": "c",
    "*.c": "c"
  }
}</code></pre>
<h3>3.3 tasks.json — 编译与烧录</h3>
<pre><code class="language-json">{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "cmake-configure",
      "type": "shell",
      "command": "cmake --preset default"
    },
    {
      "label": "cmake-build",
      "type": "shell",
      "command": "cmake --build --preset default"
    },
    {
      "label": "flash-openocd",
      "type": "shell",
      "command": "openocd -f interface/cmsis-dap.cfg -f target/stm32f1x.cfg -c 'program build/firmware.elf verify reset exit'"
    }
  ]
}</code></pre>
<h2>四、调试链</h2>
<h3>4.1 硬件接线</h3>
<p>DAPLink 与 STM32 的 4 线连接：SWDIO、SWCLK、NRST、GND。</p>
<h3>4.2 OpenOCD 配置</h3>
<pre><code class="language-bash">source [find interface/cmsis-dap.cfg]
transport select swd
source [find target/stm32f1x.cfg]
adapter speed 4000
reset_config srst_only</code></pre>
<h3>4.3 四种调试模式（launch.json）</h3>
<ol>
<li><strong>硬件复位调试</strong> — 标准模式，OpenOCD 启动后自动复位 MCU 并 halt</li>
<li><strong>软件复位调试</strong> — 通过 Cortex-Debug 的"Restart"按钮触发，不重新烧录</li>
<li><strong>Attach 模式</strong> — 连接到正在运行的 MCU，不打断执行</li>
<li><strong>pyOCD 模式</strong> — 替代 OpenOCD 的轻量方案</li>
</ol>
<h3>4.4 GDB 自定义命令</h3>
<p>在 .gdbinit 中注册 9 个自定义命令：</p>
<ul>
<li><code>conect</code> — 一键连接+加载符号</li>
<li><code>hardfault_info</code> — 分析 HardFault 时的寄存器状态</li>
<li><code>freertos_tasks</code> — 列出所有 FreeRTOS 任务状态</li>
<li><code>stack_usage</code> — 检查栈使用情况</li>
<li><code>periph</code> — 查看关键外设寄存器</li>
</ul>
<h3>4.5 WSL USB 调试穿透</h3>
<p>详见 2.5 节 USB 调试器转发。启动调试前确保 DAPLink 已正确绑定到 WSL。</p>
<h2>五、CMake 构建系统</h2>
<h3>5.1 CMakePresets.json</h3>
<pre><code class="language-c">{
  "version": 6,
  "configurePresets": [
    {
      "name": "default",
      "displayName": "STM32 Debug",
      "generator": "Ninja",
      "binaryDir": "${sourceDir}/build",
      "cacheVariables": {
        "CMAKE_TOOLCHAIN_FILE": "${sourceDir}/cmake/arm-none-eabi.cmake",
        "CMAKE_BUILD_TYPE": "Debug"
      }
    }
  ],
  "buildPresets": [
    {
      "name": "default",
      "configurePreset": "default"
    }
  ]
}</code></pre>
<h3>5.2 工具链文件 arm-none-eabi.cmake</h3>
<pre><code class="language-cmake">set(CMAKE_SYSTEM_NAME Generic)
set(CMAKE_SYSTEM_PROCESSOR arm)
set(CMAKE_C_COMPILER arm-none-eabi-gcc)
set(CMAKE_CXX_COMPILER arm-none-eabi-g++)
set(CMAKE_ASM_COMPILER arm-none-eabi-gcc)
set(CMAKE_OBJCOPY arm-none-eabi-objcopy)
set(CMAKE_SIZE arm-none-eabi-size)
set(CMAKE_C_FLAGS "-mcpu=cortex-m3 -mthumb -specs=nano.specs -specs=nosys.specs")</code></pre>
<h3>5.3 clangd 配置（.clangd）</h3>
<pre><code class="language-yaml">CompileFlags:
  Add: [-mcpu=cortex-m3, -mthumb, -std=c11]
  Remove: [-mfp16-format*, -mfpu*, -mvectorize*]
Diagnostics:
  UnusedIncludes: Strict</code></pre>
<h2>六、AI Agent 集成</h2>
<h3>6.1 AGENTS.md 知识库</h3>
<p>项目根目录放置 AGENTS.md，包含：构建设置、测试命令、代码规范、架构约束。AI Agent 自动读取后获得项目上下文。</p>
<h3>6.2 Hermes Agent 工作流</h3>
<ul>
<li>代码审查：git diff → AGENTS.md 约束比照</li>
<li>知识管理：session 笔记结构化</li>
<li>技术写作：架构复盘文自动生成</li>
</ul>
<h2>七、验收清单</h2>
<div class="arcaea-table-wrap" data-bac-table-shell="1"><table>
<tr>
<th>项</th>
<th>验收命令</th>
</tr>
<tr>
<td>ARM GCC</td>
<td><code>arm-none-eabi-gcc --version</code> → 14.2.0</td>
</tr>
<tr>
<td>CMake</td>
<td><code>cmake --version</code> → ≥4.x</td>
</tr>
<tr>
<td>Ninja</td>
<td><code>ninja --version</code></td>
</tr>
<tr>
<td>OpenOCD</td>
<td><code>openocd --version</code> → 0.12.0</td>
</tr>
<tr>
<td>clangd</td>
<td><code>clangd --version</code></td>
</tr>
<tr>
<td>调试器穿透</td>
<td><code>lsusb</code> 看到 DAPLink</td>
</tr>
<tr>
<td>编译</td>
<td><code>cmake --build build</code> → 生成 .elf</td>
</tr>
<tr>
<td>烧录</td>
<td><code>openocd -f ... -c "program build/firmware.elf verify reset exit"</code></td>
</tr>
<tr>
<td>调试</td>
<td>VSCode F5 启动 → 断点命中</td>
</tr>
</table></div>
<h2>相关文章</h2>
<ul>
<li><a href="/bsp-implementation-patterns-overview/" target="_blank" rel="nofollow">BSP 实现总览：10 个驱动模块的设计模式</a></li>
<li><a href="/embedded-firmware-hmi-engineering-retrospective/" target="_blank" rel="nofollow">工程架构复盘：从 STM32 到 Flutter</a></li>
<li><a href="/tutorial-ai/" target="_blank" rel="nofollow">AI Agent + AGENTS.md 知识库</a></li>
</ul>
