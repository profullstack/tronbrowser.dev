$ErrorActionPreference = 'Stop'
$toolsDir = "$(Split-Path -parent $MyInvocation.MyCommand.Definition)"

$packageArgs = @{
  packageName    = 'tronbrowser'
  unzipLocation  = $toolsDir
  url64bit       = 'https://github.com/profullstack/tronbrowser.dev/releases/download/v3.19.2/tronbrowser-win-x64.zip'
  checksum64     = '79d16c29e59701d41d18fe9079cee77dfecca815ed72456e24f07fa84b5a0fc4'
  checksumType64 = 'sha256'
}
Install-ChocolateyZipPackage @packageArgs

# Expose `tron` on PATH via a shim.
$exe = Join-Path $toolsDir 'tronbrowser\tronbrowser.cmd'
Install-ChocolateyShortcut -ShortcutFilePath "$env:ChocolateyInstall\bin\tron.cmd" -TargetPath $exe 2>$null
