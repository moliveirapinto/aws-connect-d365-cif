$ErrorActionPreference = 'Stop'
$org = 'orgcf0d9f1f.crm.dynamics.com'
$ip = '52.226.175.58'
$token = az account get-access-token --resource "https://$org" --subscription "ACS AMEX CC Corp" --query accessToken -o tsv
$hdr = @{ Authorization = "Bearer $token"; 'OData-MaxVersion' = '4.0'; 'OData-Version' = '4.0'; 'Content-Type' = 'application/json' }

# Find Active test conversations (subject starts with the synthetic ANI)
$q = "msdyn_ocliveworkitems?`$select=activityid,subject,statuscode&`$filter=statuscode eq 1 and startswith(subject,'%2B15551234567')&`$top=50"
$url = "https://$org/api/data/v9.2/$q"
$resp = curl.exe -s -4 --resolve "${org}:443:$ip" -H "Authorization: Bearer $token" -H "OData-MaxVersion: 4.0" -H "OData-Version: 4.0" -H "Accept: application/json" "$url"
$items = ($resp | ConvertFrom-Json).value
Write-Host "Found $($items.Count) active test conversations to close"

foreach ($it in $items) {
    $id = $it.activityid
    $body = '{"statecode":1,"statuscode":4}'
    $patchUrl = "https://$org/api/data/v9.2/msdyn_ocliveworkitems($id)"
    $code = curl.exe -s -o NUL -w "%{http_code}" -4 --resolve "${org}:443:$ip" -X PATCH -H "Authorization: Bearer $token" -H "OData-MaxVersion: 4.0" -H "OData-Version: 4.0" -H "Content-Type: application/json" -d $body "$patchUrl"
    Write-Host "Close $id -> HTTP $code"
}
Write-Host "DONE"
