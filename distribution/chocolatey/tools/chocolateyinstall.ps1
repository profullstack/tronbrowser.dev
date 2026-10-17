$ErrorActionPreference = 'Stop'
$toolsDir = "$(Split-Path -parent $MyInvocation.MyCommand.Definition)"

$packageArgs = @{
  packageName    = 'tronbrowser'
  unzipLocation  = $toolsDir
  url64bit       = 'https://github.com/profullstack/tronbrowser.dev/releases/download/v3.17.0/tronbrowser-win-x64.zip'
  checksum64     = 'af66615492edd9ad18205fccbd35edad336194193ada06d7d80b3d7a14ac9321'
  checksumType64 = 'sha256'
}
Install-ChocolateyZipPackage @packageArgs

# Expose `tron` on PATH via a shim.
$exe = Join-Path $toolsDir 'tronbrowser\tronbrowser.cmd'
Install-ChocolateyShortcut -ShortcutFilePath "$env:ChocolateyInstall\bin\tron.cmd" -TargetPath $exe 2>$null
