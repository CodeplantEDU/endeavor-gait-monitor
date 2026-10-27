"""Build an allowlisted static Vercel package. Never includes research DB or firmware."""
from pathlib import Path
import json
import shutil

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / 'vercel_site'
PUBLIC = TARGET / 'public'
PUBLIC.mkdir(parents=True, exist_ok=True)
for source in (ROOT / 'dist').rglob('*'):
    if source.is_file() and (source.suffix in {'.html', '.mjs', '.css', '.ttf'} or source.name == 'Pretendard-LICENSE.txt'):
        destination = PUBLIC / source.relative_to(ROOT / 'dist')
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
for source in (ROOT / 'web').glob('*.mjs'):
    shutil.copy2(source, PUBLIC / source.name)
shutil.copy2(ROOT / 'config.json', PUBLIC / 'research-config.json')
for filename in ['app.mjs', 'platform.mjs']:
    module = PUBLIC / filename
    module.write_text(module.read_text(encoding='utf-8').replace('PC에', '이 브라우저에'), encoding='utf-8')
index = (PUBLIC / 'index.html').read_text(encoding='utf-8')
index = index.replace('<script type="module" src="platform.mjs"></script><script type="module" src="app.mjs"></script><script type="module" src="research.mjs"></script>', '<script type="module" src="cloud-bootstrap.mjs"></script>')
(PUBLIC / 'index.html').write_text(index, encoding='utf-8')
guide = (PUBLIC / 'guide.html').read_text(encoding='utf-8')
guide = guide.replace('PC 서버가 켜진 동안 매시간, 또는 화면을 열 때 자동 생성합니다. PC가 꺼져 있을 때는 동작하지 않습니다.', '사이트를 열 때와 열린 동안 매시간 자동 생성합니다. 사이트를 닫으면 생성 작업이 멈춥니다.')
guide = guide.replace('기록은 이 PC의 data/earlybird.sqlite3에 저장됩니다. 서버를 종료한 뒤 data 폴더를 백업하세요.', 'Vercel 배포본은 이 브라우저의 IndexedDB에 기록합니다. PC 서버·다른 기기와 자동 동기화하지 않습니다. 전체 기록 JSON 백업을 내려받을 수 있습니다. 브라우저 데이터를 삭제하면 기록도 지워질 수 있습니다.')
(PUBLIC / 'guide.html').write_text(guide, encoding='utf-8')
for name in ['api', 'dist']:
    folder = TARGET / name
    folder.mkdir(exist_ok=True)
    for source in (ROOT / name).glob('*.mjs'):
        if name == 'api' or source.name in ['analysis.mjs', 'research-analysis.mjs', 'csv-analysis.mjs']:
            shutil.copy2(source, folder / source.name)
settings = {'functions': {'api/ai-analyze.mjs': {'maxDuration': 60}}, 'framework': None, 'outputDirectory': 'public', 'buildCommand': None, 'installCommand': None, 'headers': [{'source': '/(.*)', 'headers': [{'key': 'X-Content-Type-Options', 'value': 'nosniff'}, {'key': 'Referrer-Policy', 'value': 'strict-origin-when-cross-origin'}, {'key': 'Permissions-Policy', 'value': 'bluetooth=(self)'}, {'key': 'Cache-Control', 'value': 'no-cache'}]}]}
(TARGET / 'vercel.json').write_text(json.dumps(settings, indent=2), encoding='utf-8')
(TARGET / '.vercelignore').write_text('.vercel/\n.env*\n.git/\n*.log\n.gitignore\n', encoding='utf-8')
assert not any(p.suffix in {'.sqlite3', '.py', '.ino', '.log', '.svg'} for p in PUBLIC.rglob('*') if p.is_file())
print(f'STATIC_SITE_READY {TARGET} ({sum(p.is_file() for p in PUBLIC.rglob("*"))} files)')
