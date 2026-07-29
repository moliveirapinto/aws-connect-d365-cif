param([string]$Tok)
$ErrorActionPreference = 'Stop'
$sel = [uri]::EscapeDataString('$select')
$ord = [uri]::EscapeDataString('$orderby')
$top = [uri]::EscapeDataString('$top')
$url = "https://orgcf0d9f1f.crm.dynamics.com/api/data/v9.2/msdyn_ocliveworkitems?$sel=activityid,statuscode,createdon&$ord=createdon%20desc&$top=6"
$raw = curl.exe -4 -s --resolve orgcf0d9f1f.crm.dynamics.com:443:52.226.175.58 -H "Authorization: Bearer $Tok" -H "Accept: application/json" $url
Write-Host "LEN=$($raw.Length)"
($raw | ConvertFrom-Json).value | Format-Table activityid,statuscode,createdon -Auto
