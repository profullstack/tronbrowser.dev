# w3bs:// on Windows. Two jobs:
#
#   tron-w3bs.ps1 -Register   point HKCU\Software\Classes\w3bs at this script
#   tron-w3bs.ps1 <uri>       open a W3BS URI through the w3bs.org resolver
#
# The OS runs this script, not tronbrowser.cmd, for a w3bs:// link: a URI from
# a web page must never be parsed by cmd.exe, where & and % mean something.
# tronbrowser.cmd runs -Register in the background on every start, so scoop,
# choco, winget and the ZIP all register, and an upgrade that moved the files
# re-points the handler. A handler someone else registered is left alone.
param(
  [Parameter(Position = 0)][string]$Uri = '',
  [switch]$Register
)
$ErrorActionPreference = 'Stop'
$script = $MyInvocation.MyCommand.Path
$here = Split-Path -Parent $script
$key = 'HKCU:\Software\Classes\w3bs'

if ($Register) {
  $ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $command = '"{0}" -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "{1}" "%1"' -f $ps, $script
  $current = $null
  if (Test-Path "$key\shell\open\command") {
    $current = (Get-Item "$key\shell\open\command").GetValue('')
  }
  if ($current -eq $command) { exit 0 }
  if ($current -and $current -notmatch 'tron-w3bs\.ps1') { exit 0 }
  New-Item -Path "$key\shell\open\command" -Force | Out-Null
  Set-Item -Path $key -Value 'URL:W3BS resource'
  New-ItemProperty -Path $key -Name 'URL Protocol' -Value '' -PropertyType String -Force | Out-Null
  Set-Item -Path "$key\shell\open\command" -Value $command
  exit 0
}

$gateway = if ($env:TRONBROWSER_W3BS_GATEWAY) { $env:TRONBROWSER_W3BS_GATEWAY } else { 'https://w3bs.org/browse?q=' }
$u = $Uri.Trim()
# W3BS-URI-1 identifiers are lowercase letters, digits, - . / @ and the scheme:
# nothing a query string or cmd.exe needs escaped, so a well-formed one goes
# through as written. Anything else opens the resolver without it rather than
# smuggling % or & into the command line below.
if ($u -match '^(?i)w3bs://[a-z0-9][a-z0-9./@-]{0,500}$') {
  $url = $gateway + $u
} else {
  $url = $gateway -replace '\?q=$', ''
}
& (Join-Path $here 'tronbrowser.cmd') $url
exit $LASTEXITCODE
