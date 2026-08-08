param([switch]$InstallConnected)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$keyStore = Join-Path $HOME 'rigrout-upload.jks'
$javaHome = 'C:\Program Files\Eclipse Adoptium\jdk-21.0.11.10-hotspot'
$androidHome = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
$bundle = Join-Path $root 'android\app\build\outputs\bundle\release\app-release.aab'
$apk = Join-Path $root 'android\app\build\outputs\apk\release\app-release.apk'
$androidRoot = Join-Path $root 'android'
$appBuild = Join-Path $androidRoot 'app\build'
$capacitorBuild = Join-Path $root 'node_modules\@capacitor\android\capacitor\build'
$cordovaBuild = Join-Path $androidRoot 'capacitor-cordova-android-plugins\build'

function Remove-VerifiedGeneratedDirectory([string]$Target, [string]$ExpectedParent) {
    if (-not (Test-Path -LiteralPath $Target)) { return }
    $resolvedTarget = [IO.Path]::GetFullPath($Target)
    $resolvedParent = [IO.Path]::GetFullPath($ExpectedParent)
    if (-not $resolvedTarget.StartsWith($resolvedParent + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to clear unexpected build path: $resolvedTarget"
    }
    for ($attempt = 1; $attempt -le 4; $attempt++) {
        try {
            Remove-Item -LiteralPath $resolvedTarget -Recurse -Force
            return
        } catch {
            if ($attempt -eq 4) { throw }
            Start-Sleep -Seconds 2
        }
    }
}

function Clear-AndroidGeneratedBuilds {
    Remove-VerifiedGeneratedDirectory $appBuild (Join-Path $androidRoot 'app')
    Remove-VerifiedGeneratedDirectory $capacitorBuild (Join-Path $root 'node_modules\@capacitor\android\capacitor')
    Remove-VerifiedGeneratedDirectory $cordovaBuild (Join-Path $androidRoot 'capacitor-cordova-android-plugins')
}

if (-not (Test-Path -LiteralPath $keyStore)) {
    throw "Upload key not found: $keyStore"
}

$securePassword = Read-Host 'Enter the RigRout upload-key password' -AsSecureString
$passwordPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)

try {
    $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPtr)
    $env:JAVA_HOME = $javaHome
    $env:ANDROID_HOME = $androidHome
    $env:RIGROUT_KEYSTORE_FILE = $keyStore
    $env:RIGROUT_KEYSTORE_PASSWORD = $plainPassword
    $env:RIGROUT_KEY_ALIAS = 'rigrout-upload'
    $env:RIGROUT_KEY_PASSWORD = $plainPassword

    Push-Location $root
    try {
        & npm.cmd run mobile:sync
        if ($LASTEXITCODE -ne 0) { throw 'Capacitor sync failed.' }

        Push-Location $androidRoot
        try {
            # Windows can retain handles in the app, Capacitor library, or
            # generated Cordova module. Clean all three verified build trees;
            # if the first build still encounters a transient lock, repeat the
            # cleanup and build once automatically.
            for ($buildAttempt = 1; $buildAttempt -le 2; $buildAttempt++) {
                & .\gradlew.bat --stop | Out-Host
                Clear-AndroidGeneratedBuilds
                $gradleTask = if ($InstallConnected) { 'assembleRelease' } else { 'bundleRelease' }
                & .\gradlew.bat $gradleTask --no-daemon --max-workers=1
                if ($LASTEXITCODE -eq 0) { break }
                if ($buildAttempt -eq 2) { throw 'Android release build failed after a clean retry.' }
                Write-Warning 'Android build hit a transient file lock; cleaning generated files and retrying once.'
            }
        } finally {
            Pop-Location
        }
    } finally {
        Pop-Location
    }

    $artifact = if ($InstallConnected) { $apk } else { $bundle }
    if (-not (Test-Path -LiteralPath $artifact)) { throw "Expected Android artifact was not created: $artifact" }
    $jarsigner = Join-Path $javaHome 'bin\jarsigner.exe'
    & $jarsigner -verify $artifact
    if ($LASTEXITCODE -ne 0) { throw 'Android artifact signature verification failed.' }

    Write-Host ''
    Write-Host 'SIGNED AND VERIFIED:' -ForegroundColor Green
    Write-Host $artifact

    if ($InstallConnected) {
        $adb = Join-Path $androidHome 'platform-tools\adb.exe'
        $devices = @(& $adb devices | Select-Object -Skip 1 | Where-Object { $_ -match "\sdevice$" })
        if ($devices.Count -ne 1) { throw "Connect exactly one authorized Android device; found $($devices.Count)." }
        & $adb install -r $apk
        if ($LASTEXITCODE -ne 0) { throw 'Android phone update failed; the existing app was left installed.' }
        $installed = (& $adb shell dumpsys package com.rigrout.app | Select-String 'versionCode=|versionName=' | ForEach-Object { $_.Line.Trim() }) -join '; '
        Write-Host ''
        Write-Host 'PHONE UPDATED:' -ForegroundColor Green
        Write-Host $installed
    }
} finally {
    if ($passwordPtr -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPtr)
    }
    $plainPassword = $null
    Remove-Item Env:RIGROUT_KEYSTORE_PASSWORD -ErrorAction SilentlyContinue
    Remove-Item Env:RIGROUT_KEY_PASSWORD -ErrorAction SilentlyContinue
    Remove-Item Env:RIGROUT_KEYSTORE_FILE -ErrorAction SilentlyContinue
    Remove-Item Env:RIGROUT_KEY_ALIAS -ErrorAction SilentlyContinue
}
