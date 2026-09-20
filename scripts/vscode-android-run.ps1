param(
    [ValidateSet("all", "emulator", "device")]
    [string]$Target = "all",

    [switch]$SkipBuild,
    [switch]$ForceReinstall,
    [switch]$StartEmulator,
    [switch]$ScrcpyOnly,
    [switch]$NoScrcpy
)

$ErrorActionPreference = "Stop"

$AppId = "com.dejati.pos"
$Activity = "com.dejati.pos/.MainActivity"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$AndroidDir = Join-Path $Root "android"
$ApkPath = Join-Path $AndroidDir "app\build\outputs\apk\debug\app-debug.apk"
$AndroidDebugScript = Join-Path $Root ".vscode\android-debug.ps1"
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

function Invoke-AdbInstall {
    param(
        [string]$Adb,
        [string]$Serial,
        [string]$Apk
    )

    $arguments = @("-s", $Serial, "install", "-r", $Apk)
    $output = & $Adb @arguments 2>&1
    $exitCode = $LASTEXITCODE
    $output | ForEach-Object { Write-Host $_ }

    if ($exitCode -eq 0) {
        return
    }

    $message = $output | Out-String
    $signatureMismatch = $message -match "INSTALL_FAILED_UPDATE_INCOMPATIBLE" -or $message -match "signatures do not match"

    if ($signatureMismatch -and $ForceReinstall) {
        Write-Warning "Signature APK berbeda dengan app yang sudah terpasang. Menghapus $AppId dari $Serial lalu install ulang. Data lokal app akan hilang."
        Invoke-Native $Adb @("-s", $Serial, "uninstall", $AppId)
        Invoke-Native $Adb @("-s", $Serial, "install", "-r", $Apk)
        return
    }

    if ($signatureMismatch) {
        throw "Install gagal karena signature app lama berbeda dengan APK baru. Jalankan ulang dengan -ForceReinstall untuk uninstall $AppId dari device lalu install ulang; data lokal app akan hilang."
    }

    throw "Command gagal ($exitCode): $Adb $($arguments -join ' ')"
}

function Wake-AndroidTarget {
    param(
        [string]$Adb,
        [string]$Serial
    )

    & $Adb -s $Serial shell input keyevent KEYCODE_WAKEUP 2>$null | Out-Null
    & $Adb -s $Serial shell wm dismiss-keyguard 2>$null | Out-Null
    & $Adb -s $Serial shell input keyevent BACK 2>$null | Out-Null
    Start-Sleep -Milliseconds 500
}

function Set-AndroidDisplayForScrcpy {
    param(
        [string]$Adb,
        [string]$Serial
    )

    & $Adb -s $Serial shell wm size 960x600 2>$null | Out-Null
    & $Adb -s $Serial shell wm density 140 2>$null | Out-Null
    & $Adb -s $Serial shell settings put global window_animation_scale 0 2>$null | Out-Null
    & $Adb -s $Serial shell settings put global transition_animation_scale 0 2>$null | Out-Null
    & $Adb -s $Serial shell settings put global animator_duration_scale 0 2>$null | Out-Null
}

function Test-EmulatorSerial {
    param([string]$Serial)

    return $Serial -like "emulator-*"
}

function Wait-AndroidAppFocus {
    param(
        [string]$Adb,
        [string]$Serial,
        [int]$TimeoutSeconds = 20
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        $focus = (& $Adb -s $Serial shell dumpsys window 2>$null | Select-String -Pattern "mCurrentFocus|mFocusedApp") -join "`n"
        if ($focus -match "com\.dejati\.pos") {
            return
        }

        Start-Sleep -Milliseconds 500
    } until ((Get-Date) -gt $deadline)

    Write-Warning "Window Dejati POS belum menjadi fokus setelah $TimeoutSeconds detik. Lanjut membuka scrcpy."
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

if ($ScrcpyOnly -and $NoScrcpy) {
    throw "Parameter -ScrcpyOnly tidak bisa dipakai bersama -NoScrcpy."
}

if ($StartEmulator -and $Target -eq "device") {
    throw "Parameter -StartEmulator hanya bisa dipakai dengan target 'emulator' atau 'all'."
}

$adb = Get-AdbPath
if (-not $NoScrcpy) { $null = Get-ScrcpyExecutable }

Invoke-Native $adb @('start-server')

if ($StartEmulator) {
    if (-not (Test-Path $AndroidDebugScript)) {
        throw "Helper emulator tidak ditemukan: $AndroidDebugScript"
    }

    & $AndroidDebugScript -Action StartEmulator
}

if ($ScrcpyOnly) {
    Invoke-Step "Read connected Android targets" {
        & $adb devices
    }

    $devices = @(Get-ConnectedDevices -Adb $adb)
    if (-not $devices -or $devices.Count -eq 0) {
        throw "Tidak ada target '$Target' yang siap untuk scrcpy. Buka emulator atau sambungkan device USB dengan USB debugging aktif."
    }

    foreach ($serial in $devices) {
        Invoke-Step "Open scrcpy for $serial" {
            Wake-AndroidTarget -Adb $adb -Serial $serial
            if (Test-EmulatorSerial -Serial $serial) {
                Set-AndroidDisplayForScrcpy -Adb $adb -Serial $serial
            }
            Start-Scrcpy -Serial $serial
        }
    }

    Write-Host ""
    Write-Host "scrcpy selesai untuk target: $($devices -join ', ')" -ForegroundColor Green
    return
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
    Invoke-Step "Wake Android target $serial" {
        Wake-AndroidTarget -Adb $adb -Serial $serial
        if ((-not $NoScrcpy) -and (Test-EmulatorSerial -Serial $serial)) {
            Set-AndroidDisplayForScrcpy -Adb $adb -Serial $serial
        }
    }

    Invoke-Step "Stop existing Dejati POS on $serial" {
        & $adb -s $serial shell am force-stop $AppId 2>$null | Out-Null
        Start-Sleep -Milliseconds 500
    }

    if (-not $NoScrcpy) {
        Invoke-Step "Close old scrcpy for $serial" {
            Stop-Scrcpy -Serial $serial
        }
    }

    Invoke-Step "Install APK to $serial" {
        Invoke-AdbInstall -Adb $adb -Serial $serial -Apk $ApkPath
    }

    Invoke-Step "Launch Dejati POS on $serial" {
        Invoke-Native $adb @("-s", $serial, "shell", "am", "start", "--display", "0", "-W", "-n", $Activity)
        Wait-AndroidAppFocus -Adb $adb -Serial $serial
    }

    if (-not $NoScrcpy) {
        Invoke-Step "Open scrcpy for $serial" {
            Wake-AndroidTarget -Adb $adb -Serial $serial
            Start-Scrcpy -Serial $serial
            Invoke-Native $adb @("-s", $serial, "shell", "am", "start", "--display", "0", "-W", "-n", $Activity)
            Wait-AndroidAppFocus -Adb $adb -Serial $serial
        }
    }
}

Write-Host ""
Write-Host "Selesai untuk target: $($devices -join ', ')" -ForegroundColor Green
