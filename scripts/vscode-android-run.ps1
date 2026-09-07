param(
    [ValidateSet("all", "emulator", "device")]
    [string]$Target = "all",

    [switch]$SkipBuild,
    [switch]$NoScrcpy
)

$ErrorActionPreference = "Stop"

$AppId = "com.dejati.pos"
$Activity = "com.dejati.pos/.MainActivity"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$AndroidDir = Join-Path $Root "android"
$ApkPath = Join-Path $AndroidDir "app\build\outputs\apk\debug\app-debug.apk"
. (Join-Path $PSScriptRoot 'android-scrcpy.ps1')

function Get-CommandPath {
    param([string]$Name)

    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }

    return $null
}

function Get-AdbPath {
    $adb = Get-CommandPath "adb"
    if ($adb) {
        return $adb
    }

    $sdkRoots = @($env:ANDROID_HOME, $env:ANDROID_SDK_ROOT, (Join-Path $env:LOCALAPPDATA 'Android\Sdk')) | Where-Object { $_ }
    foreach ($sdkRoot in $sdkRoots) {
        $candidate = Join-Path $sdkRoot "platform-tools\adb.exe"
        if (Test-Path $candidate) {
            return $candidate
        }
    }

    throw "adb tidak ditemukan. Pastikan Android SDK platform-tools ada di PATH, ANDROID_HOME, atau ANDROID_SDK_ROOT."
}

function Invoke-Step {
    param(
        [string]$Title,
        [scriptblock]$Script
    )

    Write-Host ""
    Write-Host "==> $Title" -ForegroundColor Cyan
    & $Script
}

function Invoke-Native {
    param(
        [string]$FilePath,
        [string[]]$Arguments = @()
    )

    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Command gagal ($LASTEXITCODE): $FilePath $($Arguments -join ' ')"
    }
}

function Get-ConnectedDevices {
    param([string]$Adb)

    $lines = & $Adb devices | Select-Object -Skip 1
    $serials = @()

    foreach ($line in $lines) {
        if ($line -match "^\s*([^\s]+)\s+device\s*$") {
            $serials += $Matches[1]
        }
    }

    if ($Target -eq "emulator") {
        return @($serials | Where-Object { $_ -like "emulator-*" })
    }

    if ($Target -eq "device") {
        return @($serials | Where-Object { $_ -notlike "emulator-*" })
    }

    return @($serials)
}

Set-Location $Root

$adb = Get-AdbPath
if (-not $NoScrcpy) { $null = Get-ScrcpyExecutable }

Invoke-Native $adb @('start-server')
if ($Target -eq 'emulator' -or $Target -eq 'all') {
    & (Join-Path $Root '.vscode\android-debug.ps1') -Action StartEmulator -NoScrcpy:$NoScrcpy
}

if (-not $SkipBuild) {
    if (-not (Test-Path (Join-Path $Root "node_modules"))) {
        Invoke-Step "Install npm dependencies" {
            Invoke-Native "npm" @("install")
        }
    }

    Invoke-Step "Build web assets" {
        Invoke-Native "npm" @("run", "build:android:debug")
    }

    Invoke-Step "Sync Capacitor Android" {
        Invoke-Native "npx" @("cap", "sync", "android")
    }

    Invoke-Step "Build Android debug APK" {
        Push-Location $AndroidDir
        try {
            Invoke-Native ".\gradlew.bat" @("assembleDebug", "--console=plain")
        } finally {
            Pop-Location
        }
    }
}

if (-not (Test-Path $ApkPath)) {
    throw "APK debug tidak ditemukan di $ApkPath. Jalankan ulang tanpa -SkipBuild."
}

Invoke-Step "Read connected Android targets" {
    Invoke-Native $adb @("start-server")
    & $adb devices
}

$devices = @(Get-ConnectedDevices -Adb $adb)
if (-not $devices -or $devices.Count -eq 0) {
    throw "Tidak ada target '$Target' yang siap. Buka emulator atau sambungkan device USB dengan USB debugging aktif."
}

foreach ($serial in $devices) {
    Invoke-Step "Install APK to $serial" {
        Invoke-Native $adb @("-s", $serial, "install", "-r", $ApkPath)
    }

    Invoke-Step "Launch Dejati POS on $serial" {
        Invoke-Native $adb @("-s", $serial, "shell", "am", "start", "-n", $Activity)
    }

    if (-not $NoScrcpy) {
        Invoke-Step "Open scrcpy for $serial" {
            Start-Scrcpy -Serial $serial
        }
    }
}

Write-Host ""
Write-Host "Selesai untuk target: $($devices -join ', ')" -ForegroundColor Green
