<#
  ACE office app - Subiekt nexo agent.
  Reads this year's sales invoices (FS, FL, KFS, KFL) and material issues (RW), the stock of
  every product per warehouse and the open delivery lots (stock value and ageing), from the Subiekt database with a READ-ONLY SQL login and posts them
  to the office app. It changes nothing in Subiekt.

  First time (in a PowerShell window opened "as administrator", in this folder):
      .\ace-subiekt-agent.ps1 -Setup      asks for the settings, the SQL password and the agent key
      .\ace-subiekt-agent.ps1 -Preview    reads from Subiekt and shows what it would send (sends nothing)
      .\ace-subiekt-agent.ps1             one real sync
      .\ace-subiekt-agent.ps1 -Install    runs it every 30 minutes from Windows Task Scheduler
      .\ace-subiekt-agent.ps1 -Uninstall  removes the scheduled task
      .\ace-subiekt-agent.ps1 -Explore    lists Subiekt's product / stock tables and a few product symbols
                                          (sends nothing) - used once to check the stock query

  Settings are in config.json next to this file; the SQL password and the agent key are stored
  encrypted (Windows DPAPI, this computer only) in secrets.bin. Works with Windows PowerShell 5.1.
#>
param([switch]$Setup, [switch]$Preview, [switch]$Install, [switch]$Uninstall, [switch]$Explore)

$ErrorActionPreference = 'Stop'
$AgentVersion = '1.2'
$TaskName = 'ACE Subiekt agent'
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$ConfigPath = Join-Path $Here 'config.json'
$SecretsPath = Join-Path $Here 'secrets.bin'
$LogPath = Join-Path $Here 'agent.log'
Add-Type -AssemblyName System.Security
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Write-Log([string]$Text) {
  $line = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '  ' + $Text
  Write-Host $line
  try {
    if ((Test-Path $LogPath) -and ((Get-Item $LogPath).Length -gt 1MB)) { Move-Item -Force $LogPath ($LogPath + '.old') }
    Add-Content -Path $LogPath -Value $line -Encoding UTF8
  } catch { }
}

function Save-Secrets([string]$SqlPassword, [string]$AgentKey) {
  $plain = [Text.Encoding]::UTF8.GetBytes((@{ sql = $SqlPassword; key = $AgentKey } | ConvertTo-Json -Compress))
  $enc = [Security.Cryptography.ProtectedData]::Protect($plain, $null, [Security.Cryptography.DataProtectionScope]::LocalMachine)
  [IO.File]::WriteAllBytes($SecretsPath, $enc)
}
function Read-Secrets {
  if (-not (Test-Path $SecretsPath)) { throw 'secrets.bin is missing - run:  .\ace-subiekt-agent.ps1 -Setup' }
  $plain = [Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($SecretsPath), $null, [Security.Cryptography.DataProtectionScope]::LocalMachine)
  return ([Text.Encoding]::UTF8.GetString($plain) | ConvertFrom-Json)
}
function Read-Plain([string]$Prompt) {
  $sec = Read-Host -Prompt $Prompt -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}
function Read-Config {
  if (-not (Test-Path $ConfigPath)) { throw 'config.json is missing - run:  .\ace-subiekt-agent.ps1 -Setup' }
  return (Get-Content -Raw -Path $ConfigPath -Encoding UTF8 | ConvertFrom-Json)
}

# The stock of every product, per warehouse (checked on the Acemark PL database, October 2026:
# warehouses ACE and PROD; profiles are counted in pieces, the bar length is in the symbol).
# qty = IloscDostepna; reserved = reserved + allocated; cref = the custom field L0, which starts
# with the Cortizo reference ("2015 White Powder Coating 9010"); cortizo = 1 when the supplier
# (role 2) is CORTIZO SPÓŁKA Z O.O. config.json may override it with "stockQuery".
$StockQuery = @'
select a.Id as id, a.Symbol as symbol, left(a.Nazwa, 200) as name, jm.Symbol as unit,
       m.Symbol as warehouse, s.IloscDostepna as qty,
       coalesce(s.IloscZarezerwowanaIlosciowo, 0) + coalesce(s.IloscZadysponowana, 0) as reserved,
       left(adv.L0, 120) as cref,
       case when exists (select 1 from ModelDanychContainer.DaneAsortymentuDlaPodmiotow d
                         join ModelDanychContainer.Podmioty p on p.Id = d.Podmiot_Id
                         where d.Asortyment_Id = a.Id and d.Rola = 2 and p.NazwaSkrocona like '%CORTIZO%')
            then 1 else 0 end as cortizo
from ModelDanychContainer.StanyMagazynowe s
join ModelDanychContainer.Asortymenty a on a.Id = s.Asortyment_Id
left join ModelDanychContainer.Asortymenty_PolaWlasneAsortyment_Adv2 adv on adv.Id = a.Id
left join ModelDanychContainer.Magazyny m on m.Id = s.Magazyn_Id
left join ModelDanychContainer.JednostkiMiarAsortymentow jma on jma.AsortymentPodstawowej_Id = a.Id
left join ModelDanychContainer.JednostkiMiar jm on jm.Id = jma.JednostkaMiary_Id
where a.IsInRecycleBin = 0
'@

# The open delivery lots, for Fin&Ops > Stock value (value and ageing). Remaining = the lot minus
# everything issued from it (equals StanyMagazynowe for every product); unit cost = the receipt's
# LATEST purchase cost entry / its quantity (Przychody > Partie > Przyjecia > KosztyZakupu: a cost
# correction holds the new full value, it replaces the original - it is not added to it);
# received = the ORIGINAL delivery (a transfer between warehouses points back to it). Reconciled
# with "Remanent na dzien" product by product (October 2026).
$LotsQuery = @'
with issued as (
  select r.PrzychodZrodlowy_Id as lot_id, sum(r.Ilosc) as qty_out
  from ModelDanychContainer.Rozchody r group by r.PrzychodZrodlowy_Id),
lastissue as (
  select r.Asortyment_Id, r.Magazyn_Id, max(r.Data) as last_issue
  from ModelDanychContainer.Rozchody r where r.Wydanie_Id is not null group by r.Asortyment_Id, r.Magazyn_Id),
unitcost as (
  select prz.Id as prz_id, kz.unit_cost
  from ModelDanychContainer.Przyjecia prz
  outer apply (select top 1 k.Wartosc * coalesce(nullif(k.Kurs, 0), 1) / coalesce(nullif(k.Ilosc, 0), nullif(prz.Ilosc, 0)) as unit_cost
               from ModelDanychContainer.KosztyZakupu k
               where k.Id = prz.KosztPierwotny_Id or k.PrzyjecieDlaKtoregoKorekta_Id = prz.Id
               order by k.Data desc, k.Id desc) kz),
supplier as (
  select d.Asortyment_Id, min(p.NazwaSkrocona) as supplier
  from ModelDanychContainer.DaneAsortymentuDlaPodmiotow d
  join ModelDanychContainer.Podmioty p on p.Id = d.Podmiot_Id
  where d.Rola = 2 group by d.Asortyment_Id)
select p.Id as lot, a.Id as product_id, a.Symbol as symbol, left(a.Nazwa, 200) as name, g.Nazwa as grp,
       sp.supplier, jm.Symbol as unit, m.Symbol as warehouse,
       p.Ilosc - coalesce(i.qty_out, 0) as qty, u.unit_cost,
       convert(varchar(10), coalesce(o.Data, p.Data), 23) as received,
       convert(varchar(10), li.last_issue, 23) as last_issue
from ModelDanychContainer.Przychody p
left join issued i on i.lot_id = p.Id
left join ModelDanychContainer.Przychody o on o.Id = p.PrzychodPierwotny_Id
join ModelDanychContainer.Asortymenty a on a.Id = p.Asortyment_Id
left join ModelDanychContainer.GrupyAsortymentu g on g.Id = a.Grupa_Id
join ModelDanychContainer.Magazyny m on m.Id = p.Magazyn_Id
left join ModelDanychContainer.JednostkiMiarAsortymentow jma on jma.AsortymentPodstawowej_Id = a.Id
left join ModelDanychContainer.JednostkiMiar jm on jm.Id = jma.JednostkaMiary_Id
left join ModelDanychContainer.Partie pa on pa.Id = p.Partia_Id
left join unitcost u on u.prz_id = pa.Przyjecie_Id
left join lastissue li on li.Asortyment_Id = p.Asortyment_Id and li.Magazyn_Id = p.Magazyn_Id
left join supplier sp on sp.Asortyment_Id = a.Id
where p.Ilosc - coalesce(i.qty_out, 0) > 0
'@

function Open-Subiekt($cfg, $sec) {
  $cs = New-Object System.Data.SqlClient.SqlConnectionStringBuilder
  $cs['Data Source'] = $cfg.server; $cs['Initial Catalog'] = $cfg.database
  $cs['User ID'] = $cfg.sqlUser; $cs['Password'] = $sec.sql
  $cs['Application Name'] = 'ACE Subiekt agent'; $cs['ApplicationIntent'] = 'ReadOnly'; $cs['Connect Timeout'] = 20
  $conn = New-Object System.Data.SqlClient.SqlConnection($cs.ConnectionString)
  $conn.Open()
  return $conn
}
function Read-Rows($conn, [string]$sql, [hashtable]$params) {
  $out = New-Object System.Collections.Generic.List[object]
  $cmd = $conn.CreateCommand(); $cmd.CommandText = $sql; $cmd.CommandTimeout = 120
  if ($params) { foreach ($k in $params.Keys) { $null = $cmd.Parameters.AddWithValue($k, $params[$k]) } }
  $rd = $cmd.ExecuteReader()
  try {
    while ($rd.Read()) {
      $row = [ordered]@{}
      for ($i = 0; $i -lt $rd.FieldCount; $i++) { $v = $rd.GetValue($i); $row[$rd.GetName($i)] = $(if ($v -is [DBNull]) { $null } else { $v }) }
      $out.Add([pscustomobject]$row)
    }
  } finally { $rd.Close() }
  return ,$out
}

if ($Explore) {
  $cfg = Read-Config; $sec = Read-Secrets
  if ($cfg.stockQuery) { $StockQuery = $cfg.stockQuery }
  $conn = Open-Subiekt $cfg $sec
  try {
    Write-Host '=== Tables and columns (products, stock, warehouses, units) ==='
    $cols = Read-Rows $conn @"
select c.TABLE_NAME as t, c.COLUMN_NAME as c, c.DATA_TYPE as ty
from INFORMATION_SCHEMA.COLUMNS c
where c.TABLE_SCHEMA = 'ModelDanychContainer'
  and (c.TABLE_NAME like '%Asortyment%' or c.TABLE_NAME like '%Stan%' or c.TABLE_NAME like '%Magazyn%' or c.TABLE_NAME like '%JednostkiMiar%' or c.TABLE_NAME like '%Rezerwac%')
order by c.TABLE_NAME, c.ORDINAL_POSITION
"@ @{}
    $cols | Group-Object t | ForEach-Object { Write-Host ($_.Name + ': ' + (($_.Group | ForEach-Object { $_.c + '(' + $_.ty + ')' }) -join ', ')); Write-Host '' }
    Write-Host '=== 40 product symbols that look like Cortizo references ==='
    try {
      $ex = Read-Rows $conn @"
select top 40 a.Id, a.Symbol, left(a.Nazwa, 80) as Nazwa from ModelDanychContainer.Asortymenty a
where a.Symbol like 'COR%' or a.Symbol like '[0-9][0-9][0-9][0-9][0-9][0-9]%' order by a.Symbol
"@ @{}
      $ex | Format-Table -AutoSize | Out-String -Width 220 | Write-Host
      $n = Read-Rows $conn 'select count(*) as n from ModelDanychContainer.Asortymenty' @{}
      Write-Host ('Products in total: ' + $n[0].n)
    } catch { Write-Host ('(could not read ModelDanychContainer.Asortymenty: ' + $_.Exception.Message + ')') }
    Write-Host '=== Stock query test ==='
    try { $st = Read-Rows $conn $StockQuery @{}; Write-Host ('Stock rows: ' + $st.Count); $st | Select-Object -First 15 | Format-Table -AutoSize | Out-String -Width 220 | Write-Host }
    catch { Write-Host ('Stock query failed: ' + $_.Exception.Message) }
  } finally { $conn.Close() }
  Write-Host 'Nothing was sent. Copy everything above into the chat with Claude.'
  exit 0
}

if ($Setup) {
  $ask = { param($q, $def) $a = Read-Host -Prompt ($q + $(if ($def) { " [$def]" } else { '' })); if ($a) { $a } else { $def } }
  $cfg = [ordered]@{
    server   = (& $ask 'SQL Server name, exactly as on the Subiekt login screen' 'NEXO2026')
    database = (& $ask 'Database name (starts with Nexo_)' '')
    sqlUser  = (& $ask 'Read-only SQL login' 'ace_readonly')
    url      = (& $ask 'Office app address' 'https://office.acemark.com.pl')
    since    = (& $ask 'Load documents from (yyyy-mm-dd)' '2026-01-01')
  }
  ($cfg | ConvertTo-Json) | Set-Content -Path $ConfigPath -Encoding UTF8
  Save-Secrets (Read-Plain 'Password of the read-only SQL login') (Read-Plain 'Agent key from the office app (Sales > Subiekt > Create a new agent key)')
  Write-Host 'Saved. Next:  .\ace-subiekt-agent.ps1 -Preview'
  exit 0
}
if ($Uninstall) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host 'Scheduled task removed.'
  exit 0
}
if ($Install) {
  $null = Read-Config; $null = Read-Secrets
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -ExecutionPolicy Bypass -File "' + $MyInvocation.MyCommand.Path + '"')
  $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) -RepetitionInterval (New-TimeSpan -Minutes 30) -RepetitionDuration (New-TimeSpan -Days 3650)
  $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -MultipleInstances IgnoreNew
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
  Write-Host "Installed: '$TaskName' runs every 30 minutes. The log is $LogPath"
  exit 0
}

# ---- one sync --------------------------------------------------------------------------------
$Query = @'
select d.Id as id, d.Symbol as symbol, d.NumerWewnetrzny_PelnaSygnatura as number,
       convert(varchar(10), d.DataWydaniaWystawienia, 23) as issued,
       convert(varchar(10), d.DataSprzedazy, 23) as sold,
       d.Wartosc_NettoPoRabacie as net, d.Wartosc_BruttoPoRabacie as gross,
       w.Nazwa as currency, k.Kurs as rate, k.LiczbaJednostek as units,
       left(d.Podtytul, 300) as subtitle, left(d.Uwagi, 600) as notes,
       d.DokumentHandlowy_SprzedazZaliczkowa as flag, d.DokumentKorygowanyId as corrects,
       p.NazwaSkrocona as customer, coalesce(nullif(pa.KodPanstwaUE, ''), pa.Nazwa) as country
from ModelDanychContainer.Dokumenty d
left join ModelDanychContainer.Waluty w on w.Id = d.Dokument_Waluta_Id
left join ModelDanychContainer.KursyWalutyDokumentu k on k.Id = d.Dokument_KursWalutyDokumentu_Id
left join ModelDanychContainer.Podmioty p on p.Id = d.PodmiotId
left join ModelDanychContainer.Panstwa pa on pa.Id = p.Podmiot_PanstwoRejestracji_Id
where d.Symbol in ('FS', 'FL', 'KFS', 'KFL', 'RW')
  and coalesce(d.DataWydaniaWystawienia, d.DataWprowadzenia) >= @since
order by d.Id
'@

try {
  $cfg = Read-Config
  $sec = Read-Secrets
  if ($cfg.stockQuery) { $StockQuery = $cfg.stockQuery }
  $conn = Open-Subiekt $cfg $sec
  $stock = $null; $stockErr = $null; $lots = $null; $lotsErr = $null
  try {
    $docs = Read-Rows $conn $Query @{ '@since' = [datetime]::ParseExact($cfg.since, 'yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture) }
    # stock is separate: if its query fails, the invoices are still sent
    try { $stock = Read-Rows $conn $StockQuery @{} } catch { $stockErr = $_.Exception.Message }
    try { $lots = Read-Rows $conn $LotsQuery @{} } catch { $lotsErr = $_.Exception.Message }
  } finally { $conn.Close() }

  $bySymbol = ($docs | Group-Object symbol | Sort-Object Name | ForEach-Object { $_.Name + ' ' + $_.Count }) -join ', '
  if ($Preview) {
    Write-Host ("Read {0} documents since {1}: {2}" -f $docs.Count, $cfg.since, $bySymbol)
    $docs | Select-Object -Last 8 | Format-Table symbol, number, issued, net, currency, rate, subtitle, customer, country -AutoSize | Out-String -Width 220 | Write-Host
    if ($stockErr) { Write-Host ('Stock: query failed - ' + $stockErr) }
    else { Write-Host ('Stock: {0} rows' -f $stock.Count); $stock | Select-Object -First 8 | Format-Table symbol, name, cref, unit, warehouse, qty -AutoSize | Out-String -Width 220 | Write-Host }
    if ($lotsErr) { Write-Host ('Lots: query failed - ' + $lotsErr) }
    else {
      $val = 0; foreach ($l in $lots) { if ($l.unit_cost -ne $null) { $val += [double]$l.qty * [double]$l.unit_cost } }
      Write-Host ('Lots: {0} open, value {1:N2} PLN' -f $lots.Count, $val)
    }
    Write-Host 'Preview only - nothing was sent.'
    exit 0
  }
  if ($docs.Count -eq 0) { throw 'The query returned no documents - nothing sent.' }

  $body = @{ agent = $AgentVersion; since = $cfg.since; docs = $docs.ToArray() } | ConvertTo-Json -Depth 4 -Compress
  $resp = Invoke-RestMethod -Method Post -Uri ($cfg.url.TrimEnd('/') + '/api/agent/subiekt') -Headers @{ 'x-agent-key' = $sec.key } `
    -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($body)) -TimeoutSec 300
  $s = $resp.summary
  Write-Log ("OK  sent {0} ({1}) | sales +{2} ~{3} adopted {4} -{5} | material lines {6}, typed replaced {7}, jobs created {8} | to check {9}" -f `
    $docs.Count, $bySymbol, $s.sales.added, $s.sales.updated, $s.sales.adopted, $s.sales.removed, $s.material.lines, $s.material.typedReplaced, $s.material.jobsCreated, $s.toCheck)

  $failed = $false
  if ($stockErr) { Write-Log ('ERROR  stock not sent: ' + $stockErr); $failed = $true }
  else {
    $sbody = @{ agent = $AgentVersion; stock = $stock.ToArray() } | ConvertTo-Json -Depth 3 -Compress
    $sresp = Invoke-RestMethod -Method Post -Uri ($cfg.url.TrimEnd('/') + '/api/agent/subiekt-stock') -Headers @{ 'x-agent-key' = $sec.key } `
      -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($sbody)) -TimeoutSec 300
    Write-Log ("OK  stock {0} rows, {1} products" -f $sresp.rows, $sresp.products)
  }
  if ($lotsErr) { Write-Log ('ERROR  lots not sent: ' + $lotsErr); $failed = $true }
  else {
    $lbody = @{ agent = $AgentVersion; lots = $lots.ToArray() } | ConvertTo-Json -Depth 3 -Compress
    $lresp = Invoke-RestMethod -Method Post -Uri ($cfg.url.TrimEnd('/') + '/api/agent/subiekt-lots') -Headers @{ 'x-agent-key' = $sec.key } `
      -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($lbody)) -TimeoutSec 300
    Write-Log ("OK  lots {0}, value {1} PLN" -f $lresp.lots, $lresp.value)
  }
  if ($failed) { exit 1 }
  exit 0
} catch {
  $msg = $_.Exception.Message
  try { if ($_.ErrorDetails -and $_.ErrorDetails.Message) { $msg = $msg + ' | ' + $_.ErrorDetails.Message } } catch { }
  Write-Log ('ERROR  ' + $msg)
  exit 1
}
