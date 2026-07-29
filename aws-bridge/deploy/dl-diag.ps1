param([string]$Secret)
$ErrorActionPreference = 'Stop'
$base = 'https://directline.botframework.com/v3/directline'
$h = @{ Authorization = "Bearer $Secret" }
$marker = "DIAG-MARKER-" + (Get-Date -Format 'HHmmss')
Write-Host "MARKER=$marker"

# 1. Start conversation
$conv = Invoke-RestMethod -Method Post -Uri "$base/conversations" -Headers $h
$cid = $conv.conversationId
$tok = $conv.token
Write-Host "conversationId=$cid"
$ht = @{ Authorization = "Bearer $tok"; 'Content-Type' = 'application/json' }

# 2. Context event (routing + customer)
$ctx = @{
  type = 'event'; name = 'connect/context'
  from = @{ id = 'system:diag'; name = '+14167792856'; role = 'user' }
  channelData = @{
    channelType = '8e0f940e-3a86-f111-ab0f-6045bddc4e77'
    source = 'amazon-connect'; contactId = 'diag-contact'; ani = '+14167792856'
    customercontext = @{ phonenumber = '+14167792856' }
    conversationcontext = @{ source = 'AmazonConnect'; contactId = 'diag-contact' }
  }
} | ConvertTo-Json -Depth 8
Invoke-RestMethod -Method Post -Uri "$base/conversations/$cid/activities" -Headers $ht -Body $ctx | Out-Null
Write-Host "posted context event"

Start-Sleep -Seconds 2

# 3. Customer message with marker
$msg = @{
  type = 'message'; text = "$marker customer says hello I need help with my refund"
  from = @{ id = 'customer:diag'; name = 'Customer'; role = 'user' }
  channelData = @{
    channelType = '8e0f940e-3a86-f111-ab0f-6045bddc4e77'
    source = 'amazon-connect'; contactId = 'diag-contact'; ani = '+14167792856'
    customercontext = @{ phonenumber = '+14167792856' }
    conversationcontext = @{ source = 'AmazonConnect'; contactId = 'diag-contact' }
  }
} | ConvertTo-Json -Depth 8
$r = Invoke-RestMethod -Method Post -Uri "$base/conversations/$cid/activities" -Headers $ht -Body $msg
Write-Host "posted message, id=$($r.id)"

# 4. Wait and read back all activities the bot/channel produced
Start-Sleep -Seconds 6
$acts = Invoke-RestMethod -Method Get -Uri "$base/conversations/$cid/activities" -Headers $ht
Write-Host "=== ACTIVITIES ($($acts.activities.Count)) ==="
foreach ($a in $acts.activities) {
  $from = $a.from.id
  $role = $a.from.role
  $txt = $a.text
  Write-Host "[$($a.type)] from=$from role=$role text=$txt"
}
