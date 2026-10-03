---
title: "MCGS MCP 文件结构与修改：控件记录、嵌套长度和脚本字节码"
description: "聚焦 MCGS MCP 的 Access/BLOB 分层、CArchive 字符串、WndUser 控件记录、嵌套长度、变量绑定与脚本字节码，并说明 GPT-6 如何将结构分析落地为受限修改方式。"
published: "2026-09-07"
updated: "2026-09-07"
permalink: "/2026/09/07/mcgs-mcp-reverse-engineering/"
draft: false
categories: ["嵌入式实战","方法与工具"]
tags: []
legacyId: 1326
---

<p>MCGS Pro 的 <code>.MCP</code> 工程文件不是一组可以直接编辑的 Access 表。它的外层确实是 Access 数据库，但窗口、控件、变量绑定、事件脚本和编译产物主要保存在私有二进制 BLOB 中。真正可用的修改器必须同时理解数据库单元格、BLOB 记录边界、MFC 字符串长度、控件内部嵌套数组以及脚本字节码之间的关系。</p>
<p>本文只讨论两个问题：<strong>MCP 已经解析出了什么结构，以及这些结构应该如何修改</strong>。这里的 MCP 指 MCGS Pro 工程文件，不是 Model Context Protocol。结论限定于已分析的编辑器版本和样本，不应视为官方格式规范或跨版本承诺。</p>
<p>本文对应的非官方分析与模板化修改工具见公开仓库：<a href="https://github.com/Babel36acl/mcgs-mcp-editor-skill" target="_blank" rel="nofollow">Babel36acl/mcgs-mcp-editor-skill</a>。仓库提供原创解析代码、受限修改工具、合成测试和使用说明；MIT 许可证只覆盖其中的原创部分。</p>
<blockquote>
<p><strong>最终结论</strong></p>
<ul>
<li>MCP 的正确模型是“Access 容器 + 私有序列化 BLOB”。</li>
<li><code>WndUser.lbObjects</code> 已确认由文档头、顶层控件计数、长度定界控件记录和窗口尾部组成。</li>
<li>已确认三类样本控件：标签 <code>0x5008</code>、数值输入框 <code>0x5025</code>、标准按钮 <code>0x5027</code>。</li>
<li>字符串不是裸 UTF-16；必须按 CArchive 的 ANSI/Unicode 与短、u16、u32 长度分支读取和重建。</li>
<li>修改输入框绑定时，变量名和运行期对象 ID 必须同步；范围字段顺序为“最大值、最小值”。</li>
<li>修改按钮事件时，源码、编译字节数组和事件槽位必须作为三个独立字段处理。</li>
<li>变长修改必须同步所有包含它的嵌套长度。只更新控件外层长度，Access 仍可能可读，但 MCGS 会报告工程损坏。</li>
</ul>
</blockquote>
<h2>1. MCP 的外层：Access 只负责保存容器</h2>
<p>已分析 MCP 可以作为 Access 数据库读取。窗口、对象、设备和策略等表中既有普通标量字段，也有 <code>LongVarBinary</code> 类型的大字段。外层数据库可以准确回答：</p>
<ul>
<li>修改发生在哪张表、哪一行、哪一列；</li>
<li>目标 BLOB 修改前后的字节数和哈希；</li>
<li>写回后数据库能否重新读取目标单元格；</li>
<li>除目标单元格外，其他用户表字段是否发生变化。</li>
</ul>
<p>它不能回答 BLOB 内部某个偏移代表什么，也不能证明写回后的对象仍符合 MCGS 语义。因而“Access 能打开”只是容器层通过，不代表 MCP 完整。</p>
<div class="arcaea-mermaid-box"><pre class="mermaid">flowchart TB
    A[MCP 文件] --&gt; B[Access 数据库]
    B --&gt; C[普通表字段]
    B --&gt; D[LongVarBinary / BLOB]
    D --&gt; E[WndUser 窗口与控件]
    D --&gt; F[ObjData 对象]
    D --&gt; G[WndDevice 设备对象]
    D --&gt; H[策略、脚本与编译数据]</pre></div>
<p>使用 ACE/ODBC 写回 <code>LongVarBinary</code> 时，参数长度必须等于实际字节数。长度错误可能造成截断；截断后的数据库有时仍能打开，但目标 BLOB 的尾部已经丢失。因此写回必须发生在新副本，并在提交后逐字节回读目标单元格。</p>
<h2>2. BLOB 中的字符串：先解析长度，再解释文本</h2>
<p>在 MCP BLOB 中搜索 UTF-16LE 很容易找到中文，但“搜到文本”不等于“找到可修改字符串”。字符串前面还有序列化长度；读取器一旦选错长度分支，后续所有偏移都会漂移。</p>
<p>在匹配版本中确认的 CArchive Unicode 路径可以抽象为：</p>
<pre><code class="language-text">读取首个长度字节
├─ 小于 0xFF：短长度
└─ 等于 0xFF：读取 u16
   ├─ 小于 0xFFFF：u16 长度
   └─ 等于 0xFFFF：读取 u32 长度

Unicode 分支带有 FF FE FF 标记
长度单位：UTF-16 code unit
</code></pre>
<p>这里的长度不是 UTF-8 字节数，也不能简单使用高级语言的字符数量。包含代理对时，Unicode 字符数和 UTF-16 code unit 数可能不同。</p>
<p>严格读取器应返回完整边界，而不仅是文本：</p>
<pre><code class="language-json">{
  "offset": 1544,
  "end": 1804,
  "encoding": "utf-16le",
  "length_form": "short-u8",
  "text": "合成示例"
}
</code></pre>
<p>修改字符串时必须重建对应长度分支，并检查：</p>
<ol>
<li>新文本能否使用原长度形式表示；</li>
<li>新旧编码后的实际字节差 <code>delta</code>；</li>
<li>哪些外层记录和嵌套数组覆盖了该字符串；</li>
<li>所有受影响长度是否都能在合法范围内同步调整。</li>
</ol>
<p>截断、越界、恶意超长和未确认的扩展格式都应直接拒绝，而不是返回部分字符串继续修改。</p>
<h2>3. <code>WndUser.lbObjects</code> 的顶层结构</h2>
<p>对 36 个原生窗口、771 条顶层记录的解析结果表明，<code>WndUser.lbObjects</code> 可以按以下最小结构稳定遍历：</p>
<pre><code class="language-text">12 字节前缀                         原样保留，语义未完全解释
CArchive 字符串                    窗口文档标识
u32 top_level_control_count        顶层控件数量

重复 N 次：
    u32 record_kind                顶层类型码
    u16 payload_length             payload 字节数
    byte payload[payload_length]   控件负载

window trailer                     窗口尾部，原样保留
</code></pre>
<p>这套结构的重要之处在于：控件边界由长度字段决定，而不是靠扫描下一个类型标记。扫描类型标记会误命中嵌套动画、资源块或碰巧相同的普通字节，只适合发现候选，不能用于重建窗口。</p>
<p>一个有效的窗口解析必须满足：</p>
<ul>
<li>实际遍历记录数等于 <code>top_level_control_count</code>；</li>
<li>每条记录的结束位置不超过 BLOB 边界；</li>
<li>解析后仍能确定并保存窗口 trailer；</li>
<li>未修改记录和 trailer 在重建后逐字节一致；</li>
<li><code>payload_length &gt;= 65535</code> 等未实现扩展形式直接拒绝。</li>
</ul>
<p>已观察到的类型码如下：</p>
<div class="arcaea-table-wrap" data-bac-table-shell="1"><table>
<thead>
<tr>
<th>类型码</th>
<th>当前样本中的对象</th>
<th>已确认可修改范围</th>
</tr>
</thead>
<tbody>
<tr>
<td><code>0x5008</code></td>
<td>标签</td>
<td>模板限定的显示文字、矩形字段</td>
</tr>
<tr>
<td><code>0x5025</code></td>
<td>数值输入框</td>
<td>绑定名、运行对象 ID、最大/最小值、矩形</td>
</tr>
<tr>
<td><code>0x5027</code></td>
<td>标准按钮</td>
<td>标题、已定位事件源码和对应编译数组</td>
</tr>
</tbody>
</table></div>
<p>这些值只是当前版本和样本的实验锚点，不是完整的 MCGS 控件字典。未知类型应完整保留，不应按相似偏移套用已知模板。</p>
<h2>4. 三类已确认控件应该怎样修改</h2>
<h3>4.1 标签：修改文字不能只替换 UTF-16 字节</h3>
<p>标签文字属于控件 payload 内的序列化字符串。安全修改需要先用健康模板确定：</p>
<ul>
<li>字符串长度前缀的起止位置；</li>
<li>文本本体的起止位置；</li>
<li>控件 payload 的外层长度；</li>
<li>包含该字符串的内部数组长度；</li>
<li>修改后必须保持不变的字体、颜色、资源和尾部字节。</li>
</ul>
<p>等长替换通常不改变后续偏移，但仍必须验证目标字段身份和旧值。变长替换则要计算编码后的字节差，并把差值同步到所有真正覆盖该字段的上层长度。</p>
<h3>4.2 数值输入框：绑定名称与对象 ID 必须成对修改</h3>
<p>已确认的数值输入框中，绑定名称之前还保存了运行期对象 ID。只改变量名会留下不一致引用；编辑器可能显示新名称，运行时仍指向旧对象。</p>
<p>修改输入框绑定的最小集合是：</p>
<pre><code class="language-text">binding_name      新对象名称
runtime_object_id 与该对象对应的已验证 ID
range[0]          最大值
range[1]          最小值
</code></pre>
<p>对象 ID 必须从当前工程的对象数据中查证，不能根据名称排序或另一份工程的记录位置推断。范围顺序也不能按常见的 <code>[min, max]</code> 想当然；当前样本确认的存储顺序是 <code>[max, min]</code>。</p>
<p>修改后应分别检查名称、ID 和两个范围值的差分，确保没有碰到相邻的键盘、格式、动画或安全属性。</p>
<h3>4.3 标准按钮：标题、源码、字节码和事件槽位不是同一个字段</h3>
<p>按钮 payload 可能同时包含：</p>
<pre><code class="language-text">可见标题
多语言或资源引用形式的标题
事件槽位数组
脚本源码字符串
编译字节数组
其他未解码嵌套块
</code></pre>
<p>因此不能通过搜索按钮文字来推断事件边界，也不能只替换脚本源码。一个按钮事件至少要建模为：</p>
<pre><code class="language-text">窗口 ID + 顶层记录索引 + payload 哈希
事件槽位
源码字段：边界、旧值、新值
编译数组：边界、旧哈希、新字节
覆盖这些字段的嵌套长度列表
</code></pre>
<p>当前公开工具只对已定位模板中的事件槽位进行修改。源码、字节码或槽位有任一项不匹配就停止，不尝试寻找“看起来相似”的第二处字符串。</p>
<h2>5. 脚本源码与编译字节码</h2>
<p>按钮或策略中出现可读脚本文本，只能证明源码字符串存在。要得到可执行修改，还必须确认源码属于哪个事件槽位，以及该槽位使用哪段编译字节数组。</p>
<div class="arcaea-table-wrap" data-bac-table-shell="1"><table>
<thead>
<tr>
<th>层次</th>
<th>含义</th>
</tr>
</thead>
<tbody>
<tr>
<td>源码字符串</td>
<td>编辑器属性页中可见的脚本文本</td>
</tr>
<tr>
<td>事件槽位</td>
<td>脚本属于按钮的哪个事件</td>
</tr>
<tr>
<td>编译字节数组</td>
<td>与源码对应的执行数据</td>
</tr>
<tr>
<td>宿主行为</td>
<td>MCGS 是否接受、编译并执行该事件</td>
</tr>
</tbody>
</table></div>
<p>公开实现先把受支持脚本解析为原创 AST，再映射到版本锁定的代码生成入口；生成结果在 Unicorn CPU 仿真中运行，外部对象读写由内存字典替代。文件哈希、符号映射、语法子集或外部调用白名单任一不匹配都会拒绝。</p>
<p>当前支持范围很窄：数值变量、int32 常量、加法、多语句、最多 8 层 <code>If/Else/EndIf</code>，以及 <code>=、&lt;&gt;、&lt;、&gt;、&lt;=、&gt;=</code> 六种比较。它不是完整 BASIC 编译器，也没有在公开测试中加载厂商 DLL 或连接设备。</p>
<h2>6. 变长修改的真实损坏根因</h2>
<p>最能说明 MCP 内部结构的一次失败发生在按钮标题修改中。原标题从 6 个 UTF-16 code unit 缩短到 4 个，编码后减少 4 字节。早期写入器更新了字符串和控件的外层长度，却漏掉包住该标题的三层 u16 数组长度。</p>
<p>结果非常具有迷惑性：</p>
<ul>
<li>Access 数据库仍能打开；</li>
<li>目标表和目标 BLOB 仍能读取；</li>
<li>顶层控件记录仍能按外层长度遍历；</li>
<li>MCGS 打开副本时却报告工程损坏。</li>
</ul>
<p>对照实验排除了编译标志：只改变编译标志时工程仍能打开。随后从失败版本出发，只修正三层嵌套长度，保留标题、脚本和编译标志，编辑器的打开、属性检查、<code>Ctrl+E</code>、保存、关闭和重开均恢复正常。</p>
<p>因此根因不是中文、Access 或编译标志，而是：<strong>变长字段的所有上层容器长度没有同步更新。</strong></p>
<p>设新旧字段编码后的字节差为：</p>
<pre><code class="language-text">delta = new_encoded_size - old_encoded_size
</code></pre>
<p>每个真正包含该字段的长度计数都应增加 <code>delta</code>；位于字段之前或不覆盖该字段的计数不能调整。偏移、旧计数和包含关系必须来自当前健康模板的前像清单，不能把某个样本中的三个偏移发布成通用补丁。</p>
<h2>7. 可审计的修改清单与写回顺序</h2>
<p>一次写回不应由“搜索并替换”描述，而应由明确清单驱动：</p>
<pre><code class="language-json">{
  "source_sha256": "&lt;当前输入文件哈希&gt;",
  "window_id": 1,
  "controls": [
    {
      "record_index": 3,
      "kind": "0x5008",
      "payload_sha256": "&lt;当前控件负载哈希&gt;",
      "edits": [
        {
          "type": "carchive_string",
          "offset": 120,
          "expected": "旧标签",
          "value": "新标签",
          "nested_counts": [
            {"offset": 40, "expected": 300},
            {"offset": 64, "expected": 220}
          ]
        }
      ]
    }
  ]
}
</code></pre>
<p>以上数字和文字均为合成示例，不能直接用于真实工程。真实清单必须从当前输入重新提取。</p>
<p>执行顺序应固定为：</p>
<ol>
<li>校验源 MCP 的 SHA-256，禁止原地写入；</li>
<li>读取目标窗口并校验窗口、记录索引、类型码和 payload 哈希；</li>
<li>校验字段边界、预期旧值和所有嵌套长度前像；</li>
<li>在内存中完成单一字段修改并重新计算各层长度；</li>
<li>重建顶层记录，同时逐字节保留未知记录和窗口 trailer；</li>
<li>通过 ACE/ODBC 写入新副本，并把参数长度设为实际 BLOB 字节数；</li>
<li>重新读取目标单元格，比较准备写入的 BLOB 与数据库回读值；</li>
<li>比较全部用户表，确认只有授权单元格发生变化；</li>
<li>再由匹配版本的 MCGS 完成打开、属性、编译、保存关闭重开验证。</li>
</ol>
<div class="arcaea-mermaid-box"><pre class="mermaid">flowchart LR
    A[校验源文件哈希] --&gt; B[解析目标窗口]
    B --&gt; C[校验记录与字段前像]
    C --&gt; D[修改字段并同步嵌套长度]
    D --&gt; E[重建 BLOB 和保留未知字节]
    E --&gt; F[写入新 MCP 副本]
    F --&gt; G[数据库与 BLOB 回读]
    G --&gt; H[MCGS 打开/属性/编译/重开]</pre></div>
<p>公开仓库 <a href="https://github.com/Babel36acl/mcgs-mcp-editor-skill" target="_blank" rel="nofollow">Babel36acl/mcgs-mcp-editor-skill</a> 实现了这套受限模型：<code>mcp_tool.py</code> 负责 Access 读写和表级回读，<code>mfc_archive.py</code> 与 <code>wnduser_records.py</code> 负责字符串及顶层记录，脚本工具负责受支持事件的源码和编译数据。未知版本、未知控件、未知长度分支和前像不符均拒绝写入。</p>
<h2>8. 当前解析边界</h2>
<p>当前结果可以支持已验证模板上的受控修改，但还不是完整 MCP 格式：</p>
<ul>
<li>窗口 12 字节前缀和 trailer 的业务语义未完全解释，只能原样保留；</li>
<li>三个类型码不代表完整控件类型系统；</li>
<li>字体、多语言资源、动画、键盘和全部安全属性没有通解；</li>
<li>绑定对象 ID 必须逐工程查证；</li>
<li>未支持完整 BASIC、任意事件槽位或任意策略结构；</li>
<li>公开测试没有真实设备通信和机械动作证据。</li>
</ul>
<p>发布前运行的公开测试中，6 项原创合成结构与字段测试通过；另有 3 项依赖本地、版本匹配厂商二进制的测试因环境未提供对应文件而按设计跳过。合成测试通过不能替代 MCGS 宿主或设备验证。</p>
<h2>9. 仓库、AI 协作与版权说明</h2>
<p>完整的原创解析器、受限修改工具、合成测试和使用说明位于公开仓库：<a href="https://github.com/Babel36acl/mcgs-mcp-editor-skill" target="_blank" rel="nofollow">Babel36acl/mcgs-mcp-editor-skill</a>。仓库是非官方研究工具；其中 MIT 许可证只覆盖仓库原创内容，不覆盖 MCGS 产品、商标、厂商程序或第三方工程资料。</p>
<p>本文所述 MCP 结构由 GPT-6 结合样本差分、代码证据和实验记录完成分析，覆盖 Access/BLOB 分层、控件记录、CArchive 字符串边界、嵌套长度以及脚本源码与字节码关系；随后由 GPT-6 将这些结构结论落地为公开仓库中的受限修改方式与工具实现，包括前像校验、文件与 payload 哈希约束、嵌套长度同步和未知格式拒绝。McgsPro 宿主验收依据用户对列明操作步骤的确认；分析结论仍受已测试版本和模板限制，不因使用模型而扩大适用范围。</p>
<p>公开内容只包括独立观察得到的格式关系、修改约束、失败根因，以及为验证这些结论重新编写的原创工具和合成示例。本文不提供厂商 EXE/DLL、安装包、真实 MCP、控件库、反编译函数、连续反汇编、帮助文档原文、工程截图、客户数据、设备地址或生产参数。</p>
<p>MFC 序列化与 ODBC 的通用背景可参考微软的 <a href="https://learn.microsoft.com/en-us/cpp/mfc/reference/carchive-class?view=msvc-170" target="_blank" rel="nofollow">CArchive 类文档</a>、<a href="https://learn.microsoft.com/en-us/cpp/mfc/storing-and-loading-cobjects-via-an-archive?view=msvc-170" target="_blank" rel="nofollow">通过 Archive 存取 CObject</a>和 <a href="https://learn.microsoft.com/en-us/sql/odbc/reference/develop-app/data-length-buffer-length-and-truncation?view=sql-server-ver17" target="_blank" rel="nofollow">ODBC 数据长度与截断</a>。这些资料解释通用机制，不构成 MCGS 格式说明。</p>
<h2>结论</h2>
<p>MCP 修改的核心不是寻找更多固定偏移，而是准确回答三个问题：目标字段属于哪条长度定界记录，它被哪些嵌套容器覆盖，以及修改后哪些源码、字节码或对象引用必须同步。</p>
<p>当前最可靠的修改方式是：以 Access 定位目标单元格，以严格 CArchive 读取器确定字符串边界，以 <code>WndUser</code> 顶层记录确定控件范围，以健康模板确认控件内部字段，再通过输入哈希、payload 哈希、预期旧值和嵌套长度前像限制写入。任何一项不匹配就停止。</p>
<p>这使工具能够对标签、数值输入框和标准按钮的已确认字段做可审计修改，同时清楚保留未知部分。完整实现和合成测试见 <a href="https://github.com/Babel36acl/mcgs-mcp-editor-skill" target="_blank" rel="nofollow">mcgs-mcp-editor-skill</a>。</p>
