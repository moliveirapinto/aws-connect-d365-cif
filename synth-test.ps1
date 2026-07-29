$ErrorActionPreference = 'Stop'
$cid = "SYNTH-" + [Guid]::NewGuid().ToString('N').Substring(0,12)
$ts = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
$ingest = if ($env:INGESTOR_URL) { $env:INGESTOR_URL } else { 'https://<your-ingestor-host>/api/transcript' }
$key = $env:INGESTOR_KEY
if (-not $key) { throw 'Set $env:INGESTOR_KEY (the ingestor x-ingestor-key) before running. Optionally set $env:INGESTOR_URL.' }
Write-Host "ContactId: $cid"
$life = @{ kind = 'lifecycle'; data = @{ contactId = $cid; ani = '+15551234567'; event = 'started'; timestamp = $ts } } | ConvertTo-Json -Compress -Depth 6
$seg1 = @{ kind = 'segment'; data = @{ contactId = $cid; participant = 'CUSTOMER'; content = 'Synthetic test: hello, I need help with my order.'; timestamp = $ts; ani = '+15551234567' } } | ConvertTo-Json -Compress -Depth 6
$seg2 = @{ kind = 'segment'; data = @{ contactId = $cid; participant = 'AGENT'; content = 'Synthetic test: sure, I can help you with that.'; timestamp = $ts } } | ConvertTo-Json -Compress -Depth 6
$life | Set-Content "$env:TEMP\p_life.json" -Encoding utf8
$seg1 | Set-Content "$env:TEMP\p_seg1.json" -Encoding utf8
$seg2 | Set-Content "$env:TEMP\p_seg2.json" -Encoding utf8
foreach ($f in 'p_life', 'p_seg1', 'p_seg2') {
  $r = curl.exe -s -o NUL -w "%{http_code}" -X POST -H "Content-Type: application/json" -H "x-ingestor-key: $key" --data "@$env:TEMP\$f.json" $ingest
  Write-Host "$f -> HTTP $r"
}
Write-Host "DONE cid=$cid"
