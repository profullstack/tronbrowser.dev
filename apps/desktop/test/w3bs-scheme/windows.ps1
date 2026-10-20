# End to end on Windows: register w3bs:// the way tronbrowser.cmd does, ask the
# shell to open a W3BS URI (Start-Process, the same ShellExecute path a link
# from another app or the address bar takes), and check the engine was handed
# the w3bs.org resolver URL. The engine is a stub .cmd that records its argv.
# Writes HKCU\Software\Classes\w3bs; meant for a disposable CI runner.
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..')).Path
$w = Join-Path ([IO.Path]::GetTempPath()) ("tron-w3bs-" + [guid]::NewGuid())
New-Item -ItemType Directory -Force $w | Out-Null
Copy-Item (Join-Path $repo 'apps\desktop\launcher\tronbrowser.cmd') $w
Copy-Item (Join-Path $repo 'apps\desktop\launcher\tron-w3bs.ps1') $w
$argv = Join-Path $w 'argv.txt'
$stub = Join-Path $w 'stub-browser.cmd'
Set-Content -Encoding ascii $stub "@echo off`r`n>>`"%TB_ARGV%`" echo(%*`r`n"
$env:TRONBROWSER_BROWSER = $stub
$env:TRONBROWSER_DATA = Join-Path $w 'profile'
$env:TB_ARGV = $argv
$key = 'HKCU:\Software\Classes\w3bs'
$uri = 'w3bs://prompt/w3bs/research@1'
$want = 'https://w3bs.org/browse?q=w3bs://prompt/w3bs/research@1'
$ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'

function Wait-Argv([string]$expect, [string]$what) {
  for ($i = 0; $i -lt 60 -and -not (Test-Path $argv); $i++) { Start-Sleep -Seconds 1 }
  if (-not (Test-Path $argv)) { throw "FAIL ($what): the engine was never started" }
  Start-Sleep -Milliseconds 500
  $got = Get-Content -Raw $argv
  Remove-Item $argv
  if (-not $got.Contains($expect)) { throw "FAIL ($what): wanted $expect, engine got: $got" }
  Write-Host "ok ($what): $expect"
}
function Handler { if (Test-Path "$key\shell\open\command") { (Get-Item "$key\shell\open\command").GetValue('') } }

Remove-Item -Recurse -Force $key -ErrorAction SilentlyContinue

# A normal launch registers the scheme, in the background.
& cmd.exe /d /c "`"$w\tronbrowser.cmd`" https://example.invalid/"
Wait-Argv 'https://example.invalid/' 'plain launch'
for ($i = 0; $i -lt 60 -and -not (Handler); $i++) { Start-Sleep -Seconds 1 }
if ((Handler) -notlike "*$w\tron-w3bs.ps1*") { throw "FAIL: launch did not register w3bs (handler: $(Handler))" }
if ($null -eq (Get-Item $key).GetValue('URL Protocol')) { throw 'FAIL: no URL Protocol value' }
Write-Host "ok (register): $(Handler)"

# The shell hands a w3bs:// URI to TronBrowser.
Start-Process $uri
Wait-Argv $want 'Start-Process'

# `tron w3bs://...` from a terminal.
& cmd.exe /d /c "`"$w\tronbrowser.cmd`" $uri"
Wait-Argv $want 'tron w3bs://'

# A malformed URI with cmd.exe metacharacters opens the resolver without it.
$marker = Join-Path $w 'pwned.txt'
& $ps -NoProfile -ExecutionPolicy Bypass -File "$w\tron-w3bs.ps1" "w3bs://x&echo pwned>`"$marker`"&"
Wait-Argv 'https://w3bs.org/browse' 'hostile URI'
if (Test-Path $marker) { throw 'FAIL: a w3bs:// URI ran a command' }

# Someone else's handler is left alone.
Set-Item "$key\shell\open\command" -Value '"C:\Other\other.exe" "%1"'
& $ps -NoProfile -ExecutionPolicy Bypass -File "$w\tron-w3bs.ps1" -Register
if ((Handler) -ne '"C:\Other\other.exe" "%1"') { throw "FAIL: replaced another app's handler: $(Handler)" }
Write-Host 'ok (other handler kept)'

Remove-Item -Recurse -Force $key
Remove-Item -Recurse -Force $w -ErrorAction SilentlyContinue
Write-Host 'all w3bs:// Windows checks passed'
