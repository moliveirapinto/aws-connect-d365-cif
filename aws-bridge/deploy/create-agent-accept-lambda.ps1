$ErrorActionPreference = 'Stop'
$region = 'us-east-1'
$src = 'aws-connect-d365-bridge-kvs-notify'
$new = 'aws-connect-d365-bridge-agent-accept-notify'
Set-Location 'c:\Users\maoliveira\dev\aws-connect-d365-cif\aws-bridge'

# Reuse the kvs-notify role + env (CONSUMER_URL + SESSION_KEY are identical).
$cfg = aws lambda get-function-configuration --function-name $src --region $region | ConvertFrom-Json
$role = $cfg.Role
$runtime = $cfg.Runtime
$arch = $cfg.Architectures[0]
$envObj = @{ Variables = @{} }
foreach ($p in $cfg.Environment.Variables.PSObject.Properties) { $envObj.Variables[$p.Name] = $p.Value }
$envPath = Join-Path $env:TEMP 'agent-accept-env.json'
($envObj | ConvertTo-Json -Compress) | Set-Content -Path $envPath -Encoding ascii -NoNewline

# Zip the bundle (mjs at archive root).
$zip = 'dist-lambda\agentAcceptNotify.zip'
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path 'dist-lambda\agentAcceptNotify.mjs' -DestinationPath $zip -Force

Write-Host "role=$role runtime=$runtime arch=$arch"

$exists = $true
try { aws lambda get-function --function-name $new --region $region 2>$null | Out-Null } catch { $exists = $false }

if ($exists) {
  Write-Host 'Updating existing function code...'
  aws lambda update-function-code --function-name $new --region $region --zip-file "fileb://$zip" | Out-Null
} else {
  Write-Host 'Creating function...'
  aws lambda create-function --function-name $new --region $region `
    --runtime $runtime --architectures $arch --role $role `
    --handler 'agentAcceptNotify.handler' --timeout 30 --memory-size 256 `
    --zip-file "fileb://$zip" --environment "file://$envPath" | Out-Null
  aws lambda add-permission --function-name $new --region $region `
    --statement-id connect-invoke --action 'lambda:InvokeFunction' `
    --principal 'connect.amazonaws.com' | Out-Null
}

Remove-Item $envPath -Force
$arn = (aws lambda get-function-configuration --function-name $new --region $region --query FunctionArn --output text)
Write-Host "DONE ARN=$arn"
