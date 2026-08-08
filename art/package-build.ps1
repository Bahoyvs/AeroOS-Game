<#
    Package dist/ into the zip that gets uploaded to CrazyGames.

        npm run check
        powershell -ExecutionPolicy Bypass -File art/package-build.ps1

    Two things this exists to get right, both of which are silent failures that
    only show up after the upload has been reviewed:

    1. It REPLACES the package folder rather than copying over the top of it.
       Vite hashes asset filenames, so copying `dist/` onto a previous package
       leaves every superseded bundle behind: dead weight in the zip, and a
       file count that climbs every release.

    2. It writes entry paths with forward slashes. Windows PowerShell's own
       `Compress-Archive` writes them with backslashes, which is not what the
       ZIP spec says (APPNOTE 4.4.17.1) and which extractors on Linux read as a
       literal filename rather than a folder. The game is then served with its
       assets flattened into the root and 404s on every one of them.

    It also refuses to package a build that references an absolute asset path,
    since that is an automatic rejection and CrazyGames serves the game from a
    subdirectory.
#>
[CmdletBinding()]
param(
  [string] $Dist = 'dist',
  [string] $Name = 'aeroos-crazygames-build'
)

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

if (-not (Test-Path (Join-Path $Dist 'index.html'))) {
  throw "No $Dist/index.html - run 'npm run build' first."
}

# --- 1. refuse an unshippable build -----------------------------------------

$html = Get-Content (Join-Path $Dist 'index.html') -Raw
foreach ($m in [regex]::Matches($html, '(?:src|href)="(/[^/][^"]*)"')) {
  throw "index.html references an absolute path: $($m.Groups[1].Value)"
}
foreach ($css in Get-ChildItem $Dist -Recurse -Filter '*.css') {
  $text = Get-Content $css.FullName -Raw
  if ($text -match 'url\(\s*/[^/]') {
    throw "$($css.Name) contains an absolute url() - set base:'./' in vite.config.js"
  }
}

# --- 2. replace the package folder ------------------------------------------

if (Test-Path $Name) { [System.IO.Directory]::Delete((Resolve-Path $Name), $true) }
Copy-Item $Dist $Name -Recurse

# --- 3. write the zip with spec-correct entry names -------------------------

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$sep     = [char]92   # the Windows separator, without spelling it in a string
$root    = (Resolve-Path $Name).Path
$zipPath = Join-Path (Get-Location) "$Name.zip"

# 'Create' truncates an existing file, so the old zip needs no explicit delete.
$fs  = [System.IO.File]::Open($zipPath, 'Create')
$zip = New-Object System.IO.Compression.ZipArchive($fs, 'Create')
try {
  foreach ($f in Get-ChildItem $root -Recurse -File | Sort-Object FullName) {
    $entryName = ($f.FullName.Substring($root.Length + 1).Split($sep)) -join '/'
    $entry = $zip.CreateEntry($entryName, [System.IO.Compression.CompressionLevel]::Optimal)
    $out = $entry.Open()
    try {
      $bytes = [System.IO.File]::ReadAllBytes($f.FullName)
      $out.Write($bytes, 0, $bytes.Length)
    } finally { $out.Dispose() }
  }
} finally {
  $zip.Dispose()
  $fs.Dispose()
}

# --- 4. report what is going to be uploaded ---------------------------------

$check = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
try {
  $count = $check.Entries.Count
  $bad   = @($check.Entries | Where-Object { $_.FullName.Contains($sep) }).Count
  $hasIndex = @($check.Entries | Where-Object { $_.FullName -eq 'index.html' }).Count -eq 1
} finally { $check.Dispose() }

if ($bad -gt 0)   { throw "$bad zip entries used the wrong path separator." }
if (-not $hasIndex) { throw 'index.html is not at the root of the archive.' }

$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
$size    = (Get-Item $zipPath).Length

Write-Output "AeroOS v$version"
Write-Output ("  {0}.zip  {1:N0} bytes  {2} files" -f $Name, $size, $count)
Write-Output '  index.html at archive root, forward-slash entries, no absolute paths.'
