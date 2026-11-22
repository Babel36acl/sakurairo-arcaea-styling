#Requires -Version 7.0
<#
.SYNOPSIS
    把本地 Astro 站点目录镜像到 GitHub 仓库的持久 clone 子目录，并提交推送。

.DESCRIPTION
    本地站点目录不是 git 仓库，仓库里的 astro-babel36acl-next/ 是它的副本。
    本脚本用 robocopy /MIR 做单向镜像，然后在 clone 里提交并推送 main。

    流程：
      1) 准备持久 clone（默认 C:\Users\A1165\Documents\blog\tmp\gh-sync）：
         不存在则 clone，已存在则 fetch + 切到 main + pull --ff-only。
      2) robocopy /MIR 镜像到 <clone>\astro-babel36acl-next，
         排除 reports / output / reference / tmp / node_modules / dist / .astro /
         .git / .github 与根下 *.tar.gz。排除项同时作用于复制与删除（/XD /XF），
         且镜像目标固定在子目录内，因此 clone 里的其它目录
         （babel-arcaea-code、sakurairo-theme 等）不会被波及。
      3) 断言 src/scripts/vendor/legacy-tocbot.js 存在（构建必需，astro check 依赖）。
      4) 打印变更摘要；无变更直接退出 0。
      5) 有变更：git add -A -> git commit -> git push origin main（失败重试一次）。

    幂等：连续执行两次，第二次会输出「无变更，无需推送」并退出 0。

    .gitignore 说明：仓库内 astro-babel36acl-next/.gitignore 是仓库侧维护的超集
    （额外忽略本地产物，并含 !src/scripts/vendor/ 规则），因此不参与镜像；
    /XF 同时让它免于被 /MIR 删除。本地改 .gitignore 不会同步到仓库。

.PARAMETER DryRun
    只做 clone 准备 / 镜像 / 变更摘要，不提交、不推送。

.PARAMETER Message
    覆盖默认提交信息，默认：
    "chore(site): sync local site <yyyy-MM-dd HH:mm>"。
    建议遵循 Conventional Commits。

.PARAMETER Proxy
    HTTP(S) 代理，默认 http://127.0.0.1:7890。传空字符串表示不使用代理。

.PARAMETER ClonePath
    持久 clone 路径，默认 C:\Users\A1165\Documents\blog\tmp\gh-sync。

.PARAMETER RepoUrl
    仓库地址，默认 https://github.com/Babel36acl/sakurairo-arcaea-styling.git。

.PARAMETER Branch
    目标分支，默认 main。

.PARAMETER SitePath
    站点源码目录，默认取本脚本所在目录的父目录。

.PARAMETER Subdir
    仓库内的站点子目录名，默认 astro-babel36acl-next。

.PARAMETER MaxStatusLines
    变更摘要最多打印多少行，默认 40。

.PARAMETER DisableTlsVerify
    对 git 关闭 TLS 校验（http.sslVerify=false + http.schannelCheckRevoke=false）。
    仅在本机代理证书链有问题时临时使用。

.EXAMPLE
    pwsh -File scripts/push-to-github.ps1 -DryRun
    只镜像并显示差异，不提交。

.EXAMPLE
    pwsh -File scripts/push-to-github.ps1
    镜像、提交并推送，提交信息用默认值。

.EXAMPLE
    pwsh -File scripts/push-to-github.ps1 -Message "feat(site): publish new posts"
    自定义提交信息。
#>
[CmdletBinding()]
param(
    [switch]$DryRun,

    [string]$Message,

    [string]$Proxy = 'http://127.0.0.1:7890',

    [string]$ClonePath = 'C:\Users\A1165\Documents\blog\tmp\gh-sync',

    [string]$RepoUrl = 'https://github.com/Babel36acl/sakurairo-arcaea-styling.git',

    [string]$Branch = 'main',

    [string]$SitePath,

    [string]$Subdir = 'astro-babel36acl-next',

    [int]$MaxStatusLines = 40,

    [switch]$DisableTlsVerify
)

$ErrorActionPreference = 'Stop'
# 原生命令的 stderr 不应被当成终止性错误（git/robocopy 都会往 stderr 写进度）
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
    $PSNativeCommandUseErrorActionPreference = $false
}

# ---------------------------------------------------------------------------
# 输出辅助
# ---------------------------------------------------------------------------
function Write-Step {
    param([string]$Text)
    Write-Host ''
    Write-Host "=== $Text" -ForegroundColor Cyan
}
function Write-Info {
    param([string]$Text)
    Write-Host "    $Text"
}
function Write-Warn {
    param([string]$Text)
    Write-Host "    [warn] $Text" -ForegroundColor Yellow
}
function Stop-WithError {
    param([string]$Text)
    Write-Host ''
    Write-Host "[ERROR] $Text" -ForegroundColor Red
    exit 1
}

$nl = [Environment]::NewLine

# ---------------------------------------------------------------------------
# 参数归一化
# ---------------------------------------------------------------------------
if (-not $SitePath) {
    $SitePath = Split-Path -Parent $PSScriptRoot
}
if (-not (Test-Path -LiteralPath $SitePath -PathType Container)) {
    Stop-WithError "站点目录不存在：$SitePath"
}
$SitePath = (Resolve-Path -LiteralPath $SitePath).ProviderPath.TrimEnd('\', '/')

if (-not (Test-Path -LiteralPath (Join-Path $SitePath 'package.json') -PathType Leaf)) {
    Stop-WithError "站点目录里没有 package.json，拒绝继续：$SitePath"
}

$ClonePath = [System.IO.Path]::GetFullPath($ClonePath).TrimEnd('\', '/')
$DestPath = [System.IO.Path]::GetFullPath((Join-Path $ClonePath $Subdir)).TrimEnd('\', '/')
$sep = [System.IO.Path]::DirectorySeparatorChar

# 安全断言：镜像目标必须严格位于 clone 之下，且不能等于 clone 根
if (-not $DestPath.StartsWith($ClonePath + $sep, [System.StringComparison]::OrdinalIgnoreCase)) {
    Stop-WithError "镜像目标不在 clone 之内，拒绝继续：dest=$DestPath clone=$ClonePath"
}
if ($DestPath -eq $ClonePath) {
    Stop-WithError '/MIR 目标不能是 clone 根目录，拒绝继续。'
}
if ($ClonePath.StartsWith($SitePath + $sep, [System.StringComparison]::OrdinalIgnoreCase)) {
    Stop-WithError "clone 不能放在站点目录里面，拒绝继续：$ClonePath"
}

if ($MaxStatusLines -lt 1) { $MaxStatusLines = 40 }

# ---------------------------------------------------------------------------
# 代理 / TLS 配置（仅影响本进程）
# ---------------------------------------------------------------------------
$savedEnv = @{
    HTTPS_PROXY = $env:HTTPS_PROXY
    HTTP_PROXY  = $env:HTTP_PROXY
    ALL_PROXY   = $env:ALL_PROXY
}
$script:GitProxyArgs = @()
if ($Proxy) {
    $env:HTTPS_PROXY = $Proxy
    $env:HTTP_PROXY = $Proxy
    $env:ALL_PROXY = $Proxy
    $script:GitProxyArgs = @('-c', "http.proxy=$Proxy", '-c', "https.proxy=$Proxy")
}

$script:GitTlsArgs = @()
if ($DisableTlsVerify) {
    $script:GitTlsArgs = @('-c', 'http.sslVerify=false', '-c', 'http.schannelCheckRevoke=false')
    Write-Warn '已按 -DisableTlsVerify 关闭 git 的 TLS 校验。'
}

function Restore-Environment {
    foreach ($key in $savedEnv.Keys) {
        Set-Item -Path "env:$key" -Value $savedEnv[$key] -ErrorAction SilentlyContinue
    }
}

# ---------------------------------------------------------------------------
# git 调用封装：统一注入代理 / TLS 参数，返回退出码与输出
# ---------------------------------------------------------------------------
function Invoke-Git {
    param(
        [Parameter(Mandatory)][string[]]$GitArgs,
        [switch]$Echo
    )
    $full = @()
    $full += $script:GitProxyArgs
    $full += $script:GitTlsArgs
    $full += $GitArgs

    $lines = @(& git @full 2>&1 | ForEach-Object { [string]$_ })
    $code = $LASTEXITCODE

    if ($Echo) {
        foreach ($line in $lines) { Write-Host "      $line" }
    }

    return [pscustomobject]@{
        ExitCode = $code
        Lines    = $lines
        Text     = ($lines -join $nl)
    }
}

# 解析 remote URL 的 owner/repo，兼容 https://、git@host:owner/repo、带端口等形式
function Get-RepoCoordinates {
    param([string]$Url)
    if (-not $Url) { return $null }
    $u = $Url.Trim()
    $u = $u -replace '^[A-Za-z][A-Za-z0-9+.-]*://', ''
    $u = $u -replace '^[^@/]+@', ''
    $u = $u -replace '^([^/:]+):(\d+)/', '$1/'
    $u = $u -replace '^([^/:]+):(?=[^/])', '$1/'
    $u = $u.Trim('/')
    if ($u.EndsWith('.git')) { $u = $u.Substring(0, $u.Length - 4) }
    $parts = @($u -split '/' | Where-Object { $_ -ne '' })
    if ($parts.Count -lt 2) { return $null }
    $owner = $parts[$parts.Count - 2]
    $repo = $parts[$parts.Count - 1]
    return [pscustomobject]@{
        Owner = $owner
        Repo  = $repo
        Path  = "$owner/$repo"
    }
}

Write-Host ''
Write-Host '本地站点 -> GitHub 同步' -ForegroundColor Green
Write-Info "站点：$SitePath"
Write-Info "clone：$ClonePath"
Write-Info "目标：$DestPath（仓库 $RepoUrl，分支 $Branch）"
Write-Info "代理：$(if ($Proxy) { $Proxy } else { '<不使用>' })"
Write-Info "模式：$(if ($DryRun) { 'DryRun（不提交不推送）' } else { '同步并推送' })"

try {
    # -----------------------------------------------------------------------
    Write-Step "1/6 准备 clone：$ClonePath"
    # -----------------------------------------------------------------------
    $gitDir = Join-Path $ClonePath '.git'
    if (Test-Path -LiteralPath $gitDir) {
        Write-Info '已存在 clone，执行 fetch / checkout / pull --ff-only'

        $fetch = Invoke-Git -GitArgs @('-C', $ClonePath, 'fetch', '--prune', 'origin') -Echo
        if ($fetch.ExitCode -ne 0) {
            Stop-WithError ("git fetch 失败（exit={0}）。若是代理/证书问题，可加 -DisableTlsVerify 或检查 {1}。{2}{3}" -f $fetch.ExitCode, $Proxy, $nl, $fetch.Text)
        }

        $checkout = Invoke-Git -GitArgs @('-C', $ClonePath, 'checkout', $Branch) -Echo
        if ($checkout.ExitCode -ne 0) {
            Stop-WithError ("git checkout {0} 失败（exit={1}）。{2}{3}" -f $Branch, $checkout.ExitCode, $nl, $checkout.Text)
        }

        $pull = Invoke-Git -GitArgs @('-C', $ClonePath, 'pull', '--ff-only', 'origin', $Branch) -Echo
        if ($pull.ExitCode -ne 0) {
            Stop-WithError ("git pull --ff-only 失败（exit={0}）。本地 clone 可能有本地提交或非快进历史，请手工处理后重跑。{1}{2}" -f $pull.ExitCode, $nl, $pull.Text)
        }
    }
    else {
        if (Test-Path -LiteralPath $ClonePath) {
            $existing = @(Get-ChildItem -LiteralPath $ClonePath -Force -ErrorAction SilentlyContinue)
            if ($existing.Count -gt 0) {
                Stop-WithError "目标路径已存在但不是 git 仓库，拒绝覆盖：$ClonePath"
            }
        }
        else {
            $parent = Split-Path -Parent $ClonePath
            if (-not (Test-Path -LiteralPath $parent)) {
                New-Item -ItemType Directory -Path $parent -Force | Out-Null
                Write-Info "已创建父目录：$parent"
            }
        }

        Write-Info "执行 git clone --branch $Branch"
        $clone = Invoke-Git -GitArgs @('clone', '--branch', $Branch, $RepoUrl, $ClonePath) -Echo
        if ($clone.ExitCode -ne 0) {
            Stop-WithError ("git clone 失败（exit={0}）。{1}{2}" -f $clone.ExitCode, $nl, $clone.Text)
        }
    }

    # 远端地址校验，避免推到别的仓库
    # 注意：GitHub 对账号改名 / 仓库转移会做 HTTP 重定向，因此 owner 不同不算错误，
    # 但仓库名不同就必须中止（那是另一个仓库）。
    $originUrl = (Invoke-Git -GitArgs @('-C', $ClonePath, 'remote', 'get-url', 'origin')).Text.Trim()
    $originCoords = Get-RepoCoordinates -Url $originUrl
    $expectCoords = Get-RepoCoordinates -Url $RepoUrl
    if (-not $originCoords -or -not $expectCoords) {
        if ($originUrl -ne $RepoUrl) {
            Write-Warn "无法解析 remote URL，未做同一性校验：$originUrl（预期 $RepoUrl）"
        }
    }
    elseif (-not $originCoords.Repo.Equals($expectCoords.Repo, [System.StringComparison]::OrdinalIgnoreCase)) {
        Stop-WithError "clone 的 origin 指向另一个仓库：$($originCoords.Path)（预期 $($expectCoords.Path)），拒绝推送。"
    }
    elseif (-not $originCoords.Owner.Equals($expectCoords.Owner, [System.StringComparison]::OrdinalIgnoreCase)) {
        Write-Info "origin 的 owner 与预期不同：$($originCoords.Path)（预期 $($expectCoords.Path)）"
        Write-Info '  属于 GitHub 改名/转移后的重定向，fetch 已成功，按同一仓库处理。'
    }
    $headBranch = (Invoke-Git -GitArgs @('-C', $ClonePath, 'rev-parse', '--abbrev-ref', 'HEAD')).Text.Trim()
    if ($headBranch -ne $Branch) {
        Stop-WithError "clone 当前分支是 $headBranch，不是 $Branch，拒绝继续。"
    }
    $headBefore = (Invoke-Git -GitArgs @('-C', $ClonePath, 'rev-parse', 'HEAD')).Text.Trim()
    Write-Info "HEAD = $headBefore"

    # 记录 clone 里的同级目录，镜像后逐一核对，确保 /MIR 没波及它们
    $siblingsBefore = @(
        Get-ChildItem -LiteralPath $ClonePath -Directory -Force |
            Where-Object { $_.Name -ne '.git' -and $_.Name -ne $Subdir } |
            Select-Object -ExpandProperty Name
    )

    # -----------------------------------------------------------------------
    Write-Step "2/6 robocopy /MIR 镜像到 $Subdir"
    # -----------------------------------------------------------------------
    if (-not (Test-Path -LiteralPath $DestPath)) {
        New-Item -ItemType Directory -Path $DestPath -Force | Out-Null
    }

    $excludeDirs = @('reports', 'output', 'reference', 'tmp', 'node_modules', 'dist', '.astro', '.git', '.github')
    $roboArgs = @(
        $SitePath, $DestPath,
        '/MIR',
        '/R:2', '/W:2',
        '/NDL', '/NJH', '/NP'
    )
    foreach ($dir in $excludeDirs) {
        $roboArgs += '/XD'
        $roboArgs += (Join-Path $SitePath $dir)
    }
    # 裸名再排除一次：任何层级的 node_modules / .git 都不该进仓库
    $roboArgs += '/XD'; $roboArgs += 'node_modules'
    $roboArgs += '/XD'; $roboArgs += '.git'
    # 根下 *.tar.gz（astro-dist.tar.gz）
    $roboArgs += '/XF'; $roboArgs += '*.tar.gz'
    # 仓库侧维护的 .gitignore 超集：既不覆盖也不删除
    $roboArgs += '/XF'; $roboArgs += (Join-Path $SitePath '.gitignore')

    Write-Info "robocopy 排除目录：$($excludeDirs -join ', ')、任意层级 node_modules/.git"
    Write-Info 'robocopy 排除文件：*.tar.gz、.gitignore（.gitignore 由仓库侧维护）'

    $roboRaw = @(& robocopy @roboArgs 2>&1 | ForEach-Object { [string]$_ })
    $roboCode = $LASTEXITCODE

    if ($roboCode -ge 8) {
        Stop-WithError ("robocopy 失败（exit={0}）。{1}{2}" -f $roboCode, $nl, ($roboRaw -join $nl))
    }

    # 只打印真正发生动作的行，避免几百行目录噪音
    $actionLines = @($roboRaw | Where-Object { $_ -match '(?i)\t(New File|Newer|Older|Changed|Deleting)|\*EXTRA\*|\tERROR|FAILED' })
    if ($actionLines.Count -gt 0) {
        $shown = 0
        foreach ($line in $actionLines) {
            if ($shown -ge 25) {
                Write-Info "… 另有 $($actionLines.Count - 25) 行文件动作未显示"
                break
            }
            Write-Info ($line.TrimEnd())
            $shown++
        }
    }

    $countLines = @($roboRaw | Where-Object { $_ -match '^\s+(Dirs|Files|Bytes)\s+:' })
    Write-Info 'robocopy 统计（Total / Copied / Skipped / Mismatch / FAILED / Extras）：'
    foreach ($line in $countLines) { Write-Info $line.Trim() }

    $roboCopiedFiles = 0
    $fileLine = $countLines | Where-Object { $_ -match '^\s+Files\s+:' } | Select-Object -First 1
    if ($fileLine) {
        $nums = @(($fileLine -split ':', 2)[1].Trim() -split '\s+' | Where-Object { $_ -ne '' })
        if ($nums.Count -ge 2) { $roboCopiedFiles = [int]$nums[1] }
    }
    $roboDeletedFiles = @($roboRaw | Where-Object { $_ -match '(?i)\tDeleting\s' }).Count
    Write-Info "本次镜像：复制/更新 $roboCopiedFiles 个文件，删除 $roboDeletedFiles 个（robocopy exit=$roboCode）"

    # -----------------------------------------------------------------------
    Write-Step '3/6 断言构建必需文件仍在'
    # -----------------------------------------------------------------------
    $vendorRel = 'src\scripts\vendor\legacy-tocbot.js'
    $vendorAbs = Join-Path $DestPath $vendorRel
    if (-not (Test-Path -LiteralPath $vendorAbs -PathType Leaf)) {
        Stop-WithError "镜像后缺少构建必需文件：$vendorAbs。已中止，未提交未推送。"
    }
    $vendorSize = (Get-Item -LiteralPath $vendorAbs).Length
    Write-Info "OK  $Subdir/src/scripts/vendor/legacy-tocbot.js（$vendorSize bytes）"

    foreach ($name in $siblingsBefore) {
        if (-not (Test-Path -LiteralPath (Join-Path $ClonePath $name) -PathType Container)) {
            Stop-WithError "镜像波及了同级目录：$name 已被删除，已中止（请检查 /MIR 参数）。"
        }
    }
    if ($siblingsBefore.Count -gt 0) {
        Write-Info "OK  同级目录完好：$($siblingsBefore -join ', ')"
    }
    if (-not (Test-Path -LiteralPath (Join-Path $ClonePath '.git'))) {
        Stop-WithError 'clone 的 .git 目录丢失，已中止。'
    }

    # -----------------------------------------------------------------------
    Write-Step '4/6 变更摘要'
    # -----------------------------------------------------------------------
    $statusAll = Invoke-Git -GitArgs @('-C', $ClonePath, '-c', 'core.quotepath=false', 'status', '--porcelain')
    if ($statusAll.ExitCode -ne 0) {
        Stop-WithError ("git status 失败。{0}{1}" -f $nl, $statusAll.Text)
    }
    $statusSub = Invoke-Git -GitArgs @('-C', $ClonePath, '-c', 'core.quotepath=false', 'status', '--porcelain', '--', $Subdir)
    if ($statusSub.ExitCode -ne 0) {
        Stop-WithError ("git status（{0}）失败。{1}{2}" -f $Subdir, $nl, $statusSub.Text)
    }

    $allLines = @($statusAll.Lines | Where-Object { $_.Trim() -ne '' })
    $subLines = @($statusSub.Lines | Where-Object { $_.Trim() -ne '' })

    Write-Info "$Subdir/ 内变更：$($subLines.Count) 项；整个 clone 变更：$($allLines.Count) 项"

    if ($subLines.Count -eq 0) {
        if ($allLines.Count -gt 0) {
            Write-Warn "站点子目录无变更，但 clone 其它位置有 $($allLines.Count) 项改动（不在本脚本范围内，未处理）："
            $allLines | Select-Object -First $MaxStatusLines | ForEach-Object { Write-Info "  $_" }
        }
        Write-Host ''
        Write-Host '无变更，无需推送' -ForegroundColor Green
        exit 0
    }

    $shown = 0
    foreach ($line in $subLines) {
        if ($shown -ge $MaxStatusLines) {
            Write-Info "… 还有 $($subLines.Count - $MaxStatusLines) 行未显示（上限 -MaxStatusLines $MaxStatusLines）"
            break
        }
        Write-Info "  $line"
        $shown++
    }

    if ($allLines.Count -gt $subLines.Count) {
        Write-Warn "clone 里另有 $($allLines.Count - $subLines.Count) 项改动在 $Subdir/ 之外；提交前会被移出暂存区，不会进入本次提交。"
    }

    if ($DryRun) {
        Write-Host ''
        Write-Host 'DryRun：已镜像，未提交未推送。' -ForegroundColor Yellow
        Write-Host '如需真正推送，去掉 -DryRun 重跑。' -ForegroundColor Yellow
        exit 0
    }

    # -----------------------------------------------------------------------
    Write-Step '5/6 提交'
    # -----------------------------------------------------------------------
    $add = Invoke-Git -GitArgs @('-C', $ClonePath, 'add', '-A') -Echo
    if ($add.ExitCode -ne 0) {
        Stop-WithError ("git add -A 失败（exit={0}）。{1}{2}" -f $add.ExitCode, $nl, $add.Text)
    }

    # 安全网：git add -A 在 clone 根执行，可能顺带暂存 $Subdir 之外的改动。
    # 本脚本只负责镜像子目录，因此把范围外的路径移出暂存区。
    $staged = Invoke-Git -GitArgs @('-C', $ClonePath, '-c', 'core.quotepath=false', 'diff', '--cached', '--name-only')
    $stagedLines = @($staged.Lines | Where-Object { $_.Trim() -ne '' })
    $foreign = @($stagedLines | Where-Object { -not $_.StartsWith("$Subdir/", [System.StringComparison]::Ordinal) })
    if ($foreign.Count -gt 0) {
        Write-Warn "暂存区里有 $($foreign.Count) 项不在 $Subdir/ 内，已移出暂存："
        foreach ($path in $foreign) {
            Write-Info "  - $path"
            Invoke-Git -GitArgs @('-C', $ClonePath, 'restore', '--staged', '--', $path) | Out-Null
        }
        $staged = Invoke-Git -GitArgs @('-C', $ClonePath, '-c', 'core.quotepath=false', 'diff', '--cached', '--name-only')
        $stagedLines = @($staged.Lines | Where-Object { $_.Trim() -ne '' })
    }

    if ($stagedLines.Count -eq 0) {
        Write-Host ''
        Write-Host '无变更，无需推送' -ForegroundColor Green
        exit 0
    }

    if (-not $Message) {
        $Message = "chore(site): sync local site $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
    }
    Write-Info "提交信息：$Message"
    Write-Info "暂存文件：$($stagedLines.Count) 个"

    $commit = Invoke-Git -GitArgs @('-C', $ClonePath, 'commit', '-m', $Message) -Echo
    if ($commit.ExitCode -ne 0) {
        Stop-WithError ("git commit 失败（exit={0}）。若为签名/钩子问题请先修好再重跑；不要使用 --no-verify。{1}{2}" -f $commit.ExitCode, $nl, $commit.Text)
    }
    $commitSha = (Invoke-Git -GitArgs @('-C', $ClonePath, 'rev-parse', 'HEAD')).Text.Trim()

    # -----------------------------------------------------------------------
    Write-Step "6/6 推送 origin/$Branch"
    # -----------------------------------------------------------------------
    $push = Invoke-Git -GitArgs @('-C', $ClonePath, 'push', 'origin', $Branch) -Echo
    if ($push.ExitCode -ne 0) {
        Write-Warn "push 失败（exit=$($push.ExitCode)），3 秒后重试一次"
        if ($push.Text -match '(?i)ssl|certificate|schannel|self.signed|unable to get local issuer') {
            if ($script:GitTlsArgs.Count -eq 0) {
                $script:GitTlsArgs = @('-c', 'http.sslVerify=false', '-c', 'http.schannelCheckRevoke=false')
                Write-Warn '检测到 TLS/证书错误，重试时临时关闭校验（仅本进程，未写入 git config）'
            }
        }
        Start-Sleep -Seconds 3
        $push = Invoke-Git -GitArgs @('-C', $ClonePath, 'push', 'origin', $Branch) -Echo
        if ($push.ExitCode -ne 0) {
            Stop-WithError ("git push 失败（已重试 1 次）。本地已有提交 {0}，修好网络后可手工 git push。{1}{2}" -f $commitSha, $nl, $push.Text)
        }
    }

    $remoteSha = (Invoke-Git -GitArgs @('-C', $ClonePath, 'rev-parse', "origin/$Branch")).Text.Trim()
    if ($remoteSha -ne $commitSha) {
        Write-Warn "origin/$Branch ($remoteSha) 与本地 HEAD ($commitSha) 不一致，请核对。"
    }

    # 直接问一次远端，确认 refs/heads 上的 tip 就是刚推的提交
    $lsRemote = Invoke-Git -GitArgs @('-C', $ClonePath, 'ls-remote', '--heads', 'origin', $Branch)
    if ($lsRemote.ExitCode -eq 0 -and $lsRemote.Text.Trim()) {
        $remoteTip = ($lsRemote.Text.Trim() -split '\s+')[0]
        if ($remoteTip -eq $commitSha) {
            Write-Info "远端校验：refs/heads/$Branch = $remoteTip"
        }
        else {
            Write-Warn "远端校验不一致：refs/heads/$Branch = $remoteTip，本地 = $commitSha"
        }
    }
    else {
        Write-Warn 'ls-remote 校验跳过（网络或代理问题）'
    }

    Write-Host ''
    Write-Host '同步完成' -ForegroundColor Green
    Write-Info "提交：$commitSha"
    Write-Info "分支：$Branch（origin/$Branch = $remoteSha）"
    Write-Info "仓库：$RepoUrl"
    Write-Info "提交前 HEAD：$headBefore"
    Write-Info 'deploy.yml 会因 astro-babel36acl-next/** 变更自动触发；可用 gh run list 跟踪。'
}
finally {
    Restore-Environment
}
