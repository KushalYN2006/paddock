$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$packageDir = Join-Path $PSScriptRoot 'package'
$archive = Join-Path $packageDir 'f1-companion-source.tar.gz'
New-Item -ItemType Directory -Force -Path $packageDir | Out-Null

Push-Location $projectRoot
try {
  & tar.exe -czf $archive `
    --exclude=./.git `
    --exclude=*.pem `
    --exclude=./3Dmodel `
    --exclude=./.tmp `
    --exclude=./.pnpm-store `
    --exclude=./node_modules `
    --exclude=./backend/node_modules `
    --exclude=./frontend/node_modules `
    --exclude=./backend/dist `
    --exclude=./frontend/dist `
    --exclude=*.tsbuildinfo `
    --exclude=*/coverage `
    --exclude=./backend/prisma/dev.db `
    --exclude=./backend/prisma/dev.db-journal `
    --exclude=./backend/prisma/dev.db-wal `
    --exclude=./backend/prisma/dev.db-shm `
    --exclude=./deploy/ec2/package `
    --exclude=./.env `
    --exclude=./backend/.env `
    --exclude=./frontend/.env `
    --exclude=./backend/.env.local `
    --exclude=./frontend/.env.local `
    .
  if ($LASTEXITCODE -ne 0) { throw "tar.exe failed with exit code $LASTEXITCODE" }
} finally {
  Pop-Location
}
Write-Host "Created $archive"
