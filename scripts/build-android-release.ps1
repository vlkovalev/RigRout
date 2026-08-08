$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$keyStore = Join-Path $HOME 'rigrout-upload.jks'
$javaHome = 'C:\Program Files\Eclipse Adoptium\jdk-21.0.11.10-hotspot'
$androidHome = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
$bundle = Join-Path $root 'android\app\build\outputs\bundle\release\app-release.aab'
$androidRoot = Join-Path $root 'android'
$appBuild = Join-Path $androidRoot 'app\build'

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
            # Gradle/Windows can retain handles in incremental ART-profile and
            # package directories after an earlier build. Stop every daemon and
            # clear only this app's generated build tree before producing a
            # release. This also prevents an old signed AAB from being mistaken
            # for the new version when compilation fails.
            & .\gradlew.bat --stop | Out-Host
            if (Test-Path -LiteralPath $appBuild) {
                $expectedParent = [IO.Path]::GetFullPath((Join-Path $androidRoot 'app'))
                $resolvedBuild = [IO.Path]::GetFullPath($appBuild)
                if (-not $resolvedBuild.StartsWith($expectedParent + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
                    throw "Refusing to clear unexpected build path: $resolvedBuild"
                }
                $removed = $false
                for ($attempt = 1; $attempt -le 3 -and -not $removed; $attempt++) {
                    try {
                        Remove-Item -LiteralPath $resolvedBuild -Recurse -Force
                        $removed = $true
                    } catch {
                        if ($attempt -eq 3) { throw }
                        Start-Sleep -Seconds 2
                    }
                }
            }
            & .\gradlew.bat bundleRelease --no-daemon --max-workers=1
            if ($LASTEXITCODE -ne 0) { throw 'Android release build failed.' }
        } finally {
            Pop-Location
        }
    } finally {
        Pop-Location
    }

    $jarsigner = Join-Path $javaHome 'bin\jarsigner.exe'
    & $jarsigner -verify $bundle
    if ($LASTEXITCODE -ne 0) { throw 'Bundle signature verification failed.' }

    Write-Host ''
    Write-Host 'SIGNED AND VERIFIED:' -ForegroundColor Green
    Write-Host $bundle
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
