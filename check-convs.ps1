$ErrorActionPreference = 'Stop'
$tok = az account get-access-token --resource https://orgcf0d9f1f.crm.dynamics.com --subscription "ACS AMEX CC Corp" --query accessToken -o tsv
$ip = '52.226.175.58'
$u = 'https://orgcf0d9f1f.crm.dynamics.com/api/data/v9.2/msdyn_ocliveworkitems?$select=subject,createdon,statuscode&$orderby=createdon%20desc&$top=6'
$r = curl.exe -4 --resolve "orgcf0d9f1f.crm.dynamics.com:443:$ip" -s -H "Authorization: Bearer $tok" -H "Accept: application/json" $u | ConvertFrom-Json
$r.value | ForEach-Object { "{0} | {1} | status={2}" -f $_.createdon, $_.subject, $_.statuscode }
