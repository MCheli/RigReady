<#
.SYNOPSIS
Checks a signed RigReady installer the way the installed app will check its next update.

.DESCRIPTION
Run by the Release workflow after a signed build (docs/RELEASING.md, "Code signing"), or by hand
on the installer of a draft release:

  pwsh scripts/verify-signed-installer.ps1 -Installer release\RigReady-Setup-2.0.1.exe -Publisher "<name on the certificate>"

The installer is verified with signtool (verify /pa /v) and with Get-AuthenticodeSignature: the
status must be Valid and the certificate's subject must be the publisher, decided exactly as
electron-updater decides it (windowsExecutableCodeSignatureVerifier.js: a publisher without "="
must equal the subject's CN; a full distinguished name is compared key by key). The installer is
then run silently into a temporary folder (/S /D=<folder>), RigReady.exe and "Uninstall
RigReady.exe" there are verified the same way, resources\app-update.yml there must name the
publisher, and the uninstaller is run silently and waited for.

The installer is the real RigReady: it writes the per-user uninstall entry and shortcuts of
RigReady for the account that runs this, and the uninstaller removes them. So the install part
refuses to run where RigReady is already installed for this account; -SignaturesOnly checks the
installer's signature and nothing more, and is what to use on a PC that has RigReady.

Exits with 1 and a message on the first thing that is not right.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)] [string] $Installer,
  [Parameter(Mandatory = $true)] [string] $Publisher,
  [switch] $SignaturesOnly
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Write-Step([string] $Message) {
  Write-Host "verify-signed-installer: $Message"
}

<#
A port of electron-updater's parseDn (builder-util-runtime/out/rfc2253Parser.js), so this script
accepts a certificate subject exactly when the installed app's updater will.
#>
function ConvertFrom-Dn([string] $Sequence) {
  $result = New-Object 'System.Collections.Generic.Dictionary[string,string]'
  $seq = $Sequence.Trim()
  $quoted = $false
  $key = $null
  $token = ''
  $nextNonSpace = 0
  $i = 0
  while ($i -le $seq.Length) {
    if ($i -eq $seq.Length) {
      if ($null -ne $key) { $result[$key] = $token }
      break
    }
    $ch = $seq[$i]
    if ($quoted) {
      if ($ch -eq '"') { $quoted = $false; $i++; continue }
    } else {
      if ($ch -eq '"') { $quoted = $true; $i++; continue }
      if ($ch -eq '\') {
        $i++
        $ord = 0
        $hex = if ($i + 2 -le $seq.Length) { $seq.Substring($i, 2) } else { '' }
        if ($hex.Length -eq 2 -and [int]::TryParse($hex, [System.Globalization.NumberStyles]::HexNumber, $null, [ref] $ord)) {
          $token += [char] $ord
          $i += 2
        } else {
          if ($i -lt $seq.Length) { $token += $seq[$i] }
          $i++
        }
        continue
      }
      if ($null -eq $key -and $ch -eq '=') { $key = $token; $token = ''; $i++; continue }
      if ($ch -eq ',' -or $ch -eq ';' -or $ch -eq '+') {
        if ($null -ne $key) { $result[$key] = $token }
        $key = $null
        $token = ''
        $i++
        continue
      }
    }
    if ($ch -eq ' ' -and -not $quoted) {
      if ($token.Length -eq 0) { $i++; continue }
      if ($i -gt $nextNonSpace) {
        $j = $i
        while ($j -lt $seq.Length -and $seq[$j] -eq ' ') { $j++ }
        $nextNonSpace = $j
      }
      if ($nextNonSpace -ge $seq.Length -or
          $seq[$nextNonSpace] -eq ',' -or
          $seq[$nextNonSpace] -eq ';' -or
          ($null -eq $key -and $seq[$nextNonSpace] -eq '=') -or
          ($null -ne $key -and $seq[$nextNonSpace] -eq '+')) {
        $i = $nextNonSpace
        continue
      }
    }
    $token += $ch
    $i++
  }
  return $result
}

<# True when the subject is the publisher by electron-updater's rule. #>
function Test-Publisher([string] $Subject, [string] $Name) {
  $subjectDn = ConvertFrom-Dn $Subject
  $nameDn = ConvertFrom-Dn $Name
  if ($nameDn.Count -gt 0) {
    foreach ($key in $nameDn.Keys) {
      if (-not $subjectDn.ContainsKey($key) -or $subjectDn[$key] -cne $nameDn[$key]) { return $false }
    }
    return $true
  }
  return $subjectDn.ContainsKey('CN') -and $subjectDn['CN'] -ceq $Name
}

<# The newest signtool of the installed Windows SDKs. #>
function Find-SignTool {
  $programFiles = [Environment]::GetEnvironmentVariable('ProgramFiles(x86)')
  if (-not $programFiles) { $programFiles = 'C:\Program Files (x86)' }
  $pattern = Join-Path $programFiles 'Windows Kits\10\bin\*\x64\signtool.exe'
  $found = @(Get-ChildItem -Path $pattern -ErrorAction SilentlyContinue | Sort-Object {
      $version = [version] '0.0'
      [void] [version]::TryParse($_.Directory.Parent.Name, [ref] $version)
      $version
    } -Descending)
  if ($found.Count -eq 0) { throw "no signtool.exe under $pattern (install the Windows SDK)" }
  return $found[0].FullName
}

function Test-Signature([string] $SignTool, [string] $File, [string] $What) {
  if (-not (Test-Path -LiteralPath $File)) { throw "$What is missing: $File" }
  Write-Step "signtool verify /pa /v on $What ($File)"
  & $SignTool verify /pa /v $File
  if ($LASTEXITCODE -ne 0) { throw "signtool could not verify $What ($File): exit code $LASTEXITCODE" }
  $signature = Get-AuthenticodeSignature -LiteralPath $File
  if ($signature.Status -ne 'Valid') {
    throw "$What has no valid signature: $($signature.Status), $($signature.StatusMessage)"
  }
  $subject = $signature.SignerCertificate.Subject
  if (-not (Test-Publisher $subject $Publisher)) {
    throw "$What is signed by `"$subject`", which is not the publisher `"$Publisher`" (the installed app would refuse it)"
  }
  Write-Step "$What is signed by $subject, valid"
}

function Wait-Until([string] $What, [scriptblock] $Condition, [int] $Seconds) {
  $until = (Get-Date).AddSeconds($Seconds)
  while (-not (& $Condition)) {
    if ((Get-Date) -gt $until) { throw "timed out after $Seconds s waiting for $What" }
    Start-Sleep -Milliseconds 500
  }
}

<# A RigReady installed for this account (its uninstall entry), which the test install would overwrite. #>
function Test-RigReadyInstalled {
  $uninstall = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall'
  if (-not (Test-Path $uninstall)) { return $false }
  foreach ($key in Get-ChildItem $uninstall) {
    $name = (Get-ItemProperty -LiteralPath $key.PSPath -ErrorAction SilentlyContinue).PSObject.Properties['DisplayName']
    if ($null -ne $name -and [string] $name.Value -like 'RigReady *') { return $true }
  }
  return $false
}

$code = 0
$installDir = $null
$uninstaller = $null
try {
  $installerPath = (Resolve-Path -LiteralPath $Installer).Path
  $signTool = Find-SignTool
  Write-Step "using $signTool"
  Test-Signature $signTool $installerPath 'the installer'

  if ($SignaturesOnly) {
    Write-Step 'the installer is signed by the publisher (install skipped: -SignaturesOnly)'
  } else {
    if (Test-RigReadyInstalled) {
      throw 'RigReady is installed for this account; the test install would replace its uninstall entry and shortcuts. Run this on a PC without RigReady, or with -SignaturesOnly.'
    }
    $temp = [System.IO.Path]::GetTempPath()
    if ($temp -match '\s') {
      throw "the temp folder has a space in it ($temp); NSIS takes /D=<folder> unquoted, so set TEMP to a folder without one"
    }
    $installDir = Join-Path $temp ('rigready-verify-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
    $exe = Join-Path $installDir 'RigReady.exe'
    $uninstaller = Join-Path $installDir 'Uninstall RigReady.exe'

    Write-Step "installing silently into $installDir"
    $install = Start-Process -FilePath $installerPath -ArgumentList @('/S', "/D=$installDir") -Wait -PassThru
    if ($install.ExitCode -ne 0) { throw "the installer exited with $($install.ExitCode)" }
    Wait-Until 'the installed program' { Test-Path -LiteralPath $exe } 60

    Test-Signature $signTool $exe 'the installed RigReady.exe'
    Test-Signature $signTool $uninstaller 'the uninstaller'

    $feedFile = Join-Path $installDir 'resources\app-update.yml'
    if (-not (Test-Path -LiteralPath $feedFile)) { throw "$feedFile is missing" }
    $feed = Get-Content -LiteralPath $feedFile -Raw
    $named = [regex]::Match($feed, '(?m)^publisherName:[ \t]*(?:\[[ \t]*(.+?)[ \t]*\]|\r?\n[ \t]*-[ \t]*(.+?))[ \t]*\r?$')
    if (-not $named.Success) {
      throw "resources\app-update.yml of the install names no publisher: the installed app would not verify its updates"
    }
    $value = if ($named.Groups[1].Success) { $named.Groups[1].Value } else { $named.Groups[2].Value }
    $value = $value.Trim().Trim('"').Trim("'")
    if ($value -cne $Publisher) {
      throw "resources\app-update.yml of the install names the publisher `"$value`", not `"$Publisher`""
    }
    Write-Step "resources\app-update.yml names the publisher $value"
    Write-Step 'the installer, the installed program and the uninstaller are signed by the publisher'
  }
} catch {
  Write-Host "verify-signed-installer: $($_.Exception.Message)" -ForegroundColor Red
  $code = 1
} finally {
  if ($null -ne $uninstaller -and (Test-Path -LiteralPath $uninstaller)) {
    Write-Step "uninstalling silently from $installDir"
    try {
      # The uninstaller hands over to a copy of itself in the temp folder, so its exit is not the end.
      Start-Process -FilePath $uninstaller -ArgumentList '/S' -Wait
      Wait-Until 'the uninstaller to remove the folder' { -not (Test-Path -LiteralPath $installDir) } 120
      Write-Step 'uninstalled'
    } catch {
      Write-Host "verify-signed-installer: the uninstall did not finish: $($_.Exception.Message)" -ForegroundColor Red
      $code = 1
    }
  }
}
exit $code
