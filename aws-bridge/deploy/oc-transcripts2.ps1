param([string]$Tok)
$ErrorActionPreference = 'Stop'
$sel = [uri]::EscapeDataString('$select')
$ord = [uri]::EscapeDataString('$orderby')
$top = [uri]::EscapeDataString('$top')
$flt = [uri]::EscapeDataString('$filter')
$base = 'https://orgcf0d9f1f.crm.dynamics.com/api/data/v9.2'

$since = (Get-Date).ToUniversalTime().AddMinutes(-40).ToString('yyyy-MM-ddTHH:mm:ssZ')
$fexpr = [uri]::EscapeDataString("createdon ge $since")
$u1 = "$base/conversationtranscripts?$sel=conversationtranscriptid,name,createdon,content&$flt=$fexpr&$ord=createdon%20desc&$top=10"
$r1 = curl.exe -4 -s --resolve orgcf0d9f1f.crm.dynamics.com:443:52.226.175.58 -H "Authorization: Bearer $Tok" -H "Accept: application/json" $u1
$rows = ($r1 | ConvertFrom-Json).value
Write-Host "count since $since = $($rows.Count)"
foreach ($row in $rows) {
  Write-Host "----"
  Write-Host "id=$($row.conversationtranscriptid) name=$($row.name) createdon=$($row.createdon)"
  $c = $row.content
  if ($c) {
    if ($c.Length -gt 1500) { $c = $c.Substring(0,1500) }
    if ($c -match 'DELAYTEST|DIAG-MARKER|refund|tax') { Write-Host "*** MATCH transcript content ***" }
    Write-Host $c
  }
}
