# Career Evidence v0.4 — Liner Provider Adapter 계약

공식 문서 확인일: **2026.11.15**. 상태: **구현용 명세, 실제 Provider 호출 미실행**.

이 문서는 Liner 응답을 Career Evidence의 작업·출처·주장·비용 상태로 변환하는 경계를 정의합니다. API handler나 worker 구현 코드는 포함하지 않습니다. 실제 키, 계정 잔액, 팀 크레딧 지급, 실응답 품질, 지연, 청구 금액은 확인하지 않았습니다. 제품 API의 공개 계약은 `openapi.yaml`과 `schemas/domain.schema.json`, 저장 계약은 `schema.sql`을 따릅니다.

## 1. 실행 경계와 확정된 제품 결정

Liner 호출은 **서버 worker만** 실행합니다. 웹과 Chrome 확장은 제품 API를 사용하며 Liner 키·Provider 원문 요청 헤더를 받지 않습니다. 키는 서버 환경변수에서 읽고 `request_json`·로그·오류 응답·영상에 저장하지 않습니다. 이 단계의 입력은 합성 프로필과 공개 자료입니다.

| 용도 | 이 프로젝트의 호출 계약 | 추가 호출 정책 |
| --- | --- | --- |
| 공고 탐색 | Web Search, `max_results:10`, `include_knowledge:false`, 한국어·한국 지역 지정 | 결과가 부족해도 자동으로 검색을 반복하지 않음 |
| 공고 요건 분석 | 사용자가 선택한 서로 다른 후보 1~3개, 후보별 Search Agent 1회 | 선택하지 않은 후보는 분석하지 않음 |
| 기업 브리프 | 검색 회차당 선택 기업 1곳에 Deep Research | 기업 슬롯을 원자적으로 예약하며 다른 기업으로 바꾸지 않음 |
| 조건 재평가 | 저장된 fact bundle과 새 context를 순수 규칙으로 평가 | Provider 호출 0회 |
| 지원 초안 | 확인된 합성 경력과 브리프를 사용하는 결정론적 템플릿 | 추가 유료 생성 호출 0회 |
| 구조화 실패 | 부분 결과·미확인 처리 | 자동 유료 LLM repair 없음 |
| 재시도 | 사용자 명시 요청에 따른 새 작업 | 자동 유료 재시도 기본 OFF |

검색 결과 10개는 유효한 채용공고 10개를 보장하지 않습니다. 중복·비공고를 제외한 실제 후보 수를 저장하며 상한만 10개로 둡니다. 선택 기업의 실패·중단이 기존 검색 회차의 기업 슬롯을 다른 회사에 재할당하는 근거가 되지는 않습니다. 새 기업 탐색은 명시적인 새 검색 흐름을 사용합니다.

## 2. 확인된 공식 HTTP 계약

Provider origin은 `https://platform.liner.com`, 경로 접두사는 `/api/v1`입니다. 세 API 공통으로 `x-api-key`와 `Content-Type: application/json`을 사용합니다. 아래 경로는 제품 서버의 `/api/v1/tasks` 등과 다른 외부 경로입니다.[1][2][3]

| API | 메서드·경로 | 주요 요청 필드 | 응답 |
| --- | --- | --- | --- |
| Search | `POST /api/v1/tools/search/web` | 필수 `query`; 선택 `country_code`, `lang`, `date_range`, `max_results`, `include_knowledge` | 단일 JSON |
| Search Agent | `POST /api/v1/agents/search` | 필수 `messages`; 선택 `model`, `lang`, `mode`, `request_id`, `stream` | 기본 SSE, `stream:false`는 완료 후 JSON |
| Deep Research | `POST /api/v1/agents/deep-research` | 필수 `messages`; 선택 `lang`, `request_id`, `stream` | 기본 SSE, `stream:false`는 완료 후 JSON |

Search의 `max_results`는 1~20, 기본 10입니다. `date_range`의 문서상 값은 `past_day/past_week/past_month/past_year`입니다. `include_knowledge` 기본값은 true이므로 정확한 snake_case로 false를 명시합니다.[1]

두 Agent의 메시지 역할은 문서상 `user/assistant`이며 마지막 메시지는 `user`, content는 문자열입니다. Search Agent는 `mode:general`을 사용하고 기본 모델을 사용합니다. 명세에 없는 모델 ID·JSON schema 강제 옵션을 추정하여 보내지 않습니다. Deep Research의 SSE 요청에는 `Accept: text/event-stream`을 붙입니다. Search Agent는 Bearer 인증도 문서화했지만 이 어댑터는 공통 `x-api-key`로 통일합니다.[2][3]

Agent 호출은 `lang:ko`, `stream:true`를 명시합니다. `request_id`는 서버가 만든 호출 추적 ID를 사용합니다. 이 프로젝트에서는 스트리밍 수신을 기본으로 하며, 비스트리밍 모드를 백그라운드 작업 API로 해석하지 않습니다.

## 3. Provider 기능의 확인 한계

대상 세 API의 공개 문서에서 독립 작업 생성 후 GET 결과 조회, 취소 확정, 연결 재개·이벤트 재생, idempotency 보장은 확인하지 못했습니다. `request_id`는 반환되는 추적 식별자이며 중복 실행 방지 키가 아닙니다. Agent의 `response_format/json_schema` 강제 출력 지원도 확인하지 못했습니다.[1][2][3]

따라서 다음은 제품 서버가 책임집니다.

- 자체 task ID, 작업 조회, 결과 영속화와 프런트 재접속 복구.
- product API 요청의 idempotency와 Provider 호출 이력 분리.
- 서버 worker의 lease·세대 검사, 오래된 worker 결과의 덮어쓰기 방지.
- 명시 재시도, 추가 비용 예약, 취소 요청과 과금 불확실성 표시.
- Provider 이벤트를 제품 스키마로 정규화하고 검증하는 작업.

Provider 요청을 보낸 뒤 연결만 끊는 것으로 실행·과금 중단을 확정하지 않습니다. 미확인 기능을 지원하지 않는다고 단정하지도 않으며, 현재 구현 계약의 전제로 사용하지 않습니다.

## 4. 작업 예약·호출·결과 저장

| 단계 | 서버 동작 | 저장·상태 원칙 |
| --- | --- | --- |
| 예약 | 고정 context·후보·기업 범위와 작업을 저장 | Provider 전송 전에 `provider_calls`와 예상 비용 예약을 기록 |
| claim | task의 lease owner·generation을 확보 | 이전 worker가 결과를 쓸 수 없도록 세대 검사 |
| 전송 준비 | 호출 상태를 `dispatched`로 저장 | 실제 네트워크 전송은 DB 트랜잭션 밖에서 수행 |
| 수신 | SSE 또는 JSON을 읽고 제한된 중간 결과 보관 | 이벤트 수·출처·본문·추적 정보와 완료 여부를 구분 |
| 정규화 | 출처 연결·주장 타입·대상 공고를 검증 | 검증한 부분만 fact bundle·브리프로 저장 |
| 확정 | 현재 lease를 검증하고 결과를 저장 | task·호출·비용 상태는 각각 의미에 맞게 갱신 |
| 복구 | 저장 상태에서 재개 여부 판단 | 전송 후 결과 불명인 호출을 자동으로 재전송하지 않음 |

`dispatched`를 기록한 직후 실제 전송 전에 프로세스가 멈추는 경우도 있습니다. 이 간극에서 전송 여부를 증명할 수 없다면 `unknown`으로 보수적으로 보존합니다. 반대로 전송되지 않았음이 확실한 예약은 동일 작업의 정상 실행 대상으로 처리할 수 있습니다. 작업 조회 GET 자체가 Provider 호출을 만들면 안 됩니다.

## 5. SSE와 완료 판정

두 Agent는 `event:data`의 JSON envelope 안에 `type`을 전달합니다. 출처는 `data-search-references`, 인용 조각은 `data-search-chunks`, 본문은 `text-delta`에서 받습니다. Deep Research는 조사 작업·진행 이벤트도 전달합니다.[2][3]

네트워크 청크와 SSE 이벤트는 같은 단위가 아닙니다. 파서는 UTF-8 디코딩 상태와 미완성 프레임을 유지하고, 여러 data 행·빈 행·주석을 처리합니다. 임의의 네트워크 청크마다 JSON.parse하지 않습니다. 이벤트 ID를 결과 재개 기능이나 전체 이벤트의 고유한 중복방지 키로 간주하지 않습니다.

| 관측 결과 | Provider 호출 상태 | 제품 처리 |
| --- | --- | --- |
| 정상 응답이 완결되고 오류 없음 | `succeeded` | 정규화 품질은 별도로 평가 |
| 명시적 HTTP 오류 또는 `data-error` | `failed` | code·retryable 저장, 자동 유료 재호출 금지 |
| 응답 도중 연결 종료·프로세스 중단, 최종 결과 불명 | `unknown` | 부분 결과 보존, 비용 불확실성 표시 |
| 정상 완료했지만 구조화·인용 연결 실패 | `succeeded` | partial/unstructured, 해당 주장 unknown |

**HTTP 200과 `[DONE]`만으로 성공 처리하지 않습니다.** 스트림 개시 후 `data-error`는 HTTP 200에서 올 수 있고 실패도 `[DONE]`으로 종료됩니다. 문서상의 정상 종료 이벤트와 오류 여부를 함께 확인합니다. 정상 종료 증거 없이 EOF만 받은 경우 최종 성공을 추정하지 않습니다.[2][4]

진행 이벤트의 모양은 공개 제품 응답에 그대로 전달하지 않습니다. Deep Research 문서의 작업 상태 설명과 예시 필드가 다르므로 지원하는 모양을 검증한 뒤 제품 단계로 변환합니다. 알 수 없는 부가 이벤트는 성공 근거로 쓰지 않고 무시할 수 있습니다. `reasoning-*`는 경력·기업 사실의 근거나 사용자에게 공개할 내부 처리 기록으로 사용하지 않습니다.[3]

## 6. 출처와 주장 정규화

Search는 `results` 안의 URL·제목·스니펫·날짜 등 메타데이터를 반환합니다. Agent는 `references`와 `referenceChunks`를 제공하며, references의 누락·null·빈 문자열을 방어적으로 처리해야 합니다. Agent의 `date`는 게시일이고 수집·색인 시각이 아닙니다.[1][2]

| 입력 | 제품 저장·검증 규칙 |
| --- | --- |
| Source URL | 유효한 공개 HTTP(S) URL만 Source로 생성. 누락된 URL을 모델 텍스트로 추측하지 않음 |
| 제목·게시일·발췌 | 누락·null·빈 값은 nullable 값으로 정규화. 부분 날짜에 임의의 월·일을 추가하지 않음 |
| `referenceChunks` | 문서 예시의 num/content/sourceTitle/sourceUrl을 해석하되 실제 형식 검증 필요 |
| 인용 조각과 source | source ID·URL·조각 텍스트 연결을 검사. 연결 불가 주장은 known으로 승격하지 않음 |
| `published_date` | Provider가 제공한 게시일 정보 보존 |
| `retrieved_at`·`observed_at` | 서버가 해당 결과를 수신·관측한 시각. 원문 직접 검증 시각으로 표현하지 않음 |
| 조건 재평가 | 기존 fact bundle의 관측 시각 유지. 새 평가 생성 시각만 별도 기록 |

`EvidenceQuote.link_check=matched_to_chunk`는 인용 텍스트와 수신한 조각의 연결을 확인했다는 의미입니다. 정보의 진실성·최신 모집 여부·조건의 확정성을 증명하지 않습니다. 검색 스니펫만으로 모집 중 또는 원격 가능을 확정하지 않습니다.

원격 조건이 자료에 없으면 unknown, 합성 프로필에 경험이 없으면 PROFILE_MISSING입니다. 서로 상충하는 자료는 conflicting으로 남깁니다. 직무·회사·공고 연결은 현재 작업의 고정 후보 범위에서 검증합니다. 출처 페이지의 문장은 외부 데이터이며 작업 지시나 허용 동작의 변경 근거로 사용하지 않습니다.

## 7. 구조화 출력 실패 처리

프롬프트에는 원하는 필드와 출처 연결 형식을 요청하되 그것을 Provider의 스키마 보장으로 표현하지 않습니다. 정규화기는 파싱, 허용 필드·타입, 중복·누락, 인용 연결을 검증합니다.

- 검증한 주장만 `known`으로 저장합니다.
- 값·출처 연결을 확인할 수 없는 항목은 `unknown`과 적절한 reason을 저장합니다.
- 일부 주장만 유효하면 `partial`, 구조화 결과를 사용할 수 없으면 `unstructured`로 표시합니다.
- 정상 호출 후 자료 부족·정규화 실패는 Provider 과금이 발생하지 않았다는 근거가 아닙니다.
- 추가 모델에 JSON repair를 요청하거나 범용 생성 모델로 조용히 대체하지 않습니다.
- 사용자가 수정한 지원 답변은 `user_edited/needs_review`로 다루며 새 경력 사실을 만들어 보충하지 않습니다.

이 단계의 지원 초안은 경험과 브리프를 문항별 템플릿에 넣는 방식입니다. 여기서 ‘무료’는 **추가 유료 모델 호출이 없다**는 뜻이며 서비스 운영 전체 비용이 0이라는 뜻은 아닙니다.

## 8. 오류·제한·명시 재시도

공식 안내는 `retryable`과 `Retry-After`를 확인하고 지수 백오프·지터를 적용하도록 합니다. Search Agent·Deep Research의 기본 속도 제한은 각각 초당 2회이며 계정 조건에 따라 달라질 수 있습니다. SSE 개시 후 오류에는 새 Retry-After 헤더가 없을 수 있습니다.[4]

이 프로젝트는 자동 유료 재시도를 기본 OFF로 둡니다. HTTP 라이브러리·SDK·worker 스케줄러가 기본적으로 수행하는 자동 재호출도 같은 정책을 따라야 합니다. 이 정책은 Liner 내부의 처리 방식까지 제어한다는 뜻은 아닙니다.

사용자가 재시도를 선택하면 기존 `context_id`, 검색 회차, 후보와 기업 선택을 유지한 새 task를 만들고 `retry_of_task_id`로 원작업을 연결합니다. 성공한 후보·브리프는 재호출하지 않고 기존 결과를 보존합니다. 실패하거나 결과가 불명확한 항목만 새로운 비용 예약과 호출 이력을 만듭니다.

`retryable:false`는 원인을 고치기 전 재시도하지 않습니다. 429·일시 오류는 사용자 명시 재시도 후에도 필요한 대기 시간을 지킵니다. 결과 불명 호출은 `possible_duplicate_charge`를 표시하고 요청의 중복 비용 확인 값을 검증합니다. 같은 request_id로 다시 보내도 Provider가 중복 청구를 막아준다고 가정하지 않습니다.

## 9. 실행 중단·결과 불명·과금 상태 분리

| 대상 | 의미 |
| --- | --- |
| `tasks.cancel_requested` | 사용자가 로컬 후속 처리를 중단하도록 요청함 |
| task `canceled` | 제품이 해당 작업을 더 진행하지 않음 |
| `provider_calls.status=unknown` | 전송 또는 최종 처리 결과를 확인할 수 없음 |
| `billing_status=unknown` | 실제 과금 여부·금액이 불명확함 |
| 지원 화면의 접수 확인 필요 | 자체 지원 폼의 접수 결과에 대한 클라이언트 관측 상태로, 위 Liner 상태와 별개 |

대기 작업은 전송 없이 중단할 수 있습니다. 진행 중 연결을 끊은 경우 Provider 취소·비용 환급을 확정하지 않습니다. 취소 뒤 늦게 도착한 응답은 활성 context나 다른 기업의 결과를 덮어쓰면 안 됩니다. 호출 이력 기록 역시 현재 lease·세대 검증을 따릅니다.

## 10. 호출별 비용·추적 저장

비용은 `provider_calls`의 전용 컬럼으로 보관합니다. 전송 입력·endpoint·request hash는 고정하고 비용 확인 상태를 별도로 갱신합니다.

| 저장 항목 | 계약 |
| --- | --- |
| `estimated_cost_micro_usd` | 호출 전 문서 단가로 예약한 예상 비용. USD의 백만분의 1 단위 정수 |
| `billing_status` | `not_dispatched/estimated/unknown/verified` |
| `verified_cost_micro_usd` | 확인된 실제 금액. 확인 전에는 null, 실제 0원 확인과 미확인을 구분 |
| `provider_request_id` | 반환된 Provider 추적 ID. 제품 idempotency 또는 권한 증명이 아님 |
| `partial_json` 부가 메타데이터 | 가격 기준일, 선택한 가격 옵션, trace, 실제 usage 확인 근거 등 |
| `request_json` | 키·인증 헤더를 제외한 실제 Provider 요청 데이터 |
| `response_json/error_json` | 제한된 결과·정규화 정보 또는 명시 오류. 비밀키·내부 reasoning 로그 제외 |

`verified`는 실제 사용량·청구 근거와 해당 호출의 연결을 확인했을 때만 사용합니다. HTTP 성공만으로 예상 금액을 실제 금액 컬럼에 복사하지 않습니다. 계정 전체 잔액 변화만으로 동시에 실행한 특정 호출의 비용을 확정하지 않습니다.

호출 예약은 workspace의 `budget_limit_micro_usd`와 전체 서버 예산·호출 수 제한을 서비스 트랜잭션에서 검사합니다. 같은 트랜잭션에서 예상 비용을 예약해야 동시 작업이 예산을 각각 따로 확인한 뒤 초과 실행하는 일을 막을 수 있습니다. 비용 확정 전에는 예상 비용을, 결과 불명에는 보수적인 예약을 유지합니다. 미확인 호출을 무료 실패로 처리하여 예약 비용을 자동 반환하지 않습니다.

공개 Task의 `cost_estimate_micro_usd`·`billing_status`·`possible_duplicate_charge`는 호출별 저장 상태에서 집계합니다. 여러 호출 중 하나라도 과금이 불명확하면 전체를 verified로 표시하지 않습니다. 재시도 task의 비용은 새 호출과 연결하고 원작업 비용·성공 결과를 지우지 않습니다.

## 11. 문서 단가와 계산 가정

아래는 2026.11.15 공식 가격표의 호출 단가를 사용한 예상치입니다. 실제 계정 잔액·청구 결과가 아닙니다. 공식 가격표는 Search·Agent를 성공 처리 호출 단위로 설명합니다.[5]

| 호출 | 횟수 가정 | 호출당 USD | 예상 micro-USD |
| --- | ---: | ---: | ---: |
| Web Search, `include_knowledge:false` | 1 | 0.001 | 1,000 |
| Search Agent | 3 | 0.02 | 60,000 |
| Deep Research | 1 | 0.20 | 200,000 |
| 합계 | 5 | — | **261,000** |

**$0.001 + 3 × $0.02 + $0.20 = $0.261**입니다. 검색을 더 하거나 재시도하면 비용이 달라집니다. 분석을 1~2개만 선택하면 그만큼 호출 수가 줄어듭니다. 세금·충전 수수료·추가 모델 호출을 포함한 청구 총액으로 제시하지 않습니다. 팀 크레딧의 실제 지급·잔액도 미확인입니다.

Web Search의 Premium Data 기본 옵션을 사용하면 문서상 $0.002/회입니다. 이 명세는 일반 공고 탐색에 `include_knowledge:false`를 명시하는 것으로 비용 계산을 고정합니다. 실제 금액은 사용량 근거가 있어야 verified로 기록합니다.[1][5]

## 12. 구현 시 확인할 좁은 계약 경계

이 문서 작성에서 아래 통합 검증을 수행했다고 주장하지 않습니다. 실제 어댑터 구현 단계에서 관련 경계만 확인합니다.

1. SSE 프레임이 여러 네트워크 청크로 나뉘거나 한 청크에 여러 이벤트가 들어와도 정상 해석되는가.
2. HTTP 200 + data-error + DONE, 중간 EOF, 정상 완료지만 구조화 실패를 서로 다르게 처리하는가.
3. 누락된 URL·게시일, 연결되지 않는 인용, 서로 상충하는 주장에 값을 만들어 넣지 않는가.
4. worker 재시작 이후 dispatched 호출을 자동 재전송하지 않고 결과·비용 불명 상태를 보존하는가.
5. 명시 재시도에서 성공 후보·기업 선택·원작업 비용을 보존하고 새 호출만 예약하는가.
6. 조건 재평가·템플릿 초안·작업 polling이 유료 Provider 호출을 만들지 않는가.

실제 키·계정 사용량을 이용하는 통합 호출과 운영 배포는 이 계약 작성 범위에 포함하지 않습니다.

## 공식 출처

공식 문서 확인일: **2026.11.15**. 위의 호출 횟수·worker 정책·스키마 정규화·예산 예약·재시도 기본값은 이 프로젝트의 설계 결정이며 Provider의 보장으로 표현하지 않습니다.

[1] [Liner Search API](https://liner.com/developers/docs/search-api)

[2] [Liner Search Agent API](https://liner.com/developers/docs/search-agent-api)

[3] [Liner Deep Research Agent API](https://liner.com/developers/docs/deep-research-agent-api)

[4] [Liner Rate limits](https://liner.com/developers/docs/rate-limits)

[5] [Liner Pricing](https://liner.com/developers/docs/pricing)
