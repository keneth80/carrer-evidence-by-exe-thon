# Worker

`npm run worker`(또는 `npm run dev`가 API health 확인 뒤 자동 시작)로 실행한다. API와 같은 `DATABASE_PATH`를 연다.

처리하는 작업: `search_jobs`(S02, `src/search-task.ts`), `tailor_resume`(S04 대화 응답·변경 제안, `src/tailor-task.ts`), `render_resume`(S04 PDF, `src/render-task.ts`), `submit_application`(S05 접수 결과 확인 `action=observe`, `src/observe-task.ts`). 검색 provider는 `LINER_MODE`로 고른다: 기본 mock, `live`면 Liner 웹 검색(`packages/liner/src/web-search.ts`, 원장 `src/liner-ledger.ts`). 대화 provider는 mock만 허용한다(`CHAT_MODE=mock`). 공용 lease 도구는 `src/lease.ts`. 검색 작업 기준:

- claim: `queued` 또는 lease가 끝난 `running` 작업을 한 transaction에서 집고 `lease_generation`을 올린다.
- 실행: 전송 직전 CAS(lease 보유·중지 요청 없음)로 `provider_transmission=dispatched`를 기록하고, 호출 중에는 transaction 없이 heartbeat로 lease만 연장한다. lease를 잃으면 AbortSignal로 호출을 중단한다. 작업 입력의 provider 모드와 worker 모드가 다르면 실행하지 않는다.
- 저장: owner·generation·만료를 다시 확인한 transaction에서 JobSnapshot·검색 결과·작업 상태를 함께 쓴다. lease를 잃었으면 결과를 버린다.
- 취소·상한: 중지 요청된 작업은 결과 없이 `canceled`, 재획득 3회 초과는 `SEARCH_ATTEMPTS_EXCEEDED`.
- live provider가 `dispatched` 상태로 끊긴 작업은 재시도하지 않고 `PROVIDER_TRANSMISSION_UNKNOWN`으로 끝낸다.
- Liner live: 호출마다 `ce7_provider_calls`에 먼저 예약(짧은 transaction에서 lease·`LINER_MAX_CALLS`·`LINER_BUDGET_MICRO_USD` 확인, 2,000 micro-USD) → 요청 직전 `dispatched` → `succeeded`(1,000)/`failed`(400·401·402·429, 0)/`unknown`(네트워크·시간 초과·5xx·해석 불가). 전송 뒤 자동 재시도 없음. 실행당 최대 2건.

대화 응답은 base revision에 고정하고, 응답 중 문서가 바뀌면 stale 제안으로 저장한다. PDF는 파일을 먼저 쓰고 lease를 확인한 transaction에서 기록하며, 실패하면 파일을 지운다. 추출(`extract_resume`)은 아직 API 프로세스에서 실행한다(DECISIONS S1-07). S05 접수 결과 확인은 같은 lease 패턴으로 시도의 접수 기록만 조회한다(제출하지 않음). 자체 테스트 폼은 사이트 저장소를 대조하고 기록이 없으면 접수 키를 닫아 미접수로 확정한다. 매 반복마다 실행기 보고 없이 3분이 지난 `dispatched` 시도를 접수 불명으로 정리한다(자체 폼은 기록이 있으면 접수로 확정). 실제 제출은 worker가 아니라 Chrome 확장이 한다.
