# Career Evidence 결정 기록 — 통합 v0.7

기준일: **2026.11.16 · 한국 시간**. 사용자는 이전 수정 자료를 아직 Claude Code에 적용하지 않았으며, 하나의 통합 자료를 요청했다. 이 파일은 현재 제품 방향과 구현 기본값을 구분한다. 과거 결정은 `docs/archive/`와 `contracts/v0.4/DECISIONS.md`에 보존한다.

## 사용자가 정한 제품 방향

| ID | 결정 | 구현에 주는 의미 |
| --- | --- | --- |
| U01 | 개발 도구는 Claude Code | Codex 사용량이나 Codex 설치를 개발 전제에 넣지 않는다. |
| U02 | 최초 입력은 보유 이력서 | 원본에서 추출·확인한 경력이 공고 검색의 출발점이다. |
| U03 | 공고 선택 후 AI와 대화하며 이력서를 맞춤 수정 | 단순 추천 문장 대신 실제 문서 변경안·비교·제출본을 만든다. |
| U04 | Ego 또는 Chrome을 통해 해당 이력서로 지원 | 브라우저 실행과 파일·답변·결과를 제품 흐름에 연결한다. |
| U05 | 어느 공고에 어떤 이력서로 지원했는지 관리 | 공고 snapshot·문서 revision·실제 파일·답변·접수 근거를 보존한다. |
| U06 | 비슷한 공고의 자동 지원 포함 | 추천·자동 준비·조건부 자동 제출 모드와 사용자 설정을 제공한다. |
| U07 | 한 패키지로 처음 시작 | 이전 ZIP을 순서대로 덮어쓰는 절차 없이 현재 기획·계약·프롬프트를 함께 제공한다. |

## v0.7 구현 기본값과 이유

| ID | 결정 | 이유·한계 |
| --- | --- | --- |
| D01 | React·TypeScript·Node·SQLite 기반 유지 | 기존 실행 코드·검증을 재사용하고 첫 사용자 흐름에 집중한다. |
| D02 | Node 24.12+의 24.x, npm 11/12, 정확한 lockfile | 기초 코드의 실행 요구를 유지한다. 의존성 변경은 필요성과 검증을 함께 기록한다. |
| D03 | 텍스트 PDF 우선, 텍스트 붙여넣기 복구 | 원본부터 검색까지의 실제 경로를 먼저 완성한다. DOCX·OCR은 지원하지 않는 상태를 명시하고 확장한다. |
| D04 | 원본·확정 사실·맞춤 revision·렌더 파일 분리 | 출처 추적, 변경 비교, 과거 제출본 재열람을 보장한다. |
| D05 | 확정 경력과 선호 조건으로 SearchIntent 생성 | 고정 React query와 synthetic profile 중심의 첫 과업을 대체한다. |
| D06 | 대화형 편집은 별도 provider 인터페이스 | Liner 검색·근거 수집과 문서 수정의 입출력·검증을 분리한다. 실제 모델은 품질·비용을 확인해 선택한다. |
| D07 | 첫 실행기는 Chrome, 최초 검증은 자체 폼 | 기존 확장 골격을 활용해 입력·첨부·접수·이력을 한 경로로 검증한다. Ego도 공통 ApplyAdapter에 연결할 수 있게 설계한다. |
| D08 | 실행 채널과 사이트 adapter 분리 | 한 브라우저가 연결됐다는 사실로 모든 채용사이트 지원을 완료 처리하지 않는다. |
| D09 | 자동화는 추천/자동 준비/조건부 자동 제출 | 사용자가 선택한 범위에서 실행한다. 정책 안의 매건 제출에 수동 확인을 강제하지 않는다. |
| D10 | fixed_document 또는 tailor_within_facts | 확정 파일 그대로 재사용하거나, 확인된 사실 안에서 공고별 표현을 바꾸도록 범위를 명시한다. |
| D11 | 공고별 authorization을 새로 생성 | 수동 승인 재사용을 막고 정책·공고·계정·답변·파일 hash에 실행 근거를 결속한다. |
| D12 | 기준 공고·프로필·이력서·정책 revision 고정 | 유사 공고가 다시 기준이 되어 자동화 범위가 무제한 확대되지 않게 한다. |
| D13 | 접수 불명은 조회·검토가 필요한 영속 상태 | 자동 재제출·채널 변경 중복·근거 없는 한도 반환을 막는다. |
| D14 | 전송 상태와 채용 진행 상태 분리 | 접수 실패를 채용 불합격으로, 무응답을 불합격으로 표시하지 않는다. |
| D15 | v0.4 bytes 보존 + v0.7 추가 migration | 기존 코드와 회귀를 보존하면서 새 principal·문서·정책 계약을 명시적으로 도입한다. 자동 DB reset을 하지 않는다. |
| D16 | 현재 제품 명세는 v0.7, 과거 자료는 archive | 과거의 합성 전용·자체 폼 전용 범위가 현재 제품 방향을 막지 않도록 한다. |
| D17 | 기초 코드와 제품 구현 상태를 분리 | preview·schema 검사만으로 업로드·대화·지원 기능 완료를 주장하지 않는다. |
| D18 | 기업 심층 브리프는 선택 기능 | 이력서 맞춤 수정과 지원 완주를 모든 기업의 심층 조사 완료에 종속시키지 않는다. |
| D19 | 짧은 CLAUDE.md·CODEMAP·상태·단계 프롬프트 | 개발 문맥과 재개 비용을 줄인다. 추가 skill/MCP/모델 강제 설정 없이 시작한다. |

## 후속 구현에서 결정할 항목

첫 실제 채용사이트와 해당 adapter의 지원 범위, 제품 대화 모델/API, 사용자 인증 제공자, 실제 파일 보관 위치·기간, 운영 배포 방식은 코드·품질·비용을 확인해 결정한다. 이 항목이 미정이어도 소유권 계약과 mock 기반 첫 흐름을 구현할 수 있다. 실제 운영에 연결할 때는 미정 항목을 완료 조건으로 전환한다.

자동 지원의 회사·직무·급여·기간·건수·비용 한도는 각 사용자의 설정이다. 문서의 예시 값은 활성화된 정책이 아니다. 이번 통합 작업은 개발 자료와 기반 코드를 준비하는 범위이며, 실제 기업 제출·자동 정책 활성화·배포의 실행 기록을 만들지 않는다.

## 변경 기록 작성법

새 결정은 ID, 날짜, 변경한 내용, 이유, 영향을 받는 계약·코드·검증을 함께 기록한다. 기존 결정이 바뀌면 그 결정을 삭제하기보다 대체 ID를 연결한다. 사용자 직접 요청, 구현 기본값, 아직 검증하지 않은 가정을 구분한다.

## 팀 공유 자료 v0.8 — 2026.11.16

| ID | 결정·상태 | 의미 |
| --- | --- | --- |
| T01 | 사용자 요청: 기획서 업데이트와 업무 분장 자료 | 최신 흐름의 2페이지 기획서, 협업 계획, 편집 가능한 업무표를 함께 제공한다. |
| T02 | 협업자의 전문 분야·가용시간 미확인 | 개발 분담안과 개발+검수안을 모두 제안한다. 확정 담당 칸은 비워 둔다. |
| T03 | 제안: 개발자는 제품·웹·문서·브라우저, 협업자는 API·검색·데이터 | 개발 분담안에서만 적용하는 협의안이다. 실제 강점과 가용시간에 따라 작업 ID를 유지하고 재배분한다. |
| T04 | 제안: 협업자가 검수·자료·발표 책임을 맡는 대안 | 협업자가 개발을 맡지 않는 경우의 실질적 산출물·완료 기준을 별도로 제공한다. 개발 가능 인원을 두 명으로 계산하지 않는다. |
| T05 | 팀 자료 v0.8, 제품·API·기초 코드 v0.7 | 협업 자료 추가와 제품 구현 상태를 구분한다. 이번 작업에서 runtime·DB migration·외부 지원을 실행하지 않는다. |
| T06 | 일정은 가용시간 확인 전 목표안 | 제공된 이전 안내의 11/25 마감과 제출 규격을 기준으로 계획했다. 제출 담당이 최신 안내를 재확인한다. |
| T07 | 담당 1명·검토 1명·산출물·완료 증거 | 공동 작업도 실제 실행 책임자를 정하고 인계한다. 담당자별 프롬프트와 업무표로 진행 상태를 관리한다. |

## 1인 개발 결정 v0.9 — 2026-11-17

| ID | 결정 | 적용 범위 |
| --- | --- | --- |
| SD01 | 사용자 확정: 개발자가 개발 전체를 맡음 | 화면·서버·DB·worker·AI 편집·PDF·브라우저·기술 검증·통합. T02~T04의 2인 역할 제안을 현재 기술 배정으로 사용하지 않음 |
| SD02 | 협업자의 참여는 선택적 검수·자료·데모 | 협업자의 구현·검토 완료를 개발 선행 조건으로 두지 않음. 실제 배정은 미정 |
| SD03 | 자체 검증으로 개발 완료 판단 가능 | T07의 필수 2인 확인과 과거 XLSX 완료 집계는 현행 규칙 아님. 구현 동작·실행 근거·남은 제약을 기록 |
| SD04 | 운영·패키지 v0.9, 제품·API·기초 코드 v0.7 | 이번 변경은 시작 방식과 계획 변경이며 제품 기능 구현 아님 |
| SD05 | 첫 구현을 등록·확정(S01)과 검색(S02)으로 분리 | 두 작업이 연결돼야 기존 제품 단계 1 전체의 완료 기준을 확인 |
| SD06 | 쓰기 세션 하나를 기본으로 사용 | 추가 검토 세션은 선택. 멀티 에이전트가 사용량·시간을 줄인다는 보장 없음 |
| SD07 | 기존 사용자 구현을 보존 | 이미 개발했다면 문서 지침만 필요한 부분부터 병합하고 다음 미완료 작업을 이어감 |
| SD08 | 실제 운영 전 별도 사이트·운영 검증 | 자체 폼 성공은 실제 기업 접수 완료가 아님. 실제 사이트 adapter·운영 인증·파일 보관·접수 관측 범위를 확인 |
| SD09 | 작업 목표일은 현재 미확정 | 이전 마감 안내를 최신 확인값으로 단정하지 않으며, 1인 가용시간 확인 없이 기존 2인 목표를 약속하지 않음 |

결정은 SD01~SD09, 실행 작업은 S01~S09로 구분한다.

## S01 구현 결정 — 2026-11-17

S01(이력서 등록→추출 확인→확정 경력 저장·재열람) 구현에서 정한 기본값이다. S02 이후에 바꾸면 이 표와 계약·테스트를 함께 갱신한다.

| ID | 결정 | 이유·한계 |
| --- | --- | --- |
| S1-01 | 로컬 개발 세션 `local_dev_loopback`: 127.0.0.1 API가 profile 이름으로 principal(`local-dev:<profile>`, mode `authenticated`)과 workspace를 만들고 HttpOnly `ce_session`·`ce_csrf` 쿠키를 발급 | 실제 이력서를 로컬에서 다루기 위한 개발용 인증이다. 운영 로그인이 아니며 `AUTH_MODE`는 `local_dev`만 허용한다. 운영 인증 제공자는 S09에서 교체한다. 쓰기 요청은 정확한 Origin과 CSRF header를 요구한다. |
| S1-02 | PDF 텍스트 추출은 `pdfjs-dist` 5.7.284(정확 고정, 로컬·키 없음) | 시스템에 poppler 등 CLI가 없어도 동작한다. OCR은 하지 않으므로 스캔 PDF는 `EMPTY_TEXT` 실패와 붙여넣기 안내로 처리한다. 한도 5MB·30쪽·20만 자. |
| S1-03 | 후보 추출은 모델 없이 규칙 기반 | 원문 줄을 그대로 후보로 만들고 새 사실을 생성하지 않는다. 부정·미확인·희망 조건·연락처·분류 불가 머리글은 사실 후보에서 빼고 `CODE@page:start-end 메시지` 형식의 warning으로 남긴다. 사용자는 원문 줄을 직접 추가할 수 있다. |
| S1-04 | 추출 원문은 extraction별 파일(`documents/<doc>/extractions/<id>.source.json`)로 보관하고 근거 검증의 기준으로 사용 | DB 계약에 원문 열이 없다. 확정 시 모든 EvidenceReference의 page·code point 범위·quote를 이 파일과 대조한다. 대화 진술 근거(user_statement)는 S04 전까지 거절한다. |
| S1-05 | 합성 여부는 서버가 실제 bytes hash와 `fixtures/resumes/expected.json`의 hash를 비교해 결정 | 사용자가 data_origin을 지정할 수 없다. fixture도 같은 업로드·추출 경로를 거친다. |
| S1-06 | 확정은 새 fact revision 추가 + `expected_parent_revision_id` 비교 | 이전 revision은 DB trigger로 불변이다. 다른 화면에서 먼저 저장하면 409로 알리고 덮어쓰지 않는다. |
| S1-07 | extract_resume 작업은 API 프로세스 안에서 실행하고, 시작 시·15초마다 queued 또는 lease 만료 작업을 복구 | 로컬 CPU 작업이며 외부 전송이 없다(provider_transmission=not_dispatched). 결과 저장 시 lease owner·generation·만료를 다시 확인한다. 영속 worker 분리는 S02에서 한다. |
| S1-08 | v0.7 계약에 S01 조회 경로 3개(`GET /resume-documents`, `/source-text`, `/original`)와 schema 정의 5개 추가. 로컬 개발 세션 경로는 제품 OpenAPI에 넣지 않음 | 새로고침·재시작 후 재열람과 근거 비교에 필요하다. 개발 전용 인증은 제품 API 계약과 구분한다. |
| S1-09 | DB 초기화는 `_starter_schema`에 버전별 행(v0.4, v0.7)과 객체 digest를 기록하는 migration runner | 기존 v0.4 DB는 한 transaction으로 v0.7을 추가하고, 실패하면 전체 rollback한다. 모르는 버전·수정된 migration SQL·객체 drift는 reset 없이 거절한다. 구형 runtime은 v0.7 DB를 열지 않는다. |
| S1-10 | 확정 항목의 문장은 근거 원문 범위 안의 표현이어야 함(공백 차이 무시, 일부만 남기기 허용). 위반 시 422 `STATEMENT_EXCEEDS_EVIDENCE` | 원문에 없는 수치·역할·자격을 원문 근거 사실로 저장하지 않는다. 사용자가 새로 진술한 사실은 S04의 user_statement 근거(실제 사용자 메시지)가 생긴 뒤 별도로 확정한다. 화면도 같은 규칙으로 저장을 막는다. |
| S1-11 | PDF 추출은 worker thread에서 20초·256MB 한도로 실행, 추출 작업은 lease 재획득 3회 초과 시 `EXTRACTION_ATTEMPTS_EXCEEDED`로 실패 종료 | 신뢰할 수 없는 PDF가 API 스레드를 막거나 lease 만료 재실행이 무한 반복되지 않게 한다. 실패하면 붙여넣기 안내로 이어진다. |
| S1-12 | (2026-11-19, D03 갱신) Word(.docx) 원본 지원: `mammoth@1.13.0`(사용자 선택)으로 본문·표 텍스트만 추출, 근거는 page=null + code point 위치. 업로드 시 ZIP 중앙 디렉터리로 본문 존재·암호·선언 크기(50MB)·항목 수를 먼저 거르고, 추출은 PDF와 같은 worker thread 한도(20초·256MB). 옛 .doc·암호 Word(OLE)는 415 `DOC_NOT_SUPPORTED`. DB는 migration 009(v0.7.2)로 `ce7_documents` CHECK만 넓힘(표 재생성, 행·FK·트리거 유지). 합성 docx hash는 동결된 `expected.json` 대신 `fixtures/resumes/docx.synthetic.json` | 사용자 요청. 서식·머리글/바닥글·이미지는 경력 근거로 쓰지 않는다. 압축 폭탄과 파서 지연이 API를 막지 않게 한다. 007·008 bytes는 그대로 둔다. |
| S1-13 | (2026-11-19) 1차 점검(규칙): 확정 후 검색 설정 화면에 '기본 이력서 1차 점검' 패널. 직무 없음·기간 빠진 회사(경고), 결과 문장 없음·넓은 표현·평가어/상투 표현·긴 문장·중복·적은 기술(안내)과 질문, 직무별 문장 패턴을 보여 준다. 웹에서 계산(`packages/tailor/src/review.ts`, 외부 전송 없음), 사실은 바꾸지 않는다 | 사용자 요청('기본 이력서 1차 점검'). 확정 문장은 원문 범위(S1-10)라 점검은 안내·질문만 한다. 검색을 막지 않는다. AI 점검(Liner)은 별도 단계로 추가한다. |
| S1-14 | (2026-11-19) AI 1차 점검: `POST /api/v1/resume-fact-revisions/{id}/ai-reviews`(빈 본문, 202) → `review_resume` 작업 → `GET /api/v1/resume-ai-reviews/{id}`. migration 010(v0.7.3)으로 `ce7_tasks.kind` 확장(표 재생성)과 `ce8_resume_reviews`(끝나면 갱신 불가). provider는 대화와 같은 모드(mock=규칙 점검을 같은 모양으로, liner=Liner Router·purpose=chat 원장·가림·재시도 없음). 결과는 안내·질문만 저장(없는 사실 ID·형식 틀린 항목은 버림), 확정 경력은 바꾸지 않는다. 같은 버전에 진행 중인 점검이 있으면 409. 요청에 오늘 날짜를 넣는다 | 사용자 선택(AI 품질 점검). 점검은 사실이 아니므로 별도 표에 둔다. 실호출에서 모델이 기간을 '미래'로 오판해 기준일을 준다. 화면에서 버튼으로만 요청한다(유료). |
| S1-15 | (2026-11-19) 후보 추출 제목 인식 확장: 앞의 기호·번호(`01`, `06  `, 로마·원 숫자)·괄호와 `|`·`(` 뒤 부제를 떼고 비교, '핵심 업무 스킬'·'대표 성과'·'이전 경력' 같은 수식어 제목과 '학력 · 자격 · 교육' 같은 제목 묶음(모든 조각이 제목일 때 첫 제목)을 인식. 번호·괄호 서식이 분명한데 이름을 모르는 짧은 줄은 '기타' 구역을 연다(`1. `·`10. ` 목록 항목은 제목으로 보지 않음). 제목이 없는 머리글에서도 기간 줄은 회사·기간 후보로 만들고, 기술 구역의 40자 넘는 조각은 버리지 않고 `UNCLASSIFIED_LINE`으로 남긴다. 화면: `NO_FACT_CANDIDATES`는 원문이 있으면 '읽기 실패'가 아니라 '자동 후보 0건 · 직접 추가 필요' 안내로 보이고, 원문 줄의 '+ 추가'는 항상 보인다 | 사용자 보고(E6): 번호 제목을 쓴 실제 Word 이력서가 196줄 모두 머리글로 남아 후보 0건·읽기 실패로 보였고 직접 추가 버튼은 hover 때만 보였다. 문서 상태 값·API 계약은 바꾸지 않는다. 이미 실패로 끝난 문서는 다시 추출하지 않으므로 같은 파일을 다시 올려야 새 규칙이 적용된다. |
| S1-16 | (2026-11-19) 기본 이력서 보완 대화: `POST /api/v1/resume-fact-revisions/{id}/supplement-sessions`(빈 본문, 문서의 현재 확정 버전만, 아니면 409 `FACT_REVISION_NOT_CURRENT`) → `supplement_resume` 첫 턴(점검 findings·질문) → `POST /api/v1/resume-supplement-sessions/{id}/messages`(사용자 메시지 먼저 저장, 대화당 응답 하나, 진행 중 409 `RESPONSE_PENDING`) → 턴(reply·findings·candidates·drafts·questions) → `GET …/{id}`. migration 011(v0.7.4): `ce7_tasks.kind` 확장(표 재생성) + `ce8_supplement_sessions`(식별 열 갱신 불가)·`ce8_supplement_messages`(갱신 불가). 후보는 사용자 메시지 안의 문장만(`userSentenceFor`, packages/tailor/src/user-sentence.ts로 옮겨 맞춤 대화와 공유), 이미 확정 경력에 있는 문장은 제외. 초안은 사실이 아니며 근거(확정 경력·사용자 답변)에 없는 숫자·기술·역할(S4-04 `checkSupported`)이나 평가어(`findSlop`)가 있으면 버리고 질문으로 알림. 후보 확정은 기존 확정 API로 하고, `statementLookup`이 같은 문서의 보완 대화 사용자 메시지를 user_statement 근거로 인정(assistant 메시지는 거절). provider는 대화와 같은 모드(mock=규칙 점검·사용자 문장 그대로, liner=Liner Router·purpose=chat 원장·가림·기준일·재시도 없음). 대화 맥락은 문서의 현재 확정 버전 사실(대화 중 추가한 후보를 다시 묻지 않게), 세션은 시작 버전을 기록하고 화면은 버전이 바뀌면 안내·새 점검 버튼을 보인다 | 사용자 선택('기본 이력서 보완 대화 신설'). 공고 없이 기본 이력서를 에이전트와 보완하는 흐름을 보여 준다. AI 문장을 사실로 승격하지 않는 S4-05 규칙을 그대로 지킨다. 맞춤 대화 표는 공고가 필수라 별도 표를 둔다. |
| S1-17 | (2026-11-19) 보완 대화 오케스트레이션: 한 턴을 단계로 나눈다(`packages/tailor/src/supplement-pipeline.ts`). 첫 턴 = ① 규칙 점검(`reviewFacts`, 모델 없음) → ② AI 점검(규칙 결과를 입력으로 받아 규칙이 못 보는 문제·질문만, 문장은 고치지 않음). 답변 턴 = ③ 초안(사용자 문장 후보 + 다듬은 초안) → ④ 근거 검토(다른 호출이 초안마다 keep/drop·이유, keep도 결정적 가드(S4-04 근거·안티슬롭) 재통과). ④가 한도 거절·실패·전송 불명·형식 오류면 초안 비공개(닫힌 쪽 실패, 후보는 유지), 판정 없는 초안은 drop. ②가 실패하면 규칙 결과만 보여 주고 실패를 답·단계 요약에 적는다. 호출마다 원장 예약(purpose=chat), 보낸 뒤 재시도 없음. `SUPPLEMENT_PIPELINE=staged`(기본)·`single`(비교용, 기존 S1-16 한 번 호출). 진행 기록은 migration 012(v0.7.5)의 `ce8_supplement_sessions.progress_json`에 단계 경계마다 lease 확인 후 저장하고 GET 세션 `progress`로, 끝난 턴 요약은 `turn.pipeline`으로 보여 준다. 화면: 작업 중 진행 패널(단계 표시·움직이는 막대·지금 하는 일·경과 초, 움직임 줄이기 존중, 보내기 막음), 끝난 턴 한 줄 요약과 뺀 초안 이유. 같은 내용 처리: 후보가 기존 항목과 공백·문장부호·어미만 다르거나 에이전트가 보완 대상을 지목하면 '기존 항목 바꾸기'(그 자리 교체, 새 근거)와 '새 항목으로 추가'를 함께 보인다(확정 API 그대로). 비교 평가 `scripts/supplement-eval.mjs`(합성 3개, recall·부풀린 초안 노출·호출 수, live는 `--max-calls` 필수·전용 원장) | 사용자 승인(오케스트레이션 적용, 진행 막대 요청). 찾기와 고치기를 나누고 두 번째 판정으로 과장을 거르되, 보장은 여전히 결정적 가드가 한다. 단계 수만큼 호출·지연이 늘어 효과는 평가로 확인한다. 011은 데모 DB에 이미 적용돼 바꾸지 않고 열 추가 migration으로 분리했다. |
| S1-18 | (2026-11-19) 공고(JD) 맞춤 점검·수정 오케스트레이션(`packages/tailor/src/tailor-pipeline.ts`). JD 점검 턴(`POST /api/v1/tailoring-sessions/{id}/jd-checks`, 사용자 메시지 없는 `tailor_resume` 작업) = ① 요구사항 대조(모델 없음, `jd-check.ts checkRequirements` — 검색 화면과 같은 `explainMatch` 연결 + 기술 이름만 연결되면 그 기술을 쓴 업무 문장이 있을 때만 충족: 충족/근거 약함/미기재, 미기재는 경험 없음으로 단정하지 않음) → ② AI 점검(근거 약함·미기재 요구에 질문만, 문서 불변, 요구 id·fact id는 서버 `screenJdReview`가 검증). 답변 턴 = ③ 수정안 작성(기존 `ChatProvider.respond` 그대로) → ④ 근거 검토(별도 호출이 수정안마다 keep/drop·이유, keep도 기존 결정적 검사 `screenChanges`(S4-04 근거·S4-13 안티슬롭·적용 가능성) 재통과). ④가 거절·실패·전송 불명·형식 오류면 수정안 비공개(닫힌 쪽), 판정 없는 수정안은 drop, 사용자 문장 후보(needs_fact_confirmation)는 근거 검토 없이 기존 확인 절차로 남는다. 호출마다 원장 예약(purpose=chat), 보낸 뒤 재시도 없음, 하나라도 전송 불명이면 작업 전송 상태 unknown. 단계 기록기는 보완 대화와 공용(`stage-tracker.ts`). migration 013(v0.7.6): `ce7_tailoring_sessions.progress_json`(진행 기록 → GET 세션 `progress`)·`ce7_messages.result_json`(턴 결과 → 메시지 `turn`) 열 추가. worker `stages` provider가 없으면(테스트 하네스·S06 호환) ②·④를 건너뛰고 `mode=single`로 단계 기록에 남긴다. 실행 worker는 항상 mock 또는 Liner 단계 provider를 연결한다. 화면: 'JD 점검받기' 버튼, 요구사항 점검표(충족·근거 약함·미기재·근거 경력·질문·'이 요구에 답하기'), 진행 패널(`AgentProgress` + `TAILOR_PROGRESS`), 끝난 턴 단계 요약과 뺀 수정안 이유 | 사용자 승인("JD도 4단계 적용", migration 013·API 응답 필드 추가 포함). 공고를 고르기 전 기본 이력서 점검(S1-16·17)과 공고를 고른 뒤 JD 맞춤 점검·수정을 같은 구조로 보여 준다. 새 환경변수는 만들지 않았다(비교용 단일 호출 모드 없음). 턴 결과를 담을 곳이 없어 메시지 `result_json` 열을 함께 더했다. 답변 턴은 유료 호출이 1건에서 2건으로 늘고, JD 점검 1건이 더해진다. |

## S02 구현 결정 — 2026-11-17

S02(확정 경력→검색 계획→영속 mock 검색→공고 표시) 구현에서 정한 기본값이다. 바꾸면 계약 샘플 검증·테스트를 함께 갱신한다.

| ID | 결정 | 이유·한계 |
| --- | --- | --- |
| S2-01 | 검색 질의는 확정 경력의 `role`·`skill` 사실 문장만 이어 붙여 만든다(첫 직무 + 기술 3개씩, 최대 10개). 각 질의는 근거 fact ID를 가진다 | 모델 없이 사실 문장만 쓰므로 새 경력을 만들지 않는다. 직무·기술이 없으면 422 `NO_SEARCHABLE_FACTS`로 거절하고 경력 확인 화면으로 안내한다. |
| S2-02 | 이메일·전화·URL·주민번호·생년월일·'이름:' 등 라벨 패턴이 있거나 40자를 넘는 사실은 질의에서 제외. 조건 값에 개인정보가 있으면 422 | 사용자가 원문 줄을 직접 확정할 수 있어 S01 추출 단계의 제외만으로는 부족하다. 이름 자체는 패턴으로 알 수 없으므로 직무·기술 범주만 쓰는 것으로 막는다. |
| S2-03 | SearchIntent와 새 검색 작업은 문서의 **현재** 확정 revision으로만 만든다(아니면 409 `FACT_REVISION_NOT_CURRENT`). 이미 만든 검색은 불변으로 보존 | 다른 화면에서 경력을 고친 뒤 이전 버전으로 새 검색을 만들지 않게 한다. 이전 검색 결과는 덮어쓰지 않고 화면에 '이전 경력 버전 기준'으로 표시한다. |
| S2-04 | 검색 실행은 별도 `apps/worker` 프로세스. API는 task·search run만 저장(202). `npm run dev`는 API health 확인 후 worker를 시작 | 두 프로세스가 빈 DB를 동시에 초기화하지 않게 한다. worker가 없으면 '대기 중'으로 남고 성공처럼 보이지 않는다. |
| S2-05 | lease 30초, heartbeat leaseMs/3, 결과 저장 transaction에서 owner·generation·만료 재확인, 재획득 3회 초과 시 `SEARCH_ATTEMPTS_EXCEEDED`. provider 호출 전 `provider_transmission=dispatched` 기록 | live provider는 dispatched 상태로 끊긴 작업을 재시도하지 않고 `PROVIDER_TRANSMISSION_UNKNOWN`·`unknown`으로 끝낸다(유료 호출 중복 방지). mock은 외부 효과가 없어 재실행한다. |
| S2-06 | 취소: queued는 즉시 canceled, running은 `cancel_requested=1`만 기록한다. worker는 전송 직전 CAS에서 중지 요청을 확인해 새 전송을 하지 않고, 이미 전송했으면 결과를 저장하지 않고 canceled로 마무리. lease가 끝난 중지 요청 작업은 다음 claim 때 canceled 처리. `search_jobs`만 취소 가능 | 이미 시작한 처리를 '취소 완료'로 단정하지 않는다. 추출 작업은 취소하면 문서가 멈춘 상태로 남아 제외했다. |
| S2-07 | 공고 근무 조건(근무지·근무 방식·고용 형태·연봉·경력)은 공고 원문의 '항목: 값' 줄에서 읽고, 줄이 없으면 '정보 없음'. 필수 조건이 명확히 어긋난 공고만 결과에서 제외 | JobSnapshot 계약에 구조화 열이 없다. 정보 없음과 조건 미충족을 구분한다. 직무명 불일치는 미충족으로 단정하지 않는다. |
| S2-08 | 추천 이유·확인할 조건은 저장하지 않고 불변 기록(JobSnapshot·확정 경력·SearchIntent)에서 화면이 같은 순수 함수(`packages/search`)로 계산 | 계약 추가 없이 재현 가능하다. 근거를 찾지 못한 요구는 '경험 없음으로 단정하지 않음'으로 표시한다. 규칙 기반 단어 일치라 의미 판단은 사용자가 근거 문장을 보고 한다. |
| S2-09 | 검색 작업 입력에 API의 provider 모드(mock/live)를 고정하고, worker의 provider 모드와 다르면 `PROVIDER_MODE_MISMATCH`로 실행하지 않는다. provider 호출에는 AbortSignal을 넘겨 lease를 잃으면 중단한다 | S03에서 API·worker 설정이 어긋나 live 결과가 mock으로 표시되거나 그 반대가 되는 것을 막는다(독립 리뷰 지적). |

## S03 구현 결정 — 2026-11-18

Liner live 웹 검색 adapter. mock이 기본이며, 사용자 승인 범위는 실호출 20건·앱 예산 $10(`LINER_BUDGET_MICRO_USD=10000000`)이다. 구현·테스트는 가짜 fetch와 합성 응답만 썼고 실호출 검증은 아직 하지 않았다.

| ID | 결정 | 이유·한계 |
| --- | --- | --- |
| S3-01 | `LINER_MODE=live`는 `LINER_API_KEY`(비어 있지 않음)·`LINER_MAX_CALLS`(정수 1 이상, 새 변수)·`LINER_BUDGET_MICRO_USD`(정수 0 초과)가 모두 있을 때만 시작. 아니면 `LINER_API_KEY_REQUIRED`·`LINER_MAX_CALLS_INVALID`·`LINER_BUDGET_INVALID`·`LINER_MODE_INVALID`로 종료. 키 값은 설정 객체에 넣지 않고 worker가 provider를 만들 때만 읽는다(`readLinerApiKey`) | 한도 없는 유료 호출을 막는다. 오류·설정 출력·로그로 키가 새지 않게 한다. |
| S3-02 | provider는 `packages/liner/src/web-search.ts`. 요청 `POST https://platform.liner.com/api/v1/tools/search/web`, header `x-api-key`·`Content-Type`만, 본문 `query·country_code=KR·lang=ko·date_range=past_month·max_results=10·include_knowledge=false`. 질의는 검색 계획 앞 2개(개인정보 패턴 재확인) + '채용'. 호출당 20초 제한·작업 AbortSignal 연결 | 실행당 최대 2건으로 승인 호출 수를 아낀다. `include_knowledge=false`는 1,000건당 $1. |
| S3-03 | 호출 원장은 migration 007의 `ce7_provider_calls`(새 migration 없음). 호출마다 짧은 `BEGIN IMMEDIATE`에서 lease 보유·중지 요청 없음·전체 liner 행 수 < `LINER_MAX_CALLS`·예약 합 + 2,000 ≤ 예산을 확인하고 `reserved` 행 생성 → 요청 직전 `dispatched` → `succeeded`(확인 1,000) / `failed`(400·401·402·429, 확인 0) / `unknown`(네트워크·시간 초과·5xx·그 밖의 상태·해석 불가, 확인 비용 없음). `request_hash`는 키 없는 요청 본문 sha256 | 개발 계정 하나를 공유하므로 한도는 workspace와 무관한 DB 전체 합계다. 예약은 실패·불명이어도 반환하지 않는다(보수적 집계). 네트워크 호출은 transaction 밖. |
| S3-04 | 전송 뒤에는 어떤 실패도 자동 재시도하지 않고 남은 질의도 보내지 않는다. 처리 안 됨이 확인된 응답은 작업 `provider_transmission=completed`, 처리 여부 불명은 `unknown`, 한도·lease 거절(전송 없음)은 `not_dispatched`. `SearchProviderError`가 이 분류(`transmission`)를 가지고 worker(검색·유사 공고 탐색)가 그대로 기록한다 | 결과를 모르는 유료 호출을 다시 보내지 않는다(CLAUDE.md 불변 조건). 첫 질의 성공 뒤 둘째가 실패하면 `partial`. |
| S3-05 | 결과 → JobDraft: 공고 신호(제목·주소의 채용·모집·공고·recruit·careers·jobs, wanted·saramin·jobkorea·rocketpunch·jumpit·incruit·programmers, linkedin.com/jobs)가 있는 http(s) 주소만, fragment 제거 주소로 중복 제거, `job_key=liner:`+sha256(주소) 앞 32자, `site_id`=hostname, 회사명은 제목의 `[회사]`·`(주)회사`·`회사 채용` 형식만(일반 단어 제외) 없으면 hostname, `content_text`=검색 요약(비면 제목), `requirements=[]`, `open_status=unknown`, `data_origin=live` | 검색 요약만 받았으므로 요구 사항·모집 상태·회사명을 지어내지 않는다. 공고 신호 판정은 제목·주소 기준이라 채용 뉴스 등이 섞일 수 있다(화면에서 원문 확인 요구). |
| S3-06 | 화면: live 결과는 'Liner 웹 검색 결과'·검색 시각·출처 hostname 링크·'검색 요약만 확인(원문 확인 필요)'을 표시하고 근무 조건은 '확인 필요', 요약에서 읽은 조건 미충족도 '확인 필요'로 표시. mock은 '합성' 표시 유지. health `mode`·`live_search`는 설정을 따른다(`mock` / `implemented_liner_web`), 세션 `capabilities.live_search`도 같다 | live를 합성으로, 합성을 실제로 보이지 않게 한다. 요약만으로 조건 충족을 단정하지 않는다. |
| S3-08 | 실호출 관찰로 공고 판정을 고친다: 글(자소서·작성 예시·면접 후기 등) 제외, 공고 사이트가 아닌 곳은 제목에 직무·경력 표현이 있어야 공고, '회사 - 직무'·'직무 - 회사 (채용)' 회사명 형식, 회사명 앞 4글자+직무 제목으로 사이트 간 중복 제거. 상단 범위 문구는 health의 live_search를 따른다 | 2026-11-18 실호출 10+5건에서 글 1·일반 채용 안내 2·중복 1·회사명 누락 3을 확인. 합성 이름으로 옮긴 회귀 테스트 추가. 원장 한도는 DB 파일 단위라 임시 DB는 0부터 센다(계정 총량은 PROGRESS 누적 기록으로 관리) |
| S3-07 | 실호출 확인은 `scripts/liner-live-check.mjs`. 한도·live 설정이 없으면 거절, 키는 존재 여부만 출력, 원장 DB(`.data/liner-live-check/`)를 실행 사이에 유지해 여러 번 실행해도 합계 한도로 막음. `--usage`는 호출 없이 사용량만 | 실행 중인 개발 서버(4310·4311)와 겹치지 않게 임의 포트 in-process API를 쓴다. 제품 개발 서버 DB의 원장과는 별도 집계다. |

## S04 구현 결정 — 2026-11-17

S04(공고 선택→AI 대화→변경 제안→맞춤 이력서 revision→확정→PDF) 구현에서 정한 기본값이다.

| ID | 결정 | 이유·한계 |
| --- | --- | --- |
| S4-01 | 편집 세션은 문서의 **현재** 확정 경력 revision과 공고 스냅샷으로만 만들고, 첫 revision은 확정 사실 문장을 그대로 옮긴 기본 이력서(구역: 요약·직무·기술·경력·경력 내용·성과·학력·자격) | 원본 사실과 공고별 문서를 분리한다. 기술은 한 블록, 회사+기간은 한 줄로 묶는다. |
| S4-02 | 대화는 `tailor_resume` 영속 작업(worker). 사용자 메시지를 먼저 저장하고, 세션당 동시에 하나의 응답만 생성(`RESPONSE_PENDING`). 화면이 본 revision이 현재와 다르면 409 | 응답 순서·base revision 고정. 늦은 응답은 현재 문서를 바꾸지 않고 stale 제안으로 저장한다. |
| S4-03 | 변경 operation: replace(before가 현재 문장과 같아야 함), insert('핵심 요약' 구역 맨 앞, 근거 필수), remove(before 일치), reorder(같은 구역 맨 앞으로) | 계약의 ProposedChange에 위치 필드가 없어 위치 규칙을 고정했다. 임의 경로·코드로 문서를 고치지 않는다. |
| S4-04 | 근거 검사: replace·insert 문장의 숫자(단위가 있으면 숫자+단위 쌍, NFKC 정규화)·한국어 수량 표현·영문 기술명(한 글자 포함)·책임 범위 표현(리드·리딩·이끌·총괄·주관·팀장·최고·CTO 등)은 근거로 든 같은 fact revision의 사실 문장에 있어야 함. worker는 위반 변경을 저장하지 않고 질문으로 돌리고, 수용·확정 시 다시 검사 | 새 성과 수치·기술·역할이 문서에 들어가지 않게 한다. 한국어 의미 과장은 기계적으로 완전히 막지 못해 근거 문장을 함께 보여준다. |
| S4-05 | 새 사실은 사용자가 직접 쓴 메시지 안의 문장만 후보가 되며(`needs_fact_confirmation`), 사용자가 '경력 정보에 추가'로 `user_statement` 근거의 새 fact revision을 확정한 뒤에만 적용. 수용 시 그 fact revision을 새 이력서 revision에 고정 | assistant 문장을 사실로 승격하지 않는다(서버가 role=user 메시지만 근거로 인정, 확인 시각은 서버 기록). S1-04의 '진술 근거 거절'을 이 범위로 대체한다. |
| S4-06 | 수용은 base revision + content hash CAS. 수용·되돌리기가 일어나면 같은 세션의 다른 미처리 제안은 stale. 되돌리기는 이전 내용을 새 revision으로 저장 | 오래된 제안이 최신 문서를 덮지 않는다. 기록은 지우지 않는다. |
| S4-07 | 확정은 최신 draft만, content hash 일치·`reviewed=true`·전체 블록 근거 재검사·다른 공고 회사명 검사 후 `final`(DB trigger로 동결) | 이전 회사명(다른 지원 대상)이 남은 문서 제출을 막는다. 확정 경력에 있는 이전 직장명은 제외한다. |
| S4-08 | PDF: `render_resume` 작업, pdf-lib 1.17.1 + 나눔고딕 보통체 **전체 임베딩**(약 0.8MB), 제목은 겹쳐 그려 굵게, 날짜를 확정 시각으로 고정해 같은 revision은 같은 bytes, 렌더 버전은 PDF Producer(`resume-pdf.v2 …`). 제공 시 저장 bytes hash를 DB와 대조 | pdf-lib 서브셋은 이 글꼴의 한글 글리프를 빠뜨렸다(브라우저 관찰로 발견). 텍스트 추출이 아닌 글리프 윤곽선 검사로 회귀를 막는다. `ce7_artifacts`에 렌더 버전·쪽수 열이 없어 작업 결과와 응답 header(`X-PDF-Page-Count`)로 제공한다. |
| S4-09 | 계약 확장(S1-08과 같은 방식): `GET /tailoring-sessions/{id}/tasks`(schema `TaskList`), `POST /edit-proposals/{id}/reject`, `POST /tailoring-sessions/{id}/messages/{message_id}/retry`, `POST /tailoring-sessions/{id}/restore`, `GET /tailoring-sessions/{id}/revisions`, `GET /resume-revisions/{id}/artifacts`, schema `ResumeRestore`·`ResumeRevisionList`·`RenderedArtifactList`, `ProposalAccept.change_indexes`(부분 수용) | 화면 명세의 거절·실패 단계 재시도·되돌리기·재열람과 프롬프트의 부분 수용을 표현하는 경로가 기존 계약에 없었다. `POST /artifacts`의 resource_id는 렌더할 revision이며 완료 후 task.result_ids에 artifact ID가 들어간다. |
| S4-10 | 대화 provider는 `packages/tailor/src/provider.ts` interface. `CHAT_MODE`는 mock만 허용하고 작업 입력에 모드를 고정(불일치 시 실행 안 함). mock은 `[mock:fail]`·`[mock:slow]` 표식으로 실패·지연을 재현 | 제품 대화 모델은 아직 선택하지 않았다(D06). Claude Code는 런타임이 아니다. |
| S4-11 | 확정 전 추가 검사: 문서가 고정한 경력 버전 이후 지우거나 문장을 고친 사실을 참조하는 블록이 있으면 409 `FACTS_CHANGED`, PDF 글꼴(나눔고딕)에 없는 글자가 있으면 422 `RESUME_GLYPH_MISSING`(렌더도 같은 검사로 실패) | 철회한 사실이 제출 파일에 남거나, 글자가 PDF에서 조용히 빠지는 것을 막는다(독립 리뷰 지적). 라틴 확장 문자(é·ü 등)용 보조 글꼴은 아직 없어 해당 글자가 있는 문서는 확정할 수 없다. |
| S4-12 | 대화 진술 근거는 같은 문서(이 문서의 확정 경력으로 시작한 편집 세션)의 사용자 메시지만 인정. 실패 응답 재시도는 세션의 마지막 사용자 메시지만 | SERVICE_RULES의 '같은 scope' 해석. 답변 순서를 보존한다. |
| S4-13 | (2026-11-19) 안티슬롭: AI가 새로 쓴 제안 문장에 상투 문구(열정·최선을 다해 등)·근거 없는 평가어(탁월한·성공적으로·극대화·임팩트 등)·AI 연결 장치(뿐만 아니라·이를 통해 등)·줄표/느낌표/이모지가 있으면 문서에 넣지 않고 이유를 질문으로 남긴다(`packages/tailor/src/slop.ts`, worker `screenChanges`). 사용자 원문(근거 사실·바꾸기 전 문장)에 있는 표현은 허용. live 모델 지시문에도 같은 규칙을 넣는다 | 사용자 요청. 경력 근거 검사(S4-04)가 막지 못하는 '표현의 과장'을 기계적으로 줄인다. 규칙 목록은 관찰에 따라 늘린다. |
| S4-14 | (2026-11-19) 대화 수정 live provider = Liner Router API(`POST /api/v1/chat/completions`, `liner-claude-router`, routing 기본 balanced, JSON schema 강제, 최대 출력 4000토큰). `CHAT_MODE=liner`는 `LINER_API_KEY`·`LINER_CHAT_MAX_CALLS`·`LINER_CHAT_BUDGET_MICRO_USD`가 모두 있어야 시작. 원장은 검색과 같은 `ce7_provider_calls`이되 purpose=chat으로 따로 센다. 호출마다 최악 가격(입력 문자 수×$10/M + 4000×$50/M)을 예약하고, 확인 비용은 응답 `model`의 가격표로 계산(모르는 모델은 최고가). 보낸 뒤 자동 재시도 없음, 전송 불명은 unknown. 이메일·전화번호 형태는 보내기 전에 가림. 유사 공고 자동 준비(S06)는 계속 mock 대화. 사실 확인 후보는 모델이 어미를 바꿔도 사용자 메시지의 원문 문장으로 바꿔 저장 | 사용자 선택(연결·실호출 검증, 5회·$2). 이력서가 외부로 나가므로 화면에 전송·보관(60일)·국외 처리를 알린다. 라우터가 모델을 고르므로 비용을 적게 기록하지 않는다. 한 캠페인이 유료 호출을 대량으로 만들지 않게 한다. |
| S4-15 | (2026-11-19) 직무별 문장 패턴 라이브러리(`packages/tailor/src/patterns.ts`): 프론트엔드·백엔드·데이터·디자인·기획·공통의 작성 원칙과 합성 예시(약한 문장→나은 문장). Liner 대화 지시문에 '형식만 참고'로 넣고, 1차 점검 화면에도 보여 준다. 웹에서 다른 사람의 이력서를 검색·수집하지 않는다 | 사용자 선택. 개인정보·저작권·품질 문제와 '내 경력 사실만' 원칙. 나은 예시는 안티슬롭을 통과하고 숫자를 넣지 않는 것을 테스트로 고정한다. |

## S05 구현 결정 — 2026-11-18

S05(확정 PDF·답변 → Chrome 확장으로 자체 테스트 폼 지원 → 접수 근거 → 제출 당시 이력) 구현에서 정한 기본값이다. 내부 실행 프로토콜은 `docs/EXECUTOR_PROTOCOL.md`.

| ID | 결정 | 이유·한계 |
| --- | --- | --- |
| S5-01 | 새 migration `contracts/v0.7/migrations/008_browser_apply.sql`(버전 `v0.7.1`, 테이블 6개 추가 → 52개). 007은 바꾸지 않음. 자체 폼 사이트 저장소는 `demo_site_` 접두어로 제품 테이블과 분리 | 사용자 승인(2026-11-18). 기기 연결·폼 관측·실행 토큰·외부 지원 기록·사이트 접수 기록은 ce7에 맞는 자리가 없다. 기존 v0.7 DB는 제자리에서 v0.7.1로 올라간다. |
| S5-02 | 실행 채널(Chrome 확장 `executor.mjs`)과 사이트 adapter(`self-form-adapter.mjs` 페이지 함수, 서버 쪽 `packages/apply/src/self-form.ts`)를 분리. 현재 adapter는 `self-form.v1` 하나 | Ego·외부 사이트를 같은 지원 건·시도 기록에 뒤에 연결한다. 지원하지 않는 사이트의 공고는 422 `SITE_NOT_SUPPORTED`(외부 지원 기록으로 안내). |
| S5-03 | 자체 폼은 사이트 로그인이 없으므로 계정 binding을 '기기 × 사이트'로 만든다(`account_fingerprint = sha256(site|device)`). 시도는 승인한 기기만 실행할 수 있다 | 다른 기기·다른 사용자가 승인된 제출을 실행하지 못하게 한다. 실제 사이트 계정 binding은 해당 adapter에서 정한다. |
| S5-04 | 자체 폼은 접수 키(시도 ID)로 중복 접수를 막고, 서버가 사이트 저장소를 대조해 접수/미접수를 확정한다. 기록이 없으면 키를 봉인한 뒤 미접수. 외부 사이트에는 이 보장을 쓰지 않음 | SERVICE_RULES·BROWSER_ADAPTERS의 own demo receipt 규칙. 클릭 성공·완료 화면만으로는 자체 폼도 '접수'로 확정하지 않는다(사이트 기록 대조 필요). |
| S5-05 | 문항은 adapter가 아는 4개(이름·이메일·지원 동기·개인정보 동의)만 처리. 답변 출처는 `user_answer`만, `source_ids = ["ua_<문항>"]`. 확정 사실·정책 답변은 근거 검증 구현 뒤 연다 | 새 사실을 답변으로 만들지 않는다. 폼에 모르는 필수 문항이 있으면 `UNSUPPORTED_QUESTION`으로 사용자 확인 대기(합성 공고 `pixelhouse-designer`가 추가 문항을 가짐). |
| S5-06 | 수동 권한은 최근 30분 안의 `verified` 폼 관측(같은 revision·payload hash)과 대상이 정확히 같을 때만 만든다. 유효 15분. 새 권한은 같은 지원 건의 쓰지 않은 이전 권한을 철회 | 실제 폼에 넣고 다시 읽은 결과를 사용자가 확인한 뒤에 승인한다. 오래된 관측·만료 권한으로 제출하지 않는다. |
| S5-07 | 전송 직전(dispatch) 서버가 권한·대상 주소·폼 snapshot hash·다시 읽은 값·저장 PDF bytes hash를 다시 검증. 다르면 전송하지 않고 시도를 `failed_before_dispatch`로 멈춤 | 승인 후 폼·파일·답변이 바뀐 경우를 막는다. 사용자는 다시 확인·승인해야 한다. |
| S5-08 | 확장은 이미 다른 값이 들어 있는 입력란을 덮어쓰지 않고 `FIELD_HAS_OTHER_VALUE`로 멈춘다 | BROWSER_ADAPTERS: 원래 입력값을 확인한 뒤 허용 필드만 채운다. |
| S5-09 | 접수 결과 확인(observe)은 `submit_application` 작업(`action: observe`)으로 예약한다. 조회만 하며 제출하지 않는다. 실행기 보고 없는 `dispatched`는 3분 뒤 worker가 정리 | 007의 task kind 제약 안에서 쓴다. 재제출·다른 채널 우회 제출은 없다. |
| S5-10 | 외부 지원 기록(`ce8_external_applications`): 검색 공고에서 기록하면 job_key로 같은 공고의 지원 준비를 막고(409), 회사·직무만 입력한 기록은 확인 안내로만 사용 | 회사·제목 유사성만으로 같은 공고라고 확정하지 않는다(SERVICE_RULES). |
| S5-11 | 계약 확장 경로 6개: `GET /job-applications/{id}/history`, `POST /executor-pairings`, `GET /executor-devices`, `POST /executor-devices/{id}/revoke`, `POST·GET /external-applications`. 연결 코드는 idempotency 응답 저장소에 남기지 않고 같은 key 재요청은 409 | 지원 이력 재열람과 기기 연결에 필요하다. 실행기 프로토콜(`/api/executor/v1`)은 공개 계약에 넣지 않는다. |
| S5-12 | `BROWSER_APPLY_ENABLED`는 외부 사이트 브라우저 지원 스위치로 남김(true는 여전히 미구현 오류). 자체 폼 지원은 로컬 개발 범위라 이 값과 무관 | 외부 기업 접수가 구현된 것처럼 보이지 않게 한다. |
| S5-13 | 독립 리뷰 반영: ① 미접수·전송 전 중단 뒤에는 그 이후의 폼 확인만 인정(상태 계산·승인 모두) ② 승인 만료·철회·내용 변경된 대기 시도는 worker·승인 요청 때 `failed_before_dispatch`로 닫음 ③ 이 시도의 접수 기록이 없어도 승인 뒤 같은 공고·같은 PDF의 다른 접수가 있으면 봉인하지 않고 `submission_unknown`(`POSSIBLE_OTHER_SUBMISSION`) ④ 전송 1분 안의 접수 결과 확인은 409 `OBSERVATION_TOO_EARLY` ⑤ 실행 토큰 불일치는 409(기기 연결 유지) ⑥ 한 줄 답변은 저장 전 앞뒤 공백 제거 | 리뷰 MEDIUM 3·LOW 지적. 사용자가 페이지에서 직접 제출한 경우 미접수로 잘못 확정해 중복 접수로 이어지는 것을 막는다. 연결 코드 실패 횟수 제한은 아직 전역 1분 20회다(로컬 개발 범위의 알려진 한계). |

## S06 구현 결정 — 2026-11-18

S06(고정 기준의 유사 공고 탐색과 지원서 자동 준비, 제출 없음) 구현 기본값이다. migration 추가 없음(007의 정책·캠페인 테이블 사용).

| ID | 결정 | 이유·한계 |
| --- | --- | --- |
| S6-01 | 정책 모드는 `recommend`·`prepare`만 받는다. `submit`은 422 `POLICY_MODE_NOT_IMPLEMENTED`(S07) | 준비 모드가 제출 명령을 만들지 않는 것을 코드 경로로 보장한다. 준비 결과는 권한·시도·폼 관측을 만들지 않는다(테스트로 확인). |
| S6-02 | 기준(seed)은 캠페인 생성 시 지원 건 revision·공고 snapshot·이력서 revision으로 고정. 정책의 기준 이력서와 다르면 422. 캠페인이 만든 지원 건은 기준으로 쓰지 않음 | SERVICE_RULES: 자동으로 지원한 공고로 범위를 넓히지 않는다. 다시 실행해도 같은 공고(job_key)는 다시 넣지 않는다. |
| S6-03 | 유사도 = 직무 계열 0.4 + 공통 기술(overlap) 0.35 + 업무 표현 0.15 + 책임 수준 0.1, 0.3 미만은 이유와 함께 건너뜀. 유사도는 지원 가능 여부와 분리 | 규칙 기반 설명 가능 점수. 실제 공고 다양성에서의 품질은 S03(live) 이후 재조정 필요. |
| S6-04 | 정책 조건은 S02 판정 규칙을 재사용: 필수 미충족 → 건너뜀, 필수 미확인 → 검토 필요, 선호 미충족 → 메모 | 모르는 조건을 충족으로 추정하지 않는다. |
| S6-05 | 중복: 같은 job_key의 지원 건·외부 기록 → 건너뜀(접수·불명 상태 표시), 회사·직무명만 같음 → 검토 필요. 미지원 사이트·adapter가 모르는 필수 문항 → 검토 필요 | 회사·제목 유사성만으로 같은 공고로 확정하지 않는다. |
| S6-06 | `fixed_document`는 기준 PDF를 그대로 쓰되 기준 공고 회사명·직무명, 맞춤 요약의 이 공고에 없는 기술명, 다른 공고 회사명이 있으면 검토로 보냄. `tailor_within_facts`는 mock 대화 provider의 변경 중 허용 수정 종류(reorder·summary·rewrite_with_facts)와 근거 검사를 통과한 것만 적용해 새 revision(`finalization_source=policy`)과 실제 PDF 생성 | 정책 확정을 사용자 확인으로 꾸미지 않는다. 확정 사실 밖 내용은 넣지 않는다. |
| S6-07 | 자동 준비 지원 건(`source_kind=campaign`) 답변은 이름·이메일만 기준 지원서에서 가져오고, 지원 동기·개인정보 동의는 비워 둠. 상태는 '작성 중' | 공고마다 달라야 하는 답변·동의를 자동 작성하지 않는다. 제출은 S05 흐름(폼 확인·수동 승인)으로만. |
| S6-08 | 준비 한도는 캠페인 안에서 전체 `total_limit`, 하루(Asia/Seoul) `daily_limit`. 넘으면 '추천'으로 남기고 서류를 만들지 않음 | 제출 한도·비용 예약(quota)은 S07에서 정책 단위로 구현한다. |
| S1-19 | (2026-11-19) 모든 Liner 대화 호출(7종: review·supplement·supplement review/critic·chat·JD review/critic)의 시스템 프롬프트를 `HR_PERSONA`(채용 서류 검토 경험이 많은 HR 전문가, 존댓말·담백)로 시작하고 각 프롬프트 첫 줄은 '이번 작업: …'으로 바꿔 정체성을 하나로 둔다. 페르소나는 규칙보다 앞서지 않음·근거 없는 수치/역할/성과 금지·미기재 단정 금지·합격 단정 금지·실존 인물/회사 담당자 사칭 금지를 명시. 점검·초안·공고 맞춤 5종에는 `HR_CRITERIA`(직무 적합성, 경력기술 중심·최신순, 공고 용어 정렬·사내 용어 풀기·근거 없는 기술 금지, 의미 있는 수치는 사용자가 말한 것만·없으면 질문, 설명 가능성, 짧은 서술문·직함 가독성, 무관한 개인정보 제외)를 붙이고 근거 검토(critic) 2종에는 붙이지 않는다. 화면 라벨 '에이전트' → 'HR 전문가'(주석·코드 이름은 유지). 모델이 reply 등 설명 문장에 내부 ID(fact_·blk_·req_·said_)를 쓰지 않게 프롬프트로 막고, 서버 `scrub.ts`가 Liner 응답의 설명 문장 필드에서만 한 번 더 지운다(근거 필드·ID 필드는 원문 대조용이라 그대로). 출처(웹 조사 2026-11-19): 잡코리아 인사담당자 548명 설문 — 서술 항목 중 경력기술 60.4%, 면접 대상 선발 기준 '회사·직무 이해' 54.0%(뉴시스 2021-08-20, https://mobile.newsis.com/view/NISX20210820_0001555097); 원티드 「채용 담당자를 사로잡는 경력직 이력서 쓰는 법」 — JD 키워드 겹침↑ 합격률↑, 수치화 성과 합격률 13%↑(내부 분석, 표본·방법 비공개, https://www.wanted.co.kr/events/article_23_01_09); 원티드 인사담당자 글 — 최신순, 직무 관련 성과 선별, 허위 기재는 면접에서 드러남(경험 조언, https://www.wanted.co.kr/events/article_23_01_06); TheLadders 2018 시선 추적 — 첫 검토 평균 7.4초, 굵은 직함·글머리 성과·짧은 서술문(2차 보도 HR Dive, https://www.hrdive.com/news/eye-tracking-study-shows-recruiters-look-at-resumes-for-7-seconds/541582/, 원문 PDF 열람 실패) | 사용자 요청("HR 관계자 페르소나", "에이전트 → HR 전문가 라벨", "실제 HR 전문가가 꼽는 이력서 기준을 검색해 적용"). '수치화' 권고는 근거 원칙(S4-04)과 충돌하므로 '사용자가 말한 수치만, 없으면 질문'으로 바꿔 넣었다. 검토자가 문장 품질을 근거보다 앞세우지 않도록 critic에는 기준을 넣지 않는다. 수치(13% 등)는 출처의 신뢰도 한계를 그대로 기록한다. |
| S6-09 | 실행 예약 시 정책 generation을 작업 입력에 고정. 실행 전 정책이 일시중지·철회·재활성화되면 작업은 실행하지 않음(`POLICY_NOT_ACTIVE`/`POLICY_CHANGED`). 캠페인 일시중지·종료는 대기 작업 취소·진행 작업 중지 요청 | 오래전 예약으로 중지된 정책이 실행되지 않게 한다. |
| S6-10 | 계약 확장: `GET /similar-job-campaigns/{id}/queue`(대기함)와 schema `CampaignQueue`·`CampaignQueueItem`·`CampaignEvaluation` | 계약의 캠페인 본문만으로는 유사 이유·조건·필요한 확인·파일 버전을 보여줄 수 없다. |
| S6-11 | 자동 준비 지원 건이 기준 이력서(다른 공고용)를 고정한 경우 답변 수정 시 같은 이력서 유지를 허용 | 확정 파일 그대로 쓰기 전략의 지원 건도 답변을 이어 쓸 수 있어야 한다. |
| S6-13 | 화면 시연·Chrome 검증 스크립트는 기본으로 제출 직전에서 멈춘다(`chrome-apply-e2e.mjs`, `demo-seed.mjs`). 로컬 자체 폼 제출은 `--submit-local`을 명시할 때만 한다. `--headful`로 진행을 Chrome 창에서 보여 준다 | 사용자 지시 "제출하면 안되". 접수 확인·접수 불명 처리 회귀는 메모리 내 자동 테스트(`tests/browser-apply.test.mjs`, 127.0.0.1 자체 폼)와 `--submit-local`로만 확인한다 |
| S6-12 | 독립 리뷰 반영: ① 캠페인이 만든 지원 건·정책이 확정한 이력서는 기준 불가(422 `CAMPAIGN_SEED_NOT_ALLOWED`, 화면 버튼도 숨김) ② 후보마다 기록 직전 정책 활성·유효기간·generation을 다시 확인해 실행 중 일시중지·철회·만료 시 남은 후보를 기록하지 않음 ③ 준비 한도를 정책(policy_id) 단위로 집계하고 기록 transaction 안에서 재확인 ④ 한도로 보류한 후보(`held`)는 다시 찾기 때 재판단 ⑤ live provider 전송 불명 작업은 재호출하지 않음 | 리뷰 HIGH 2·MEDIUM 3. 남은 한계: 캠페인 생성 시 사용자가 본 기준 revision과 서버 고정 revision 비교(계약 필드 추가 필요), 비용 한도 집행(live 전환 시 provider 원장 연결), 기록 전 종료 시 남는 PDF 파일 정리, 작업 완료 시 캠페인 `completed` 전환은 아직 없다. |
