param(
    [ValidateSet("StartEmulator", "RunAndPrepareDebug")]
    [string]$Action = "RunAndPrepareDebug",

    [switch]$NoScrcpy
)

$ErrorActionPreference = "Stop"

$AppId = "com.dejati.pos"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

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

    $sdkRoots = @($env:ANDROID_HOME, $env:ANDROID_SDK_ROOT, (Join-Path $env:LOCALAPPDATA "Android\Sdk")) | Where-Object { $_ }
    foreach ($sdkRoot in $sdkRoots) {
        $candidate = Join-Path $sdkRoot "platform-tools\adb.exe"
        if (Test-Path $candidate) {
            return $candidate
        }
    }

    throw "adb tidak ditemukan. Pastikan Android SDK platform-tools ada di PATH, ANDROID_HOME, atau ANDROID_SDK_ROOT."
}

function Get-EmulatorPath {
    $emulator = Get-CommandPath "emulator"
    if ($emulator) {
        return $emulator
    }

    $sdkRoots = @($env:ANDROID_HOME, $env:ANDROID_SDK_ROOT, (Join-Path $env:LOCALAPPDATA "Android\Sdk")) | Where-Object { $_ }
    foreach ($sdkRoot in $sdkRoots) {
        $candidate = Join-Path $sdkRoot "emulator\emulator.exe"
        if (Test-Path $candidate) {
            return $candidate
        }
    }

    throw "Android emulator tidak ditemukan. Pastikan Android SDK emulator ada di PATH, ANDROID_HOME, atau ANDROID_SDK_ROOT."
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

function Initialize-WindowApi {
    if ('DejatiWindowApi' -as [type]) { return }

    Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class DejatiWindowApi {
    [DllImport("user32.dll")]
    public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
}
"@
}

function Hide-AndroidEmulatorWindows {
    Initialize-WindowApi

    Get-Process -Name emulator,qemu-system-x86_64,qemu-system-aarch64 -ErrorAction SilentlyContinue |
        Where-Object { $_.MainWindowHandle -ne 0 } |
        ForEach-Object {
            [DejatiWindowApi]::ShowWindowAsync($_.MainWindowHandle, 6) | Out-Null
        }
}

function Show-AndroidEmulatorWindows {
    Initialize-WindowApi

    Get-Process -Name emulator,qemu-system-x86_64,qemu-system-aarch64 -ErrorAction SilentlyContinue |
        Where-Object { $_.MainWindowHandle -ne 0 } |
        ForEach-Object {
            [DejatiWindowApi]::ShowWindowAsync($_.MainWindowHandle, 9) | Out-Null
        }
}

function Test-AndroidEmulatorWindow {
    return [bool](
        Get-Process -Name emulator,qemu-system-x86_64,qemu-system-aarch64 -ErrorAction SilentlyContinue |
            Where-Object { $_.MainWindowHandle -ne 0 } |
            Select-Object -First 1
    )
}

function Get-EmulatorDevices {
    param([string]$Adb)

    return @((Get-EmulatorDeviceStates -Adb $Adb) | Where-Object { $_.State -eq "device" } | Select-Object -ExpandProperty Serial)
}

function Get-EmulatorDeviceStates {
    param([string]$Adb)

    $lines = & $Adb devices | Select-Object -Skip 1
    return @($lines | ForEach-Object {
        if ($_ -match "^\s*(emulator-[^\s]+)\s+([^\s]+)") {
            [pscustomobject]@{
                Serial = $Matches[1]
                State = $Matches[2]
            }
        }
    })
}

function Stop-AndroidEmulatorProcesses {
    Get-Process -Name emulator,qemu-system-x86_64,qemu-system-aarch64 -ErrorAction SilentlyContinue |
        ForEach-Object {
            Write-Warning "Menutup emulator lama/stuck: $($_.ProcessName) PID $($_.Id)"
            Stop-Process -Id $_.Id -Force
        }
}

function Wait-ForEmulatorDevice {
    param(
        [string]$Adb,
        [int]$TimeoutSeconds = 180
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        $devices = @(Get-EmulatorDevices -Adb $Adb)
        if ($devices.Count -gt 0) {
            return $devices[0]
        }

        Start-Sleep -Seconds 2
    } until ((Get-Date) -gt $deadline)

    throw "Emulator belum terdeteksi oleh adb setelah $TimeoutSeconds detik."
}

function Wait-ForBootComplete {
    param(
        [string]$Adb,
        [string]$Serial,
        [int]$TimeoutSeconds = 180
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        $booted = (& $Adb -s $Serial shell getprop sys.boot_completed 2>$null) -join ""
        if ($booted.Trim() -eq "1") {
            Write-Host "Emulator siap: $Serial"
            return
        }

        Start-Sleep -Seconds 2
    } until ((Get-Date) -gt $deadline)

    throw "Emulator $Serial belum selesai boot setelah $TimeoutSeconds detik."
}

function Start-EmulatorIfNeeded {
    $adb = Get-AdbPath
    Invoke-Native $adb @("start-server")

    $devices = @(Get-EmulatorDevices -Adb $adb)
    if ($devices.Count -gt 0) {
        if (-not (Test-AndroidEmulatorWindow)) {
            Write-Warning "Emulator ADB sudah berjalan, tapi window emulator tidak terlihat. Mulai ulang emulator dengan window normal."
            Stop-AndroidEmulatorProcesses
            Start-Sleep -Seconds 2
            & $adb kill-server | Out-Null
            Invoke-Native $adb @("start-server")
        } else {
            Show-AndroidEmulatorWindows
            Write-Host "Emulator sudah berjalan: $($devices[0])"
            Wait-ForBootComplete -Adb $adb -Serial $devices[0]
            return $devices[0]
        }
    }

    $devices = @(Get-EmulatorDevices -Adb $adb)
    if ($devices.Count -gt 0) {
        Write-Host "Emulator sudah berjalan: $($devices[0])"
        Show-AndroidEmulatorWindows
        Wait-ForBootComplete -Adb $adb -Serial $devices[0]
        return $devices[0]
    }

    $states = @(Get-EmulatorDeviceStates -Adb $adb)
    if ($states.Count -gt 0) {
        Write-Warning "Emulator terdeteksi tapi belum siap: $(($states | ForEach-Object { "$($_.Serial)=$($_.State)" }) -join ', ')"
        & $adb kill-server | Out-Null
        Start-Sleep -Seconds 2
        Invoke-Native $adb @("start-server")

        try {
            $serial = Wait-ForEmulatorDevice -Adb $adb -TimeoutSeconds 30
            Wait-ForBootComplete -Adb $adb -Serial $serial
            return $serial
        } catch {
            Write-Warning "Emulator masih belum siap setelah restart ADB. Mulai ulang emulator."
            Stop-AndroidEmulatorProcesses
            Start-Sleep -Seconds 2
            & $adb kill-server | Out-Null
            Invoke-Native $adb @("start-server")
        }
    } elseif (Get-Process -Name emulator,qemu-system-x86_64,qemu-system-aarch64 -ErrorAction SilentlyContinue) {
        Write-Warning "Proses emulator ada, tapi tidak muncul sebagai device ADB. Mulai ulang emulator."
        Stop-AndroidEmulatorProcesses
        Start-Sleep -Seconds 2
        & $adb kill-server | Out-Null
        Invoke-Native $adb @("start-server")
    }

    $emulator = Get-EmulatorPath
    $avds = @(& $emulator -list-avds | Where-Object { $_ })
    if ($avds.Count -eq 0) {
        throw "Tidak ada Android Virtual Device. Buat AVD dulu lewat Android Studio Device Manager."
    }

    $avd = $avds[0]
    Write-Host "Membuka emulator: $avd"
    Start-Process -FilePath $emulator -ArgumentList @("-avd", $avd, "-no-audio", "-no-snapshot-load") | Out-Null

    $serial = Wait-ForEmulatorDevice -Adb $adb
    Wait-ForBootComplete -Adb $adb -Serial $serial
    return $serial
}

function Enable-WebViewDebugForward {
    param([string]$Serial)

    $adb = Get-AdbPath
    $appPid = (& $adb -s $Serial shell pidof $AppId 2>$null) -join ""
    $appPid = $appPid.Trim()

    if (-not $appPid) {
        Write-Warning "PID $AppId belum ditemukan; port debug WebView belum bisa diforward."
        return
    }

    Invoke-Native $adb @("-s", $Serial, "forward", "tcp:9222", "localabstract:webview_devtools_remote_$appPid")
    Write-Host "WebView debug siap di localhost:9222 untuk $Serial."
}

switch ($Action) {
    "StartEmulator" {
        Start-EmulatorIfNeeded | Out-Null
    }
    "RunAndPrepareDebug" {
        $serial = Start-EmulatorIfNeeded
        & (Join-Path $Root "scripts\vscode-android-run.ps1") -Target emulator -NoScrcpy:$NoScrcpy
        Enable-WebViewDebugForward -Serial $serial
    }
}
