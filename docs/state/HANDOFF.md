# 다음 작업 인계 — 통합 v0.7

## 협업자 인계 — 2026-11-21

이 저장소는 2026-11-21 기준 `main`이 최신이다(공개 저장소). 이어서 작업할 때 먼저 볼 것:

- 규칙: `CLAUDE.md`(제품 불변 조건·먼저 물을 것), `AGENTS.md`(다른 코딩 에이전트용 요약), `DECISIONS.md`(결정과 이유, 최근 S1-22 ~ S1-29·S2-14).
- 코드 위치: `docs/CODEMAP.md`. 진행·검증 기록: `docs/state/PROGRESS.md`(아래쪽이 최신).
- 실행: `npm ci` → `npm run dev`(키 없으면 전부 mock). 검증: `npm run typecheck`, `npm test`(251개), `npm run build`, `npm run check:integration`. `check:contracts`는 PyYAML·jsonschema가 필요해 이 환경에서는 실행하지 못했다(BLOCKED).
- 실호출: `.env`의 `LINER_API_KEY`(값은 저장소에 없음) + 명령줄 한도(`LINER_MAX_CALLS` 등, README). 검색 1회 = 요청 5건, JD 점검 1회 = 대화 2~3건 + 보충 검색 0~2건, 수정 1턴 = 대화 2건.

**2026-11-19 이후 들어간 것(모두 구현·자동 테스트, 실호출 확인):** 점검 항목의 작성 예시와 추천 문장 고르기·중복 정리, 기본 이력서·공고별 이력서 Word 내려받기, 회사별 배치(미리보기·PDF·Word, 프로젝트·소제목 묶음), 직군별 HR 기준과 HR 실무 기준·면접 예상 질문, 공고 본문 붙여넣기(migration 014), 요구사항별 HR 근거 판정, 공고 전체 맞춤 수정, 채용 사이트 우선 검색(site: 묶음, 경유 링크 처리), JD 점검 보충 검색.

**알려진 한계·다음 후보(우선순위 순):**

1. 외부 채용 사이트 지원: 자체 테스트 폼만 지원한다. 실제 공고(live)는 확정 PDF·Word까지만 된다. 사이트 adapter·정책 기반 자동 제출(S07)은 미구현.
2. 공고 본문: 검색은 요약(약 100자)만 준다. 붙여넣기와 보충 검색으로 보완했지만 원문 전체를 자동으로 읽지는 않는다. 검색 결과의 절반 이상인 경유 링크(google.com/goto)는 원래 주소를 알 수 없다.
3. 회사 이름: 제목·요약에 회사 이름이 없으면 출처 사이트가 회사 칸에 나온다(이때 보충 검색도 하지 않는다).
4. 화면 확인 NOT_RUN: 추천 문장 고르기·중복 정리·Word 내려받기의 실제 클릭, 확정 → PDF 내려받기는 사용자 브라우저 확인에 맡겼다.
5. 기본 이력서 확정 경력에 '프로젝트' 종류가 없어 배치 규칙(마지막 회사 뒤 '이름 | 설명' 줄)으로 묶는다. 추출 단계에서 종류를 나누면 더 정확하다.
6. `check:contracts` 실행 환경, 새 PC clone 재현, 대회 제출 형식 확인.

**지켜야 할 것:** 근거 없는 수치·기술·직책을 이력서에 넣지 않는다(결정적 검사 + 근거 검토). 검색·공고 본문은 경력의 근거가 아니다. 사용자 확인(`reviewed: true`)·제출 승인을 대신하지 않는다. 실제 이력서·키·개인 경로를 저장소·로그·fixture에 넣지 않는다. 계약(`contracts/v0.7`)을 바꾸면 schema·openapi·README·MANIFEST를 함께 맞춘다.

### 추가 — 추출 확인 화면 묶음(S1-30, 2026-11-21)

- 확인 화면이 회사·프로젝트·기술·학력 묶음으로 나오고 묶음 체크박스로 전체를 넣고 뺀다. 실호출 대화가 켜져 있으면 이력서를 읽을 때 Liner가 분류와 속한 회사를 한 번 보정한다(mock은 규칙만).
- 확인: typecheck PASS, 테스트 257건 PASS, build PASS, 합성 이력서 실호출 1건과 브라우저에서 묶음 머리·묶음 체크박스 동작 확인.
- 한계: 이미 읽어 둔 이력서는 다시 읽지 않으므로 Liner 보정이 적용되지 않는다(화면 묶음은 적용). 묶음 안의 항목 카드는 예전 크기 그대로다. 추출 작업의 `provider_transmission` 표시는 이 호출을 반영하지 않는다(원장 `ce7_provider_calls`에는 남는다).
- 주의: `apps/web/src/resume/FactEditor.tsx`·`ReviewPage.tsx`를 고쳤다. 같은 파일을 고치는 다른 작업과 합칠 때 확인한다.

### 추가 — 이력서 정리와 읽기 진행 표시(S1-31, 2026-11-21)

- 이력서를 읽을 때 Liner에 원문 전체(연락처·머리글 줄 가림)를 보내고, 끊긴 줄 잇기·붙은 줄 나누기·제목 줄 빼기·빠진 줄 살리기를 받는다. 서버가 원문과 글자 단위로 대조해 맞는 작업만 적용한다.
- 읽는 동안 3단계 로딩바(파일 읽기 → AI 정리 → 원문 대조·저장)를 보여 준다. 단계는 작업의 `provider_transmission`에서 읽는다.
- 확인: typecheck PASS, 테스트 261건 PASS, build PASS, 합성 이력서 실호출 1건. 로딩바는 세 상태의 렌더 결과만 확인했고 브라우저에서 실제 업로드로 보지는 못했다(브라우저 세션이 사용자와 공유되어 시험 계정으로 바꾸지 않았다).
- 한계: 원문에서 떨어져 있는 줄은 잇지 못한다(2단 편집 PDF). 이미 읽어 둔 이력서에는 적용되지 않는다. 머리글 줄에 있는 직함은 가려져서 살리지 못한다.

### 추가 — 모델이 항목을 정하는 읽기(S1-32, 2026-11-21)

- 실호출에서는 규칙으로 자른 뒤 고치던 방식 대신, 원문 전체를 Liner에 보내 Liner가 항목(원문 줄 범위 + 분류)과 순서를 정한다. 문장은 서버가 원문 그대로 이어 만든다. 위 S1-30·S1-31 항목의 '분류·묶음 보정', '잇기·나누기·빼기·살리기' 설명은 이 방식으로 대체됐다(`applyStructure`는 없어졌다).
- mock·호출 실패·재시도에서는 예전 규칙 추출 결과가 그대로 나온다.
- 확인: typecheck·테스트·build PASS, 실제 PDF 1건 실호출(개수·분류만 확인, 12.6초, 약 $0.067).
- 한계: 같은 PDF도 호출마다 묶음 크기가 조금 달라진다. 긴 이력서는 '기타' 분류 항목이 많이 남는다. 한 항목은 이어진 줄만 묶을 수 있다.

### 추가 — 기간 누락 수정과 구역 제목 묶음(S1-33, 2026-11-21)

- 한 줄에 붙은 회사·직함·기간을 나눌 때 조각 순서가 원문과 달라 기간이 버려지던 문제를 고쳤다.
- 확인 화면에서 '기타'로 몰리던 항목을 원문의 구역 제목별 묶음으로 보여 준다(표시 전용).
- 확인: typecheck·테스트·build PASS, 실제 PDF 실호출(개수·분류만 확인). 화면은 브라우저에서 직접 보지 못했다.
- 한계: 제목 판별은 길이·모양 규칙이라 제목이 아닌 짧은 줄이 묶음 제목이 될 수 있다. 호출마다 항목 수가 조금 다르다.

### 추가 — 다양한 PDF 양식 대응(S1-34, 2026-11-23)

- 글자를 그린 순서가 뒤섞인 PDF(디자인 도구로 만든 표·단·글상자)는 화면 위치로 줄·단·표를 다시 맞춰 읽는다. 순서가 맞는 PDF는 이전과 똑같이 읽는다.
- 확인: 합성 PDF 5종 테스트, 실제 PDF 2개는 결과 변화 없음, 좁은 왼쪽 단 + 표 합성 PDF 실호출 1건.
- 한계: 스캔 이미지 PDF는 읽지 못한다. 뒤섞임 판단과 표·2단 구분은 경험 규칙이라 양식에 따라 틀릴 수 있다. 3단 이상은 가장 뚜렷한 경계 하나만 나눈다. 실제 PDF는 2개로만 확인했다.

## 현재 위치 — 2026-11-18

**S01 완료(자체 검증):** 로컬 개발 세션 → 텍스트 PDF/붙여넣기 등록 → 규칙 기반 추출 → 원문 위치와 함께 확인·수정 → 확정 경력 revision 저장·재열람. 근거는 `PROGRESS.md`의 'S01 검증 기록'.

**S02 완료(자체 검증, mock):** 확정 경력 화면의 '확인한 내용으로 공고 찾기' → `/resumes/:id/search`(검색에 쓰는 직무·기술 사실 표시 + 희망 조건 입력) → `POST /search-intents`(현재 확정 revision만, 개인정보 제외 질의) → `POST /resume-searches`(task·search run 저장, 202) → **별도 worker 프로세스**(`apps/worker`)가 claim·lease·heartbeat·CAS로 mock provider 실행 → `/searches/:id`에서 공고·추천 이유·확인할 조건·상세 비교. 재시작·취소·만료 lease·지연 결과·타 사용자 접근을 검증했다. 근거는 `PROGRESS.md`의 'S02 검증 기록', 결정은 `DECISIONS.md`의 S2-01~S2-09. 독립 리뷰(MEDIUM 4·LOW 9) 반영 완료.

**S04 완료(자체 검증, mock 대화·실제 PDF):** 검색 결과 상세의 '이 공고에 맞춰 이력서 수정' → `/tailoring/:id`(공고 요구 / AI 대화 / 이력서 미리보기, 작은 화면은 탭) → 메시지 저장 + `tailor_resume` 작업(worker) → 변경 제안 카드(전·후·이유·근거) → 전체·부분 수용 / 거절 / 되돌리기(새 revision) → 확정 경력에 없는 내용은 질문, 사용자가 쓴 진술은 '경력 정보에 추가'(`user_statement` 근거 새 fact revision) 후에만 적용 → `/tailoring/:id/final`에서 확인·확정(hash·근거·다른 회사명 검사) → `render_resume` 작업이 실제 PDF(pdf-lib + 나눔고딕 전체 임베딩) 생성·hash 저장 → iframe 미리보기·내려받기. 근거는 `PROGRESS.md`의 'S04 검증 기록', 결정은 `DECISIONS.md`의 S4-01~S4-12. 독립 리뷰(HIGH 1·MEDIUM 5·LOW 9) 반영 완료.

**브라우저 관찰에서 발견·수정한 중요 결함:** pdf-lib 서브셋 임베딩이 한글 글리프를 빠뜨려 PDF 글자가 보이지 않았다(텍스트 추출 검사는 통과). 전체 임베딩으로 고치고 글리프 윤곽선 검사를 테스트에 넣었다. PDF 관련 변경 시 `tests/helpers/pdf-glyphs.mjs` 검사와 실제 렌더(브라우저 또는 `sips -s format png`) 확인을 함께 한다.

**S05 완료(자체 검증, 자체 테스트 폼·Chrome):** 최종 제출본 화면의 '지원 준비 시작' → `/applications/:id`(문항 답변 저장 → Chrome 확장으로 폼 확인·입력 → 최종 확인·'승인하고 제출' → 접수 결과 → 채용 진행) → 확장(1회 코드로 연결한 기기 토큰)이 자체 폼(`/demo/apply/<공고>`)에 답변 입력·확정 PDF bytes 첨부 → 값·파일 hash readback을 서버가 대조 → 수동 권한(revision·payload·파일 hash·대상·폼 구조 hash·15분) → 시도 → 전송 직전 재검증 후 `dispatched` → 제출 → 사이트 접수 기록 대조로 접수 확정. 접수 불명은 영속 상태이고 '접수 결과 확인'은 조회만 한다. `/applications`에서 제출 당시 공고·파일·답변·권한·근거를 다시 열고, 외부 지원 기록·기기 연결을 관리한다. 근거는 `PROGRESS.md`의 'S05 검증 기록', 결정은 `DECISIONS.md`의 S5-01~S5-13, 내부 프로토콜은 `docs/EXECUTOR_PROTOCOL.md`. 독립 리뷰(MEDIUM 3·LOW 9) 실질 항목 반영 완료.

**자체 폼 검증은 외부 기업 접수 검증이 아니다.** 자체 폼의 접수 키·봉인 보장은 외부 사이트에 쓰지 않는다. 사이드 패널의 실제 클릭 경로는 사용자 제스처가 필요해 자동 검증하지 못했다(NOT_RUN, `docs/EXTENSION_START.md`의 수동 절차로 확인).

**제품 단계 1·2·3(자체 폼)은 mock provider 범위에서 완료 기준을 확인했다.** 실제 공고(Liner live, S03)와 제품 대화 모델은 아직이다. 사용자가 `.env`에 `LINER_API_KEY`를 등록해 두었다고 알렸다(2026-11-17). 값은 읽지 않았고, **최종 테스트 때 live 검증에 사용**한다. 확인할 때는 값 대신 존재 여부만 출력한다.

**S06 완료(자체 검증, mock·제출 없음):** 직접 준비한 지원 건 화면의 '이 지원을 기준으로 비슷한 공고 찾기' → `/campaigns/new/:지원건`(기준 표시·모드·서류 전략·조건·한도 → 정책 저장 → hash 확인·동의) → 캠페인 실행(`discover_similar` worker) → `/campaigns/:id` 대기함(유사 이유·조건·중복·필요한 확인·파일 버전·보류 이유, 준비된 지원서 링크). 근거는 `PROGRESS.md` 'S06 검증 기록', 결정은 `DECISIONS.md` S6-01~S6-12. 시연 데이터는 `node scripts/demo-seed.mjs`(개발 서버 실행 중).

## 다음 한 작업

**하네스 운영(2026-11-19):** 완료 전 Stop 훅이 검증 원장을 확인한다(`.claude/hooks/ledger-stop-check.mjs`). 원장 갱신: `python3 ~/.claude/plugins/cache/harness-design-kit/harness-core/<버전>/scripts/verify_run.py`. 감사 로그에 pass도 기록(`HARNESS_MONITOR=1`), 요약은 같은 폴더 `audit_report.py`. 교훈 L1~L5(`docs/lessons-learned.md`)를 코드 작성 전에 읽는다. 저장소 검색은 `rg`.

**2026-11-19 공고(JD) 맞춤 점검·수정 오케스트레이션(S1-18, migration 013 = v0.7.6, mock·자동 테스트 PASS, 커밋 전):** 편집 화면 'JD 점검받기' → 요구사항 대조(충족·근거 약함·미기재) → AI 점검(질문만) / 답변 턴 수정안 작성 → 근거 검토(닫힌 쪽 실패). `POST /api/v1/tailoring-sessions/{id}/jd-checks`, 세션 `progress`, 메시지 `turn`. 다음: 데모 DB 백업 → 서버 재시작(013 적용) → 합성 이력서·합성 공고로 JD 점검·진행 패널·점검표·뺀 수정안 브라우저 확인 → Liner live(JD 점검 1건 + 답변 턴 2건) 승인 한도 안에서 확인.

**2026-11-19 보완 대화 오케스트레이션(S1-17, migration 012 = v0.7.5, mock·자동 테스트 PASS, 커밋 전):** 규칙 점검 → AI 점검 / 초안 → 근거 검토, 진행 패널(`AgentProgress.tsx`), 기존 항목 바꾸기, 비교 평가 `node scripts/supplement-eval.mjs --provider=mock|liner --fixtures=… --max-calls=N`. 다음: 데모 서버 재시작(012 적용) → 브라우저 진행 패널 확인 → Liner live 평가(승인 한도 안).

**2026-11-19 기본 이력서 보완 대화(S1-16, migration 011 = v0.7.4, mock 구현·자동 테스트 PASS, 커밋 전):** 확정 경력 화면 맨 위 '에이전트 이력서 점검·보완' → 점검·질문 → 답변 → 내 문장만 경력 후보 → '경력에 추가'(새 경력 버전, user_statement 근거). 남은 일: 개발 서버 재시작 후 브라우저 확인, Liner live 확인(승인 20건·$5 범위), 커밋(사용자 요청 시). 근거는 PROGRESS.

**2026-11-19 1차 점검 완료(규칙 S1-13 + AI S1-14, migration 010 = v0.7.3)·직무별 문장 패턴(S4-15).** Liner 대화·점검 실호출 6/8건(사용자 승인 8건·$2), 확인 비용 $0.0996, 결과 불명 0. 근거는 PROGRESS. 점검은 안내·질문만 하고 확정 경력을 바꾸지 않는다. 남은 일: 화면(브라우저) 확인, 커밋(사용자 요청 시).

**2026-11-19 안티슬롭(S4-13)·Liner 대화 provider(S4-14) 구현, 실호출 4/5건 PASS(비용 $0.045).** 재검증: `CHAT_MODE=liner LINER_CHAT_MAX_CALLS=5 LINER_CHAT_BUDGET_MICRO_USD=2000000 node --env-file-if-exists=.env scripts/liner-chat-check.mjs [--usage]`. 남은 사용자 결정: 1차 점검(AI 품질 점검) 설계, '잘된 이력서 참고' 방식.

**2026-11-19 Word(.docx) 업로드 추가(S1-12, migration 009 = v0.7.2).** 근거는 PROGRESS. 사용자 확인 대기: (1) 흐름의 '기본 이력서 1차 점검'이 현재의 추출 확인·확정이면 되는지, AI 품질 점검 단계를 더할지 (2) 대화 수정에 Liner Router API(`/api/v1/chat/completions`) 사용 여부 — 조사 결과는 조건부 가능(60일 보관·국외 이전·민감정보 금지 약관) (3) '안티슬롭' 적용 대상.

**S03 실호출 검증 완료(2026-11-18, 총 6건·확인 비용 $0.006·결과 불명 0, 사용자 승인 한도 20건·$10 안).** 남은 승인 호출 14건. 다음 한 작업: S08 마무리(대회 제출 형식·마감은 사용자 안내 필요, 새 PC clone 재현, 데모 영상). live 재검증 명령: `LINER_MODE=live LINER_MAX_CALLS=20 LINER_BUDGET_MICRO_USD=10000000 node --env-file-if-exists=.env scripts/liner-live-check.mjs` (먼저 `--usage`). **원장 한도는 DB 파일 단위다** — 임시 DB로 띄운 개발 서버는 0부터 센다. 승인 총량(20건)은 PROGRESS의 누적 기록으로 관리한다.


**S08 로컬 시연 정리 계속** — `docs/DEMO_RUNBOOK.md`, `node scripts/demo.mjs`(제출 직전 멈춤). 남은 일: 새 PC clone 재현, 대회 제출 형식·마감 확인(사용자 안내 필요), 데모 영상. S03(Liner live) 실호출 검증이 먼저다(위).

**S07은 보류(2026-11-18 사용자 결정: 제출하지 않음).** 재개 시 아래 메모를 따른다. 모든 시연·검증 스크립트는 기본 제출 직전 멈춤이며 로컬 자체 폼 제출은 `--submit-local`일 때만 한다(DECISIONS S6-13).

S07 메모: 정책 안의 자동 지원·중지·불명 처리 (`prompts/05-auto-apply.md`).

- 정책 `submit` 모드를 열되(현재 422), 공고마다 `kind=policy` 권한을 만들고 한도·비용 예약(`ce7_quota_reservations`)·generation을 dispatch 직전에 검증한다(007 trigger가 이미 강제).
- 자동 제출도 S05 실행기(확장)·자체 폼 경로를 그대로 쓴다. 답변·동의가 비어 있거나 새 질문·조건 미확인이면 사용자 처리로 넘긴다. 일시중지·철회는 새 전송만 막고 전송 중인 건은 결과 관측을 계속한다.
- S06 리뷰 한계(기준 revision 비교·비용 한도 집행·캠페인 완료 전환)도 함께 다룬다.

S03(Liner live)는 코드 구현 완료(2026-11-18), 실호출 검증은 위 '다음 한 작업'의 명령으로 한다. `LINER_API_KEY`는 존재 여부만 확인한다.

## 우선 읽을 경로

루트 CLAUDE.md → 이 파일과 PROGRESS.md → docs/CODEMAP.md → prompts/solo-start.md → 단계 1 프롬프트 → contracts/v0.7/README.md와 해당 계약.

## 첫 변경에서 주의할 점

- 고정 React query·합성 프로필 선택으로 업로드 경로를 대체하지 않는다. 합성 이력서 파일도 사용자 입력과 같은 파이프라인을 거친다.
- 원본·추출·확정 사실·선호 조건을 분리하고, principal/workspace 소유권으로 조회한다. 클라이언트가 지정한 소유자 ID만 믿지 않는다.
- v0.7 migration과 기존 전체 DB 객체 검증의 호환성을 함께 구현한다. DB 파일 삭제나 자동 reset으로 충돌을 피하지 않는다.
- 검색 요청은 확정 경력·선호 조건의 버전을 고정한다. 연락처 등은 검색 질의에서 제외한다.
- 작업 저장·worker 재시작·idempotency·lease generation을 구현한다. 지연 결과가 새 버전을 덮지 못하게 한다.
- 실제 대화 모델·첫 채용사이트 선택 없이도 mock 기반 첫 흐름은 완성할 수 있다.

## 재현 명령

```bash
npm ci
npm run doctor
npm test
npm run db:check
npm run build
npm run dev   # API → health 확인 후 worker 자동 기동. http://127.0.0.1:4310/start 에서 로컬 연결 후 이력서 등록
npm run worker  # worker만 따로 실행(API와 같은 DATABASE_PATH)
node scripts/chrome-apply-e2e.mjs --headful  # 제출 직전까지(기본, 제출 없음) Chrome 창으로 보여 줌. 4310·4311이 비어 있어야 함
node scripts/chrome-apply-e2e.mjs --submit-local  # 로컬 자체 폼 제출까지 하는 S05 전체 검증(사용자 허락 시에만, 약 2분)
```

DB·파일은 기본으로 `.data/career-evidence.sqlite`, `.data/objects/`에 저장된다(`DATABASE_PATH`, `OBJECT_DIR`로 변경). 계약 검사는 `jsonschema`·`PyYAML`이 있는 Python으로 `python scripts/check_contracts.py`를 실행한다.

계약 검사는 README의 Python 환경(예: `/tmp/ce-contracts-venv`, `requirements-validation.txt`)을 준비한 뒤 `npm run check:contracts`(S01·S02·S04·S05 실제 응답 schema 검증 포함), 통합 자료 검사는 `npm run check:integration`을 사용한다. `npm run worker`는 `search_jobs`·`tailor_resume`·`render_resume`·`submit_application`(접수 결과 확인)을 실행한다. 기존 `.data` DB는 다음 실행 때 v0.7.1 migration이 제자리 적용된다. worker 없이 API만 띄우면 검색은 '대기 중'으로 남는다(정상).

## 실제 확인할 결과

서로 다른 이력서의 역할·기술이 검색 계획을 바꾸는지, 경력 확인 전 검색이 제한되는지, 추출 실패가 복구 안내로 연결되는지, 재시작 후 결과가 남는지, 사용자 A의 자료에 사용자 B가 접근할 수 없는지 확인한다. 합성·mock 검증은 live 검증으로 보고하지 않는다.

## 다음 인계에 남길 항목

완성한 사용자 흐름 / 핵심 변경 파일 / 실행한 검증·환경·결과 / 남은 결함·NOT_RUN / 다음 한 작업 / 관련 결정 ID를 기록한다. 비밀 값과 실제 이력서 원문은 인계 문서에 복사하지 않는다.

## 현재 실행 책임 — 2026-11-17

전체 기술 구현·통합·자체 검증은 개발자가 맡는다. 협업자가 만든 API나 검토를 기다리지 않는다. 현재 사용자 PC에 새 구현이 있다면 이 문서의 초기 상태보다 실제 코드·검증을 우선해 다음 작업을 정정한다. v0.9를 기존 폴더에 일괄 덮어쓰지 않는다.

현재 세션의 입력·출력과 실제 검사 근거를 남겨 다음 Claude Code 세션이 그대로 이어가게 한다. 협업자의 사용자 검수·발표 도움은 선택이며 참여하지 않아도 개발을 계속한다.
