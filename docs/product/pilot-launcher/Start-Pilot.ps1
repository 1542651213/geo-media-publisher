param(
    [string]$InstallDirectory = '',
    [string]$PilotDirectory = (Join-Path $env:LOCALAPPDATA 'GEO-Department-Pilot-R115I'),
    [switch]$ValidateOnly
)
$ErrorActionPreference = 'Stop'
try {
    $pilotAbsolute = [IO.Path]::GetFullPath($PilotDirectory).TrimEnd('\')
    if (-not [IO.Path]::IsPathRooted($PilotDirectory) -or [IO.Path]::GetFileName($pilotAbsolute) -ne 'GEO-Department-Pilot-R115I') {
        throw 'Pilot directory must be an absolute, dedicated GEO-Department-Pilot-R115I directory.'
    }
    foreach ($protected in @((Join-Path $env:APPDATA 'codex-media-publisher'), (Join-Path $env:LOCALAPPDATA 'codex-media-publisher'))) {
        $protectedAbsolute = [IO.Path]::GetFullPath($protected).TrimEnd('\')
        if ($pilotAbsolute.Equals($protectedAbsolute, [StringComparison]::OrdinalIgnoreCase) -or $pilotAbsolute.StartsWith($protectedAbsolute + '\', [StringComparison]::OrdinalIgnoreCase) -or $protectedAbsolute.StartsWith($pilotAbsolute + '\', [StringComparison]::OrdinalIgnoreCase)) {
            throw 'Existing publisher data is protected. Choose the dedicated pilot directory.'
        }
    }
    $probe = $pilotAbsolute
    while ($probe) {
        if (Test-Path -LiteralPath $probe) {
            $probeItem = Get-Item -LiteralPath $probe -Force
            if (-not $probeItem.PSIsContainer) { throw 'Pilot path contains a file instead of a directory.' }
            if ($probeItem.Attributes -band [IO.FileAttributes]::ReparsePoint) {
                throw 'Pilot path contains a link or junction. Refusing to start.'
            }
        }
        $parent = [IO.Directory]::GetParent($probe)
        $probe = if ($parent) { $parent.FullName } else { $null }
    }
    $profile = Join-Path $pilotAbsolute 'b01-isolated-user-data'
    if (Test-Path -LiteralPath $profile) {
        $profileItem = Get-Item -LiteralPath $profile -Force
        if (-not $profileItem.PSIsContainer -or ($profileItem.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Pilot profile must be a real directory.' }
    }
    $manifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'SOFTWARE.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($manifest.deliveryId -ne 'R1.15-I' -or $manifest.appAsarSha256 -notmatch '^[a-f0-9]{64}$') { throw 'Delivery manifest is invalid.' }
    $configFile = Join-Path $pilotAbsolute 'pilot-install.json'
    if (-not $InstallDirectory -and (Test-Path -LiteralPath $configFile)) {
        $InstallDirectory = (Get-Content -LiteralPath $configFile -Raw -Encoding UTF8 | ConvertFrom-Json).installDirectory
    }
    if (-not $InstallDirectory) {
        if ($ValidateOnly) { throw 'Installation directory is required for validation.' }
        Add-Type -AssemblyName System.Windows.Forms
        $picker = New-Object System.Windows.Forms.OpenFileDialog
        $picker.Title = 'Select the installed Geo Media Publisher.exe for R1.15-I'
        $picker.Filter = 'Geo Media Publisher|Geo Media Publisher.exe'
        if ($picker.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { throw 'No software selected. Pilot did not start.' }
        $InstallDirectory = [IO.Path]::GetDirectoryName($picker.FileName)
        $picker.Dispose()
    }
    $installAbsolute = [IO.Path]::GetFullPath($InstallDirectory)
    $executable = Join-Path $installAbsolute 'Geo Media Publisher.exe'
    $archive = Join-Path $installAbsolute 'resources\app.asar'
    if (-not (Test-Path -LiteralPath $executable -PathType Leaf) -or -not (Test-Path -LiteralPath $archive -PathType Leaf)) { throw 'Installed application resources are incomplete.' }
    $algorithm = [Security.Cryptography.SHA256]::Create()
    $stream = [IO.File]::OpenRead($archive)
    try { $archiveDigest = [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
    finally { $stream.Dispose(); $algorithm.Dispose() }
    if ($archiveDigest -ne $manifest.appAsarSha256) { throw 'Software does not match this I delivery. Refusing to open any data.' }
    foreach ($grant in @('b01-acceptance.json', 'r115-d-sprint-acceptance.json', 'r115-c-official-api-acceptance.json')) {
        if (Test-Path -LiteralPath (Join-Path $installAbsolute ('resources\' + $grant))) { throw 'Experimental acceptance grant found. Pilot did not start.' }
    }
    if ($ValidateOnly) {
        [pscustomobject]@{ status = 'PASS'; deliveryId = $manifest.deliveryId; profile = $profile; softwareMatched = $true; launchPerformed = $false } | ConvertTo-Json -Compress
        exit 0
    }
    New-Item -ItemType Directory -Path $profile -Force | Out-Null
    @{ installDirectory = $installAbsolute } | ConvertTo-Json | Set-Content -LiteralPath $configFile -Encoding UTF8
    foreach ($key in [Environment]::GetEnvironmentVariables('Process').Keys) {
        if ($key -match 'ACCEPTANCE|BENCHMARK|NATIVE_SUBMIT|^ELECTRON_RUN_AS_NODE$|^ELECTRON_RENDERER_URL$') { [Environment]::SetEnvironmentVariable($key, $null, 'Process') }
    }
    $env:GMP_B01_ISOLATED_USER_DATA_DIR = $profile
    $env:PUBLISHER_DATA_MODE = 'production'
    $env:PUBLISHER_ENV = 'production'
    Write-Host ('R1.15-I department pilot. New pilot profile: ' + $profile)
    Write-Host 'Existing production data is separate. Confirm R1.15-I in Settings.'
    Start-Process -FilePath $executable -WorkingDirectory $installAbsolute -WindowStyle Normal | Out-Null
    exit 0
} catch {
    Write-Error ('PILOT NOT STARTED: ' + $_.Exception.Message) -ErrorAction Continue
    exit 1
}
