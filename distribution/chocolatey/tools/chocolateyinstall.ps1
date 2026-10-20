$ErrorActionPreference = 'Stop'
$toolsDir = "$(Split-Path -parent $MyInvocation.MyCommand.Definition)"

$packageArgs = @{
  packageName    = 'tronbrowser'
  unzipLocation  = $toolsDir
  url64bit       = 'https://github.com/profullstack/tronbrowser.dev/releases/download/v3.18.0/tronbrowser-win-x64.zip'
  checksum64     = '3c55d427ded61cfa955d19ce6d6fe7616000a041da6dcbcab21c29094f7d1a65'
  checksumType64 = 'sha256'
}
Install-ChocolateyZipPackage @packageArgs

# Expose `tron` on PATH via a shim.
$exe = Join-Path $toolsDir 'tronbrowser\tronbrowser.cmd'
Install-ChocolateyShortcut -ShortcutFilePath "$env:ChocolateyInstall\bin\tron.cmd" -TargetPath $exe 2>$null
