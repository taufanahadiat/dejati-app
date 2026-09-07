function Get-ScrcpyExecutable {
    $command = Get-Command scrcpy.exe -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }

    $packageRoot = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages'
    $executable = Get-ChildItem -Path $packageRoot -Filter 'scrcpy.exe' -Recurse -ErrorAction SilentlyContinue |
        Select-Object -First 1 -ExpandProperty FullName
    if ($executable) { return $executable }
    throw 'scrcpy tidak ditemukan. Instal dengan: winget install Genymobile.scrcpy'
}

function Start-Scrcpy {
    param([string]$Serial)

    $escapedSerial = [regex]::Escape($Serial)
    $existing = Get-CimInstance Win32_Process -Filter "Name = 'scrcpy.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -match "(?:--serial|-s)\s+$escapedSerial(\s|$)" }
    foreach ($item in $existing) {
        $process = Get-Process -Id $item.ProcessId -ErrorAction SilentlyContinue
        if ($process -and $process.MainWindowHandle -ne 0 -and $process.Responding) {
            Write-Host "Jendela scrcpy untuk $Serial sudah berjalan."
            return
        }
    }

    $scrcpy = Get-ScrcpyExecutable
    $logBase = Join-Path $env:TEMP "dejati-scrcpy-$Serial-$(Get-Date -Format 'yyyyMMdd-HHmmss-fff')"
    # Start-Process joins ArgumentList into a command line; quote the complete title.
    $arguments = "--serial $Serial --max-size 1000 --window-width 1000 --window-height 625 --window-title `"Dejati POS - $Serial`""
    $process = Start-Process -FilePath $scrcpy -ArgumentList $arguments -WorkingDirectory (Split-Path -Parent $scrcpy) -PassThru -RedirectStandardOutput "$logBase.out.log" -RedirectStandardError "$logBase.err.log"
    $deadline = (Get-Date).AddSeconds(30)
    do {
        Start-Sleep -Milliseconds 500
        $process.Refresh()
        if ($process.HasExited) {
            $details = Get-Content "$logBase.err.log" -ErrorAction SilentlyContinue
            throw "scrcpy gagal untuk $Serial (exit $($process.ExitCode)): $($details -join [Environment]::NewLine)"
        }
        if ($process.MainWindowHandle -ne 0 -and $process.Responding) {
            Write-Host "scrcpy siap: $Serial (PID $($process.Id)). Log: $logBase"
            return
        }
    } until ((Get-Date) -gt $deadline)
    throw "Jendela scrcpy untuk $Serial belum siap. Periksa $logBase.err.log dan $logBase.out.log."
}
