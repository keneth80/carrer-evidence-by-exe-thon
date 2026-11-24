# Career Evidence — 근거로 이력서를 고치고 지원까지 이어 주는 에이전트

내가 가진 이력서 한 부로 시작합니다. 에이전트가 이력서를 점검하고 빠진 내용을 물어 보완한 뒤, 맞는 공고를 찾고, 공고마다 이력서를 대화로 맞춰 고쳐 지원서 제출까지 이어 줍니다.
에이전트는 **원문이나 내가 직접 말한 내용에 없는 수치·기술·직책을 이력서에 넣지 않습니다.** 모든 문장에 근거(원문 위치 또는 내 답변)가 붙습니다.

## 어떤 문제를 푸나요

- 공고마다 이력서를 다시 고치고, 지원서 문항을 채우고, 어디에 냈는지 관리하는 일이 반복됩니다.
- 생성형 AI로 이력서를 고치면 문장은 그럴듯해지지만 **하지 않은 성과나 과장된 역할**이 섞이기 쉽습니다. 면접에서 그대로 위험이 됩니다.
- 표·번호 제목이 많은 Word 이력서는 도구가 내용을 제대로 읽지 못해, 결국 사람이 다시 옮겨 적습니다.

## 사용 흐름

| 단계 | 사용자가 보는 것 | 에이전트가 하는 일 |
|---|---|---|
| 1. 이력서 등록 | PDF·Word(.docx)·텍스트 붙여넣기 | 원문을 읽고 회사·기간·직무·기술·업무를 후보로 나눔(원문 위치 표시) |
| 2. 내용 확인 | 후보 확인·일괄 포함/제외·원문 줄 추가 | 사용자가 확인한 것만 **확정 경력**으로 저장(버전 관리) |
| 3. 점검·보완 | "HR 전문가에게 점검받기" + 진행 막대 | 규칙 점검 → AI 점검 → 질문 → 답변으로 초안 작성 → 근거 검토 → 새 경력 버전 |
| 4. 공고 찾기 | 추천 공고와 추천 이유 | 확정 경력의 직무·기술로 검색어를 만들고 공고와 경력을 연결 |
| 5. 공고별 맞춤 | 공고 본문 붙여넣기, "HR 전문가에게 JD 점검받기" + 요구사항 점검표(근거 구절·검토 의견) + 진행 막대, AI 대화 + 변경 전후 비교, 회사별로 묶은 미리보기·PDF·Word | 요구사항 추출·대조 → 요구마다 HR 근거 판정(인용은 서버가 이력서와 대조) → AI 점검(질문) → 공고 전체 맞춤 수정안 작성 → 근거 검토, 새 사실은 확인 후에만 반영 |
| 6. 지원 | 확정 PDF·문항 답변·최종 승인 | 확장 프로그램이 폼 입력·첨부 후 다시 읽어 대조, 승인한 내용만 제출 |

## Liner API를 쓰는 곳

| 기능 | Liner API | 코드 | 켜는 설정 |
|---|---|---|---|
| 공고 검색(출처 포함) | Web Search `POST /api/v1/tools/search/web` | `packages/liner/src/web-search.ts` | `LINER_MODE=live` |
| JD 점검의 보충 검색(요약뿐인 공고 내용, 회사 참고 정보) | Web Search(같은 원장 한도) | `packages/tailor/src/research.ts`, `packages/liner/src/web-search.ts` | `LINER_MODE=live` + `CHAT_MODE=liner` |
| 이력서 AI 점검 | Router `POST /api/v1/chat/completions` (`liner-claude-router`, JSON schema 응답) | `packages/liner/src/review.ts` | `CHAT_MODE=liner` |
| 기본 이력서 보완 대화(점검·초안·근거 검토 단계 분리) | Router chat completions | `packages/liner/src/supplement.ts` | `CHAT_MODE=liner` |
| 공고(JD) 맞춤 점검(질문)·수정안 근거 검토 | Router chat completions(단계별 별도 호출) | `packages/liner/src/tailor-stages.ts` | `CHAT_MODE=liner` |
| 공고별 맞춤 수정안 작성 | Router chat completions | `packages/liner/src/chat.ts` | `CHAT_MODE=liner` |

- 모든 호출은 DB 원장(`ce7_provider_calls`)에 먼저 예약하고 보냅니다. 호출 수·예산 한도를 넘으면 보내지 않습니다.
- 점검·수정은 단계마다 따로 호출합니다. 보완 대화는 첫 점검 1건, 공고 맞춤 JD 점검은 요구사항별 근거 판정 + HR 점검 2건(요구 목록이 없는 공고는 추출 1건 추가), 답변 1턴은 작성 + 근거 검토 2건입니다.
- 전송 여부가 불확실한 유료 호출은 자동으로 재시도하지 않습니다. 이메일·전화번호는 가려서 보냅니다.
- 라우팅 전략(`LINER_CHAT_ROUTING=cost|balanced|quality`)으로 비용과 품질을 조절합니다.
- 모든 대화 호출의 시스템 프롬프트는 **HR 전문가 페르소나**로 시작하고, 점검·초안·공고 맞춤 호출에는 서류 검토 기준을 덧붙입니다(`packages/liner/src/persona.ts`). 페르소나는 근거 규칙보다 앞서지 않습니다.

## 실행 방법

이 서비스는 공개 주소 없이 **내 컴퓨터에서 실행**합니다. 웹·API·작업 처리기(worker)가 모두 `127.0.0.1`에서만 열리고, 로그인은 로컬 개발용 연결(이름만 입력)입니다.
아래 절차는 macOS, Node.js 24.19, npm 11.17에서 새로 받은 `main`으로 처음부터 끝까지 확인했습니다(2026-11-24).

### 1. 준비물

| 항목 | 필요한 버전 | 확인 명령 | 비고 |
|---|---|---|---|
| Node.js | 24.12 이상 24.x | `node -v` | `.nvmrc`가 24입니다. nvm을 쓰면 `nvm install 24 && nvm use` |
| npm | 11 이상 | `npm -v` | Node 24에 함께 설치됩니다 |
| Git | 아무 버전 | `git --version` | |
| 비어 있는 포트 | 4310(웹), 4311(API) | `lsof -i :4310 -i :4311` | 다른 프로그램이 쓰고 있으면 실행이 멈춥니다 |
| Google Chrome | 선택 | | 확장 프로그램으로 지원서 제출까지 해 볼 때만 필요합니다([7단계](#7-chrome-확장으로-지원서-제출하기선택)) |
| Python 3 + PyYAML·jsonschema | 선택 | | `npm run check:contracts`를 돌릴 때만 필요합니다 |

### 2. 받기와 설치

```bash
git clone https://github.com/keneth80/carrer-evidence-by-exe-thon.git
```

```bash
cd carrer-evidence-by-exe-thon
```

```bash
npm ci
```

- `package-lock.json`대로 설치합니다. 스캔본 PDF 글자 인식에 쓰는 `tesseract.js`와 한국어·영어 글자 자료도 함께 설치되며, 실행 중에 인터넷에서 따로 내려받지 않습니다.
- 설치 끝에 `npm warn allow-scripts ... fsevents, tesseract.js` 경고가 나올 수 있습니다. 실행에는 영향이 없습니다.

### 3. 설정 파일 만들기

```bash
cp .env.example .env
```

기본값은 **mock 모드**입니다. API 키 없이 모든 화면과 흐름을 볼 수 있고, AI 응답은 규칙 기반 합성 응답이며 화면에 'mock'으로 표시됩니다. API 키를 뺀 나머지 값(호출 한도·예산·라우팅·경로)은 모두 채워져 있어, Liner로 바꿀 때는 키와 모드만 바꾸면 됩니다.

| 설정 | 기본값 | 뜻 |
|---|---|---|
| `CHAT_MODE` | `mock` | 이력서 읽기·HR 점검·문장 추천·JD 점검·맞춤 수정에 쓰는 AI. `liner`면 Liner Router API(유료) |
| `LINER_MODE` | `mock` | 공고 검색. `live`면 Liner Web Search(유료)로 실제 공개 공고를 찾고, 아니면 합성 공고 목록 |
| `DATABASE_PATH` | `.data/career-evidence.sqlite` | SQLite DB 파일. 처음 실행할 때 자동으로 만들어집니다 |
| `OBJECT_DIR` | `.data/objects` | 올린 이력서·만든 PDF를 저장하는 폴더 |
| `LINER_CHAT_MAX_CALLS` · `LINER_CHAT_BUDGET_MICRO_USD` | `20` · `5000000`($5) | AI 대화 호출 수·예산 한도(`CHAT_MODE=liner`일 때만 씀) |
| `LINER_MAX_CALLS` · `LINER_BUDGET_MICRO_USD` | `20` · `2000000`($2) | 공고 검색 호출 수·예산 한도(`LINER_MODE=live`일 때만 씀) |
| `LINER_CHAT_ROUTING` | `quality` | 라우팅 전략(`cost`·`balanced`·`quality`) |
| `API_PORT` | `4311` | API 포트 |
| `DEMO_ORIGIN` | `http://127.0.0.1:4310` | 웹 주소. **바꾸지 않습니다**(웹·확장·API가 이 주소로 맞춰져 있습니다) |

설정과 설치 상태는 아래 명령으로 확인합니다. 출력된 `checks`가 모두 `"ok": true`이면 됩니다.

```bash
npm run doctor
```

### 4. 실행하기

```bash
npm run dev
```

API, 웹, worker가 함께 뜹니다. 아래처럼 나오면 준비된 것입니다.

```text
개발 화면: http://127.0.0.1:4310 | 검색 mock·mock 대화 worker 포함 | 지원은 자체 테스트 폼만
Career Evidence API: http://127.0.0.1:4311 (...)
Career Evidence worker: search_jobs(provider=mock) · tailor_resume(chat=mock, staged) · ...
  VITE v8.3.8  ready in ... ms
  ➜  Local:   http://127.0.0.1:4310/
```

브라우저에서 **http://127.0.0.1:4310/start** 를 엽니다(`localhost`가 아니라 `127.0.0.1`로 여는 것을 권장합니다). 끝낼 때는 터미널에서 `Ctrl+C`를 누릅니다.

### 5. 따라 해 보기(mock, 몇 분)

저장소의 **합성 이력서**(실제 인물 아님)로 전체 흐름을 볼 수 있습니다. 괄호 안은 화면의 버튼 이름입니다.

1. **연결:** `/start`에서 아무 이름(예: `demo`)을 넣고 **연결**을 누릅니다. 이름마다 자료가 따로 저장됩니다.
2. **이력서 등록:** `fixtures/resumes/frontend.synthetic.pdf`를 고르고 **이 파일 등록**을 누릅니다. `backend.synthetic.pdf`, `frontend.synthetic.docx`도 쓸 수 있고, 텍스트를 붙여넣어도 됩니다.
3. **내용 확인:** 읽은 항목이 회사·프로젝트·기술 묶음으로 나옵니다. 사람이 판단할 것만 맨 위 **확인할 것 N개**에 모이고, 원문 그대로인 묶음은 접혀 있습니다(**펼치기**로 열어 고치거나 뺄 수 있습니다). **확인한 내용 저장**을 누르면 확정 경력이 됩니다.
4. **(선택) 이력서 점검:** **HR 전문가에게 점검받기** → 질문에 답하거나 **문장 추천받기**로 문장을 고릅니다. 고른 문장은 확정 경력의 새 버전이 됩니다.
5. **공고 찾기:** **확인한 내용으로 공고 찾기** → **이 기준으로 공고 찾기**. mock에서는 합성 공고 목록이 나옵니다.
6. **공고 고르기:** 공고 카드의 **상세 비교 보기** → **이 공고에 맞춰 이력서 수정**.
7. **JD 맞춤:** **HR 전문가에게 JD 점검받기** → 요구사항별 충족·근거 약함·미기재 점검표가 나옵니다. **이 공고에 맞춰 수정해줘**를 보내고 수정안의 **모두 적용**을 누릅니다. 오른쪽 미리보기에서 **수정 전후 비교**를 누르면 바뀐 줄과 이유를 볼 수 있고, **Word로 내려받기**도 됩니다.
8. **최종본:** **최종 제출본 확인** → 확인 체크 → **이 버전으로 확정** → **PDF 만들기**. 파일의 SHA-256이 함께 표시됩니다.
9. **지원 준비:** **지원 준비 시작** → 문항(이름·이메일·지원 동기·동의)을 채우고 **답변 저장**. 실제 제출은 Chrome 확장으로 합니다([7단계](#7-chrome-확장으로-지원서-제출하기선택)).

### 6. Liner API로 실행하기(유료)

`.env`에서 키를 넣고 모드를 바꾼 뒤 `npm run dev`를 다시 실행합니다(한도 값은 `.env.example`에 이미 들어 있습니다). 키는 `.env`에만 넣고 코드·커밋에 적지 않습니다.

```bash
LINER_API_KEY=<발급받은 키>

# 이력서 읽기(검토 초안)·HR 점검·문장 추천·JD 점검·맞춤 수정
CHAT_MODE=liner
LINER_CHAT_MAX_CALLS=20
LINER_CHAT_BUDGET_MICRO_USD=5000000   # $5
LINER_CHAT_ROUTING=quality            # cost | balanced | quality

# 실제 공고 검색(필요할 때만). mock으로 두면 합성 공고로 흐름을 봅니다.
LINER_MODE=live
LINER_MAX_CALLS=20
LINER_BUDGET_MICRO_USD=2000000        # $2
```

- 한도는 DB 원장 기준의 **전체 합계**입니다. 호출 전에 최악 비용을 예약하고, 끝난 호출은 확인된 실제 비용으로 셉니다(보내는 중이거나 결과를 알 수 없는 호출은 예약 그대로). 넘으면 호출하지 않고, 그 단계는 규칙 결과로 돌아가거나 화면에 안내가 나옵니다.
- 참고 비용(2026-11-24 실측, `CHAT_MODE=liner`·`LINER_MODE=mock`): 실제 이력서로 읽기 → HR 점검·문장 추천 → JD 점검 → 맞춤 수정까지 Router chat 8건, 약 $0.56(이력서 읽기 1건 약 $0.16).
- `CHAT_MODE=liner`이면 이력서 내용·확정 경력·공고가 Liner로 전송됩니다(이메일·전화번호는 가려서 보냄). 화면에도 같은 안내가 나옵니다.
- 이력서 읽기에서 AI 정리가 돌지 않았으면 확인 화면에 **AI 정리 없이 읽은 결과** 안내가 나옵니다(mock이거나 한도·호출 실패).

### 7. Chrome 확장으로 지원서 제출하기(선택)

제출 대상은 저장소에 들어 있는 **개발용 자체 테스트 폼**(`http://127.0.0.1:4310/demo/apply/<공고>`)뿐입니다. 실제 기업에는 접수되지 않습니다.

1. Chrome에서 `chrome://extensions` → **개발자 모드** 켜기 → **압축해제된 확장 프로그램을 로드합니다** → 저장소의 `apps/extension` 폴더를 고릅니다.
2. 웹에서 5단계의 9번(지원 준비, 답변 저장)까지 진행합니다.
3. **지원 이력** 화면에서 **확장 연결 코드 만들기**를 누르고, 확장 아이콘으로 연 사이드 패널에 코드를 넣어 연결합니다.
4. 패널의 **지원 폼 열기** → **폼 확인·입력**: 답변 입력과 PDF 첨부 후 다시 읽어 서버와 대조합니다(아직 제출하지 않음).
5. 웹 지원 화면에서 내용을 확인하고 **승인하고 제출**을 누르면, 확장이 한 번 제출하고 사이트의 접수 기록(접수번호)으로 결과를 확인합니다.

자세한 절차와 자동 검증 방법은 [`docs/EXTENSION_START.md`](docs/EXTENSION_START.md)에 있습니다.

### 8. 데이터 위치와 초기화

- 모든 자료는 저장소 안 `.data/` 폴더에만 저장됩니다(DB와 올린 파일). `.data/`는 Git에 올라가지 않습니다.
- 처음 상태로 돌리려면 서버를 끄고 `.data/` 폴더를 지운 뒤 다시 `npm run dev`를 실행합니다.

```bash
rm -rf .data
```

### 9. 문제 해결

| 증상(터미널 메시지) | 원인 | 해결 |
|---|---|---|
| `DEPENDENCIES_MISSING: run npm ci` | 의존성을 설치하지 않음 | `npm ci` |
| `npm run doctor`에서 `Node 24.12+`가 `false` | Node 버전이 다름 | Node 24.12 이상 24.x로 바꾸기(`nvm use`) |
| `Error: Port 4310 is already in use` | 이미 실행 중이거나 다른 프로그램이 포트 사용 | 먼저 띄운 `npm run dev`를 `Ctrl+C`로 끄거나 `lsof -i :4310`으로 찾아 종료 |
| `STARTER_ORIGIN_FIXED` | `DEMO_ORIGIN`을 바꿈 | `.env`의 `DEMO_ORIGIN=http://127.0.0.1:4310`으로 되돌리기 |
| `LINER_API_KEY_REQUIRED` | `CHAT_MODE=liner` 또는 `LINER_MODE=live`인데 키가 없음 | `.env`에 `LINER_API_KEY` 넣기, 또는 두 값을 `mock`으로 |
| `LINER_CHAT_MAX_CALLS_INVALID`, `LINER_CHAT_BUDGET_INVALID` | `CHAT_MODE=liner`인데 대화 한도가 0이거나 비어 있음 | 1 이상의 정수로 넣기(6단계 예시) |
| `LINER_MAX_CALLS_INVALID`, `LINER_BUDGET_INVALID` | `LINER_MODE=live`인데 검색 한도가 0이거나 비어 있음 | 1 이상의 정수로 넣기 |
| `LINER_CHAT_ROUTING_INVALID` | 라우팅 값 오타 | `cost`, `balanced`, `quality` 중 하나 |
| 화면에 `답변을 만들지 못했어요 (LINER_BUDGET_LIMIT)` | 이 DB에서 쓴 비용 + 이번 호출의 최악 예약이 대화 예산을 넘음 | `.env`의 `LINER_CHAT_BUDGET_MICRO_USD`를 올리고 다시 실행하거나, `.data`를 지워 새 DB로 시작 |
| `LOCAL_DEV_AUTH_NOT_FOR_PRODUCTION` | `NODE_ENV=production`으로 실행 | 이 버전은 로컬 실행 전용입니다. `NODE_ENV`를 지우고 실행 |
| 스캔본 PDF가 오래 걸림 | 그림에서 글자를 인식하는 중(최대 8쪽, 100초 한도) | 기다리거나, 텍스트를 붙여넣어 등록 |
| 확인 화면에 항목이 하나도 안 보임 | 확인할 것이 없어 묶음이 모두 접혀 있음 | 묶음의 **펼치기**를 누릅니다 |

## 에이전트가 지키는 원칙

- 원본 문서·확정 경력·공고별 이력서·제출 파일을 따로 저장합니다. 이전 버전과 과거 제출본을 덮어쓰지 않습니다.
- 경력 사실은 원문 위치나 **사용자가 직접 쓴 메시지**에만 근거합니다. 에이전트가 다듬은 문장은 사용자가 자기 답변으로 보내기 전까지 사실이 아닙니다.
- 숫자·기술명·책임 범위 표현(리드·총괄 등)이 근거에 없으면 서버가 저장을 막습니다(`packages/tailor/src/guard.ts`).
- 제출은 회사·공고·파일 hash·답변에 묶인 **사용자 승인**이 있어야 합니다. 클릭 성공을 접수로 보지 않고, 접수 불명은 자동 재제출하지 않습니다.
- 검색 질의에 연락처 등 개인정보를 넣지 않습니다.

## 검증

```bash
npm test                 # 단위·통합 테스트(합성 자료)
npm run build            # 타입 검사 + 웹·확장 빌드
npm run check:integration
npm run check:contracts  # Python 3 + PyYAML·jsonschema 필요(contracts/README 참고)
```

## 폴더 구조

| 경로 | 내용 |
|---|---|
| `apps/web` | React 화면 |
| `apps/api` | Node HTTP API(세션·소유권·멱등성·revision 검증) |
| `apps/worker` | 추출·검색·대화·점검·PDF·제출 작업(lease 기반 영속 작업) |
| `apps/extension` | Chrome 확장(폼 입력·첨부·제출 실행기) |
| `packages/resume` · `packages/tailor` · `packages/liner` | 추출 규칙 · 근거 검사·점검·대화 · Liner provider |
| `contracts/v0.7` | OpenAPI·도메인 schema·SQLite migration |
| `fixtures/resumes` | 합성 이력서(실제 인물 아님) |

## 한계

- 공개 서비스 주소는 없습니다. 운영용 로그인이 없어 로컬(`127.0.0.1`) 실행 전용이며, 실행 화면은 데모 영상으로 대신합니다.
- 개발용 mock 검색은 합성 공고를 씁니다. 실제 공고 검색은 `LINER_MODE=live`일 때입니다.
- 브라우저 제출은 저장소에 포함된 **자체 테스트 폼**만 지원합니다. 외부 채용 사이트 adapter는 아직 없습니다.
- Chrome 확장은 개발자 모드로 직접 설치합니다(`docs/EXTENSION_START.md`).

개발 운영 문서는 `docs/DEV_GUIDE.md`, 설계 결정은 `DECISIONS.md`, 코드 지도는 `docs/CODEMAP.md`에 있습니다.
