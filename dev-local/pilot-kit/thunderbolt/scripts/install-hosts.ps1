#Requires -Version 5.1
# Client-machine prep (Windows): point the pilot's host names at the pilot host's
# IP in the hosts file, because there is no DNS on the objekt.
#
# Why this is not optional on the desktop client: the installed Volt build has its
# backend address BAKED IN at build time (one build for every customer), and the
# TLS certificate is issued for that same name — so the client cannot be pointed
# at a bare IP. The name has to resolve locally. The same applies to voltd's wss://
# endpoint and Keycloak, which ride the same name on their own ports.
#
# Run from an elevated PowerShell, once per client machine, next to
# certs\install-ca.ps1 (which installs the CA root — both are needed: the name
# must resolve AND the certificate must be trusted).
#
# Usage:
#   scripts\install-hosts.ps1 -Ip 10.20.30.40 -Names backend.volt.oktaplus.ru
#   scripts\install-hosts.ps1 -Ip 10.20.30.40 -Names backend.volt.oktaplus.ru,volt.pilot.local
#   scripts\install-hosts.ps1 -Ip 10.20.30.40 -Names ... -Remove
param(
    [Parameter(Mandatory = $true)] [string]$Ip,
    [Parameter(Mandatory = $true)] [string[]]$Names,
    [switch]$Remove,
    # Exists so the rewrite logic can be exercised against a fixture instead of the
    # real file; the elevation check and the DNS flush apply to the real one only.
    [string]$HostsPath
)
$ErrorActionPreference = "Stop"

$systemHosts = Join-Path $env:SystemRoot "System32\drivers\etc\hosts"
$hostsPath = if ($HostsPath) { $HostsPath } else { $systemHosts }
$isSystemHosts = ($hostsPath -eq $systemHosts)

if ($isSystemHosts) {
    $admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $admin) {
        Write-Error "Run this from an elevated PowerShell — the hosts file is not writable otherwise."
        exit 1
    }
}

if (-not [System.Net.IPAddress]::TryParse($Ip, [ref]$null)) {
    Write-Error "-Ip must be a literal IP address, not a name (that is the whole point: there is no DNS)."
    exit 1
}
$marker = "# volt-pilot"
$lines = @(Get-Content -LiteralPath $hostsPath)

# Drop any line this script wrote before, and any line that maps one of these
# names, so a re-run after the IP changes replaces rather than appends. A stale
# duplicate wins or loses unpredictably depending on order — never leave one.
$kept = $lines | Where-Object {
    $line = $_
    if ($line -match [regex]::Escape($marker)) { return $false }
    $fields = ($line -replace '#.*$', '').Trim() -split '\s+'
    if ($fields.Count -lt 2) { return $true }
    -not ($Names | Where-Object { $fields[1..($fields.Count - 1)] -contains $_ })
}

$out = $kept
if (-not $Remove) { $out += "$Ip`t$($Names -join ' ')`t$marker" }

Set-Content -LiteralPath $hostsPath -Value $out -Encoding ASCII
if ($isSystemHosts) { ipconfig /flushdns | Out-Null }

if ($Remove) {
    Write-Host "Removed the pilot hosts entry for: $($Names -join ', ')"
} else {
    Write-Host "Mapped $($Names -join ', ') -> $Ip in $hostsPath."
    if ($isSystemHosts) {
        Write-Host "Flushed the resolver cache."
        foreach ($n in $Names) {
            $resolved = try { [System.Net.Dns]::GetHostAddresses($n)[0].IPAddressToString } catch { "FAILED" }
            Write-Host ("  {0,-34} -> {1}" -f $n, $resolved)
        }
    }
    Write-Host "If Volt is already running, restart it: WebView2 caches resolution per process."
}
