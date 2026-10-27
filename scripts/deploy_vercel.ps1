$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$stage = Join-Path $projectRoot 'vercel_site'
python (Join-Path $PSScriptRoot 'build_vercel.py')
if ($LASTEXITCODE -ne 0) { throw 'Static build failed.' }
$resolvedStage = (Resolve-Path -LiteralPath $stage).Path
$expectedStage = [IO.Path]::GetFullPath((Join-Path $projectRoot 'vercel_site'))
if ($resolvedStage -ne $expectedStage) { throw 'Unexpected deployment directory.' }
$allowedEntries = @('public', 'api', 'dist', '.vercel', 'vercel.json', '.vercelignore', '.gitignore')
$extraEntries = Get-ChildItem -LiteralPath $resolvedStage -Force | Where-Object { $_.Name -notin $allowedEntries }
if ($extraEntries) { throw 'Unexpected files in deployment staging directory. Upload aborted.' }
$linkFile = Join-Path $resolvedStage '.vercel/project.json'
if (-not (Test-Path -LiteralPath $linkFile)) {
    throw 'Link vercel_site to earlybird-gait-monitor first. Do not deploy the source project root.'
}
$link = Get-Content -Raw -LiteralPath $linkFile | ConvertFrom-Json
if ($link.projectId -ne 'prj_6lWTHVMT6QyJtfHEUzlZaf4RfEV0' -or $link.orgId -ne 'team_1Xl5yVWzbAjaUusySEisORU2') {
    throw 'Unexpected Vercel team or project.'
}
vercel --cwd $resolvedStage --scope codeplantedus-projects deploy --prod --yes
if ($LASTEXITCODE -ne 0) { throw 'Vercel deployment failed.' }
