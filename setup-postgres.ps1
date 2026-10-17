$ErrorActionPreference = "Stop"
$pgBase = "C:\Users\bhumi\pgsql"
$zipPath = "$pgBase\pg.zip"
$extractPath = "$pgBase\pgsql"
$dataPath = "$pgBase\data"
$logPath = "$pgBase\postgres.log"

if (-not (Test-Path $pgBase)) {
    New-Item -ItemType Directory -Path $pgBase -Force | Out-Null
}

if (-not (Test-Path "$extractPath\bin\postgres.exe")) {
    Write-Host "Downloading PostgreSQL 16 portable binaries..."
    curl.exe -L "https://get.enterprisedb.com/postgresql/postgresql-16.4-1-windows-x64-binaries.zip" -o $zipPath
    Write-Host "Extracting PostgreSQL..."
    Expand-Archive -Path $zipPath -DestinationPath $pgBase -Force
    Remove-Item -Path $zipPath -Force -ErrorAction SilentlyContinue
    Write-Host "PostgreSQL extracted."
}

if (-not (Test-Path "$dataPath\PG_VERSION")) {
    Write-Host "Initializing PostgreSQL cluster..."
    & "$extractPath\bin\initdb.exe" -D $dataPath -U postgres -A trust --encoding=UTF8
}

Write-Host "Checking if PostgreSQL is running..."
$isRunning = $false
try {
    $tcp = Test-NetConnection -ComputerName localhost -Port 5432 -WarningAction SilentlyContinue
    $isRunning = $tcp.TcpTestSucceeded
} catch {
    $isRunning = $false
}

if (-not $isRunning) {
    Write-Host "Starting PostgreSQL server..."
    & "$extractPath\bin\pg_ctl.exe" -D $dataPath -l $logPath start
    Start-Sleep -Seconds 3
}

Write-Host "Creating user and database if needed..."
& "$extractPath\bin\psql.exe" -U postgres -h localhost -p 5432 -c "DO \`$do\`$ BEGIN IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'ops_user') THEN CREATE USER ops_user WITH PASSWORD 'ops_password' SUPERUSER; END IF; END \`$do\`$;"
& "$extractPath\bin\psql.exe" -U postgres -h localhost -p 5432 -c "SELECT 1 FROM pg_database WHERE datname = 'ops_pressure';" | Out-String -OutVariable dbExists
if ($dbExists -notmatch "1") {
    & "$extractPath\bin\psql.exe" -U postgres -h localhost -p 5432 -c "CREATE DATABASE ops_pressure OWNER ops_user;"
}
& "$extractPath\bin\psql.exe" -U postgres -h localhost -p 5432 -c "GRANT ALL PRIVILEGES ON DATABASE ops_pressure TO ops_user;"

Write-Host "PostgreSQL setup complete and running on localhost:5432!"
