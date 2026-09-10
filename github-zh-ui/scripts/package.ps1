$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if ((Split-Path $projectRoot -Leaf) -ne 'github-zh-ui') {
    throw "Refusing to package unexpected directory: $projectRoot"
}

$sourcesPath = Join-Path $projectRoot 'generated\sources.json'
if (-not (Test-Path -LiteralPath $sourcesPath)) {
    throw 'generated/sources.json is missing. Run npm run update:sources first.'
}

$sources = Get-Content -LiteralPath $sourcesPath -Raw | ConvertFrom-Json
$generatedAt = [DateTimeOffset]::Parse($sources.generatedAt)
if (([DateTimeOffset]::UtcNow - $generatedAt).TotalHours -gt 24) {
    throw 'Source metadata is older than 24 hours. Run npm run update:sources first.'
}

$distDir = Join-Path $projectRoot 'dist'
$zipPath = Join-Path $distDir 'github-zh-ui-0.1.0.zip'
$unpackedDir = Join-Path $distDir 'github-zh-ui-0.1.0'
New-Item -ItemType Directory -Path $distDir -Force | Out-Null
if (Test-Path -LiteralPath $zipPath) {
    Remove-Item -LiteralPath $zipPath -Force
}

$resolvedDist = (Resolve-Path -LiteralPath $distDir).Path
if (Test-Path -LiteralPath $unpackedDir) {
    $resolvedUnpacked = (Resolve-Path -LiteralPath $unpackedDir).Path
    if (-not $resolvedUnpacked.StartsWith($resolvedDist + [IO.Path]::DirectorySeparatorChar) -or (Split-Path $resolvedUnpacked -Leaf) -ne 'github-zh-ui-0.1.0') {
        throw "Refusing to replace unexpected package directory: $resolvedUnpacked"
    }
    Remove-Item -LiteralPath $resolvedUnpacked -Recurse -Force
}

New-Item -ItemType Directory -Path $unpackedDir | Out-Null
New-Item -ItemType Directory -Path (Join-Path $unpackedDir 'generated') | Out-Null
Copy-Item -LiteralPath (Join-Path $projectRoot 'src') -Destination (Join-Path $unpackedDir 'src') -Recurse
Copy-Item -LiteralPath (Join-Path $projectRoot 'generated\dictionary.js') -Destination (Join-Path $unpackedDir 'generated\dictionary.js')
Copy-Item -LiteralPath (Join-Path $projectRoot 'generated\sources.json') -Destination (Join-Path $unpackedDir 'generated\sources.json')
foreach ($file in @('manifest.json', 'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md')) {
    Copy-Item -LiteralPath (Join-Path $projectRoot $file) -Destination (Join-Path $unpackedDir $file)
}

Compress-Archive -Path (Join-Path $unpackedDir '*') -DestinationPath $zipPath -CompressionLevel Optimal
Write-Output "Unpacked: $unpackedDir"
Write-Output "ZIP: $zipPath"
