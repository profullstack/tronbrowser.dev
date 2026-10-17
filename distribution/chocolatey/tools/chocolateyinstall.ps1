$ErrorActionPreference = 'Stop'
$toolsDir = "$(Split-Path -parent $MyInvocation.MyCommand.Definition)"

$packageArgs = @{
  packageName    = 'tronbrowser'
  unzipLocation  = $toolsDir
  url64bit       = 'https://github.com/profullstack/tronbrowser.dev/releases/download/v3.17.1/tronbrowser-win-x64.zip'
  checksum64     = '229a06b97e4cfc45fd4b8d87035d7e694b2e471ee59af060799b58d1cc29c31a'
  checksumType64 = 'sha256'
}
Install-ChocolateyZipPackage @packageArgs

# Expose `tron` on PATH via a shim.
$exe = Join-Path $toolsDir 'tronbrowser\tronbrowser.cmd'
Install-ChocolateyShortcut -ShortcutFilePath "$env:ChocolateyInstall\bin\tron.cmd" -TargetPath $exe 2>$null
