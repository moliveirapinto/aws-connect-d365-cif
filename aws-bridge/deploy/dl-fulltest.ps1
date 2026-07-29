param([string]$Secret)
$ErrorActionPreference = 'Stop'
$base = 'https://directline.botframework.com/v3/directline'
$h = @{ Authorization = "Bearer $Secret" }
$marker = "DELAYTEST-" + (Get-Date -Format 'HHmmss')
Write-Host "MARKER=$marker"

$conv = Invoke-RestMethod -Method Post -Uri "$base/conversations" -Headers $h
$cid = $conv.conversationId; $tok = $conv.token
Write-Host "conversationId=$cid"
$ht = @{ Authorization = "Bearer $tok"; 'Content-Type' = 'application/json' }

$cd = @{
  channelType = '8e0f940e-3a86-f111-ab0f-6045bddc4e77'
  source = 'amazon-connect'; contactId = "$marker"; ani = '+14167792856'
  customercontext = @{ phonenumber = '+14167792856' }
  conversationcontext = @{ source = 'AmazonConnect'; contactId = "$marker" }
}
$ctx = @{ type='event'; name='connect/context'; from=@{id="system:$marker";name='+14167792856';role='user'}; channelData=$cd } | ConvertTo-Json -Depth 8
Invoke-RestMethod -Method Post -Uri "$base/conversations/$cid/activities" -Headers $ht -Body $ctx | Out-Null
Start-Sleep -Seconds 3

$m1 = @{ type='message'; text="$marker CUSTOMER: hi I need help with my tax refund status"; from=@{id="customer:$marker";name='Customer';role='user'}; channelData=$cd } | ConvertTo-Json -Depth 8
Invoke-RestMethod -Method Post -Uri "$base/conversations/$cid/activities" -Headers $ht -Body $m1 | Out-Null
Start-Sleep -Seconds 2
$m2 = @{ type='message'; text="$marker AGENT: sure, your refund is scheduled for next week"; from=@{id="agent:$marker";name='Agent';role='user'}; channelData=$cd } | ConvertTo-Json -Depth 8
Invoke-RestMethod -Method Post -Uri "$base/conversations/$cid/activities" -Headers $ht -Body $m2 | Out-Null
Write-Host "posted 2 messages; waiting 12s for OC ingestion before close..."
Start-Sleep -Seconds 12

$eoc = @{ type='endOfConversation'; code='completedSuccessfully'; from=@{id="system:$marker";role='user'}; channelData=@{contactId="$marker";source='amazon-connect'} } | ConvertTo-Json -Depth 6
Invoke-RestMethod -Method Post -Uri "$base/conversations/$cid/activities" -Headers $ht -Body $eoc | Out-Null
Write-Host "posted endOfConversation (after delay). MARKER=$marker"
