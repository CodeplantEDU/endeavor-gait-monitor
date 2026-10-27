"""Check tracked publication files without printing any suspected secret value."""
from pathlib import Path
import os
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
result = subprocess.run(['git', 'ls-files', '-z'], cwd=ROOT, capture_output=True, check=True)
files = [Path(p) for p in result.stdout.decode('utf-8').split('\0') if p]
if not files:
    raise SystemExit('No tracked files. Stage the intended public source before checking.')
blocked = {'data', 'output', 'tmp', 'backups', 'node_modules', 'vercel_site', '.vercel', '.theia', '__pycache__'}
patterns = [re.compile(r'sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}'), re.compile(r'gh[pousr]_[A-Za-z0-9]{30,}'), re.compile(r'github_pat_[A-Za-z0-9_]{30,}'), re.compile(r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----')]
secrets = [os.environ.get(k, '') for k in ['OPENAI_API_KEY', 'EARLYBIRD_AI_ACCESS_CODE', 'GH_TOKEN', 'GITHUB_TOKEN', 'VERCEL_TOKEN']]
secrets = [s for s in secrets if len(s) >= 16]
failures = []
for relative in files:
    file = ROOT / relative
    if any(p in blocked for p in relative.parts) or (relative.name.startswith('.env') and relative.name != '.env.example') or file.suffix.lower() in {'.zip', '.db', '.sqlite', '.sqlite3', '.pdf', '.docx'}:
        failures.append((str(relative), 'excluded runtime/private path'))
        continue
    if file.suffix == '.csv' and relative.parts[0] != 'examples':
        failures.append((str(relative), 'unapproved CSV location'))
    if file.suffix == '.ttf':
        if relative.as_posix() not in {'dist/assets/Pretendard-Regular.ttf', 'dist/assets/Pretendard-Bold.ttf'}:
            failures.append((str(relative), 'unapproved binary asset'))
        continue
    raw = file.read_bytes()
    try:
        text = raw.decode('utf-8-sig')
    except UnicodeDecodeError:
        failures.append((str(relative), 'unexpected binary file'))
        continue
    if any(p.search(text) for p in patterns) or any(s in text for s in secrets):
        failures.append((str(relative), 'credential-shaped or current secret value'))
    if re.search(r'C:[/\\]Users[/\\](?!Public)', text, re.I):
        failures.append((str(relative), 'personal absolute Windows path'))
if failures:
    for file, reason in failures:
        print(f'BLOCKED {file}: {reason}')
    raise SystemExit(1)
assert (ROOT / 'dist/assets/Pretendard-LICENSE.txt').is_file()
print(f'PUBLIC_CHECK_OK {len(files)} tracked files; no excluded data or recognized/current credentials')
