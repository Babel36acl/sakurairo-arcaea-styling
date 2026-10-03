---
title: "双工具链构建系统：GCC ARM 和 LLVM 在同一项目中共存"
description: "同一个 STM32 项目同时支持 GCC ARM 和 LLVM/Clang。GCC 日常开发，LLVM 发布优化。两个工具链文件不到 70 行。"
published: "2026-05-28"
updated: "2026-08-18"
permalink: "/2026/05/28/dual-toolchain-gcc-llvm-arm-embedded/"
draft: false
categories: ["方法与工具"]
tags: ["ARCH"]
legacyId: 537
---

<div class="arcaea-wrap">
<p><span class="tag">方法与工具</span> <span class="tag">构建系统</span></p>
<p>同一个 STM32 项目，同时支持 GCC ARM None EABI 和 LLVM/Clang 两套工具链。不是"二选一"，而是"两个都要"——开发用 GCC（稳定）、调优用 LLVM（更激进的优化和更清楚的警告）。</p>
<h2>CMakePresets 架构</h2>
<p>CMakePresets.json 定义构建预设，CMake 工具链文件决定用哪个编译器：</p>
<pre><code class="language-json">{
    "version": 3,
    "configurePresets": [
        {
            "name": "default",
            "hidden": true,           // 隐藏预设，只作为基类
            "generator": "Ninja",     // 统一生成器
            "binaryDir": "${sourceDir}/build/${presetName}",
            "toolchainFile": "${sourceDir}/cmake/gcc-arm-none-eabi.cmake"  // 默认GCC
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
<p>使用：</p>
<pre><code class="language-text">GCC Debug 构建
cmake --preset Debug
cmake --build --preset Debug --parallel 8

# 换 LLVM 时，手动指定不同的工具链文件
cmake -S . -B build/llvm-debug -G Ninja 
  -DCMAKE_TOOLCHAIN_FILE=cmake/llvm-arm-none-eabi.cmake 
  -DCMAKE_BUILD_TYPE=Debug 
  -DCMAKE_EXPORT_COMPILE_COMMANDS=ON
cmake --build build/llvm-debug --parallel 8</code></pre>
<h2>GCC 工具链文件</h2>
<pre><code class="language-c"># cmake/gcc-arm-none-eabi.cmake
set(CMAKE_SYSTEM_NAME    Generic)
set(CMAKE_SYSTEM_PROCESSOR arm)

set(CMAKE_C_COMPILER    arm-none-eabi-gcc)
set(CMAKE_CXX_COMPILER  arm-none-eabi-g++)
set(CMAKE_OBJCOPY       arm-none-eabi-objcopy)

set(TARGET_FLAGS "-mcpu=cortex-m3")
set(CMAKE_C_FLAGS "${TARGET_FLAGS} -Wall -fdata-sections -ffunction-sections")
set(CMAKE_C_FLAGS_DEBUG   "-O0 -g3")
set(CMAKE_C_FLAGS_RELEASE "-Os -g0")

set(CMAKE_EXE_LINKER_FLAGS
    "${TARGET_FLAGS}
     -T ${CMAKE_SOURCE_DIR}/STM32F103XX_FLASH.ld
     --specs=nano.specs
     -Wl,-Map=${CMAKE_PROJECT_NAME}.map
     -Wl,--gc-sections
     -Wl,--print-memory-usage")</code></pre>
<h2>LLVM 工具链文件</h2>
<p>LLVM 的配置有趣的地方：编译器是 clang，但链接器仍然是 arm-none-eabi-gcc（因为 LLVM 的 ld.lld 对 ARM 嵌入式链接脚本支持不如 GCC 的 GNU ld 完善）：</p>
<pre><code class="language-cmake"># cmake/llvm-arm-none-eabi.cmake
set(CMAKE_C_COMPILER   clang)
set(CMAKE_CXX_COMPILER clang++)
set(CMAKE_LINKER       arm-none-eabi-gcc)  # 重要！用 GCC 做链接
set(CMAKE_OBJCOPY      llvm-objcopy)

set(CMAKE_C_COMPILER_TARGET   arm-none-eabi)
set(CMAKE_CXX_COMPILER_TARGET arm-none-eabi)

# 自动探测 GCC ARM 的 sysroot 和 libgcc 路径
execute_process(
    COMMAND arm-none-eabi-gcc -print-sysroot
    OUTPUT_VARIABLE ARM_NONE_EABI_SYSROOT
    OUTPUT_STRIP_TRAILING_WHITESPACE)
execute_process(
    COMMAND arm-none-eabi-gcc -print-libgcc-file-name
    OUTPUT_VARIABLE ARM_NONE_EABI_LIBGCC)

set(CMAKE_SYSROOT "${ARM_NONE_EABI_SYSROOT}")
set(MCU_FLAGS -mcpu=cortex-m3 -mthumb -mfloat-abi=soft)
set(CMAKE_C_FLAGS_INIT "${MCU_FLAGS} -Wall -fdata-sections -ffunction-sections")
set(CMAKE_C_FLAGS_DEBUG   "-O0 -g3")
set(CMAKE_C_FLAGS_RELEASE "-Oz -g0")    # LLVM 用 -Oz 比 -Os 更激进

# 链接时回退到 GCC
set(CMAKE_C_LINK_EXECUTABLE
    "arm-none-eabi-gcc &lt;LINK_FLAGS&gt; &lt;OBJECTS&gt; -o &lt;TARGET&gt; &lt;LINK_LIBRARIES&gt;")</code></pre>
<h2>关键差异</h2>
<div class="arcaea-table-wrap" data-bac-table-shell="1"><table>
<tr>
<th>维度</th>
<th>GCC ARM</th>
<th>LLVM/Clang</th>
</tr>
<tr>
<td>编译器</td>
<td>arm-none-eabi-gcc</td>
<td>clang --target=arm-none-eabi</td>
</tr>
<tr>
<td>链接器</td>
<td>arm-none-eabi-g++</td>
<td>arm-none-eabi-gcc（回退）</td>
</tr>
<tr>
<td>优化</td>
<td>-O0 / -Os</td>
<td>-O0 / -Oz（更小）</td>
</tr>
<tr>
<td>sysroot</td>
<td>内置</td>
<td>从 GCC 探测</td>
</tr>
<tr>
<td>启动文件</td>
<td>GCC asm</td>
<td>兼容（同一份 startup.s）</td>
</tr>
<tr>
<td>编译数据库</td>
<td>CMAKE_EXPORT_COMPILE_COMMANDS</td>
<td>同上，clangd 兼容</td>
</tr>
</table></div>
<h2>LLVM 的 sysroot 探测</h2>
<p>LLVM for ARM 需要 GCC ARM 的 C 运行时库（libgcc、libc_nano）。配置中通过 execute_process 在 CMake 配置阶段自动探测 GCC ARM 的安装路径：</p>
<pre><code class="language-cmake">execute_process(
    COMMAND arm-none-eabi-gcc -print-sysroot
    OUTPUT_VARIABLE ARM_NONE_EABI_SYSROOT)
execute_process(
    COMMAND arm-none-eabi-gcc -print-libgcc-file-name
    OUTPUT_VARIABLE ARM_NONE_EABI_LIBGCC)
get_filename_component(ARM_NONE_EABI_GCC_LIB_DIR
    "${ARM_NONE_EABI_LIBGCC}" DIRECTORY)

set(CMAKE_SYSROOT "${ARM_NONE_EABI_SYSROOT}")
# 链接时自动找到正确的 libgcc.a 路径</code></pre>
<p>这避免了硬编码路径。只要 GCC ARM 工具链在 PATH 中，LLVM 就能自动找到它所需的运行时库。</p>
<blockquote>
<p>GCC 用于日常开发和调试（稳定）。LLVM 用于发布构建和静态分析（更激进的优化 + clang-tidy / clang-analyzer）。两个工具链文件不到 70 行，但让项目的构建灵活度翻倍。</p>
</blockquote>
</div>
