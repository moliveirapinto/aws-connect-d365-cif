param([string]$Tok)
$ErrorActionPreference = 'Stop'
$sel = [uri]::EscapeDataString('$select')
$ord = [uri]::EscapeDataString('$orderby')
$top = [uri]::EscapeDataString('$top')
$base = 'https://orgcf0d9f1f.crm.dynamics.com/api/data/v9.2'

Write-Host "=== recent conversationtranscript rows ==="
$u1 = "$base/conversationtranscripts?$sel=conversationtranscriptid,name,createdon&$ord=createdon%20desc&$top=8"
$r1 = curl.exe -4 -s --resolve orgcf0d9f1f.crm.dynamics.com:443:52.226.175.58 -H "Authorization: Bearer $Tok" -H "Accept: application/json" $u1
($r1 | ConvertFrom-Json).value | Format-Table conversationtranscriptid,name,createdon -Auto
