param(
    [ValidateSet("all", "pdftex", "xetex", "dvi")]
    [string] $Target = "all"
)

$ErrorActionPreference = "Stop"

$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$defaultPluginRoot = Split-Path -Parent $scriptDirectory
$configPath = Join-Path $scriptDirectory "local-config.ps1"

if (-not (Test-Path $configPath)) {
    throw @"
Missing local configuration file:

    $configPath

Create it using:

    Copy-Item scripts\local-config.example.ps1 scripts\local-config.ps1

Then update the paths for your computer.
"@
}

. $configPath

if ([string]::IsNullOrWhiteSpace($PluginRoot)) {
    $PluginRoot = $defaultPluginRoot
}

function Assert-PathExists {
    param(
        [Parameter(Mandatory)]
        [string] $Path,

        [Parameter(Mandatory)]
        [string] $Description
    )

    if (-not (Test-Path $Path)) {
        throw "$Description does not exist: $Path"
    }
}

function Convert-ToGitBashPath {
    param(
        [Parameter(Mandatory)]
        [string] $WindowsPath
    )

    $resolvedPath = [System.IO.Path]::GetFullPath($WindowsPath)
    $driveLetter = $resolvedPath.Substring(0, 1).ToLowerInvariant()
    $remainingPath = $resolvedPath.Substring(2).Replace('\', '/')

    return "/$driveLetter$remainingPath"
}

Assert-PathExists $SwiftLatexRoot "SwiftLaTeX root"
Assert-PathExists $EmsdkRoot "EMSDK root"
Assert-PathExists $GitBashPath "Git Bash executable"
Assert-PathExists $PluginRoot "Plugin root"

$pdftexSource = Join-Path $SwiftLatexRoot `
    "pdftex.wasm\swiftlatexpdftex.worker.js"

$xetexSource = Join-Path $SwiftLatexRoot `
    "xetex.wasm\swiftlatexxetex.worker.js"

$dvipdfmSource = Join-Path $SwiftLatexRoot `
    "dvipdfm.wasm\swiftlatexdvipdfm.worker.js"

$compilerRoot = Join-Path $PluginRoot `
    "src\latexRender\compiler"

$pdftexDest = Join-Path $compilerRoot `
    "swiftlatexpdftex\swiftlatexpdftex.worker.js"

$xetexDest = Join-Path $compilerRoot `
    "swiftlatexxetex\swiftlatexxetex.worker.js"

$dvipdfmDest = Join-Path $compilerRoot `
    "swiftlatexxetex\swiftlatexdvipdfm.worker.js"

$swiftLatexBashPath = Convert-ToGitBashPath $SwiftLatexRoot
$emsdkBashPath = Convert-ToGitBashPath $EmsdkRoot

$makeCommand = switch ($Target) {
    "all" {
        "make re"
    }

    "pdftex" {
        "make -C pdftex.wasm re --no-print-directory"
    }

    "xetex" {
        "make -C xetex.wasm re --no-print-directory"
    }

    "dvi" {
        "make -C dvipdfm.wasm re --no-print-directory"
    }
}

Write-Host "Building SwiftLaTeX..."
Write-Host "Source: $SwiftLatexRoot"
Write-Host "Target: $Target"

& $GitBashPath -lc @"
set -e
cd '$swiftLatexBashPath'
source '$emsdkBashPath/emsdk_env.sh'
$makeCommand
"@

if ($LASTEXITCODE -ne 0) {
    throw "SwiftLaTeX build failed with exit code $LASTEXITCODE."
}

$workers = @{
    pdftex = @{
        Source = $pdftexSource
        Destination = $pdftexDest
        Description = "Generated PDFTeX worker"
    }

    xetex = @{
        Source = $xetexSource
        Destination = $xetexDest
        Description = "Generated XeTeX worker"
    }

    dvi = @{
        Source = $dvipdfmSource
        Destination = $dvipdfmDest
        Description = "Generated DVIPDFM worker"
    }
}

$selectedWorkers = if ($Target -eq "all") {
    @("pdftex", "xetex", "dvi")
}
else {
    @($Target)
}

Write-Host "Copying workers..."

foreach ($workerName in $selectedWorkers) {
    $worker = $workers[$workerName]

    Assert-PathExists `
        $worker.Source `
        $worker.Description

    New-Item `
        -ItemType Directory `
        -Force `
        -Path (Split-Path -Parent $worker.Destination) |
        Out-Null

    Copy-Item `
        $worker.Source `
        $worker.Destination `
        -Force

    Write-Host "  Copied $workerName"
}

Write-Host ""
Write-Host "SwiftLaTeX target '$Target' built and copied successfully."