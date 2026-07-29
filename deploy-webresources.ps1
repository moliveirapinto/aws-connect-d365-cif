$ErrorActionPreference = 'Stop'
$base = 'C:\Users\maoliveira\dev\aws-connect-d365-cif\webresources'
$org  = 'https://orgcf0d9f1f.crm.dynamics.com'
$resolve = 'orgcf0d9f1f.crm.dynamics.com:443:52.226.175.58'
$tok = $env:DVTOK

function New-WR($name, $display, $type, $file) {
  $bytes = [IO.File]::ReadAllBytes($file)
  $b64 = [Convert]::ToBase64String($bytes)
  $body = @{ name = $name; displayname = $display; webresourcetype = $type; content = $b64 } | ConvertTo-Json -Compress
  $tmp = Join-Path $env:TEMP ("wr_" + [IO.Path]::GetFileNameWithoutExtension($name) + ".json")
  [IO.File]::WriteAllText($tmp, $body)
  Write-Host "===== POST $name ====="
  $out = curl.exe -4 -s -w "`nHTTP:%{http_code}`n" --resolve $resolve -X POST -H "Authorization: Bearer $tok" -H "Content-Type: application/json" -H "OData-Version: 4.0" -H "Prefer: return=representation" --data "@$tmp" "$org/api/data/v9.2/webresourceset"
  $out | Out-String | Write-Host
}

New-WR 'maulabs_awsconnect_softphone.html' 'AWS Connect Softphone Host' 1 (Join-Path $base 'maulabs_awsconnect_softphone.html')
New-WR 'maulabs_awsconnect_sidepane.js' 'AWS Connect Side Pane Opener' 3 (Join-Path $base 'maulabs_awsconnect_sidepane.js')
