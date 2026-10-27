# Vercel 배포

## 원칙

서버에서 사용할 키·이용 코드는 공개 저장소에 포함하지 않는다. 저장소 루트에는 원본·테스트·문서가 있으므로 **`vercel_site`만 배포**한다. 빌드는 공개 웹·서버 함수와 필요한 모듈만 선택해 복사한다.

일반적인 Vercel Git 연결로 이 저장소 루트 전체를 바로 배포하는 방식은 현재 구성이 아니다. 처음에는 아래 CLI 절차를 사용한다. 운영용 Git 자동 배포를 추가할 경우 별도 빌드·단계 경계를 검토한다.

## 본인 프로젝트에 새로 연결

Vercel CLI를 설치하고 본인 계정으로 로그인한다.

```powershell
npm install -g vercel
vercel login
npm ci
npm test
npm run test:python
npm run build
npm run check:public
vercel link --cwd vercel_site
```

연결 질문에서 **본인 팀과 대상 프로젝트**를 선택한다. `.vercel/project.json`은 로컬 연결 정보이므로 커밋하지 않는다. 이 저장소의 기존 `scripts/deploy_vercel.ps1`·`scripts/setup_vercel_ai.mjs`는 Codeplant 운영 프로젝트 ID를 확인하는 유지관리용 스크립트다. 새 프로젝트에서는 그대로 실행하지 않는다.

## AI 서버 환경변수

다음 명령은 대화형으로 값을 입력한다. 실제 키를 명령 인수·채팅·스크린샷에 넣지 않는다. 루트 `.env.local` 파일은 Vercel에 자동 업로드하지 않는다.

```powershell
vercel env add OPENAI_API_KEY production --cwd vercel_site --sensitive
vercel env add EARLYBIRD_AI_ACCESS_CODE production --cwd vercel_site --sensitive
vercel env add OPENAI_MODEL production --cwd vercel_site
```

모델 값은 `gpt-6.1-terra`다. 웹에서 입력하는 이용 코드는 서버의 `EARLYBIRD_AI_ACCESS_CODE`와 동일한 **본인 설치본의 코드**를 사용한다. 공개 서비스의 코드나 다른 사람의 키를 재사용하지 않는다.

배포 함수는 `VERCEL_URL`, `VERCEL_PROJECT_PRODUCTION_URL`에 해당하는 origin과 설정한 `EARLYBIRD_ALLOWED_ORIGIN`을 허용한다. Vercel 프로젝트의 시스템 환경변수 사용을 활성화한다. 별도 도메인을 쓰거나 시스템 환경변수가 없으면 정확한 HTTPS origin을 추가한다.

```powershell
vercel env add EARLYBIRD_ALLOWED_ORIGIN production --cwd vercel_site
```

값은 예를 들어 본인 운영 사이트의 `https://사이트주소` 형식이며 끝의 `/`는 넣지 않는다. 와일드카드나 임의 외부 origin을 추가하지 않는다. 환경변수 변경 후 다시 배포한다.

## 운영 배포와 확인

```powershell
vercel deploy --prod --cwd vercel_site
```

CLI가 출력한 운영 URL에서 다음을 확인한다.

1. CSV 업로드와 숫자 정제, 시간 그래프가 열린다.
2. 잘못된 이용 코드에서는 AI 호출이 거부된다.
3. 본인 코드·전송 동의 후 합성 CSV의 AI 리포트가 생성·저장된다.
4. 같은 브라우저에서 새로고침 후 보고서를 다시 열 수 있다.
5. 다른 브라우저에서 기록이 자동으로 보인다고 가정하지 않는다.

`/api/state`·`/api/platform`은 브라우저 안에서 처리하므로 외부 curl의 404는 중앙 기록 API 장애를 뜻하지 않는다. 실제 네트워크 AI 함수는 `/api/ai-analyze`다.

## Codeplant 운영 유지관리

원래 운영 프로젝트의 ID와 팀을 의도적으로 유지할 때만 `scripts/deploy_vercel.ps1`을 사용한다. 스크립트는 스테이징 경로·허용 파일·프로젝트 연결을 확인한다. 프로젝트 변경을 위해 보호 조건을 무조건 지우지 않는다.

이 저장소를 만들기 위한 작업에서는 기존 운영 사이트의 키·도메인·기록·펌웨어를 변경하지 않았다. GitHub 공개와 Vercel 운영 배포는 별도 작업이다.

참고: [Vercel 시스템 환경변수](https://vercel.com/docs/environment-variables/system-environment-variables), [Vercel CLI](https://vercel.com/docs/cli).
