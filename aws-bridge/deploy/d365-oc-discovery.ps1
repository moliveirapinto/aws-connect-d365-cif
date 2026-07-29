# D365 Omnichannel discovery for the create-at-accept feature.
# Read-only. Finds the agent's systemuserid + inspects workstream/queue/routing.
$ErrorActionPreference = 'Stop'
$org = 'orgcf0d9f1f.crm.dynamics.com'

Write-Host '=== token ==='
$tok = az account get-access-token --resource "https://$org" --query accessToken -o tsv
if (-not $tok) { throw 'no token' }
Write-Host ("token len=" + $tok.Length)

# Resolve current IP to dodge DNS flapping, then pin via --resolve.
$ip = $null
try { $ip = ([System.Net.Dns]::GetHostAddresses($org) | Where-Object { $_.AddressFamily -eq 'InterNetwork' } | Select-Object -First 1).IPAddressToString } catch {}
if (-not $ip) { $ip = '52.226.175.58' }
Write-Host "ip=$ip"
$resolve = "${org}:443:$ip"
$base = "https://$org/api/data/v9.2"
$H = @("Authorization: Bearer $tok", 'Accept: application/json', 'OData-MaxVersion: 4.0', 'OData-Version: 4.0')

function DvGet($path) {
  $url = "$base/$path"
  $args = @('-4','-s','--resolve',$resolve)
  foreach ($h in $H) { $args += @('-H',$h) }
  $args += $url
  $raw = & curl.exe @args
  return $raw
}

Write-Host "`n=== WhoAmI ==="
DvGet 'WhoAmI'

Write-Host "`n=== systemuser mauricio (by domainname contains mauricio) ==="
DvGet ("systemusers?" + [uri]::EscapeDataString('$select') + '=systemuserid,fullname,domainname,internalemailaddress,isdisabled&' + [uri]::EscapeDataString('$filter') + '=' + [uri]::EscapeDataString("contains(domainname,'mauricio')"))

Write-Host "`n=== live workstreams ==="
DvGet ("msdyn_liveworkstreams?" + [uri]::EscapeDataString('$select') + '=msdyn_liveworkstreamid,msdyn_name,msdyn_streamsource,msdyn_mode')

Write-Host "`n=== queues (msdyn_ocliveworkstreams / queues) ==="
DvGet ("queues?" + [uri]::EscapeDataString('$select') + '=queueid,name,queuetypecode,queueviewtype&' + [uri]::EscapeDataString('$top') + '=50')
