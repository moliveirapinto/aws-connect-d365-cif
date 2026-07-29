param([string]$Secret)
$ErrorActionPreference = 'Stop'
$base = 'https://directline.botframework.com/v3/directline'
$cid = 'IQ7qzqg7yUM5HVaYn01bGn-us'
$ht = @{ Authorization = "Bearer $Secret"; 'Content-Type' = 'application/json' }
$eoc = @{
  type = 'endOfConversation'; code = 'completedSuccessfully'
  from = @{ id = 'system:diag'; role = 'user' }
  channelData = @{ contactId = 'diag-contact'; source = 'amazon-connect' }
} | ConvertTo-Json -Depth 6
$r = Invoke-RestMethod -Method Post -Uri "$base/conversations/$cid/activities" -Headers $ht -Body $eoc
Write-Host "posted endOfConversation, id=$($r.id)"
