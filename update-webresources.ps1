$ErrorActionPreference = 'Stop'
$base = 'C:\Users\maoliveira\dev\aws-connect-d365-cif\webresources'
$org  = 'https://orgcf0d9f1f.crm.dynamics.com'
$resolve = 'orgcf0d9f1f.crm.dynamics.com:443:52.226.175.58'
$hAuth = "Authorization: Bearer $($env:DVTOK)"
$idHtml = 'd34647b3-4b86-f111-ab0f-3833c5de5ec3'
$idJs   = '5c30a5b1-4b86-f111-ab0f-6045bddc4e77'

function Patch-WR($id, $file) {
  $b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($file))
  $body = @{ content = $b64 } | ConvertTo-Json -Compress
  $tmp = Join-Path $env:TEMP ("patch_" + $id + ".json")
  [IO.File]::WriteAllText($tmp, $body)
  $code = curl.exe -4 -s -o NUL -w "%{http_code}" --resolve $resolve -X PATCH -H $hAuth -H "Content-Type: application/json" --data "@$tmp" "$org/api/data/v9.2/webresourceset($id)"
  Write-Host "PATCH $id HTTP:$code"
}

Patch-WR $idHtml (Join-Path $base 'maulabs_awsconnect_softphone.html')
Patch-WR $idJs   (Join-Path $base 'maulabs_awsconnect_sidepane.js')

$pubXml = "<importexportxml><webresources><webresource>{$idHtml}</webresource><webresource>{$idJs}</webresource></webresources></importexportxml>"
$pubBody = @{ ParameterXml = $pubXml } | ConvertTo-Json -Compress
$tmpP = Join-Path $env:TEMP 'publish.json'
[IO.File]::WriteAllText($tmpP, $pubBody)
$pcode = curl.exe -4 -s -o NUL -w "%{http_code}" --resolve $resolve -X POST -H $hAuth -H "Content-Type: application/json" --data "@$tmpP" "$org/api/data/v9.2/PublishXml"
Write-Host "PublishXml HTTP:$pcode"
