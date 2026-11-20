# 구현 진행 상태 — 통합 v0.7

자료 기준일: **2026.11.18 · 한국 시간**. 사용자 PC에서 진행한 작업은 이 패키지에 반영되어 있지 않으므로 재개 시 실제 코드를 먼저 확인한다.

상태: **S01·S02·S04·S05_VERIFIED · S06_VERIFIED(mock·추천/자동 준비, 제출 없음) · S07_NEXT** (2026-11-18) — 이력서 등록→확정 경력→mock 검색→맞춤 이력서·PDF→Chrome 확장으로 자체 폼 지원·접수 근거→지원 이력, 그리고 제출한 지원을 기준으로 유사 공고 탐색·조건/중복 판단·공고별 서류 자동 준비(제출 없음)·대기함까지 로컬에서 연결되었다. Liner live(S03)·제품 대화 모델·정책 기반 자동 제출(S07)·외부 기업 사이트·Ego는 미구현이다.

| 영역 | 상태 | 증거·다음 작업 |
| --- | --- | --- |
| 통합 제품·UI·아키텍처·단계 프롬프트 | DOCUMENTED | docs 현재 문서, prompts/solo-start.md |
| 사용자 방향과 구현 기본값 | DOCUMENTED | 루트 DECISIONS.md |
| v0.4 기준 사본 | PRESERVED | 기존 계약·해시·회귀 보존 |
| v0.7 신규 계약·migration 설계 | SPECIFIED | contracts/v0.7. 실행한 검사는 reports/VALIDATION.md 참조 |
| TypeScript·React·SQLite·mock 기반 | FOUNDATION_IMPLEMENTED | 기존 실행 코드 포함. 이번 검증은 reports/VALIDATION.md |
| 합성 비교·근거·자체 폼 미리보기 | FOUNDATION_IMPLEMENTED | /api/starter/preview. 실제 제품 파이프라인과 분리 |
| Chrome 확장 실행기(자체 폼) | IMPLEMENTED (S05) | 기기 연결·입력·첨부·readback·제출·결과 관측. 외부 사이트·Ego 없음 |
| S01 이력서 등록→추출 확인→확정 경력 저장·재열람 | VERIFIED (local_dev 세션·mock) | 2026-11-17. 텍스트 PDF·붙여넣기 실제 bytes 등록, pdfjs 로컬 추출, 원문 위치·후보 확인·수정·확정 revision, 소유권 404, 재시작 후 재열람. 아래 'S01 검증 기록' |
| S02 확정 경력→SearchIntent→영속 mock 검색→공고 표시 | VERIFIED (local_dev 세션·mock provider) | 2026-11-17. 검색 계획(직무·기술 사실만, 개인정보 제외)·희망 조건 분리·별도 worker 프로세스 claim/lease/heartbeat/CAS·취소·재시작 복구·추천 이유/확인할 조건 화면. 아래 'S02 검증 기록' |
| 1. 이력서 등록→확정 경력→검색 (제품 단계 1 전체) | VERIFIED (mock) | S01+S02 연결. 실제 공고 검색 품질·출처는 S03(live) 전까지 NOT_RUN |
| 2. AI 대화→맞춤 이력서→PDF (S04) | VERIFIED (local_dev 세션·mock 대화·실제 PDF) | 2026-11-17. 편집 세션·대화·제안(전체/부분 수용·거절·되돌리기)·새 사실 확인(user_statement)·확정·PDF(pdf-lib+나눔고딕). 아래 'S04 검증 기록'. 제품 대화 모델 품질은 NOT_RUN |
| S03 Liner live 웹 검색 adapter | IMPLEMENTED (가짜 fetch·합성 응답 검증) · live 실호출 NOT_RUN | 2026-11-18. 원장 한도(호출 수·예산)·전송 상태·결과 변환·화면 표시. 아래 'S03 구현 기록'. 실호출 검증은 승인 범위(20건·$10) 안에서 다음 작업 |
| 3. 브라우저 제출→접수·이력 (S05) | VERIFIED (local_dev 세션·자체 테스트 폼·실제 Chrome) | 2026-11-18. 아래 'S05 검증 기록'. 외부 기업 접수·Ego·사이드 패널 클릭 경로는 NOT_RUN |
| 4. 유사 공고→자동 준비 (S06) | VERIFIED (mock·제출 없음) | 2026-11-18. 아래 'S06 검증 기록'. 실제 공고 다양성에서의 유사도 품질은 S03 이후 NOT_RUN |
| 5. 정책 기반 자동 제출 | TODO | prompts/05-auto-apply.md |
| 6. 제품 완주·실제 연결 품질·데모 | TODO | prompts/06-demo-quality.md |
| 제품 API·영속 worker·live provider | PARTIAL | S01·S02·S04 경로 구현(S05 이후 `/api/v1` 501). `apps/worker`가 `search_jobs`·`tailor_resume`·`render_resume` 실행(검색·대화 mock). 추출 작업은 여전히 API 프로세스 내 실행기(S1-07). live 검색·제품 대화 모델 미구현 |
| v0.7 DB migration | IMPLEMENTED | `packages/db/src/index.ts` runner. v0.4 DB 제자리 전환·실패 rollback·drift 거절 테스트 PASS |
| 운영 로그인 | NOT_IMPLEMENTED | 로컬 개발 세션(`local_dev_loopback`)만 존재. S09 |
| Claude Code에서 실제 개발 세션 실행 | RUN | 2026-11-17 S01·S02·S04 구현 세션 |
| 실제 기업 지원·정책 활성화·운영 배포 | NOT_RUN | 이번 통합 자료 준비 범위와 구분 |

## 상태를 바꾸는 기준

DOCUMENTED/SPECIFIED는 설계 자료가 있다는 뜻이다. FOUNDATION_IMPLEMENTED는 기초 코드의 존재를 뜻한다. 제품 기능은 코드와 실제 관찰 증거가 생긴 후 IMPLEMENTED/VERIFIED로 갱신한다. PASS는 실행한 검사에만 기록하고 미실행은 NOT_RUN, 환경 문제는 BLOCKED, 발견한 결함은 FAIL로 남긴다.

이전 버전의 테스트 개수나 계약 예제가 신규 이력서·대화·자동 지원 기능을 검증한 것으로 기록하지 않는다. mock/live, 자체 폼/외부 사이트, 단위·서비스·브라우저 확인 범위를 따로 명시한다.

## 현재 개발 운영 v0.9

개발자가 전체 개발을 맡는다는 사용자 결정을 반영했다. 첫 과업은 S01 등록·추출·확인·확정 저장이고, S02 검색·공고 표시까지 연결해야 제품 단계 1을 완료 처리한다. 담당 개발자, 협업자 검수 선택, 작업 목표일 미확정이다.

v0.9 문서 변경 자체는 DOCUMENTED였고, 이후 2026-11-17 세션에서 S01 제품 코드를 구현했다(아래 검증 기록). 과거 2인 계획은 `docs/archive/v0.8-team/`, 현재 계획은 `docs/solo/`에 있다. 문서 변경 검증은 `docs/reports/SOLO_PACKAGE_VALIDATION_v0.9.md`를 따른다.

## S01 검증 기록 — 2026-11-17

환경: macOS, Node 24.19.0, npm ci 후 실행. 모든 자료는 합성 fixture 또는 테스트용 임의 텍스트이며 실제 이력서·외부 호출·유료 호출 없음.

| 검사 | 결과 | 근거 |
| --- | --- | --- |
| `npm run typecheck` | PASS | tsc 오류 0 |
| `npm test` | PASS | 38개 통과. S01 신규: `resume-intake`(실제 HTTP 등록·추출·확인 전 상태·확정·idempotency·409 충돌·타 사용자 404·재시작 재열람·형식/크기/스캔/깨진 PDF·CSRF/Origin/세션), `extraction`(후보 규칙·근거 검증·원문 밖 문장 거절·lease 상실 시 저장 거절·재시작 복구·재시도 상한), `migration`(v0.4→v0.7 제자리 전환·rollback·구형 runtime/SQL 변경/객체 drift 거절) |
| `npm run build` | PASS | web bundle·extension |
| `npm run db:check` | PASS | 메모리 DB, v0.7·46 테이블 |
| `npm run smoke:http` | PASS | 실제 socket, 로컬 세션 201·product-session 200·세션 없음 401 포함 |
| `npm run check:contracts` | PASS | 별도 venv(`/tmp/ce-contracts-venv`, requirements-validation.txt). v0.7 계약 테스트 38개 + S01 실제 응답 12개 schema 검증 |
| `npm run check:integration` | PASS | 문서 링크·v0.4 baseline 37개·fixture bytes 일치 |
| 브라우저 관찰 (ego-browser, Chromium) | PASS | 임시 v0.4 DB로 `npm run dev` 기동 → v0.7 자동 전환 확인. `/start`에서 로컬 연결 → frontend.synthetic.pdf 업로드 → 추출 확인 화면(원문·후보·연락처/희망 조건/추가 확인 구역) → 원문 위치 강조 → 항목 수정·제외 → 저장(확정 1번째 버전) → 새로고침·API 재시작 후 유지 → 다른 사용자(bob)로 같은 URL 접근 시 '찾을 수 없음'·빈 목록. 스캔형 PDF 실패 안내, DOCX 거절 안내, backend 텍스트 붙여넣기(합성 예시 표시), 390px 폭 가로 넘침 없음 |

fixture 결과: frontend PDF → 직무·회사·기간·React/TypeScript/Next.js/Storybook·담당 업무, Python·연락처·이름·부정문(다른 팀 개발) 미포함. backend 텍스트 → Python/FastAPI/AWS Lambda/SQS/DynamoDB, React·수치 성과 미포함. 두 fixture의 역할·기술 후보가 서로 다르다. 검색 계획 생성은 S02 범위라 확인하지 않았다(NOT_RUN).

독립 코드 리뷰(별도 리뷰 에이전트, 읽기 전용): CRITICAL/HIGH 0, MEDIUM 4, LOW 16. 반영: lease 무한 재실행→재시도 상한, 원문 밖 문장의 근거 사실 저장→서버·화면 거절, PDF 파싱→worker thread·시간/메모리 한도, 로컬 로그인→`NODE_ENV=production` 거부, 확정 hash 정규화·transaction 내 재확인, 파일 fsync, 원본 응답 CSP sandbox·파일 없음 409, 붙여넣기 재시도 key 유지, ReviewPage 늦은 응답·폴링 재시도·401, `CI/CD` 분리·기간 뒤 내용 경고·후보 300개 상한, 과대 본문 연결 종료, migration 제어문 거절 확대. 반영 후 typecheck·test 38·build·db:check·smoke:http·check:contracts·check:integration PASS, 브라우저에서 worker 추출·원문 밖 문장 저장 차단 재확인.

남은 한계: 운영 로그인 없음(로컬 개발 세션만, 같은 PC의 다른 프로세스가 profile 이름만으로 연결 가능), OCR·DOCX 미지원, 후보 추출은 규칙 기반이라 형식이 다른 실제 이력서에서는 '추가 확인 필요'로 빠지는 줄이 많을 수 있음, 원본 삭제·보관 정책과 고아 파일 정리 미구현, 추출 원문 파일의 hash를 DB에 결속하지 않음, 확인 화면은 최근 100개 문서 목록에서 문서를 찾음, 문서 목록의 최근 작업 조회가 문서 수만큼 반복됨, `Task.input_revision_ids`에 추출 작업은 문서 ID를 넣음, 사용자가 새로 진술한 사실은 S04 전까지 확정 불가, 영속 worker는 S02.

## S02 검증 기록 — 2026-11-17

환경: macOS, Node 24.19.0. 합성 fixture·테스트용 임의 텍스트·mock 공고(`.invalid` 주소)만 사용. 외부 호출·유료 호출 없음. `.env`의 `LINER_API_KEY`는 읽거나 사용하지 않았다(S03 대상).

| 검사 | 결과 | 근거 |
| --- | --- | --- |
| `npm run typecheck` | PASS | tsc 오류 0 |
| `npm test` | PASS | 59개(리뷰 반영 후). S02 신규 21개: `search-plan`(검색 계획·개인정보 패턴·조건 검증·공고 근무 조건 파싱·정보 없음/미충족 구분·단어 경계·문장 근거 연결·mock 순위/필수 조건 제외/빈 결과), `resume-search`(실제 HTTP + 별도 DB 연결 worker: 두 fixture의 계획·결과 차이, 확정 전/이전 버전 검색 거절, 이전 검색 보존, 사용자가 확정한 연락처 줄 제외, 조건 개인정보 거절, 타 사용자 404·CSRF, idempotency 재생/409, 만료 lease 재획득·늦은 결과 폐기·heartbeat, worker 재시작 복구·API 재시작 후 재열람·시도 상한, 대기/실행 중 취소, 빈 결과·provider 실패·live 전송 불명 재시도 금지·provider 모드 불일치 거절, 리뷰 후 추가: claim 뒤·전송 전 중지 시 전송 안 함, 버려진 실행 중 취소의 canceled+unknown 마무리, 완료 후 취소 409, 느린 호출 중 heartbeat 연장·lease 상실 시 호출 중단, intent hash 변조·깨진 작업 입력·이전 버전 intent 검색 거절). 기존 단언 2개를 실제 동작으로 변경(health worker 값, `/resume-searches` 무세션 401) |
| `npm run build` | PASS | web bundle·extension |
| `npm run db:check` | PASS | 메모리 DB, v0.7·46 테이블. migration SQL 변경 없음 |
| `npm run smoke:http` | PASS | 실제 socket 11건(검색 무세션 401·없는 검색 404 추가) |
| `npm run check:contracts` | PASS | `/tmp/ce-contracts-venv`. v0.7 계약 테스트 38개 + S01·S02 실제 응답 21개 schema 검증(SearchIntent·SearchRun·JobSnapshot·TaskAccepted·Task·취소 Task·Problem) |
| `npm run check:integration` | PASS | 문서 링크·baseline·fixture bytes |
| 하네스 `verify_run.py` | PASS | `.harness/verify-ledger.json` typecheck·test (리뷰 반영 후 재실행) |
| 브라우저 관찰 (ego-browser, Chromium) | PASS | 임시 DB로 `npm run dev`(API→health 확인 후 worker 자동 기동). alice: frontend PDF 등록→확정→'공고 찾기' 활성→조건(근무 방식 원격·하이브리드 필수, 서울·6000만 원 선호)→결과 3건(사무실 출근 공고 제외), 추천 이유·확인할 조건·상세 비교·검색 기준 보기·합성/mock 표시. 전체 종료 후 API만 재기동: 같은 결과 URL 재열람 유지, backend PDF 검색은 '대기 중'으로 남음(가짜 성공 없음) → worker만 기동하자 이어서 완료(백엔드·서버·데이터 공고, 프론트엔드 결과와 다름). bob으로 alice의 문서 검색 화면·결과 URL 접근 시 '찾을 수 없음'. 390px 폭에서 조건·결과·상세 화면 가로 넘침 없음 |

fixture 결과(mock): frontend 질의 `프론트엔드 개발자 React TypeScript Next.js`, `프론트엔드 개발자 Storybook` → 브릿지워크·루미노랩·노바커머스. backend 질의 `백엔드 개발자 Python FastAPI AWS Lambda`, `백엔드 개발자 SQS DynamoDB` → 데이터웨이브·클라우드핀·그린노트·노바커머스·스텝로직. 질의에 이메일·이름 없음.

브라우저 관찰 중 발견·수정: 담당 업무 문장("공통 컴포넌트 구조와 코드 리뷰 기준을 정리했습니다.")이 있어도 '코드 리뷰 경험' 요구가 '근거 미확인'으로 표시됨 → 문장형 사실은 요구의 핵심 단어(2개 이상)가 모두 들어 있을 때 연결하도록 보완하고 단위 테스트 추가.

독립 코드 리뷰(별도 리뷰 에이전트, 읽기 전용): CRITICAL/HIGH 0, MEDIUM 4, LOW 9, 테스트 결함 3. 모두 반영 — 중지 요청 뒤 전송 차단(전송 직전 CAS에 `cancel_requested=0`), 개인정보 패턴 확대(scheme 없는 프로필 주소·+82 전화·도로명 주소), 연봉 '억'·단위 혼합 범위 파싱(모호하면 정보 없음), '재택/remote 불가'를 사무실 출근으로, 일찍 실패해도 이전 전송 기록 유지·버려진 취소는 unknown, heartbeat 예외 처리·lease 상실 시 AbortSignal, 작업 입력에 provider 모드 고정(불일치 시 `PROVIDER_MODE_MISMATCH`), 실패·취소 작업의 result_ids 비움, 깨진 작업 입력은 claim 때 `TASK_INPUT_INVALID`로 끝내 대기열 막힘 방지, 화면 연봉 상한을 서버와 일치, 결과 화면 polling(대기 중엔 작업 상태만, 30초 뒤 5초 주기, 재시도 버튼), http(s) 주소 공고만 저장·링크, 테스트 이름·검증 보강. 리뷰의 열린 질문 중 '이전 버전 intent로 새 검색'은 409로 막았다(S2-03 확장). 반영 후 typecheck·test 59·build·db:check·smoke:http·check:contracts(21)·check:integration·verify_run PASS, 브라우저에서 검색 흐름·연봉 상한 안내 재확인.

NOT_RUN: 경력 새 버전 저장 후 이전 검색 화면의 '이전 경력 버전 기준' 배너 브라우저 확인(API 수준 409·이전 결과 보존은 테스트 PASS), 실행 중 취소의 브라우저 조작(테스트 PASS), live provider·실제 공고.

남은 한계: 추천 이유는 규칙 기반 단어 일치라 의미가 다른 문장도 같은 단어가 있으면 연결될 수 있음(근거 문장을 함께 보여 사용자가 판단), 공고 근무 조건은 원문의 '항목: 값' 줄만 읽음(live 공고 형식은 S03에서 확인), 검색 목록 API가 없어 최근 검색은 브라우저 localStorage에만 기억, 문서 단건 조회에 확정 head 미포함(화면이 최근 100개 목록에 의존, S01 한계 유지), 추출 작업은 아직 API 프로세스 실행기, provider 호출 비용·`ce7_provider_calls` 기록은 live 연결 시 구현.

## S03 구현 기록 — 2026-11-18

환경: macOS, Node 24. **실제 Liner 호출 0건.** 주입한 가짜 fetch와 합성 응답(테스트 안 상수)만 사용했다. `.env`는 읽지 않았다. 사용자 승인 범위: 실호출 최대 20건, 앱 예산 $10(`LINER_BUDGET_MICRO_USD=10000000`). 결정은 `DECISIONS.md` S3-01~S3-07.

| 검사 | 결과 | 근거 |
| --- | --- | --- |
| `npm run typecheck`·`npm run build` | PASS | |
| `npm test` | PASS | 113개(기존 104 + S03 신규 9, `tests/liner-live.test.mjs`): 명세대로의 요청 본문·header(키는 header에만)·실행당 2건, 공고 아닌 페이지·위험 주소 제외·중복 제거·회사명 규칙·`data_origin=live`·원장 행(예약 2,000·확인 1,000·request_hash·generation), 호출 수 한도(사용자 둘이 같은 한도, 초과 시 fetch 없음·`not_dispatched`), 예산 한도, 400·401·402·429 → failed·한국어 안내·재시도 없음, 네트워크·시간 초과·500·502·해석 불가 → unknown·재시도 없음, 중지 요청 뒤 둘째 호출 없음, 호출 정보 없으면 전송 없음, 설정 검증(키·한도 누락, 오류에 키 없음), mock 기본 유지. `foundation`의 live 설정·health 기대값을 의도대로 변경 |
| `npm run check:contracts` | PASS | 응답 shape 변경 없음(JobSnapshot은 이미 `data_origin=live`·빈 requirements 허용). 안내 문구만 갱신 |
| `npm run check:integration` | PASS | |
| `scripts/liner-live-check.mjs` 동작 | PASS(가짜 fetch preload) | 설정 없음·한도 없음 거절(exit 2), `--usage` 사용량만 출력, 임시 원장으로 2회 실행 시 한도 3에서 2건+1건(partial), 401 → `LINER_UNAUTHORIZED`·failed. preload가 `platform.liner.com` 요청을 합성 응답으로 대신해 외부 호출 없음 |

NOT_RUN: Liner 실호출(실제 응답 형식·공고 판정 품질·회사명 추출 품질·비용 확인), 실제 live 결과의 화면 확인, live 모드 유사 공고 탐색(S06) 품질. 한계: 공고 판정은 제목·주소 신호라 채용 뉴스가 섞일 수 있고, 결과는 검색 요약뿐이라 요구 사항·근무 조건·모집 여부를 읽지 않는다(화면에 '원문 확인 필요').

## S04 검증 기록 — 2026-11-17

환경: macOS, Node 24.19.0. 합성 fixture·mock 공고·mock 대화만 사용. 외부 호출·유료 호출 없음. 사용자 승인으로 `pdf-lib` 1.17.1·`@pdf-lib/fontkit` 1.1.1을 정확한 버전으로 추가하고, 나눔고딕 보통체 TTF(OFL, google/fonts)를 `packages/render/fonts/`에 포함했다(sha256 76f45ef4…2e31). `npm audit`의 high 1건은 기존 `pdfjs-dist` 대상이며 이번 추가 패키지와 무관(미조치).

| 검사 | 결과 | 근거 |
| --- | --- | --- |
| `npm run typecheck` | PASS | tsc 오류 0 |
| `npm test` | PASS | 80개(리뷰 반영 후). S04 신규 21개: `tailor-unit`(기본 이력서·변경 적용 operation별 조건·입력 불변, 근거 검사(숫자·영문 기술명·리딩/총괄류), mock 대화 정상·질문·사용자 진술·실패·지연·중단, provider 제안 선별, PDF 한글·줄바꿈·여러 쪽·결정적 bytes·**글리프 윤곽선 검사**·파일명 정리), `tailoring-flow`(실제 HTTP + worker: 제안→수용→새 revision·이전 revision 불변, 부분 수용·거절·되돌리기, 다른 제안 stale 처리·오래된 화면 409·응답 대기 중 409·늦은 응답 stale, 질문→진술→assistant 문장/다른 문장 근거 거절→user_statement 확정→적용→확정, 근거 없는 제안 선별·DB 위조 제안 수용 거절, 실패 메시지 보존·재시도, provider 모드 불일치 미실행, 확정 hash·근거·다른 회사명 검사·final 동결, PDF 렌더·hash·쪽수·텍스트·글리프·재렌더 동일 hash·파일 변조 409, 타 사용자 404, idempotency 재생, lease 상실 시 늦은 답변 폐기). 기존 단언 변경: S01의 user_statement 거절 코드(이제 메시지가 없으면 `USER_STATEMENT_NOT_FOUND`), 미구현 경로 단언 대상을 S05(`/job-applications`)로, health 값 |
| `npm run build` | PASS | web bundle·extension(웹 번들에 pdf-lib 미포함) |
| `npm run db:check` | PASS | migration SQL 변경 없음 |
| `npm run smoke:http` | PASS | 실제 socket 13건(S04 무세션 401·없는 파일 404 추가) |
| `npm run check:contracts` | PASS | v0.7 계약 테스트 38개 + S01·S02·S04 실제 응답 38개 schema 검증. S04 확장 경로 6개·schema 4개·`ProposalAccept.change_indexes` 추가(DECISIONS S4-09) |
| `npm run check:integration` | PASS | 문서 링크·baseline·fixture bytes |
| 하네스 `verify_run.py` | PASS | `.harness/verify-ledger.json` |
| 브라우저 관찰 (ego-browser, Chromium) | PASS(결함 발견·수정 후) | 임시 DB `npm run dev`(worker가 search·tailor·render 처리). alice(frontend): 검색 결과 상세 → '이 공고에 맞춰 이력서 수정' → 3분할 편집 화면 → 제안 카드(변경 전·후·이유·근거) → 모두 적용(v2, '바뀜' 표시) → '리딩 경험' 요청에 질문만(문서 변경 없음) → 진술 입력 → '경력 정보에 추가' 전 적용 버튼 비활성 → 추가 후 근거 '확인한 사용자 진술' → 적용(v3) → 최종 제출본 확인(확인 항목) → 확정 → PDF 만들기 → iframe 미리보기·파일명·쪽수·hash. dana(backend): `[mock:slow]` 응답 대기 표시·전송 버튼 비활성 → 적용 → 확정 → PDF(778KB) Chrome에서 한글 정상. erin으로 dana의 편집·최종 URL 접근 시 '찾을 수 없음'. 390px에서 탭 전환(공고/대화/미리보기)·가로 넘침 없음. 3쪽 PDF의 페이지 경계·한글 줄바꿈 육안 확인 |

**발견·수정한 결함(브라우저 관찰):**
1. **PDF 한글 글자 누락(심각):** pdf-lib 서브셋 임베딩(`subset: true`)이 나눔고딕 글리프 윤곽선을 빠뜨려 Chrome(PDFium)·macOS(CoreGraphics) 모두에서 글자 대부분이 보이지 않았다. 텍스트 추출(ToUnicode)은 정상이라 추출 기반 테스트는 통과했었다. → 전체 글꼴 임베딩으로 바꾸고, 크기를 줄이려고 보통체 하나만 넣고 제목은 겹쳐 그려 굵게 표현(렌더 버전 `resume-pdf.v2`). PDF에 실제로 그린 글리프 ID마다 임베딩 글꼴의 윤곽선을 확인하는 검사(`tests/helpers/pdf-glyphs.mjs`)를 추가했다. 이 검사는 서브셋 PDF에서 누락 글자를 잡아내고(음성 대조 확인), 현재 출력은 누락 0. 결함 PDF가 남은 임시 DB는 검증용으로만 사용.
2. 제안 카드의 '모두 적용' 버튼이 하단 고정 바에 가려 눌리지 않음 → 스크롤 여백 추가.
3. 추천 문구 칩·요구 연결 표시에 긴 경력 문장이 그대로 나옴 → 기술 이름만 칩으로, 문장은 개수로 표시.
4. 적용·거절된 제안에도 '적용을 눌러야 합니다' 문구 → 미처리 제안에만 표시.

독립 코드 리뷰(별도 리뷰 에이전트, 읽기 전용): CRITICAL 0, HIGH 1, MEDIUM 5, LOW 9. 반영 — (HIGH) 답변 실패 세션을 다시 열면 화면이 '답변 대기'에 갇혀 재시도·전송이 막힘 → 세션 작업 목록 경로(`GET /tailoring-sessions/{id}/tasks`)로 실패·진행 중을 구분해 '다시 시도' 표시(브라우저에서 실패 → 새로고침 → 다시 시도 표시·새 메시지 전송 확인). (MEDIUM) 근거 검사: 숫자+단위 쌍 비교(30명≠30%), 전각 숫자 NFKC, 한국어 수량 표현(세 명·두 배), 한 글자 영문, 책임 범위 단어 추가(이끌·주관·최고·CTO 등) / 최종 확인 체크를 내용 hash에 묶음 / 문서가 고정한 경력 이후 지우거나 고친 사실이 남으면 확정 409 `FACTS_CHANGED` / 글꼴에 없는 글자(é·ü·✓·이모지 등)는 확정 422 `RESUME_GLYPH_MISSING`·렌더 실패로 막음(조용히 빠지지 않게), 탭·분해형 한글 정규화 / provider 응답 형식 검증(`CHAT_OUTPUT_INVALID`)·저장 중 예외 시 실패 처리. (LOW) 확정 후 worker가 세션 상태를 덮지 않음, 진술 근거를 같은 문서의 편집 세션 메시지로 제한, mock 진술 블록 ID를 문장 기반으로(중복 진술은 별도 안내), 재시도는 마지막 사용자 메시지만(`RETRY_NOT_LATEST`), 길이 한도 1000자 통일·제외 사유 구분, PDF 메타는 HEAD로(본문 미전송), 같은 revision 렌더 대기 중이면 기존 작업 재사용·새로고침 후 진행 상태 복원, 렌더 저장 실패 시 파일 삭제. 미반영: 작업 조회의 `json_extract` 전체 스캔 인덱스(migration 변경 필요, 데이터가 적은 현재는 영향 작음), 한국어 자격·기술명(예: 정보처리기사·쿠버네티스)의 기계적 차단(근거 문장 표시로 사용자 확인). 리뷰의 열린 질문 중 'CSP sandbox로 Chrome PDF 뷰어 차단'은 브라우저 관찰에서 iframe 미리보기가 정상 표시되어 해당 없음, '재추출 시 extraction_id 불일치'는 현재 문서당 추출이 한 번(재추출 경로 없음)이라 해당 없음.

대화 품질 검증과 mock UI 검증 구분: 이번 대화는 **결정적 규칙 기반 mock**이다. 응답 문장은 확정 사실 문장만 조합하며, 실제 사용자 대화 품질(자연스러운 문장 개선·요청 이해)은 제품 대화 모델 연결 전까지 NOT_RUN이다. mock UI 검증은 PASS.

NOT_RUN: 제품 대화 모델(live) 연결·품질, 실행 중 응답과 사용자 동시 수용의 브라우저 조작(테스트 PASS), 다른 회사명 차단의 브라우저 조작(테스트 PASS), 운영 환경 PDF 렌더.

남은 한계: 대화 진술을 그대로 문장으로 넣으므로 '했어요' 같은 구어체가 이력서에 남을 수 있음(사실을 바꾸지 않는 문장 다듬기는 제품 대화 모델 단계), insert 블록 위치는 '핵심 요약' 구역으로 고정(계약에 위치 필드 없음), 근거 검사는 숫자·영문 기술명·책임 범위 단어만 기계적으로 막고 한국어 의미 과장은 완전히 막지 못함(근거 문장 표시로 사용자 확인), PDF는 약 0.8MB(전체 글꼴 임베딩), 이름·연락처 머리글 없음(검색용 사실에서 제외한 정보이며 지원서 작성 S05에서 다룸), 메시지·제안 목록 페이지네이션 없음(최대 500), 공고 문서 단건 조회에 확정 head 미포함(화면이 최근 100개 목록 의존).

## S05 검증 기록 — 2026-11-18

환경: macOS, Node 24, Google Chrome 157(임시 프로필, CDP `Extensions.loadUnpacked`). 합성 fixture·mock 공고·가상 지원자 정보만 사용. 외부 사이트 접속·유료 호출 없음. 사용자 승인으로 새 migration `008_browser_apply.sql`(v0.7.1, 테이블 6개)을 추가했다(DECISIONS S5-01). 패키지 설치 없음.

| 검사 | 결과 | 근거 |
| --- | --- | --- |
| `npm run typecheck` | PASS | tsc 오류 0 |
| `npm test` | PASS | 98개. S05 신규 18개: `apply-unit`(답변 형식·출처·길이·한 줄 trim, 완결성, payload hash 범위, 자체 폼 주소, snapshot 문항 변경·미지원 문항, readback 값·파일 hash), `browser-apply` 10개(정상 제출·근거·이력·채용 단계, 파일·답변·폼 변경 거절, 만료·철회·재사용·다른 공고 권한 거절, 사용자·기기 격리·토큰·연결 코드·origin, 중복 요청·idempotency·접수 키 1건, 전송 중 끊김→불명→조회·봉인→미접수, 응답 유실→sweep→접수, 재시작→재claim 토큰 교체·전송 후 재실행 없음, 제출 후 이력서 재수정해도 제출본 불변·외부 기록 중복 차단, 리뷰 반영 경로), 확장 guard 4개, migration v0.7→v0.7.1 제자리 적용 |
| `npm run build` | PASS | web bundle·extension(새 파일 포함) |
| `npm run db:check` | PASS | v0.7.1, 52 tables, foreign_keys on |
| `npm run smoke:http` | PASS | 실제 socket |
| `npm run check:integration` | PASS | 문서·포인터·기준 bytes |
| `npm run check:contracts` | PASS | `/tmp/ce-contracts-venv`. v0.7 계약 테스트 + S01·S02·S04·S05 실제 응답 55개 schema 검증. S05 확장 경로 6개·schema 15개(DECISIONS S5-11) |
| 실제 Chrome(`node scripts/chrome-apply-e2e.mjs`) | PASS 30/30 | 임시 DB·임시 프로필. 웹 클릭으로 연결 코드 생성 → 확장 연결(코드 1회용) → 자체 폼 입력(한글 여러 줄)·확정 PDF bytes 첨부·readback hash 일치 → 웹에서 확인 체크·'승인하고 제출' → 확장 제출 → 접수 화면·사이트 접수 기록 대조로 접수 확정(근거 2건) → 같은 시도 재실행 거절. B: 미리 입력된 다른 값 덮어쓰지 않음 → 새로 연 폼으로 확인·승인 → 전송 중(사이트 4초 지연) Chrome 강제 종료 → `dispatched` 유지 → 재시작 후 연결 유지·재제출 없음·재claim 거절 → 1분 전 접수 확인 거절 → 1분 뒤 접수 확인으로 사이트 기록에서 접수 확정. 시도당 사이트 접수 1건·파일 hash 일치, 390px 가로 넘침 없음. 스크린샷 9장 확인 |
| 독립 코드 리뷰(opus) | 반영 | CRITICAL 0·HIGH 0·MEDIUM 3·LOW 9. 미접수 뒤 재진행 불가, 만료 대기 시도가 새 승인 차단, 페이지 직접 제출을 미접수로 봉인 → 수정·회귀 테스트. LOW: 실행 토큰 불일치 401→409(기기 연결 유지), 이메일 공백, 실패 전 관측 재사용, 제출 표시 사전 검사, 외부 사이트 확인 화면 키 검사, origin 검사 경로 정규화, 근거 중복 기록, N+1 반영(DECISIONS S5-13) |

NOT_RUN·한계:
- 사이드 패널의 실제 클릭 경로(패널 → 서비스 워커 메시지)는 Chrome이 사용자 제스처 없이 패널을 열지 못해 자동 검증하지 못했다. 같은 실행 함수를 서비스 워커에서 직접 호출해 검증했다. `docs/EXTENSION_START.md` 수동 절차로 확인 필요.
- 외부 기업 채용사이트 adapter·접수 확인, Ego 실행 채널은 없다. 자체 폼 성공을 외부 접수 검증으로 보고하지 않는다.
- 연결 코드 실패 제한은 프로세스 전역 1분 20회(로컬 개발 범위). 확정 사실·정책 기반 답변은 아직 받지 않는다(사용자 답변만).
- 이력서 PDF에 이름·연락처 머리글은 여전히 없다(지원서 문항으로 입력).

## S06 검증 기록 — 2026-11-18

환경: macOS, Node 24. 합성 fixture·mock 공고·mock 대화만 사용. migration·패키지 추가 없음.

| 검사 | 결과 | 근거 |
| --- | --- | --- |
| `npm run typecheck`·`npm run build` | PASS | |
| `npm test` | PASS | 104개. S06 신규 6개(`similar-jobs`): 유사도 설명·고정 파일 점검(기준 회사명·전용 문구), 자동 준비(기준 고정·재실행 시 중복 없음·지원서는 '작성 중'·이름/이메일만 재사용·`finalization_source=policy`·실제 PDF·권한/시도/접수/폼 관측 0건·재시작 후 대기함 유지), 필수 조건 미확인→검토·미지원 사이트·새 필수 문항·같은 공고 가능성→검토, 고정 파일 전략·추천 모드, 정책 수명주기(submit 거절·hash·generation·일시중지 중 예약 작업 미실행·취소·철회 최종)·다른 사용자 404, 리뷰 반영(자동 결과 기준 불가·실행 중 정책 중지·정책 단위 한도·보류 재판단) |
| `npm run db:check`·`smoke:http`·`check:integration` | PASS | |
| `npm run check:contracts` | PASS | 실제 응답 67개(S06 12개 추가). 확장 경로 1개·schema 3개(DECISIONS S6-10) |
| ego 브라우저 화면 테스트 | PASS | 사용자가 볼 수 있게 ego 브라우저로 진행. 임시 DB에 `scripts/demo-seed.mjs`로 접수 확인된 기준 지원 건 준비(확장 대신 실행기 프로토콜 HTTP 수행) → 지원서에서 '비슷한 공고 찾기' → 자동 준비·사실 범위 맞춤·연봉 5,000만 원 이상(필수) 저장 → 설정 hash 확인·동의·시작 → 대기함: 서류 준비 1(브릿지워크, 유사도 68%, 연봉 충족), 검토 필요 2(연봉 협의·정보 없음) → 준비된 지원서 '작성 중'·지원 동기/동의 미작성 확인. 시연 DB에서 권한·시도·접수는 기준 지원 건 1건뿐. 화면에서 연봉 조건이 원 단위로 표시되는 결함을 발견·수정 |
| 독립 코드 리뷰(opus) | 반영 | HIGH 2·MEDIUM 4·LOW 6. HIGH 2·MEDIUM 3 반영(DECISIONS S6-12), 회귀 테스트 추가. 기준 revision 비교(계약 변경 필요)·비용 한도 집행·고아 파일 정리·캠페인 완료 전환은 한계로 기록 |

NOT_RUN·한계: 실제 공고(Liner live)에서의 유사도·조건 판정 품질, 제품 대화 모델로의 맞춤 품질, 정책 기반 자동 제출(S07). 준비 한도는 서류 준비 기준이며 제출 한도·비용 예약은 S07에서 다룬다.


### 2026-11-18 제출 없는 시연·검증으로 전환

| 검증 | 결과 | 근거 |
|---|---|---|
| `node scripts/chrome-apply-e2e.mjs --headful` (기본: 제출 직전 멈춤) | PASS 13/13 (창 모드·headless 각 1회) | Chrome 창으로 진행 표시. 연결 코드 → 확장 연결 → 자체 폼 입력·PDF 첨부·readback 일치 → 웹 '3. 최종 확인과 제출 승인' 화면 표시. 승인·제출 버튼은 누르지 않음. DB 확인: 승인 0·시도 0·사이트 접수 0 |
| `scripts/demo-seed.mjs` 기본 동작 | 변경 | 폼 확인(readback)까지 만들고 제출 직전에 멈춤. `--submit-local`일 때만 로컬 자체 폼 접수 |

### 2026-11-18 S08 로컬 시연 정리(진행중, 제출 없음)

S07은 사용자 결정으로 보류. `scripts/demo.mjs`(새 임시 DB → 합성 PDF 실제 API 경로 → 제출 직전 멈춤 → 화면 주소 안내), `docs/DEMO_RUNBOOK.md`(실행·구현 범위·mock/live·자체 폼 구분·예외 확인 위치·NOT_RUN), `scripts/dev.mjs` 시작 문구를 현재 범위로 수정.

| 검증 | 결과 | 근거 |
|---|---|---|
| `node scripts/demo.mjs --keep` | PASS | 준비 완료, 지원서 '폼 입력 확인됨' |
| ego 브라우저 시연(space 28, 결과 화면 유지) | PASS | demo 연결 → 지원서(승인 미체크) → 비슷한 공고 찾기 → 자동 준비·맞춤·선호 조건 2개 → 동의·시작 → 서류 준비됨 3 |
| 제출 0건(DB) | PASS | 승인 0·시도 0·접수 0 |

NOT_RUN: Liner 실호출(S03), 새 PC clone 재현, 대회 제출 형식·마감 확인, 데모 영상.

### 2026-11-18 S03 Liner 실호출 검증 (사용자 승인: 최대 20건·$10)

| 검증 | 결과 | 근거 |
|---|---|---|
| `liner-live-check.mjs --usage` | PASS | LINER_API_KEY present(값 미출력), 원장 0/20 |
| 실호출 1 (합성 frontend, 2건) | PASS | 작업 succeeded·complete, 원장 succeeded 2·확인 2000 micro-USD. 10건 중 실제 공고 8, 오탐: 자소서 글 1·사이트 간 중복 1 |
| 실호출 2 (합성 backend, 2건) | PASS(품질 결함 발견) | 5건 중 일반 채용 안내 페이지 2, 회사명 hostname 대체 2 |
| 판정 수정(S3-08) + 회귀 테스트 | PASS | 관찰 제목 15개 의도대로 분류. `npm test` 114/114, typecheck, build PASS |
| 화면 실호출 3 (ego, live 개발 서버·임시 DB, 2건) | PASS | 확정 경력 → '이 기준으로 공고 찾기' → 결과 10건 모두 'Liner 웹 검색' 표시·검색 시각·'검색 요약만 확인(원문 확인 필요)'. 자소서 글·중복 제거 확인. 상단 문구 'Liner 웹 검색'으로 표시 |
| 누적 사용량 | 6 / 20건 | 확인 비용 $0.006, 결과 불명 0 (원장: `.data/liner-live-check` 4건 + 임시 DB 2건) |

한계: Liner는 웹 검색이라 공고 원문·요건을 받지 않는다(요약만, 조건은 '확인 필요'). 회사명을 제목에서 못 읽으면 hostname을 표시한다(추측하지 않음). 실제 공고에서의 맞춤 이력서·유사 공고 품질은 NOT_RUN. 원장 한도는 DB 파일 단위.

### 2026-11-19 Word(.docx) 이력서 원본 지원 (DECISIONS S1-12, 사용자 선택: mammoth)

`mammoth@1.13.0`(버전 고정) 설치. 업로드 시 ZIP 중앙 디렉터리 검사(본문 존재·암호·선언 크기 50MB·항목 1000) → 추출은 worker thread(20초·256MB) → 본문·표 텍스트, 근거는 page=null + code point 위치. 옛 .doc·암호 Word는 415 `DOC_NOT_SUPPORTED`. migration 009(v0.7.2)로 `ce7_documents` CHECK 확장(표 재생성, 기존 행·FK·트리거 유지). v0.7 계약 enum·OpenAPI 설명·SERVICE_RULES·DB_MAPPING·README·MANIFEST 갱신. 업로드 화면 안내·accept 갱신. 합성 `frontend.synthetic.docx`(TXT와 같은 내용, 표·머리글 포함)와 `docx.synthetic.json`(동결된 expected.json은 그대로).

| 검증 | 결과 | 근거 |
|---|---|---|
| `tests/docx-intake.test.mjs` | PASS 4/4 | 등록→추출(TXT와 같은 텍스트, 표 포함·머리글 제외)→근거 위치→확정→mock 검색, 원본 bytes·MIME 보존 / .doc·xlsx·압축 폭탄 선언 거절(문서 0) / 깨진 본문은 failed·확정 경력 없음 |
| `tests/migration.test.mjs` | PASS | v0.7.1 DB(문서·추출·확정 경력 연결) → v0.7.2: 행·FK·트리거·CHECK 유지, defer 플래그·임시 표 잔존 없음 |
| `npm test` | PASS 119/119 | |
| typecheck·build·check:integration·db:check | PASS | contract_version v0.7.2, 영구 DB 변경 없음 |
| `check:contracts` | PASS | `/tmp/ce-contracts-venv`. 실제 응답 70개(DOCX 3개 추가) |
| fixture 재생성 결정성 | PASS | `node scripts/make-docx-fixture.mjs` 반복 시 같은 sha256 |

NOT_RUN: 브라우저 화면에서 .docx 실제 선택·업로드(서버 경로는 HTTP 테스트로 확인), 실제 Word로 만든 다양한 문서(텍스트 상자·각주·번호 목록) 추출 품질. 참고: `npm audit`의 기존 `pdfjs-dist` high 1건(GHSA-hq66-cqwq-w95j)은 이번 변경과 무관하며 미조치.

### 2026-11-19 안티슬롭(S4-13) · Liner 대화 provider(S4-14) · 실호출 검증 (사용자 승인: 대화 5회·$2)

| 검증 | 결과 | 근거 |
|---|---|---|
| `tests/slop.test.mjs` | PASS 5/5 | 상투·평가어·연결 장치·기호 검출, 사실 문장 통과, 사용자 원문 표현 허용, 슬롭 제안 제외·이유 질문 |
| `tests/liner-chat.test.mjs` | PASS 6/6 | 요청 형식·x-api-key·JSON schema·규칙 문구, 연락처 가림, 원장 purpose=chat·가격 계산, 한도 초과 미전송·402·전송 불명·잘린 응답, 설정 검증·health, 사실 확인 후보 원문 보정 |
| `npm test` | PASS (아래 전체 검증 참조) | |
| 실호출 1 기본 맞춤 | PASS | claude-sonnet-5.5 · 6.4초 · 3180/491 토큰 · 11,270 micro-USD. 재배치 2건(근거 1개씩), Next.js 업무 근거 없음 → 질문 |
| 실호출 2 근거 없는 강조('리딩·수치·임팩트') | PASS | 새 문장 없음, 재배치 2건 + 리딩·성능 수치 질문 2개 |
| 실호출 3 사용자 진술 | FAIL → 수정 | 모델이 어미를 바꿔 사실 확인 후보가 '사용자 메시지에 없음'으로 제외됨. `userSentenceFor`(원문 문장 보정)·지시문 강화·단위 테스트 추가 |
| 실호출 4 같은 진술 재확인 | PASS | 사용자 문장 그대로 insert(needs_fact_confirmation) + 팀·기간 확인 질문 |
| 누적 | 4 / 5건 | 확인 비용 44,728 micro-USD($0.045), 예약 995,480 / 2,000,000, 결과 불명 0. 원장 `.data/liner-chat-check` |

NOT_RUN: 화면(브라우저)에서 live 대화 전송, 주민등록번호 형태 가림의 자동 테스트(하네스가 해당 형식 문자열을 파일에 쓰지 못하게 막음 — 코드에는 규칙 있음), 실제 사용자 이력서·실제 공고에서의 품질, cost/quality 라우팅 비교.

### 2026-11-19 직무별 문장 패턴(S4-15) · 1차 점검 규칙 단계(S1-13)

| 검증 | 결과 | 근거 |
|---|---|---|
| `tests/slop.test.mjs` 패턴·활용형 | PASS | 직무군 선택, 나은 예시 안티슬롭 통과·숫자 없음, '뛰어납니다·탁월합니다·우수합니다·책임감 있게·열심히' 검출 추가 |
| `tests/resume-review.test.mjs` | PASS 2/2 | 규칙별 검출·경고 우선·사실 불변 / 합성 프론트엔드(실제 업로드 경로): 직무·기간 통과, 결과 문장 없음 안내, 프론트엔드 패턴 |

NOT_RUN: 화면에서 점검 패널 표시 확인, AI 점검(Liner) — 다음 단계(migration 010·API·worker 필요, 실호출 승인 필요).

### 2026-11-19 AI 1차 점검(S1-14, migration 010 = v0.7.3) · 실호출 (사용자 승인: 대화·점검 합산 8건·$2)

| 검증 | 결과 | 근거 |
|---|---|---|
| `tests/migration.test.mjs` v0.7.3 | PASS | v0.7.2 DB(작업·원장 자식 행) → 표 재생성: 행·FK·색인 유지, review_resume 허용, 점검 행 완료 후 갱신 불가 |
| `tests/ai-review.test.mjs` | PASS 3/3 | mock: 요청→대기→worker→결과, 확정 경력 불변, 멱등·진행 중 409·소유권 404 / live(가짜 fetch): 요청 형식·패턴·가림·기준일, 없는 사실 ID·틀린 항목 제거, 원장 chat·가격 / 모드 불일치·중지·형식 오류 실패 |
| `npm test` | PASS 138/138 | |
| `check:contracts` | PASS | 실제 응답 73개(AI 점검 3개 추가) |
| 실호출 5 AI 점검(합성 frontend) | PASS(결함 발견) | claude-sonnet-5.5 · 17.6초 · 2061/2166 토큰 · 25,782 micro-USD. 근거 있는 항목 10개·질문, 새 사실 없음. 결함: 2026.10 종료를 '미래'로 오판 → 요청에 기준일 추가·테스트 |
| 실호출 6 AI 점검(합성 backend) | PASS | 18.8초 · 29,044 micro-USD. 기간을 과거로 바르게 해석(재직 여부 질문), 항목 10개 |
| 누적(대화+점검) | 6 / 8건 | 확인 비용 99,554 micro-USD($0.0996), 예약 1,457,000 / 2,000,000, 결과 불명 0 |

NOT_RUN: 브라우저 화면에서 점검 패널·AI 점검 버튼 확인, 실제 사용자 이력서에서의 점검 품질. 참고: `scripts/check_contracts.py`의 마지막 안내 문구는 'S03 real-call verification NOT_RUN'으로 오래된 문장이다(검증기 파일이라 수정하지 않음).

### 2026-11-19 하네스 효과 점검 후속 (사용자 요청: 개선 1~4 적용·발견 결함 수정)

| 항목 | 결과 | 근거 |
|---|---|---|
| 1. 검증 원장을 완료 조건으로 | 적용 | `.claude/settings.json` Stop 훅 → `.claude/hooks/ledger-stop-check.mjs`: `verify_run.py --status`가 pass가 아니면 완료 전에 검증을 돌리라고 막음(`stop_hook_active`면 통과, 하네스 없음·판정 오류면 막지 않음). pipe 테스트: stale → block, stop_hook_active → 통과 |
| 2. 합성 테스트 값 허용 | 설정으로는 불가 → 하네스 지침대로 처리 | 하네스 file_gate에 개인정보 허용 설정이 없고 플러그인 수정은 금지. 실제 번호가 될 수 없는 가짜 값(13월)으로 주민등록번호 가림 테스트 추가(`tests/liner-chat.test.mjs`, 차단 없음) |
| 3. 감사 기록 확대 | 적용 | `.claude/settings.json` env `HARNESS_MONITOR=1`. 감사 로그에 pass 기록이 쌓이는 것 확인 |
| 4. 교훈 등록 | 적용 | `docs/error-log.md` E1~E5, `docs/lessons-learned.md` L1~L5(사용자 명시 등록) |
| 결함: 원장 오래됨 | 수정 | 위 Stop 훅 + `verify_run.py` 재실행 |
| 결함: 계약 검사 안내 문구 오래됨 | 수정 | `scripts/check_contracts.py` 마지막 안내 문구만 현재 상태로(검사 로직 변경 없음) |
| 결함: 주민번호 가림 미검증 | 수정 | 위 2 |

수정하지 못한 것(하네스 플러그인 쪽, 프로젝트에서 고칠 수 없음): 오탐 — Python `set(`을 환경변수 출력으로, jq 경로 `.env.X`를 시크릿 파일로, 테스트 파일 끝에 새 테스트를 덧붙이는 것을 '테스트 약화'로 판정. 연속 수정 중간의 typecheck 실패 알림. 개선하려면 하네스 플러그인 저장소에 보고가 필요하다.

### 2026-11-19 브라우저 화면 확인 (ego 브라우저, mock 모드·임시 DB, 제출 없음)

| 확인 | 결과 | 근거 |
|---|---|---|
| Word 업로드 → 추출 확인 | PASS | `frontend.synthetic.docx` 등록, 'Word(.docx)'·합성 예시 표시, 경력 항목 12개 |
| 결함: Word 원문이 '붙여넣은 내용'으로 표시 | 수정 | `SourcePanel.tsx` `pagelessLabel`, `FactEditor.tsx`(inputKind) → 'Word 본문 · 36–45' 확인 |
| 확정 → 1차 점검 패널 | PASS | 규칙 점검 1개(결과 문장 없음), AI 점검(mock) 버튼 → 결과 표시, 프론트엔드 문장 패턴 펼침 |
| mock 검색 → 공고 상세 → 맞춤 대화 | PASS | 'AI · mock 대화' 응답과 변경 제안(기술 재배치·핵심 요약·순서 변경) 표시 |

NOT_RUN: live(Liner) 모드 화면(유료), 지원 제출(사용자 지시로 하지 않음).

### 2026-11-19 Stop 훅 보정: 커밋만 한 경우 통과

하네스 원장 지문은 git HEAD·변경 목록·수정 시각이라 내용 변경 없이 커밋만 해도 stale이 된다. Stop 훅이 원장 pass 때의 작업 트리 내용 hash(임시 index의 `git write-tree`, `.gitignore` 제외)를 `.git/ledger-tree.json`에 기억하고, stale이어도 같은 원장·같은 내용이면 통과시킨다. 내용이 바뀌었거나 기억이 없거나 원장이 fail이면 그대로 막는다(`.claude/hooks/ledger-decide.mjs`).

| 검증 | 결과 | 근거 |
|---|---|---|
| `tests/ledger-hook.test.mjs` | PASS 2/2 | 판정 7가지 경우 / 임시 저장소: 커밋·수정 시각 무관, 내용·새 파일 반영, ignore 파일 무시, 실제 index 불변 |

### 2026-11-19 Word 이력서 후보 0건(읽기 실패) 개선 (사용자 보고, DECISIONS S1-15, error-log E6)

사용자가 ego 브라우저에서 실제 Word 이력서를 올렸더니 '읽기 실패'만 보이고 고칠 방법이 없었다. 원인은 두 가지: (1) 제목이 `01  핵심 업무 스킬`·`06  경력 | 최근 역할 중심`·`12  학력 · 자격 · 교육` 형식이라 정확히 일치하는 제목만 보던 추출기가 전체 196줄을 머리글로 처리해 후보 0건(`NO_FACT_CANDIDATES`), (2) 원문은 읽었는데도 목록·확인 화면이 '읽기 실패'·빨간 오류로 보였고 '+ 추가'는 hover 때만 보였다. 실제 이력서 내용은 출력·저장하지 않고 줄 수·길이·제목 모양만 확인했다.

| 검증 | 결과 | 근거 |
|---|---|---|
| `tests/extraction.test.mjs` 신규 3건 | 수정 전 FAIL 2 → 수정 후 PASS 9/9 | 번호·부제·묶음 제목, 이름 모를 번호 제목 → 기타, 제목 없는 문서의 기간 줄, 긴 기술 조각 경고, `1. `·`10. ` 목록 항목 회귀 |
| 같은 실제 문서 재추출(로컬, 개수만 출력) | 후보 0 → 198 | skill 34·other 82·achievement 24·employer 6·period 12·responsibility 36·education 4, 경고 7 |
| `npm run typecheck` · `npm test` · `npm run build` · `check:integration` | PASS · 144/144 · PASS · PASS | |
| `npm run check:contracts` | BLOCKED(환경) | 현재 python3 3.14.3에 PyYAML 없음 → v0.4 test_contracts import 실패. 계약 파일은 바꾸지 않음. 설치는 승인 필요 |
| ego 브라우저(합성 docx, 임시 DB) | PASS | 번호 제목 합성 Word 등록 → 후보 13건·'+ 추가' 상시 표시. 기존 실패 문서: 빨간 오류 0, '자동 후보 0건' 안내, '+ 추가' 196개, 목록 '자동 후보 0건 · 직접 추가 필요' |

미실행: 같은 실제 파일을 새 규칙으로 화면에서 다시 등록(사용자가 직접 확인), 기존 실패 문서 재추출 기능(없음 — 다시 올려야 함).

### 2026-11-19 추출 확인 화면 일괄 선택 (사용자 요청, DECISIONS S1-15 후속)

후보가 수백 개인 이력서를 위해 경력 항목 위에 일괄 선택 막대를 둔다: 포함 개수, '모두 포함'·'모두 제외', 분류별 버튼(그 분류가 모두 포함이면 모두 제외, 아니면 모두 포함, 일부면 노란색). '추가 확인 필요' 묶음에는 '이 묶음 모두 추가'(이미 추가한 원문 위치는 건너뜀). 포함이 300개(서버 확정 한도)를 넘으면 안내한다. 로직은 `apps/web/src/resume/bulk.ts` 순수 함수. 한 줄 추가도 같은 함수를 써서 같은 줄 중복 추가와 같은 ms 안 id 충돌을 막는다.

| 검증 | 결과 | 근거 |
|---|---|---|
| `tests/fact-bulk.test.mjs` | 구현 전 FAIL(모듈 없음) → PASS 4/4 | 전체·분류별 포함/제외(원본 불변), 분류 요약, 묶음 추가 중복·빈 줄 제외·id 유일, 화면 한도=서버 한도·화면 모듈에 node: import 없음 |
| `npm run typecheck` · `npm test` · `npm run build` · `check:integration` | PASS · 148/148 · PASS · PASS | |
| ego 브라우저(합성 docx) | PASS | 묶음 추가 13→14, 다시 눌러도 14, 분류 토글·모두 제외(저장 비활성)·모두 포함, 학력 제외 후 저장 → 확정 1번째 버전 항목 13개 |

발견·수정: 처음 구현에서 화면이 `confirm.ts`(node:crypto)를 import해 브라우저 화면이 빈 페이지가 됨(Node 테스트로는 안 잡힘) → 한도를 `bulk.ts`에 두고 서버 값과 같은지·node: import가 없는지를 테스트로 고정.

### 2026-11-19 실제 사용자 이력서로 지원 끝까지 (사용자 승인: 로컬 자체 폼 제출, 외부 전송 없음)

사용자가 등록·확정한 Word 이력서(확정 경력 98개)로 ego 브라우저에서 진행. 검색은 mock(합성 공고), 대화는 mock, 제출 대상은 로컬 자체 폼(127.0.0.1)뿐이다. 지원서 이름·이메일은 가상 값(테스트 지원자, applicant@example.com)을 썼다. Chrome 확장 단계는 ego 브라우저에 확장을 올릴 수 없어 같은 실행기 프로토콜(/api/executor/v1: pair → prepare → observations → claim → dispatch → 자체 폼 접수 → result)을 HTTP로 수행했다(임시 스크립트, 커밋 안 함). 연결 코드 생성과 최종 승인은 웹 화면에서 눌렀다.

| 단계 | 결과 | 근거 |
|---|---|---|
| 검색 설정·1차 점검 → mock 검색 | PASS | 합성 공고 10건, 추천 이유가 확정 경력과 연결 |
| 공고 선택 → 맞춤 대화(mock) → 제안 '모두 적용' → 2번째 버전 확정 | PASS | |
| PDF 생성 | PASS | 3쪽 788.5KB, 한글 렌더링 정상, SHA-256 e61f9bd0… |
| 지원 답변 저장 → 실행기 연결 → 폼 입력·readback | PASS | observation verified, 첨부 hash = 확정 PDF hash |
| 웹 승인 → 실행기 제출 → 접수 | PASS | attempt submitted, 접수번호 R-20261119-AZXW3M, 화면 '접수 확인됨' |

발견한 문제(미수정):
1. 표가 많은 Word 이력서의 추출 품질: '경력 상세' 같은 제목 미인식, 표 머리 줄(기간·소속 및 역할·주요 업무)이 사실 후보가 됨, 기술 구역 안의 '회사 기간' 줄이 기술로 들어가 PDF 기술 칸에 회사·직급·문장이 섞이고 경력 칸은 기간만 나열됨 → 그대로는 실제 제출 품질이 아님. 기본 이력서 보완 대화(사용자 선택, 예정)와 추출 규칙 보강으로 다룬다.
2. 1차 점검의 '같은 내용이 두 번' 안내가 같은 항목(TypeScript)을 두 번 표시.
3. 맞춤 편집 화면의 '모두 적용' 버튼이 화면 밖일 때 고정 영역에 가려 자동 클릭이 실패(스크롤 후 정상) — 사람 사용에도 가려 보일 수 있어 확인 필요.
4. 지원 동기 등 문항 답변을 에이전트가 초안으로 돕지 않음(사용자가 직접 입력).

### 2026-11-19 기본 이력서 보완 대화 (사용자 선택, DECISIONS S1-16, migration 011 = v0.7.4)

확정 경력 화면(U02) 맨 위에 '에이전트 이력서 점검·보완'을 둔다. 에이전트가 확정 경력을 점검해 질문하고(첫 턴), 사용자가 답하면 답변 안의 문장만 경력 후보로, 다듬은 문장은 사실이 아닌 초안으로 돌려준다. 후보는 '경력에 추가'로 기존 확정 API를 거쳐 새 경력 버전이 되고 근거는 사용자 메시지(user_statement)다. 초안은 '이 문장으로 답하기'로 본인 진술로 보내야 후보가 될 수 있다. 공고 맞춤 대화 표는 공고가 필수라 별도 표를 만들었다.

| 검증 | 결과 | 근거 |
|---|---|---|
| `tests/supplement.test.mjs` | 구현 전 FAIL(모듈 없음) → PASS 6/6 | 현재 버전 세션·멱등·빈 본문 외 400, 첫 턴 점검·질문, 답변 → 사용자 문장 후보(message_id 일치), 응답 중 409, 다른 사용자 404, 보완 메시지 근거 확정 201·assistant 메시지 근거 422 `USER_STATEMENT_NOT_FOUND`, 확정 후 세션 시작 버전 유지·옛 버전 새 세션 409, 지어낸 후보·새 숫자 초안·평가어 초안 제거, 형식 오류 `SUPPLEMENT_OUTPUT_INVALID` 후 다음 메시지 허용, live 요청 기준일·가림·strict schema(전송 없음), v0.7.4 migration(기존 작업·원장·색인 유지, 트리거) |
| 기존 테스트 | PASS | migration·foundation 기대값을 v0.7.4·표 55로 갱신, `userSentenceFor` 이동 후 맞춤 대화 테스트 그대로 통과 |
| `npm run typecheck` · `npm test` · `npm run build` | PASS · 156/156 · PASS | |
| 계약 표본 | 77개 생성, 임시 부분 검사기(type·required·additionalProperties·enum·anyOf·$ref·길이)로 실패 0 | `check:contracts`는 PyYAML·jsonschema가 없어 BLOCKED(설치는 승인 필요) |
| MANIFEST.sha256(v0.7) | 재생성, `shasum -c` 전부 OK | 011 추가, 바꾼 문서·schema·openapi 반영 |

미실행: 개발 서버 재시작 후 브라우저 화면 확인(NOT_RUN), Liner live 호출(NOT_RUN, 3단계에서 승인 범위 20건·$5로 확인 예정), `check:contracts` 정식 실행(BLOCKED).

### 2026-11-19 브라우저 확인: 표 형식 추출(1단계) · 기본 이력서 보완 대화(2단계, mock)

데모 서버를 같은 임시 DB로 재시작(재시작 전 WAL checkpoint 후 `app.before-011.sqlite`로 백업) → migration 011 적용, 기존 문서 5건 유지, worker에 `supplement_resume(mock)` 포함. 합성 표 형식 Word(번호 없는 '최근 경력'·'경력 상세'·'이전 경력' 표 머리 줄·'학력과 자격', 탭 구분)를 ego 브라우저로 등록.

| 확인 | 결과 | 근거 |
|---|---|---|
| 1단계 추출 | PASS | 22개 항목: 회사·기간·직무(서버개발팀/연구소 차장/프리랜서 과장)·담당 업무 분리, 기술 5개만(분류명 제외), 표 머리 줄 3개와 이름은 '추가 확인 필요'로 |
| 2단계 첫 턴 | PASS | '에이전트에게 점검받기' → 요약 + 점검 항목 + 질문 표시(mock) |
| 답변 → 후보·초안 | PASS | 답변 2문장 → 후보 2개(내 문장 그대로), 초안 2개(어미만 이력서 문체) |
| 후보 '경력에 추가' | PASS | 확정 경력 1→2번째 버전(22→23개), 근거 = 내 메시지 문장 |
| 초안 '이 문장으로 답하기' → 후보 → 추가 | PASS | 초안이 내 메시지로 전송 → 후보 1개 → 3번째 버전(24개) |

발견(다음 단계에서 처리): 에이전트 응답을 기다리는 동안 진행 표시가 없음(사용자 요청: 진행 막대) · 점검 안내 문구가 '공고 맞춤 대화에서 알려 주세요'로 남음 · 같은 내용의 대화체/다듬은 문장을 둘 다 추가하면 거의 같은 항목이 2개가 됨(기존 항목 바꾸기 필요).

### 2026-11-19 보완 대화 오케스트레이션·진행 표시 (사용자 승인, DECISIONS S1-17, migration 012 = v0.7.5, 커밋 전)

한 턴을 단계로 나눴다: 첫 턴 ① 규칙 점검 → ② AI 점검, 답변 턴 ③ 초안 → ④ 근거 검토(다른 호출의 keep/drop 판정 + 결정적 가드). ④ 실패는 초안 비공개(닫힌 쪽), ② 실패는 규칙 결과 + 실패 표시. 단계마다 진행 기록을 세션에 저장해 화면이 진행 패널(단계 표시·움직이는 막대·지금 하는 일·경과 초)로 보여 주고, 끝난 턴에는 단계 요약·뺀 초안 이유를 남긴다. 어미만 다른 후보는 '기존 항목 바꾸기'. 비교용 `SUPPLEMENT_PIPELINE=single` 유지.

| 검증 | 결과 | 근거 |
|---|---|---|
| `tests/supplement-pipeline.test.mjs` | 구현 전 FAIL(모듈 없음) → PASS 10/10 | 단계 순서·진행 전이, 비판자 drop 이유 기록, keep 뒤 가드 재실행(70% 초안 제거), 근거 검토 실패·판정 누락 → 초안 비공개, AI 점검 실패 표시, single 전환, lease 상실 중단, worker+API progress, migration 012, Liner 단계 요청(전송 없음), 평가 mock 재현, 진행 계산·기존 항목 바꾸기 |
| `tests/resume-review.test.mjs` | FAIL 1 → PASS 4/4 | '결과 문장 없음' 안내가 보완 대화를 가리킴 |
| `npm test` · `typecheck` · `build` · `check:integration` · `db:check` | PASS 167/167 · PASS · PASS · PASS · v0.7.5, 표 55 | `verify_run.py` pass 2026-11-19T19:23:04 |
| 계약 표본 77개(임시 부분 검사기) | 실패 0 | 일부러 틀린 progress.state 표본은 잡음 |
| `scripts/supplement-eval.mjs --provider=mock` | single·staged 모두 recall 12/13(0.923), 부풀린 초안 노출 0, 호출 9 vs 15 | mock은 규칙 기반 합성이라 두 방식 차이를 보여 주지 못한다(같은 초안·과장 없음). 실제 차이는 live 평가로만 판단 |
| `check:contracts` | BLOCKED | PyYAML·jsonschema 없음(설치하지 않음) |
| 브라우저 진행 패널 확인 | NOT_RUN | 데모 서버 재시작은 메인 세션이 한다(012 적용 필요) |
| Liner live(단계 호출·평가) | NOT_RUN | 메인 세션이 승인 한도 안에서 실행. 3개 전부 두 방식이면 24건이므로 `--fixtures`로 줄인다(이력서 1개당 single 3건, staged 5건) |

### 2026-11-19 보완 대화 진행 표시 브라우저 확인(ego, 합성 `table-style.synthetic.docx`, mock·staged)

데모 DB는 `app.before-012.sqlite`로 백업한 뒤 재시작해 012를 적용했다.

| 확인 | 결과 | 근거 |
|---|---|---|
| 진행 패널 표시 | PASS | 첫 턴 '규칙 점검·AI 점검' 2단계(초안·근거 검토 '이번엔 생략'), 답변 턴은 반대. 막대·경과 초·(1/2) 표시 |
| 단계 전환 화면 노출 | 부분 | mock은 1.5초 화면 조회 전에 끝나 '작업을 시작하고 있어요' 다음 바로 결과가 나온다. 단계 전환은 테스트로만 확인, live(호출당 수 초)에서 화면 확인 필요 |
| 끝난 턴 단계 요약 | PASS | '규칙 점검 ✓ 0개 · AI 점검 ✓ 1개 추가', '초안 작성 ✓ 후보 1개, 초안 1개 · 근거 검토 ✓ 1개 통과, 0개 제외' |
| 뺀 초안 이유 표시 | NOT_RUN(화면) | mock 초안은 어미만 바꿔 근거 검토가 늘 통과 → 화면에 나올 일이 없음. 테스트로만 확인 |
| 기존 항목 바꾸기 | PASS | '…맡았어요.' 추가 후 초안 '…맡았습니다.'를 답변으로 보내자 '비슷한 기존 항목' + 바꾸기/새 항목 버튼. 바꾸기 → 4→5번째 버전, 항목 25개 유지, 한 줄만 남고 근거 user_statement |
| 수정: 진행 패널 가림 | 고침 | 단계 줄이 하단 고정 버튼에 가려 나타날 때 가운데로 스크롤(`AgentProgress.tsx`, 움직임 줄이기면 즉시 이동) |
| 수정: mock 초안 어미 | 고침 | '맡았어요'→'맡았었습니다', '만들어요'→'만들었습니다'(시제 변경), '예요' 미처리 → 과거형·이에요/예요만 변환(`packages/tailor/src/supplement.ts` formal). 재현 테스트 추가(FAIL→PASS) |
| `npm test` · build · `verify_run.py` | PASS 168/168 · PASS · pass 2026-11-19T19:29:11 | |

### 2026-11-19 공고(JD) 맞춤 점검·수정 오케스트레이션 (사용자 승인 "JD도 4단계 적용", DECISIONS S1-18, migration 013 = v0.7.6, 커밋 전)

공고를 고른 뒤의 맞춤 편집도 보완 대화와 같은 4단계로 나눴다. JD 점검 턴(메시지 없는 `tailor_resume` 작업) = ① 요구사항 대조(모델 없음, 충족·근거 약함·미기재) → ② AI 점검(근거 약함·미기재 요구에 질문만). 답변 턴 = ③ 수정안 작성(기존 맞춤 대화 제안) → ④ 근거 검토(별도 호출 keep/drop + 결정적 검사 재통과, 실패 시 수정안 비공개·사용자 문장 후보 유지). 단계 기록기는 보완 대화와 공용(`stage-tracker.ts`). 화면: 'JD 점검받기' 버튼, 요구사항 점검표·'이 요구에 답하기', 진행 패널, 단계 요약·뺀 수정안 이유.

| 검증 | 결과 | 근거 |
|---|---|---|
| `tests/tailor-pipeline.test.mjs` | 구현 전 FAIL(모듈 없음) → PASS 12/12 | 요구사항 분류(미기재 ≠ 경험 없음), AI 점검 서버 재검증(요구·fact id), 단계 전이, AI 점검 실패 표시, critic drop 이유, keep 후 가드 재실행, 닫힌 쪽 실패(거절·형식 오류·판정 누락·전송 불명), lease 상실, worker+API progress·turn·409(RESPONSE_PENDING·revision 충돌)·타 사용자 404, migration 013, Liner 요청(전송 없음·연락처 가림·원장 없으면 미전송), live 가짜 fetch 원장 3건(chat)·critic 불명 → 작업 unknown, 화면 진행 계산 |
| 기존 맞춤 대화 테스트(`tailoring-flow`·`tailor-unit`·`liner-chat`·`slop`) | PASS(기대값 변경 없음) | `stages` 없는 하네스는 기존 단일 호출 경로(②·④ 생략, `mode=single`)로 돈다 |
| 버전 기대값 | v0.7.5 → v0.7.6 | `tests/migration`·`foundation`·`supplement`, `scripts/db-check.mjs`. v0.7.5 migration 테스트는 012까지만 적용하도록 고정 |
| `npm test` · `typecheck` · `build` · `check:integration` · `db:check` | PASS 180/180 · PASS · PASS · PASS · v0.7.6, 표 55 | |
| 계약 표본(임시 부분 검사기 `/tmp/ce-check/mini-validate.mjs`) | 79개 실패 0 | JD 점검 TaskAccepted·progress 있는 TailoringSession·turn 있는 메시지 목록 포함. 일부러 틀린 stage key·status 표본 2개는 잡음 |
| `check:contracts` | BLOCKED | PyYAML·jsonschema 없음(설치하지 않음) |
| 브라우저 JD 점검 화면 | NOT_RUN | 데모 서버 재시작은 메인 세션이 한다(013 적용 필요) |
| Liner live(JD 점검·답변 턴 단계 호출) | NOT_RUN | 가짜 fetch로만 확인 |

### 2026-11-19 JD 맞춤 점검 브라우저 확인(ego, 합성 `table-style.synthetic.docx` + mock 합성 공고 '브릿지워크 시니어 프론트엔드', mock·staged)

데모 DB는 `app.before-013.sqlite`로 백업한 뒤 재시작해 013(v0.7.6)을 적용했다.

| 확인 | 결과 | 근거 |
|---|---|---|
| JD 점검(첫 턴) | PASS | 점검표 '충족 0 · 근거 약함 1 · 미기재 2', 미기재는 '경험이 없다는 뜻은 아니에요', 요구별 질문 + '이 요구에 답하기', 요약 '요구사항 대조 ✓ … · AI 점검 ✓ 질문 3개' |
| 진행 패널 | PASS(대기 상태) | '에이전트가 수정안을 만들고 있어요', 4단계 중 해당 턴 2단계만 진행·나머지 '이번엔 생략'. 단계 전환은 mock이 빨라 화면에서 못 봄(보완 대화와 같음) |
| 수정안 → 근거 검토 | PASS | '이 공고에 맞춰 수정해줘' → '수정안 작성 ✓ 수정안 2개 · 근거 검토 ✓ 2개 통과, 0개 제외', 변경 전후·근거 표시. 뺀 수정안 화면은 mock이 늘 통과라 NOT_RUN(테스트로만) |
| 발견·수정: 답하기 머리말이 후보에 섞임 | 고침 | '이 요구에 답하기'가 넣는 `‘코드 리뷰 경험’ 관련:`이 경력 후보 문장에 그대로 들어감 → `user-sentence.ts`가 줄 맨 앞 머리말을 떼고 후보를 만든다. 보완 대화 머리말도 `(질문) `→`‘질문’에 대한 답: `(괄호로 시작하는 진짜 문장 '(주)…'를 자르지 않게). 재현 테스트 FAIL→PASS. 오염된 제안은 거절했고 저장하지 않음 |
| 기획서 PDF | 갱신 | `docs/submission/기획서.pdf` A4 2쪽, JD 맞춤 4단계 반영, '경력 19년' 사례 일반화 |
| `npm test` · typecheck | PASS 181/181 · PASS | |

### 2026-11-19 HR 전문가 페르소나·서류 검토 기준·라벨 변경 + Liner 실호출 화면 확인 (DECISIONS S1-19)

- 페르소나: `packages/liner/src/persona.ts` `HR_PERSONA`를 Liner 대화 호출 7종 시스템 프롬프트 맨 앞에 붙이고 각 첫 줄을 '이번 작업: …'으로 바꿈. 점검·초안·공고 맞춤 5종에 `HR_CRITERIA`(웹 조사 출처는 S1-19), 근거 검토 2종에는 붙이지 않음. `tests/persona.test.mjs` 9건(구현 전 FAIL → PASS).
- 라벨: 화면의 '에이전트' → 'HR 전문가'(버튼·안내·진행 패널·aria). 코드 이름·주석은 유지.
- 공고 요구 패널: JD 점검표와 같은 `checkRequirements`로 '충족·근거 약함(기술 이름만 연결)·미기재' 표시.
- 기획서 흐름 '공고별 맞춤 대화' → 'JD 맞춤 점검·수정', HR 관점 한 줄 추가, PDF 2쪽 재생성. README Liner 절 한 줄 추가.

Liner 실호출(데모 서버 `CHAT_MODE=liner`, `LINER_MODE=mock` 검색, 한도 8건·$2, 합성 `table-style.synthetic.docx`·합성 공고, 실행 전 DB 백업 `app.before-live.sqlite`):

| 확인 | 결과 | 근거 |
|---|---|---|
| 기본 점검 첫 턴 진행 패널 단계 전환 | PASS | 0.5s 시작 → 2.0s '규칙 점검 ✓ · AI 점검 진행 중 (2/4)', 약 27초. AI 점검 11개, HR 관점 문구('면접에서 범위를 설명할 수 있어야') |
| 기본 점검 답변 턴 | PASS | 42.3s 초안 작성 진행 → 51.3s 근거 검토 진행. '후보 2개, 초안 2개 · 근거 검토 2개 통과 0개 제외'. 초안이 '근거 없는 속도 표현은 뺐습니다'라고 밝히고 측정 기록을 질문. 후보에 답하기 머리말 없음(실호출로도 수정 확인) |
| JD 점검 | PASS | 1.0s '요구사항 대조 ✓ · AI 점검 진행 중', 점검표 충족 0·근거 약함 1·미기재 2, 요구별 질문 |
| JD 답변(새 경험) | PASS | 새 사실은 '확인할 사실 1개'로만, 수정안 0개라 근거 검토 생략 |
| JD 수정 요청 | PASS | 55.9s '수정안 작성 ✓ · 근거 검토 진행 중 (2/2)' 화면 캡처. '수정안 2개 · 근거 검토 2개 통과 0개 제외'(기술 블록 앞으로, 중복 성과 문장 정리 제안) |
| 원장 | PASS | chat 7건 모두 succeeded, 확인 비용 120,226 micro-USD(≈$0.12), 전송 불명 0. 승인(20건·$5) 중 7건 사용 |
| 근거 검토의 실제 제외(drop) | NOT_OBSERVED | 이번 7건에서는 초안·수정안이 근거 안이라 제외 0. drop 화면은 테스트로만 확인 |

실호출 뒤 데모 서버는 mock 모드로 되돌림.

### 2026-11-19 데모 영상(`docs/submission/데모영상.mp4`, 2:48, 1280×800 H.264)

- 합성 자료만 든 빈 DB(`frontend.synthetic.docx`, 합성 공고 '노바커머스 풀스택'), Liner chat 실호출 7건 succeeded·약 $0.09·전송 불명 0. 사용자 추가 승인으로 대화 승인 총 30건·$5 중 21건 사용(누적 확인 비용 약 $0.30).
- 첫 실호출 녹화본은 녹화 스크립트의 스크롤 대상 오류로 결과 화면이 안 잡혀 폐기(7건 사용), mock 리허설로 수정 확인 후 재녹화. 재녹화본에서도 답변 턴 결과 직후 약 5초 잘못된 스크롤 → 해당 프레임을 잘라 냄(화면 내용 변경 없음).
- 녹화 도구는 저장소 밖(`/tmp/ce-check/video/`: cards.html, record.mjs, end.mjs, build.py). 제출 버튼은 누르지 않음.
- 발견(미수정): 실호출 HR 전문가 답변 문장에 내부 ID(`fact_005`, `fact_011`)가 그대로 나온다 → 프롬프트에 'reply에 ID를 쓰지 않는다' 추가 필요.

### 2026-11-19 AI 답변 속 내부 ID 제거 + 데모 영상 재녹화

- 프롬프트: `HR_PERSONA`에 'reply·질문·설명·이유 문장에 내부 ID를 쓰지 않는다' 추가.
- 서버: `packages/liner/src/scrub.ts` `scrubProse` — Liner 응답(`callLinerJson`)의 설명 문장 필드(reply·question(s)·detail·title·note·reason·summary)에서 `fact_/blk_/req_/said_` ID를 지운다. 근거 필드(statement·text·before·after)와 ID 필드는 그대로, 입력은 바꾸지 않음. `tests/persona.test.mjs` 재현 테스트 FAIL → PASS, `npm test` 191/191.
- 데모 영상 재녹화(`docs/submission/데모영상.mp4` 2:50, 편집 없음): Liner chat 7건 succeeded·약 $0.10·전송 불명 0. 저장된 턴 결과 5개의 설명 문장에 내부 ID 0건. 녹화 스크립트 스크롤 대상(가장 안쪽·마지막 요소) 수정 후 mock 리허설로 확인하고 찍음.
- 대화 승인 누적: 30건 중 28건 사용, 누적 확인 비용 약 $0.40, 전송 불명 0. 녹화 후 서버 종료.
- 영상은 YouTube에 올리고 저장소에는 넣지 않음(`.gitignore`에 `docs/submission/*.mp4`).

### 2026-11-20 실제 이력서 테스트 피드백 반영 (E7, DECISIONS S1-20)

- 화면 'AI' 표현 → '전문가'(진행 막대·단계 이름 'HR 전문가 점검'·요약·말풍선·탭·공고 찾기 '전문가 점검'·'Liner' 표시). 개인정보 안내는 'Liner(외부 서비스)로 전송, 최대 60일 보관, 해외 제공사 경유 가능'으로 사실을 유지.
- 긴 이력서(확정 경력 100개) AI 점검이 LINER_CHAT_TRUNCATED → 점검 항목 최대 8개·문장 120자 규칙. 실제 이력서 재확인: 'HR 전문가 점검 ✓ 8개 추가', 질문 8개.
- 중복 안내는 업무·성과·기타 문장에만(직함·회사 재입사·기간·기술·지역 반복 제외). 실제 이력서에서 중복 안내 0건.
- HR 전문가 점검·작성 가이드(HR_REVIEW_GUIDE·HR_DRAFT_GUIDE) 추가, 서버 routing `quality`로 실행. 실제 이력서 점검 1건: 17초, claude-sonnet-5.5, 입력 8,014·출력 1,739 토큰, 33,418 micro-USD.
- 테스트 194/194. 실제 이력서 내용은 파일·로그에 남기지 않았다(단계 요약·개수·모델명만 확인).

### 2026-11-20 실제 이력서 품질 검증(Liner live, routing quality, 모두 claude-sonnet-5.5)

이력서 내용은 파일·로그에 남기지 않았다. 판정과 개수만 기록한다.

| 항목 | 판정 | 근거 |
|---|---|---|
| ① HR 전문가 점검 | PASS(보완 1) | 강점 먼저, 최근 경력·범위('총괄·리드')부터, 검토자 관점 설명, 상황·행동·결과 질문과 '없으면 넘어가도 됨', 회사 간 기술 서술 불일치 발견, 오래된 경력 묶기 제안, 공백은 질문으로만. 근거 밖 수치·ID·합격 예측 없음. 보완: 일부 제목이 명사형으로 끝나 말투 불균일 |
| ② 과장 유도 거부 | PASS | "수치를 그럴듯하게 넣어 달라" → 거절하고 이유 설명, 확정 경력 문장만 한 문장 한 일로 초안 4개(새 수치·기술 0), 후보 0, 실제 기록 질문. 근거 검토 4/4 통과 |
| ③ JD 점검(실제 공고) | FAIL(제품 한계) | Liner 웹 검색 결과는 검색 요약만 있어 요구사항 목록이 비어 있음(`requirements=[]`) → 점검표 0·질문 0. 수정안 단계는 공고 요약 본문에서 기술 요구를 읽음 → 요구사항 추출 단계 필요. 답변에 내부 용어 'checks'가 보임 |
| ④ 공고 맞춤 수정안 | PASS(보완 1) | 수정안 2개(맞춤 요약 추가·한 문장 한 일 분리), 근거 경력 표시, 근거 검토 2/2 통과, 새 수치·기술 없음, 공고 기술과 연결되는 경력·성능 기록 질문. 보완: 답변 설명이 실제 수정안보다 넓게 말함('총괄' 풀어 썼다고 했으나 해당 수정 없음) |
| 검색 품질 | 보완 필요 | 8건 중 뉴스레터형 목록·해외 공고 섞임, 모든 카드 '요구 사항과 직접 연결된 경력 없음' |
| 비용 | — | chat 5건 약 $0.115, search 2건 약 $0.002 |

### 2026-11-20 품질 검증 후속 수정(DECISIONS S1-21)

| 항목 | 결과 | 근거 |
|---|---|---|
| JD 점검 요구사항 추출 | PASS | 단위·파이프라인 테스트 7개(tests/jd-extract.test.mjs). 실제 이력서 세션 실호출 1회: 이전 점검표 0 → 공고 요약에서 요구 1개 추출, 같은 요약에 섞인 다른 회사 공고 문구(경력·학력 조건)는 뽑지 않음, 대조 결과 표시, 답에 내부 용어 없음, '요약에서 읽음' 안내. 대화 2건 |
| 검색 필터 | PASS | 저장된 실제 검색 결과 8건에 새 규칙 적용(호출 없음): 주간 모음글 1·해외 공고 3 제외, 국내 공고 4 유지. 회귀 테스트 추가 |
| 표현 다듬기 | PASS(프롬프트·서버) | 해요체 제목 규칙, 필드 이름·영어 상태값 금지, 실제 changes만 설명, 근거 검토에서 뺀 수정안을 답에 알림(파이프라인 테스트). 말투 개선의 실호출 재확인은 NOT_RUN |
| 전체 | PASS | typecheck, npm test 204/204 |
| 비용 누계(이 데모 DB) | — | chat 17건, search 2건 |
