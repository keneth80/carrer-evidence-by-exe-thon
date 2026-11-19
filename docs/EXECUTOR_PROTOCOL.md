# 실행기 내부 프로토콜 `/api/executor/v1` (S05, 2026-11-18)

Chrome 확장(실행 채널)과 서버 사이의 내부 프로토콜이다. 공개 제품 API(OpenAPI)가 아니다. 웹 클라이언트가 접수 성공 근거나 정책 권한을 직접 만드는 경로는 없다(API_INDEX 참고). 구현: `apps/api/src/apply/executor.ts`, 확장: `apps/extension/executor.mjs`.

## 인증과 경계

- 기기 연결: 웹 `POST /api/v1/executor-pairings`가 10분 유효·1회용 8자리 코드를 만든다. 확장이 `POST /api/executor/v1/pair {code, label}`로 기기 토큰(32 bytes hex)을 받는다. 코드·토큰 원문은 저장하지 않는다(sha256만). 실패 연결 시도는 1분 20회로 제한한다.
- 이후 요청은 `Authorization: Bearer <기기 토큰>`. 연결 해제(웹 `POST /api/v1/executor-devices/{id}/revoke`)하면 401 `DEVICE_REVOKED`.
- 서버는 `/api/executor/v1/*`에서만 `chrome-extension://<32자>` origin을 받는다. 다른 웹 origin은 403. 확장은 쿠키를 보내지 않는다(`credentials: omit`).
- 확장 host 권한은 `http://127.0.0.1:4310/*` 하나다. API는 Vite proxy(같은 origin)로 호출한다. 실행 주소는 코드에 고정한 자체 폼 경로(`/demo/apply/<공고>`)만 허용하고, 서버가 준 주소도 다시 검사한다.
- 패널 메시지는 정해진 동작 이름과 ID만 담는다(`guard.mjs`의 `isPanelRequest`). URL·selector·script를 메시지로 받지 않는다.

## 경로

| 메서드·경로 | 역할 |
| --- | --- |
| `POST /pair` | 1회 코드 → 기기 토큰 |
| `GET /session` | 기기 정보(연결 확인) |
| `GET /applications` | 이 workspace의 지원 건(주소·상태·답변 완료 여부·대기 시도) |
| `GET /applications/{id}/prepare` | 현재 revision의 입력값·파일 메타. 답변 미완성 409, 이미 전송한 건 409 |
| `GET /applications/{id}/artifact?revision=N` | 현재 revision에 고정한 PDF bytes(저장 bytes hash 재확인) |
| `POST /applications/{id}/observations` | 폼 snapshot(+readback). 서버가 공고·문항·파일 입력·값·파일 hash를 대조해 `inspected`/`verified`/`mismatch`로 저장 |
| `GET /attempts` | 이 기기 binding으로 승인된 `prepared` 시도 |
| `POST /attempts/{id}/claim` | 실행 토큰 발급. 전송 전이면 재발급(이전 토큰 무효). 권한 무효면 시도를 `failed_before_dispatch`로 멈춤 |
| `POST /attempts/{id}/dispatch` | 전송 직전 검증(권한·주소·snapshot hash·readback·파일 hash) 후 `dispatched` 기록, 접수 키(시도 ID) 반환. 불일치면 전송하지 않고 시도 중단. 다시 집힌 이전 실행 토큰은 409 `RUN_TOKEN_INVALID`(기기 연결은 유지) |
| `POST /attempts/{id}/result` | 결과 보고(`confirmation`·`form_error`·`no_confirmation`·`not_started`). 한 번만 반영 |

## 상태 원칙

- `dispatched`는 브라우저에 제출을 지시하기 직전에 저장한다. 이후 끊기면 외부 효과가 없었다고 단정하지 않는다.
- 자체 테스트 폼은 사이트 저장소(`demo_site_submissions`)가 접수 키로 중복을 막고, 서버가 그 저장소를 대조해 접수/미접수를 확정할 수 있다(`reconcile.ts`). 기록이 없으면 키를 닫아(sealed) 늦은 전송도 받지 않게 한 뒤 미접수로 확정한다. **이 강한 보장은 자체 폼에만 적용한다.** 외부 사이트 adapter는 근거가 없으면 `submission_unknown`을 유지한다.
- 실행기 보고 없이 3분이 지난 `dispatched`는 worker가 접수 불명으로 바꾼다(자체 폼은 기록이 있으면 접수로 확정, 봉인은 하지 않음). 승인이 만료된 대기 시도는 worker가 전송 전 중단으로 닫는다.
- 웹의 접수 결과 확인은 전송 1분 뒤부터 받는다(그 전에는 실행기가 결과를 볼 시간). 이 시도의 접수 기록이 없더라도 승인 뒤 같은 공고·같은 PDF의 다른 접수가 있으면(페이지에서 직접 제출한 경우) 봉인하지 않고 접수 불명으로 둔다.
- 확장은 기기 토큰(`storage.local`)과 전송 후 관측용 실행 토큰(`storage.session`)만 가진다. 서비스 워커가 재시작되면 결과 관측만 이어가고 제출 버튼은 다시 누르지 않는다.

## 자체 폼 사이트 표식(self-form.v1)

`form[data-ce-form="self-form.v1"]`, 공고 `[data-ce-posting-id]`·`[data-ce-company]`·`[data-ce-title]`, 문항 `label [data-ce-label]` + `name`, 파일 `input[name=resume_file]`, 접수 키 `input[name=submission_key]`, 제출 `[data-ce-submit]`, 결과 `[data-ce-receipt]`(접수번호·공고·접수 키) / `[data-ce-error]` / `[data-ce-status="sending"]`. 개발 검증 표식: 지원 동기에 `[demo:slow]`(4초 지연)·`[demo:drop]`(저장 후 응답 없이 끊음)·`[demo:reject]`(503, 저장 안 함).
