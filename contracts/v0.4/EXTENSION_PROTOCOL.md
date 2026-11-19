# Career Evidence — Chrome 확장·테스트 폼 프로토콜 v0.4

- 작성일: 2026-11-15
- 기준: Career Evidence 기획서 v0.2, UI·UX 상세 설계 v0.3의 W05·X01·X02·W06
- 상태: 구현 전 계약. 이 문서의 흐름은 실제 브라우저에서 검증 완료한 결과가 아니다.
- 범위: PC Chrome, 합성 프로필·합성 PDF, 팀이 관리하는 테스트 폼 1종
- 공개 API와 메시지 필드: snake_case. operation 값은 이 문서에 정한 대문자 enum을 사용한다.

## 1. 실행 구조

제품 웹, 테스트 폼, API는 같은 origin의 단일 TypeScript 서비스에서 제공한다. 접수 상태의 권위는 동일한 영속 SQLite 데이터베이스에 둔다.

실행 경로는 다음으로 고정한다.

1. 사용자가 확장의 사이드패널에서 동작을 선택한다.
2. 서비스워커가 명령의 출처와 연결 대상을 검증한다.
3. 지정된 tab_id·document_id의 top-frame content script가 고정 DOM 동작을 수행한다.
4. 자체 페이지의 고정 page bridge가 동일 origin API를 호출한다.
5. 서버가 workspace 범위, revision, 승인, 실제 제출 내용을 검증하고 SQLite에 결과를 기록한다.

개인별 외부 사이트 로그인과 제품 회원가입은 없다. 이 workspace 세션은 개발·데모에서 합성 데이터를 분리하기 위한 세션이다. 실제 채용 사이트 로그인·제출, 범용 폼 탐색, iframe 지원, 대량 지원은 이 계약에 포함하지 않는다.

### 1.1 실제 제출 대상

- 허용 origin과 테스트 폼 경로는 서버 정적 설정에서 정한다.
- application의 실제 target은 이 설정에서 생성한다. DOM이나 메시지의 임의 URL로 덮어쓰지 않는다.
- 참고 회사·공고·직무와 실제 제출 대상인 Career Evidence 테스트 폼을 별도로 표시한다.
- 제출 API는 POST /demo/v1/submissions 한 곳이다.
- top frame의 지정된 form_id·form_schema_version·application_id가 모두 맞아야 읽기·입력·제출을 진행한다.
- 다른 origin, 다른 application 경로, 다른 폼, 하위 frame, opaque origin, about:blank에서는 연결을 승인하지 않는다.

## 2. 세션과 신뢰 경계

### 2.1 서버와 자체 페이지

서버는 host-only HttpOnly workspace 세션 쿠키를 사용한다. SameSite=Strict를 적용하고 HTTPS 환경에는 Secure를 적용한다. 변경 API는 세션, workspace 소유권, 정확한 Origin, 세션에 연결된 CSRF를 검증한다. 개발 서버는 loopback에 바인딩하고 Host도 설정값과 비교한다.

CSRF 처리와 세션을 사용하는 API 호출은 자체 페이지의 코드 안에서 수행한다. page bridge는 확장으로 cookie, CSRF, 서버 키 또는 Liner API 키를 반환하지 않는다. form_session_id·approval_id·attempt_id는 레코드 식별자이며 인증 비밀이나 단독 인가 수단이 아니다.

page bridge는 고정된 operation handler만 제공한다. 메시지에서 URL, HTTP method, 임의 header, 실행할 JavaScript, 임의 selector를 받아 실행하지 않는다. API endpoint와 DOM selector는 배포 코드의 고정 매핑으로 결정한다.

### 2.2 page bridge

content script와 자체 페이지 간 전달은 고정 메시지 형식의 window.postMessage를 사용한다.

- 수신 시 event.source가 현재 window이고 event.origin이 서버 설정의 정확한 origin인지 검사한다.
- 송신 targetOrigin에 와일드카드를 사용하지 않는다.
- 연결된 application_id·form_session_id·connection_nonce와 진행 중인 request_id를 검사한다.
- 허용된 op와 해당 단계에 맞는 payload만 처리한다.
- 요청하지 않은 응답이나 이미 종료된 요청의 응답을 새로운 동작으로 해석하지 않는다.
- 텍스트와 반환 데이터를 코드나 HTML로 실행하지 않는다.

nonce는 연결의 상관관계와 오래된 메시지를 구분하기 위한 값이다. 같은 origin의 다른 코드가 관측할 수 있으므로 인증 비밀로 취급하지 않는다.

이 방식은 팀이 관리하는 자체 페이지와 서버 코드를 신뢰한다. origin·nonce·UI gesture 검사는 XSS나 손상된 렌더러까지 방어하는 암호학적 사용자 승인 증명이 아니다. 외부 사이트에 이 신뢰 모델을 그대로 확대하지 않는다.

### 2.3 확장 내부

- 권한은 activeTab, scripting, sidePanel, storage로 제한한다.
- externally_connectable 및 외부 메시지 listener는 제공하지 않는다.
- content script에서 범용 네트워크 요청이나 브라우저 조작을 요청하는 메시지는 제공하지 않는다.
- 서비스워커는 브라우저가 제공한 sender.id·sender.url·sender.origin·sender.tab.id·sender.frameId·sender.documentId를 검증한다.
- payload가 주장하는 tab_id나 origin을 Chrome의 sender 정보 대신 사용하지 않는다.
- 최종 확인·제출 명령은 허용된 확장 사이드패널 origin/path에서 온 요청만 수락한다.
- content script나 page bridge 응답은 사용자 확인·제출 명령으로 승격되지 않는다.

## 3. 메시지 envelope

요청, 응답, 이벤트는 별도 종류이다. 정확한 허용 필드와 op별 payload는 동봉 메시지 JSON Schema에 따른다. 정의되지 않은 필드는 거절한다.

| 필드 | 계약 |
|---|---|
| protocol_version | 문자열 1.0 |
| kind | request / response / event |
| request_id | UUID 요청 상관관계 ID. 응답은 요청의 값을 그대로 사용 |
| op | 요청·응답은 operation enum, 이벤트는 FORM_CHANGED / CONNECTION_LOST |
| application_id | 해당 메시지가 다루는 지원 건 |
| form_session_id | 요청은 HELLO 연결 전을 제외하고 필수. 응답은 필드를 포함하며 연결 정보가 없는 실패에서 null 허용 |
| expected_revision | FILL_FORM, ATTACH_SAMPLE_FILE, CONFIRM_REVIEW, PREPARE_ATTEMPT, SUBMIT_ATTEMPT 요청에 필수인 1 이상의 정수 |
| connection_nonce | HELLO 이후 요청에 필수인 32~128자 문자열. 연결된 document의 현재 nonce와 대조 |
| payload | 요청·이벤트의 op별 닫힌 객체 |
| ok | 응답의 성공 여부 |
| data / error | 성공 응답은 data, 실패 응답은 error를 사용 |

error는 code, message, retryable을 포함한다. retryable=true는 해당 operation을 다시 시도할 수 있다는 뜻이며, 실제 접수 POST를 자동 재전송하라는 뜻이 아니다.

### 3.1 읽기 요청 예

~~~json
{
  "protocol_version": "1.0",
  "kind": "request",
  "request_id": "bf0a4246-35a0-4c31-b690-b5de247c3f74",
  "op": "GET_ATTEMPT",
  "application_id": "app_example",
  "form_session_id": "fs_example",
  "connection_nonce": "0123456789abcdef0123456789abcdef",
  "payload": {
    "attempt_id": "attempt_example"
  }
}
~~~

위 식별값은 형식을 설명하는 예시이며 실제 자격 증명이 아니다. 응답은 같은 request_id와 op를 사용한다.

### 3.2 sender와 document 검증

사이드패널 요청은 확장 ID와 허용된 사이드패널의 origin/path를 검증한다. content script 메시지는 현재 form session에 기록된 탭, top frame, document, origin, 폼 경로와 일치해야 한다.

서비스워커에서 content script로 보낼 때는 저장된 tab_id와 document_id를 지정한다. 제출할 때마다 현재 활성 탭을 새로 찾아 다른 탭에 명령을 보내지 않는다.

같은 origin으로 이동하여 activeTab 권한이 남아 있어도 새 document_id이면 새 연결이다. 재연결 전의 입력·확인 권한을 재사용하지 않는다. tab_id가 같다는 사실만으로 동일 문서라고 판단하지 않는다.

## 4. 허용 operation

| op | 요청 시작점과 기능 | 서버 쓰기 및 선행조건 |
|---|---|---|
| HELLO | 사용자의 확장 실행으로 현재 테스트 폼과 연결 | form_sessions 생성. 정확한 대상·현재 workspace 검증 |
| READ_FORM | 현재 폼의 필드·선택값·첨부·동의 값을 읽음 | 읽기만 수행. 연결된 document와 폼이 일치해야 함 |
| FILL_FORM | 현재 초안의 값을 고정 필드에 입력 | 폼 값 변경. 기존 사용자 입력 덮어쓰기는 확인한 변경 내역에 한정 |
| ATTACH_SAMPLE_FILE | 사용자가 고른 승인된 합성 PDF를 첨부 | 폼 첨부 변경. 파일 바이트·형식·크기를 확인 |
| OPEN_REVIEW | 현재 서버 상태와 실제 DOM 값을 대조하고 검토 화면 구성 | 읽기만 수행. approval이나 attempt를 만들지 않음 |
| CONFIRM_REVIEW | 최종 사용자 제출 버튼에서 현재 검토 내용을 서버에 확인 | ApprovalCreate로 approvals POST. 검증한 불변 Approval을 반환 |
| PREPARE_ATTEMPT | 저장한 Approval에 대한 시도를 준비 | attempts POST. 유효한 사용자 제출 의도와 현재 Approval 필요 |
| SUBMIT_ATTEMPT | 저장한 prepared 시도의 실제 폼 내용을 제출 | 고정 multipart POST. 직전 실제 값과 승인 내용 재대조 |
| GET_ATTEMPT | 같은 시도의 현재 상태·receipt를 조회 | 읽기만 수행. 조회 실패나 기록 없음은 미접수 증거가 아님 |
| RECONCILE_ATTEMPT | 사용자 요청으로 receipt 확인 또는 기존 시도 종결 | 같은 DB 트랜잭션에서 receipt 반환 또는 closed_not_accepted 확정 |

확인 체크박스와 제출 동의는 기본 해제 상태이다. 프로필, AI 답변, page bridge, 재연결 또는 서버 응답이 이를 자동 선택하지 않는다.

### 4.1 op별 payload와 성공 응답

아래 타입 이름은 schemas/domain.schema.json의 $defs 이름이다. 추가 필드를 붙이지 않는다.

| op | 요청 payload | 성공 응답 data |
|---|---|---|
| HELLO | 빈 객체 | application: Application, form_session: FormSession을 담은 객체 |
| READ_FORM | 빈 객체 | FormObservation |
| FILL_FORM | expected_revision, overwrite_confirmed | FormObservation |
| ATTACH_SAMPLE_FILE | file_id | FormObservation |
| OPEN_REVIEW | 빈 객체 | ReviewView |
| CONFIRM_REVIEW | ApprovalCreate | Approval |
| PREPARE_ATTEMPT | idempotency_key, request: AttemptCreate | Attempt |
| SUBMIT_ATTEMPT | attempt_id | ReceivedAttempt |
| GET_ATTEMPT | attempt_id | Attempt |
| RECONCILE_ATTEMPT | attempt_id, close_if_no_receipt:true | ResolvedAttempt |

ApprovalCreate의 필드는 expected_revision, form_session_id, readback, review_confirmed:true이다. readback.consent.test_submission도 true여야 한다.

AttemptCreate의 필드는 expected_revision, approval_id, form_session_id, payload_digest이다. 중복으로 전달되는 envelope와 payload의 expected_revision·form_session_id는 일치해야 한다. JSON Schema만으로 이 일치를 검증했다고 간주하지 않고 runtime에서 비교한다.

ReceivedAttempt는 state가 received이고 receipt를 포함하는 성공 결과이다. ResolvedAttempt는 received, rejected, closed_not_accepted 중 하나이며 prepared를 허용하지 않는다. GET_ATTEMPT와 PREPARE_ATTEMPT는 전체 Attempt 타입을 사용한다.

RECONCILE_ATTEMPT는 지정된 과거 attempt를 원자적으로 정리하는 동작이므로 현재 초안의 expected_revision을 필수 전제조건으로 삼지 않는다. application·workspace·attempt 결속은 항상 검사한다.

### 4.2 이벤트

FORM_CHANGED와 CONNECTION_LOST 이벤트는 reason, observed_revision을 담은 payload를 사용한다. 둘 다 필수이며 임의 필드를 추가하지 않는다. 이벤트의 request_id도 UUID이고, 요청에 대한 응답으로 위장하지 않는다.

FORM_CHANGED는 기존 로컬 확인을 해제하고 변경된 실제 값을 다시 대조하게 한다. CONNECTION_LOST는 입력·제출을 잠근다. 어느 이벤트도 접수 실패나 완료를 확정하거나 새로운 승인을 만들지 않는다.

## 5. form session과 readback

### 5.1 연결 정보

POST /api/v1/applications/{application_id}/form-sessions가 연결 레코드를 만든다. 요청 body는 expected_revision만 포함하는 FormSessionCreate이다. 별도의 binding 또는 readback 저장소·API를 만들지 않는다.

서버 form session은 application, workspace, target_origin, form_path, form_schema_version, expires_at을 결속한다. Chrome의 tab_id·frame_id·document_id·connection_nonce는 확장에서 이 form_session_id에 연결하여 보관한다. 이 브라우저 정보를 FormSessionCreate에 임의 필드로 추가하지 않는다. Chrome의 탭·document 정보는 확장의 라우팅·navigation 검증 자료이며 서버가 독립적으로 인증한 브라우저 신원이라고 설명하지 않는다.

document 이동·탭 종료·다른 application 선택·폼 schema 불일치 시 연결을 무효로 본다. 전송 가능성이 없는 단계에서는 확인을 해제한다. 이미 접수 요청이 진행됐을 수 있다면 그 시도를 미접수로 바꾸지 않고 결과 조회 대상으로 유지한다.

### 5.2 실제 값 재읽기

입력 뒤에는 폼의 실제 값을 다시 읽는다. readback은 다음을 포함한다.

- 이름·이메일 등 합성 프로필에서 가져온 실제 표시·입력 값
- company/job 및 현재 폼 대상과 선택한 application의 일치 여부
- answers의 question_id experience / motivation 및 실제 답변
- start_availability의 실제 선택값
- 실제 선택된 파일의 이름·형식·바이트 수·바이트 digest
- 실제 제출 동의 값과 동의 문구 버전

답변은 각각 필수이며 500자 제한을 서버에서도 검증한다. 입력 컴포넌트와 서버의 길이 계산 규칙은 공통 데이터 계약을 따른다. 파일은 합성 PDF 1개, 최대 5,242,880 bytes로 제한하며 실제 바이트를 검증한다.

React 등 제어 입력에 값을 넣은 것만으로 성공 처리하지 않는다. 재렌더링 이후 값 유지, 선택값, 필수값 상태, 실제 첨부 상태를 확인한다. 없는 정보를 경험 없음이나 임의 성과로 채우지 않는다.

runtime 메시지는 JSON 직렬화 데이터를 사용한다. File·Blob 객체를 메시지에 직접 싣지 않는다. 합성 파일 바이트는 자체 페이지가 승인된 샘플 참조에서 확보하여 폼에 첨부한다. 최종 제출에는 이 파일의 실제 바이트가 포함된다.

## 6. 검토·승인·최종 제출

### 6.1 OPEN_REVIEW와 확인 체크박스

OPEN_REVIEW는 application의 현재 서버 상태와 DOM readback을 대조한다. 필수값, 파일, 동의 준비 상태, 현재 대상, 진행 중인 기존 시도를 확인하고 전체 내용을 표시한다. 이 동작에는 쓰기가 없다.

확인 체크박스는 현재 보이는 회사·직무·대상·프로필·답변·첨부·동의·revision에 연결된 로컬 UI 확인 상태이다. 체크박스 변경 자체로 CONFIRM_REVIEW를 호출하지 않는다. CONFIRM_REVIEW는 최종 사용자 제출 버튼에서만 실행하는 서버 승인 생성 operation이다.

답변, 프로필 버전, 대상, 직무, 파일 내용, 동의가 바뀌면 로컬 확인을 즉시 취소하고 화면도 갱신한다. 파일명이 같아도 바이트 digest가 바뀌면 다시 검토한다. content script의 변경 이벤트는 빠른 UI 갱신을 돕지만 서버 검증을 대체하지 않는다.

제출 동의는 초안 content.consent의 일부이다. 사용자가 동의를 바꾸면 PATCH /api/v1/applications/{application_id}에 expected_revision과 현재 content를 보내 저장한다. 응답의 새 revision을 기준으로 폼 동의 값과 readback을 맞춘 뒤 사용자가 최종 확인한다. 답변·입사 시점·file_id 변경도 같은 초안 저장 규칙을 따른다. 저장 대기·충돌·실패 중에는 최종 제출을 활성화하지 않는다.

로컬 검토 확인과 저장되는 제출 동의를 구분한다. 동의가 저장됐다는 이유만으로 검토 확인을 자동 선택하지 않으며, 동의 변경으로 revision이 바뀌면 이전 검토 확인을 해제한다.

### 6.2 사용자의 최종 제출 버튼

이 내용으로 테스트 제출 버튼을 사용자가 직접 누르면 하나의 제출 의도를 만든다. 이 의도는 현재 application·form session·revision·검토한 snapshot과 연결한다.

서비스워커는 요청이 허용된 사이드패널에서 왔는지 확인하고, 기존의 유효한 로컬 확인과 실제 폼 내용이 맞는지 검사한다. page bridge가 보내는 메시지나 저장된 작업의 재생만으로 새로운 제출 의도를 만들지 않는다.

브라우저의 일시적 user activation이 네트워크 대기 내내 유지된다고 가정하지 않는다. 제출 의도는 확인한 내용에 연결된 애플리케이션 상태이며, 사람의 클릭을 암호학적으로 인증한 자료가 아니다. sidePanel.open처럼 Chrome이 실제 사용자 동작을 요구하는 API는 해당 동작에 직접 연결한다.

최종 버튼의 처리는 다음 순서로 고정한다.

1. 현재 폼과 revision을 다시 확인한다.
2. 해당 제출 의도의 요청 식별값과 idempotency key를 복구 가능하게 저장한다.
3. CONFIRM_REVIEW로 POST /api/v1/applications/{application_id}/approvals를 호출한다.
4. 반환된 Approval로 PREPARE_ATTEMPT를 실행하여 POST /api/v1/applications/{application_id}/attempts를 호출한다.
5. 반환된 attempt_id와 제출 시작 표시를 확장 저장소에 보존한다.
6. 실제 폼 값을 한 번 더 읽고 승인 내용과 대조한다.
7. 일치하면 SUBMIT_ATTEMPT로 POST /demo/v1/submissions를 실행한다.
8. 동일 attempt의 receipt를 확인하고 최종 상태를 표시한다.

따라서 최종 버튼의 operation 순서는 CONFIRM_REVIEW → PREPARE_ATTEMPT → SUBMIT_ATTEMPT이다. 복구 포인터 저장이 실패하면 새 실제 제출을 시작하지 않는다. 이미 요청이 전달됐을 수 있는 경우에는 접수 확인 필요 상태를 유지한다.

### 6.3 approvals 계약

CONFIRM_REVIEW는 ApprovalCreate를 payload로 받고 approvals 요청을 실행한다. 필드는 expected_revision, form_session_id, 현재 readback, review_confirmed:true이다. readback에는 answers, start_availability, 관측한 파일 바이트 digest와 동의 값이 들어간다.

서버는 클라이언트가 선언한 hash만 신뢰하지 않고 현재 application 및 readback 내용을 검증하여 승인 snapshot을 저장한다. 승인 payload는 불변이다. consumed/revoked 등 승인 수명 메타데이터만 변경할 수 있다.

승인 범위에는 workspace/application, 참고 candidate·company/job, 실제 target_origin·form_path·form_schema_version, profile 버전, 전체 답변, 파일 내용 식별값, 동의 값·문구 버전, revision이 포함된다. form_session_id도 승인에 결속한다. expires_at을 지난 승인이나 revoked 승인을 새 attempt에 사용할 수 없다.

form_sessions·approvals·attempts·reconcile의 API 호출에는 workspace + operationId + key 범위의 안정된 UUID Idempotency-Key를 사용한다. HELLO·CONFIRM_REVIEW·RECONCILE_ATTEMPT에서는 해당 operation의 request_id를 사용하고 PREPARE_ATTEMPT에서는 payload.idempotency_key를 사용한다.

요청 fingerprint는 SHA256(UTF8(method + LF + normalized_actual_path + LF + JCS(body)))로 고정한다. normalized_actual_path는 대상 ID를 포함한 정규화된 실제 경로이며 경로 템플릿이 아니다. 같은 key에서 method·대상 경로·body가 달라 fingerprint가 달라지면 409로 거절한다.

같은 key와 같은 fingerprint의 재호출은 같은 리소스를 가리키며 그 리소스의 현재 상태를 반환한다. 과거의 prepared 응답이나 이전 승인 메타데이터를 그대로 재생하지 않는다. 반환된 현재 상태를 검사한 뒤 다음 단계를 결정하며 종료된 시도를 다시 제출하지 않는다. 승인 응답만 유실됐다고 새로운 승인 의도를 자동 생성하지 않는다.

### 6.4 실제 제출

POST /demo/v1/submissions는 multipart/form-data를 받는다. payload 파트에는 SubmissionEnvelope를 JSON 문자열로 직렬화하여 전달하고 file 파트에는 실제 PDF 바이트를 전달한다. SubmissionEnvelope는 attempt_id, approval_id, form_session_id, revision, readback을 포함한다. 성공 응답 data는 ReceivedAttempt이며 received 상태와 일치하는 receipt를 함께 확인한다.

폼의 고정 handler는 현재 폼을 직렬화하여 정해진 endpoint로만 보낸다. DOM에서 임의로 바뀐 action URL이나 메시지의 URL을 따라가지 않는다.

서버는 실제 답변과 파일 바이트를 승인 snapshot과 다시 비교한다. 제출 직전 readback 이후 값이 바뀌었어도 변경된 내용으로 접수하지 않는다. 파일명만 비교하거나 이전에 계산한 client hash만 신뢰하지 않는다.

전송 후에는 수정·파일 교체·새 제출을 잠근다. timeout이나 응답 단절이 생기면 그 요청이 도달했을 가능성을 유지하고 접수 확인 필요로 표시한다.

## 7. 서버 상태와 UI 상태

서버 attempt enum은 다음 네 가지로 고정한다.

| 서버 상태 | 의미 |
|---|---|
| prepared | 시도가 저장됨. 아직 접수 receipt가 확정되지 않음. 요청이 전송 전인지 진행 중인지 이 값만으로 단정할 수 없음 |
| received | 같은 시도의 접수와 receipt가 DB에 확정됨 |
| rejected | 해당 시도의 접수 거절이 이유와 함께 DB에 확정됨 |
| closed_not_accepted | receipt 없는 이전 시도를 원자적으로 종료함. 지연된 제출도 더 이상 접수하지 않음 |

received, rejected, closed_not_accepted는 종료 상태이다. 종료된 시도를 prepared로 되돌리지 않는다.

UI의 unknown, 즉 접수 확인 필요는 관측 상태이다. 서버 attempt의 별도 enum으로 저장하거나 received를 unknown으로 덮어쓰지 않는다.

읽기 조회는 GET /api/v1/attempts/{attempt_id}를 사용한다. 현재 application에서 다른 제출 의도를 새로 만들지 않고 지정된 시도의 저장 상태를 읽는다.

### 7.1 완료 판정

접수 완료는 서버 receipt의 application, attempt, 참고 company/job, 실제 target, 제출 revision과 snapshot/file digest가 저장한 불변 제출본과 일치할 때만 표시한다.

버튼 클릭, 입력 완료, 일반적인 HTTP 200, 완료처럼 보이는 문구만으로 접수 완료를 표시하지 않는다. W06은 현재 수정 중인 초안이 아니라 해당 attempt에 저장된 제출 당시 내용을 보여준다.

### 7.2 거절과 결과 불명확

접수 거절은 해당 attempt의 영속 rejected 결과를 확인했을 때만 표시한다. 일반적인 4xx/5xx·연결 오류만으로 rejected라고 단정하지 않는다.

GET 실패, 404, 아직 receipt가 없다는 응답은 최종 미접수 확인이 아니다. 원래 요청이 지연 중일 수 있으므로 unknown을 유지하고 자동 재제출하지 않는다.

## 8. 중복 접수와 다중 탭

같은 workspace·job·target의 지원을 하나의 application으로 식별한다. 서로 다른 탭에서 그 application을 열어도 같은 서버 상태를 사용한다.

필수 서버 제약은 다음과 같다.

- application당 동시에 활성인 prepared attempt는 최대 1개
- 같은 approval로 만들어지는 attempt는 최대 1개
- 같은 workspace/operationId/idempotency key와 fingerprint는 같은 리소스에 연결하며 재호출은 현재 상태를 반환
- application당 receipt는 최대 1개
- attempt당 receipt는 최대 1개
- 활성 시도가 있는 동안 초안 수정과 새로운 승인·시도 생성 제한
- 같은 revision에 대한 동시 편집은 서버 revision 비교로 충돌 처리

attempt 생성 시 검증, prepared attempt 생성, approval 소비를 같은 트랜잭션에서 처리한다. consumed는 같은 승인으로 새 attempt를 만드는 권리가 소비됐다는 뜻이며, 그 승인을 소비한 해당 attempt의 제출을 거절하는 이유가 아니다.

최종 제출과 reconcile은 같은 SQLite에서 BEGIN IMMEDIATE로 상태 검사와 쓰기를 직렬화한다. 최종 제출은 검증, 접수 기록, receipt 생성, received 전환을 하나의 트랜잭션으로 처리한다.

같은 attempt의 같은 제출이 중복 도달하면 기존 receipt를 반환한다. 같은 식별자에 다른 내용이 들어오면 거절하고 기존 접수를 변경하지 않는다.

중복 접수 0의 보장 범위는 동일한 영속 SQLite 파일, 설정된 application 식별 규칙, 모든 쓰기 경로에 적용된 트랜잭션·UNIQUE 제약이 유지되는 자체 테스트 폼이다. DB를 초기화·교체하거나 외부 채용 시스템에 전송하는 상황으로 이 보장을 확대하지 않는다.

SQLite는 WAL, synchronous=FULL, foreign_keys 활성화를 사용한다. 잠금 대기가 실패하면 상태를 추정하지 않고 조회·복구 대상으로 남긴다.

## 9. RECONCILE_ATTEMPT

POST /api/v1/attempts/{attempt_id}/reconcile는 단순 읽기가 아니다. close_if_no_receipt:true인 ReconcileRequest를 보내 receipt를 확인하고, receipt가 없는 기존 prepared 시도를 확실하게 종료하는 사용자 요청이다.

같은 DB의 BEGIN IMMEDIATE 안에서 다음을 처리한다.

1. workspace와 대상 attempt를 확인한다.
2. receipt가 있으면 기존 received 결과를 반환한다.
3. 이미 rejected 또는 closed_not_accepted이면 그 종료 결과를 반환한다.
4. receipt 없는 prepared이면 closed_not_accepted로 전환한다.
5. 기존 시도의 승인 사용 권한을 폐기하고 활성 시도를 해제한다.
6. COMMIT한다.

submit이 먼저 확정되면 reconcile은 같은 receipt를 반환한다. reconcile이 먼저 확정되면 늦은 submit은 ATTEMPT_CLOSED로 거절된다. receipt 존재 확인과 상태 종료를 서로 다른 트랜잭션으로 나누지 않는다.

종료 후 다시 준비할 때는 새 사용자 확인, 새 approval, 새 attempt가 필요하다. 이전 시도·거절·종료 기록은 보존한다.

### 9.1 사용자 문구

unknown 화면:

> 접수 여부를 아직 확인하지 못했어요.

버튼:

> 접수 결과 확인

버튼 설명:

> 접수 기록이 없으면 이전 시도를 종료하고, 내용을 다시 확인할 수 있어요.

received 결과:

> 테스트 접수 기록을 확인했어요.

closed_not_accepted 결과:

> 접수된 기록이 없어 이전 시도를 종료했어요. 내용을 다시 확인한 뒤 제출할 수 있어요.

조회·정리 요청 실패:

> 접수 결과를 아직 확인하지 못했어요. 같은 지원을 다시 보내지 않고 결과를 확인해 주세요.

자동 복구와 백그라운드 갱신은 GET 조회만 한다. 아직 제출 중임을 알고 있는 시도를 자동 reconcile로 종료하지 않는다. RECONCILE_ATTEMPT는 결과 불명확 상태에서 위 효과를 안내하고 사용자가 선택했을 때 수행한다.

## 10. MV3 lifecycle과 복구

서비스워커가 계속 살아 있다고 가정하지 않는다. Chrome은 일반적으로 30초 유휴 등의 조건에서 확장 서비스워커를 종료하며 전역 변수는 사라진다.

- listener는 서비스워커 최상위에서 동기 등록한다.
- 비동기 메시지 응답은 listener가 literal true를 반환하고 완료 후 sendResponse하는 방식으로 구현한다.
- 장기 Port, 타이머, heartbeat를 정확한 실행이나 영속성의 근거로 사용하지 않는다.
- chrome.storage.local에는 application/attempt 식별자, 안정된 요청 key, 마지막 제출 시작 표시 등 복구 포인터만 저장한다.
- local 저장소 접근 수준은 TRUSTED_CONTEXTS로 제한한다.
- session 저장소와 서비스워커 메모리는 연결 보조 상태에만 사용한다.
- 폼 내용·승인·접수·receipt의 권위는 서버 DB에 둔다.

패널이나 워커가 다시 시작되면 서버 application과 기존 attempt를 먼저 조회한다. prepared 또는 전송 가능성이 있는 기존 시도를 발견하면 새로운 제출을 시작하지 않는다.

승인·시도 생성 응답이 유실되면 같은 idempotency key와 fingerprint로 같은 리소스의 현재 상태를 조회할 수 있다. 과거의 생성 당시 상태를 복원하는 동작이 아니며 새로운 접수 POST를 실행할 권한을 복구하는 동작도 아니다. 워커 재시작으로 잃어버린 사용자 제출 의도를 자동 재생하지 않는다.

실제 제출 요청이 전달됐을 가능성이 있으면 GET으로 상태를 확인하고 필요할 때 사용자가 RECONCILE_ATTEMPT를 선택한다. 같은 multipart 요청을 자동으로 다시 보내지 않는다.

탭이 닫히거나 새 document로 바뀌어도 접수 기록을 삭제하지 않는다. 다시 허용된 자체 페이지에 연결한 현재 form session에서 같은 workspace의 과거 attempt를 조회할 수 있다. 조회를 위해 과거 document의 쓰기 승인을 되살리지 않는다.

## 11. 남은 실제 브라우저 QA

다음은 구현 후 통과해야 할 항목이며 현재 PASS로 선언하지 않는다.

1. 정확한 origin·경로·form·top frame만 허용하고 다른 탭·origin·iframe에서 읽기·입력·제출이 잠기는지 확인한다.
2. 같은 origin의 navigation으로 document_id가 바뀌었을 때 기존 확인이 무효가 되는지 확인한다.
3. 두 회사의 폼을 번갈아 열어 초안·알림·receipt가 섞이지 않는지 확인한다.
4. 같은 application을 두 탭에서 동시에 제출해 활성 시도와 receipt가 하나로 유지되는지 확인한다.
5. 동의·확인 항목이 처음부터 해제되고 사용자 선택 없이 승인되지 않는지 확인한다.
6. 답변·입사 시점·대상·동의 변경과 같은 이름의 다른 파일이 확인을 무효화하는지 확인한다.
7. 제어 입력의 재렌더링 이후 실제 값과 첨부 바이트가 readback과 일치하는지 확인한다.
8. approval 저장 전후, attempt 저장 전후, 제출 직전, DB COMMIT 이후 응답 이전에 워커·탭·프로세스를 중단하고 서버 상태에서 복구되는지 확인한다.
9. submit과 reconcile의 양쪽 경쟁 순서를 재현하여 receipt 반환 또는 지연 제출 거절만 발생하는지 확인한다.
10. 같은 key와 fingerprint는 같은 리소스의 현재 상태를 반환하고, 다른 대상 경로·body는 409로 거절되어 기존 기록을 변경하지 않는지 확인한다.
11. GET 404·timeout·5xx에서 미접수나 접수 완료를 만들어내거나 자동 재제출하지 않는지 확인한다.
12. 종료된 시도의 늦은 submit이 거절되고 새 승인·새 attempt로만 다시 진행되는지 확인한다.
13. 실제 PDF 바이트·크기·형식 검증과 500자 제한이 서버에서도 적용되는지 확인한다.
14. 세션·CSRF·다른 workspace 접근 실패가 상태 오판이나 비밀값 노출로 이어지지 않는지 확인한다.
15. page bridge가 보낸 위조 확인·제출 메시지가 사이드패널의 사용자 명령으로 수락되지 않는지 확인한다.
16. receipt의 attempt·revision·digest가 맞지 않는 응답에서 완료 표시를 보류하는지 확인한다.

## 12. 공식 기술 근거

다음 자료는 2026-11-15에 확인했다. 제품 선택과 API 계약은 이 문서의 설계 결정이며 Chrome 문서 자체가 이 제품의 안전성이나 접수 성공을 보증하는 것은 아니다.

| 근거 | 공식 문서 |
|---|---|
| 서비스워커 종료·전역 변수 소실·영속 상태 필요 | [The extension service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle) |
| 이벤트 listener 최상위 동기 등록 | [Events in service workers](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/events) |
| 사용자 실행으로 부여되는 activeTab, 다른 origin 이동 시 해제 | [The activeTab permission](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab/) |
| content script의 낮은 신뢰·JSON 메시지·비동기 응답 | [Message passing](https://developer.chrome.com/docs/extensions/develop/concepts/messaging) |
| MessageSender의 tab·frameId·documentId·origin | [runtime API](https://developer.chrome.com/docs/extensions/reference/api/runtime) |
| 특정 documentId로 메시지 전송 | [tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs) |
| local/session 저장소 수명과 접근 수준 | [storage API](https://developer.chrome.com/docs/extensions/reference/api/storage) |
| content script의 origin 제약과 임의 URL 프록시 위험 | [Cross-origin network requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests) |
| sidePanel.open의 사용자 동작 요건 | [sidePanel API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel) |
| SQLite 단일 writer와 BEGIN IMMEDIATE | [SQLite transactions](https://www.sqlite.org/lang_transaction.html) |
| WAL에서 FULL과 NORMAL의 내구성 차이 | [SQLite PRAGMA synchronous](https://www.sqlite.org/pragma.html#pragma_synchronous) |
