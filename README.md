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

필요한 것: Node.js 24.x(`.nvmrc`), npm 11 이상.

```bash
npm ci
cp .env.example .env     # 값은 직접 채웁니다. API 키는 코드에 적지 않습니다.
npm run dev              # 웹 http://127.0.0.1:4310 · API http://127.0.0.1:4311 · worker 함께 실행
```

1. http://127.0.0.1:4310/start 를 열고 프로필 이름(아무 이름)으로 로컬 연결합니다.
2. `fixtures/resumes/`의 **합성 이력서**(PDF·Word)를 올리면 전체 흐름을 볼 수 있습니다.

### Liner API로 실행하기(심사용 키)

`.env`에 아래 값을 넣고 `npm run dev`를 다시 실행합니다. 한도 값은 예시입니다.

```bash
LINER_API_KEY=<심사용 키>
# 공고 검색
LINER_MODE=live
LINER_MAX_CALLS=20
LINER_BUDGET_MICRO_USD=2000000
# 점검·보완·맞춤 대화
CHAT_MODE=liner
LINER_CHAT_MAX_CALLS=20
LINER_CHAT_BUDGET_MICRO_USD=5000000
LINER_CHAT_ROUTING=quality   # 결과 품질 우선(라우터가 요청마다 모델 선택)
```

키 없이 실행하면 모든 AI 기능이 **mock**(규칙 기반 합성 응답)으로 동작하고, 화면에 mock임을 표시합니다.

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

- 개발용 mock 검색은 합성 공고를 씁니다. 실제 공고 검색은 `LINER_MODE=live`일 때입니다.
- 브라우저 제출은 저장소에 포함된 **자체 테스트 폼**만 지원합니다. 외부 채용 사이트 adapter는 아직 없습니다.
- Chrome 확장은 개발자 모드로 직접 설치합니다(`docs/EXTENSION_START.md`).

개발 운영 문서는 `docs/DEV_GUIDE.md`, 설계 결정은 `DECISIONS.md`, 코드 지도는 `docs/CODEMAP.md`에 있습니다.
