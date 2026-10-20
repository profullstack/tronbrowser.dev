$ErrorActionPreference = 'Stop'
$toolsDir = "$(Split-Path -parent $MyInvocation.MyCommand.Definition)"

$packageArgs = @{
  packageName    = 'tronbrowser'
  unzipLocation  = $toolsDir
  url64bit       = 'https://github.com/profullstack/tronbrowser.dev/releases/download/v3.19.4/tronbrowser-win-x64.zip'
  checksum64     = '4d00b55abdd8cd166e16311e8ab8f71c18c2ef660cd7cfd07165901dae775888'
  checksumType64 = 'sha256'
}
Install-ChocolateyZipPackage @packageArgs

# Expose `tron` on PATH via a shim.
$exe = Join-Path $toolsDir 'tronbrowser\tronbrowser.cmd'
Install-ChocolateyShortcut -ShortcutFilePath "$env:ChocolateyInstall\bin\tron.cmd" -TargetPath $exe 2>$null
