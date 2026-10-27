# ENDEAVOR 보행 모니터링

ESP32 스마트 슈즈의 **앞·뒤 FSR과 MPU6500 자세각**을 BLE로 수집하고, **CSV를 정제해 GPT-6.1 Terra가 보행 기록 리포트를 작성**하는 CODEPLANT 프로젝트입니다.

**[서비스 열기](https://earlybird-gait-monitor.vercel.app/#analysis)** · **[Codex에 붙여 넣는 프롬프트](docs/CODEX_PROMPTS.md)** · **[구조와 데이터 흐름](docs/ARCHITECTURE.md)** · **[배포 방법](docs/DEPLOYMENT.md)**

이 저장소에는 웹 UI, 브라우저 저장소, Python/SQLite 서버, OpenAI API 함수, ESP32 INO와 필수 헤더, 테스트, 실행·배포 스크립트가 포함됩니다. 개인 측정 기록·기존 API 키·운영 AI 이용 코드는 포함하지 않습니다.

## Codex로 바로 시작하기

아직 소스를 받지 않았다면 Codex 새 대화에서 다음처럼 시작할 수 있습니다.

```text
https://github.com/CodeplantEDU/endeavor-gait-monitor 저장소를 현재 작업 폴더 아래
endeavor-gait-monitor 폴더에 clone해 줘. 같은 이름의 폴더가 이미 있으면 덮어쓰지 마.
README.md와 AGENTS.md를 읽고 아래의 '처음 내려받은 프로젝트 실행' 절차를 진행해 줘.
펌웨어와 기존 운영 사이트는 변경하지 말고 로컬 개발 서버부터 실행해 줘.
```

1. 이 저장소를 내려받아 Codex에서 해당 폴더를 엽니다.
2. 아래 내용을 그대로 입력합니다. 다른 작업용 폴더를 선택하지 마세요.

```text
이 프로젝트의 README.md, AGENTS.md, docs/ARCHITECTURE.md를 읽어 줘.
먼저 Node.js 24와 Python 3 실행 가능 여부를 확인하고 필요한 의존성을 설치해 줘.
펌웨어는 바꾸지 말고 npm test, npm run test:python, npm run build를 실행해 줘.
.env.local이 없으면 .env.example을 복사하되 비밀 값은 출력하거나 임의로 만들지 마.
OpenAI 키는 기존 키 재사용 또는 내 계정의 새 키 설정 중 내가 선택할 수 있게 해 줘.
키가 없는 동안에도 CSV 업로드·정제·그래프는 사용할 수 있게 npm run dev로 서버를 열어 줘.
http://127.0.0.1:8774/#analysis에서 examples/sensor_example.csv를 불러와
주기 수가 0이어도 정제와 그래프가 나오는지 확인하고, 실제로 검증한 내용만 알려 줘.
```

AI 연결·오류 수정·센서 연결·Vercel 배포·기능 확장용 프롬프트는 [별도 문서](docs/CODEX_PROMPTS.md)에 있습니다. API 키를 프롬프트·GitHub 이슈·채팅에 붙여 넣지 마세요.

## 현재 기능

| 기능 | 동작 범위 |
|---|---|
| 양발 장치 등록 | ESP32를 발별로 등록하고 BLE 알림을 수신 |
| 실시간 측정 | FSR 앞/뒤, 롤·피치·요, 약 20Hz 기록과 발별 캘리브레이션 |
| CSV 분석 | 저장 Trial 선택 또는 원시 CSV 업로드, 숫자 정제·시간 정렬·중복 제거 |
| 그래프 | FSR·롤·피치·요의 시간 변화, 채널별 분포와 결측 현황 |
| AI 리포트 | 주기 수·기준선 횟수 조건 없이 CSV와 전체 통계를 해석하고 저장 |
| 자동 리포트 | 코드·전송 동의 설정 후 측정 종료와 원시 기록 저장에 이어 생성 |
| 기록·리포트 | 브라우저 저장, CSV/JSON/HTML 다운로드와 브라우저 인쇄/PDF |
| 일상 관리 | 복약 기록, 장기 추이, 보호자 공유 자료·방문 케어 요청서 작성 |

**AI 건강상담 메뉴의 기본 안내는 규칙 기반입니다.** 실제 OpenAI 호출은 보행 분석의 CSV AI 리포트 기능에 연결되어 있습니다. 공유·케어 기능은 파일·요청서 준비이며 이메일 발송·의료기관 예약·방문 배정은 연결되어 있지 않습니다.

### 주기를 못 잡아도 분석하는 이유

기존 접촉 주기 계산은 FSR이 접촉 해제 임계값 아래로 내려가야 다음 주기를 구분했습니다. 신발 압착·센서 감도·보정 상태 때문에 값이 계속 높으면, 반복 파형이 있어도 주기 수가 부족해질 수 있습니다.

현재 기본 경로는 **CSV 직접 분석**입니다. 주기 10회, 20초, 개인 기준선 3회 조건으로 AI 분석을 막지 않습니다. 이전의 주기·기준선 비교 알고리즘은 기존 보고서 호환과 연구용 보조 계산으로 남아 있습니다. AI가 자동으로 정확한 주기 검출이나 임상 판단을 보장한다는 뜻은 아닙니다.

## 로컬 실행

### 준비

- Node.js 24 이상, Python 3.10 이상, Git
- BLE 연결은 Web Bluetooth가 가능한 Chrome/Edge와 OS Bluetooth 환경
- AI 사용 시 본인 OpenAI API 키와 해당 모델 접근 권한

```powershell
git clone https://github.com/CodeplantEDU/endeavor-gait-monitor.git
cd endeavor-gait-monitor
npm ci
Copy-Item .env.example .env.local
npm run dev
```

브라우저에서 **http://127.0.0.1:8774**를 엽니다. 이 모드는 Vercel과 같은 **브라우저 IndexedDB 저장 방식**과 Node AI 함수를 사용합니다. 키 없이도 CSV 정제·그래프를 확인할 수 있으며, AI 요청은 서버 설정이 필요하다는 메시지를 표시합니다.

`.env.local`에 본인 계정의 값을 설정합니다. 아래 설명은 환경변수 이름이며 실제 키 예시가 아닙니다.

| 변수 | 용도 |
|---|---|
| `OPENAI_API_KEY` | 서버에서만 사용하는 OpenAI API 키 |
| `OPENAI_MODEL` | 기본값 `gpt-6.1-terra`; 모델 접근 권한은 계정별 확인 필요 |
| `EARLYBIRD_AI_ACCESS_CODE` | 이 설치본의 AI 기능을 여는 별도 이용 코드 |
| `EARLYBIRD_ALLOWED_ORIGIN` | 선택 사항: 별도로 배포한 사이트의 정확한 origin |
| `EARLYBIRD_QA_PORT` | 로컬 Node 서버 포트, 기본 8774 |

본인용 이용 코드는 다음 명령으로 생성하고 `.env.local`에 저장하세요. 공개 서비스의 기존 이용 코드는 저장소에 없습니다.

```powershell
node -e "console.log(require('node:crypto').randomBytes(24).toString('hex'))"
```

환경변수 변경 후 서버를 다시 시작합니다. 웹의 **보행 분석 → AI 이용 코드**에는 `EARLYBIRD_AI_ACCESS_CODE` 값을 넣고 CSV 전송에 동의합니다. API 키를 입력하는 칸이 아닙니다. AI 호출에는 본인 OpenAI 계정의 사용 요금이 발생할 수 있습니다.

### Python/SQLite 모드

```powershell
python server.py --open --port 8765
```

Windows에서는 `start.cmd`로도 실행할 수 있습니다. Python 추가 패키지 없이 동작하고 기록은 `data/earlybird.sqlite3`에 저장합니다. 이 서버는 BLE·CSV·로컬 기록 기능을 제공하지만 **Node의 `/api/ai-analyze`를 실행하지 않습니다. AI 리포트까지 사용하려면 위 `npm run dev` 또는 Vercel 모드를 사용하세요.**

서로 다른 URL·포트·브라우저 프로필의 IndexedDB는 별개이며 Python DB와도 자동 동기화하지 않습니다. 브라우저 데이터 삭제 전 **전체 기록 JSON 백업**을 사용하세요.

## 센서 배선과 펌웨어

각 발에 ESP32 1개, FSR 2개, MPU6500 1개를 사용합니다.

| 연결 | ESP32 |
|---|---|
| MPU VCC / GND | 3V3 / GND |
| MPU SDA / SCL | GPIO21 / GPIO22 |
| 앞 FSR 측정 노드 | GPIO35 |
| 뒤 FSR 측정 노드 | GPIO34 |

각 FSR 회로는 `3V3 → FSR → 측정 노드 → 고정 저항 → GND`입니다. 두 FSR에 개별 고정 저항을 사용합니다. `config.json`의 실제 저항값은 미확인 값으로 `null`이며, ADC를 N·BW·kPa로 환산하지 않습니다.

[기본 INO](firmware/fsr_mpu_ble/fsr_mpu_ble.ino)와 [OrientationFilter.h](firmware/fsr_mpu_ble/OrientationFilter.h)를 **같은 폴더**에 둔 채 Arduino IDE로 엽니다. ESP32 보드 패키지를 설치하고 실제 보드·포트를 선택합니다. 현재 프로토콜에서는 양발에 동일한 코드를 올리고 웹에서 발을 구분합니다. 전원 인가 직후 약 3초간 정지시켜 자이로 보정을 기다리세요.

장치 이름은 `FSR-MPU-ESP32`입니다. 두 장치를 구분하기 어려우면 한쪽 전원만 켜서 먼저 등록합니다. 발마다 무부하·기준 자세 4초, 가압 정지 4초를 캘리브레이션한 뒤 기록합니다. 펌웨어는 MPU6500의 장치 ID `0x70`을 확인하고 I²C 주소 `0x68`·`0x69`를 탐색합니다. 이 코드를 MPU6050용으로 간주하지 마세요.

## CSV AI 분석 사용

1. 보행 분석에서 **저장된 기록**을 선택하거나 **원시·필터 CSV 파일**을 불러옵니다.
2. `side` 열이 없는 한쪽 발 CSV는 발 구분을 직접 선택합니다.
3. 정제 행 수, 제외·중복·결측 현황과 그래프를 확인합니다.
4. 이용 코드와 OpenAI 전송 동의를 설정하고 **CSV AI 분석·리포트 저장**을 누릅니다.
5. 건강 리포트에서 다시 열거나 HTML·JSON·PDF로 내보냅니다.

예시 파일 [examples/sensor_example.csv](examples/sensor_example.csv)는 **기능 검사 전용 합성 신호**이며 실제 참여자의 측정 자료가 아닙니다. 이 파일의 FSR은 0으로 떨어지지 않고 좌우 진폭이 다르게 설정되어 있습니다.

정제는 빈칸·잘못된 숫자를 결측으로 유지하고 시간 정렬·동일 시각 중복 제거를 수행합니다. 긴 누락 구간을 임의로 보간하지 않습니다. AI에는 숫자 센서 채널·상대 시간·발 구분·통계·질문을 전송하며, 참여자·기기·보정 ID와 절대 시각은 자동 전송하지 않습니다. 질문에 개인정보를 넣으면 질문 자체는 전송되므로 주의하세요.

긴 기록은 전체 통계와 최대 약 3,000개의 대표 행을 전달하고 실제 전송 행 수를 표시합니다. 원본 업로드 8MB·50,000행, 정제 CSV 2.5MB, 서버 요청 3MB 제한이 있습니다. 기본 API 시간 제한은 55초입니다. 실패해도 원시 측정 기록은 별도로 유지됩니다. 자동 생성은 브라우저를 열어 둔 동안 실행되며, 새로고침·참여자 변경 뒤에는 코드와 동의를 다시 설정해야 합니다.

## 검사

```powershell
npm test
npm run test:python
npm run build
npm run check:public
npx playwright install chromium
```

`npm run dev`가 실행 중인 상태에서 다른 터미널에서 다음을 실행합니다.

```powershell
npm run test:browser
```

기본 CSV 브라우저 검사는 합성 데이터와 **모의 AI 응답**을 사용해 과금하지 않습니다. 실제 API 시험은 명시적으로 `EARLYBIRD_LIVE_AI=1`을 설정해야 하며 본인 키·이용 코드가 필요합니다. 과거 주기 기반 화면의 `tests/research-browser-check.cjs`는 이전 기대값을 보존한 참고 스크립트이며 현재 기본 검사에 포함하지 않습니다. 현재 CSV 경로는 `tests/csv-browser-check.cjs`로 검사합니다. 실제 BLE 검사 스크립트는 장치와 브라우저 환경이 필요하므로 CI에서 자동 실행하지 않습니다.

## Vercel 배포

[배포 문서](docs/DEPLOYMENT.md)를 따르세요. **원본 폴더 전체를 업로드하지 않고** `npm run build`로 만든 `vercel_site`만 배포합니다. 기존 운영 배포 스크립트는 Codeplant의 지정 프로젝트만 허용하도록 보호되어 있습니다. 새 설치본의 배포는 문서의 별도 연결 절차를 사용하세요.

## 폴더 구조

```text
api/          서버 전용 OpenAI 분석 함수
dist/         웹 UI, BLE 해석, CSV 정제·분석·그래프
web/          브라우저 IndexedDB API와 Vercel 초기화
firmware/     ESP32 INO와 자세 필터 헤더
scripts/      빌드·개발 서버·배포·예시 리포트 생성
tests/        단위·저장 API·브라우저 검사
examples/     합성 CSV 예시
docs/         Codex 프롬프트·구조·배포·검증 설명
server.py     Python 로컬 서버
storage.py    측정 기록 저장과 검증
platform_store.py  복약·리포트·공유 준비 저장
```

## 해석 범위와 참고 논문

이 프로젝트는 연구·시연용 보행 기록 도구이며 임상적으로 검증된 파킨슨병 진단·개인 질병 확률을 제공하지 않습니다. 좌우 차이는 감도·장착·보정·걷기 조건을 함께 확인해야 합니다. 현재 펌웨어에는 원시 가속도·각속도가 없고, 양발 시계는 하드웨어 동기화되지 않았습니다. 보폭·속도·동결보행·정밀한 양발 지지시간을 검증한 시스템이 아닙니다.

- [Patoz et al. 2023](https://doi.org/10.3389/fnins.2023.1119390): 보행 속도를 통제한 압력·시간 지표 비교. 본 장치와 센서 수·샘플링 조건이 다릅니다.
- [Weiss et al. 2011](https://doi.org/10.1177/1545968311424869): 허리 가속도 분석. 신발 FSR·자세각과 직접 수치 비교하지 않습니다.
- [WearGait-PD](https://doi.org/10.1038/s41597-026-06806-2): 주기 정규화 참고 자료. 현재 CSV AI 경로의 주기 검출·질병 예측 성능을 검증하는 근거는 아닙니다.

작성한 프로젝트 코드는 [MIT License](LICENSE), 포함된 Pretendard 글꼴은 별도의 [SIL OFL 1.1](dist/assets/Pretendard-LICENSE.txt)을 따릅니다. [제3자 고지](THIRD_PARTY_NOTICES.md)를 확인하세요.
