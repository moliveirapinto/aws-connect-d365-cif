# Dataverse query helper for orgcf0d9f1f (gbbrcg tenant).
# Pins IPv4 to bypass the flapping local resolver. Usage:
#   ./dv.ps1 "msdyn_liveworkstreams?`$select=msdyn_name&`$top=50"
param([Parameter(Mandatory=$true)][string]$Path)
$org = "https://orgcf0d9f1f.crm.dynamics.com"
$ip  = "52.226.175.58"
$tok = az account get-access-token --resource $org --query accessToken -o tsv 2>$null
if (-not $tok) { Write-Error "No token. Run: az account set --subscription 'ACS AMEX CC Corp'"; exit 1 }
curl.exe -4 -s --resolve "orgcf0d9f1f.crm.dynamics.com:443:$ip" `
  -H "Authorization: Bearer $tok" `
  -H "Accept: application/json" `
  -H "OData-MaxVersion: 4.0" `
  -H "OData-Version: 4.0" `
  -H "Prefer: odata.include-annotations=`"*`"" `
  "$org/api/data/v9.2/$Path"
