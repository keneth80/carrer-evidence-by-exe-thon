# v0.7 서비스 의미 규칙

이 문서는 JSON Schema·OpenAPI·SQL과 함께 적용한다. 필드가 존재하거나 DB INSERT가 성공했다는 이유로 아래 의미가 확인된 것은 아니다.

## 인증·요청·파일

- 실제 요청에서 인증한 principal로 workspace를 결정한다. body/URL의 resource ID는 그 범위 안에서 다시 조회하며, 타인의 ID는 존재 여부를 노출하지 않는 404로 처리할 수 있다. 쿠키 인증의 쓰기 요청은 CSRF와 정확한 Origin도 확인한다.
- v0.4 demo session으로 실제 자료에 접근하지 않는다. `ProductSession`은 새 인증된 연결의 기능 상태를 알린다. 배포 로그인 제공자와 executor pairing 방식은 별도 구현 항목이며 현재 코드에서 완료되지 않았다.
- 지원하는 원본 형식은 텍스트 PDF, Word(.docx, v0.7.2), 붙여넣기다. docx는 본문·표 텍스트만 읽고 쪽 번호 대신 텍스트 위치(page=null)로 근거를 연결한다. 옛 .doc·OCR는 후속 기능이다. 서버의 실제 파일·페이지·문자·요청 크기 한도를 표시한다. 공개 schema가 최대 bytes를 지정하지 않는 것은 무제한 허용을 뜻하지 않는다.
- 원본 hash는 PDF 원본 bytes 또는 붙여넣은 문자열의 UTF-8 bytes에 대해 계산한다. 파일명으로 서버 경로를 조합하지 않는다. 생성 PDF는 실제 bytes의 hash를 새로 계산한다. 모델 출력이나 예제의 hash를 대신 사용하지 않는다.
- 지원서·대화·접수 증거의 로그에는 필요한 참조와 상태만 남긴다. 원본 전체를 분석 로그나 공개 데모로 복제하지 않는다. 정리·삭제 정책은 원본 파일과 파생 이력의 관계를 고려한 명시적 소유자 작업으로 구현하며 demo의 7일 세션 TTL과 혼동하지 않는다.
- 쓰기 요청은 workspace + operation + Idempotency-Key로 중복을 검사한다. request_hash에는 HTTP method, 실제 정규화 path(리소스 ID 포함), 정규화 body를 포함한다. 같은 key에 다른 대상/내용이면 409다. 파일 업로드는 서버가 검증한 실제 파일 hash도 fingerprint에 포함한다.

## 원본 → 확인된 사실 → 검색

- EvidenceReference의 문서 ID, page, start/end, quote를 원본 추출 문자열에서 검증한다. start는 포함, end는 제외하는 Unicode code point 위치다. page가 없으면 붙여넣기 전체 텍스트 기준이다. end>start와 quote 일치는 서비스 규칙이다.
- 추출 오류/텍스트 없음은 failed 또는 review_required로 알린다. 사용자가 직접 붙여넣거나 정정할 수 있게 하고, 빈 경력으로 자동 확정하지 않는다.
- 사용자 진술 근거는 실제 사용자가 작성한 같은 scope의 TailoringMessage를 가리켜야 한다. assistant 메시지를 user_statement로 승격하거나 모델이 생성한 수치를 자동 확정하지 않는다. 확인 시각은 서버가 기록한다.
- (v0.7.4, S1-16) 기본 이력서 보완 대화(ResumeSupplementSession)의 사용자 메시지도 같은 문서의 user_statement 근거가 될 수 있다. 에이전트 턴의 candidates는 사용자 메시지 안의 문장만 담고, drafts는 사실이 아닌 제안이며 근거에 없는 숫자·기술·역할·평가어가 있으면 저장 전에 버린다. 보완 대화는 확정 경력을 직접 바꾸지 않고, 사용자가 확정 API로 새 버전을 만든다. 대화는 문서의 현재 확정 버전에서만 시작하고 대화당 응답은 하나씩 만든다.
- (v0.7.5, S1-17) 보완 대화 한 턴은 단계로 나눈다: 규칙 점검 → AI 점검(첫 턴, 문장을 고치지 않고 문제·질문만) / 초안 작성 → 근거 검토(답변 턴). 근거 검토는 다른 호출이 초안마다 keep/drop을 판정하고, keep도 결정적 근거·안티슬롭 검사를 다시 통과해야 보인다. 근거 검토가 거절·실패·전송 불명·형식 오류면 초안은 보이지 않고(닫힌 쪽 실패) 사용자 문장 후보만 남는다. AI 점검이 실패하면 규칙 점검 결과만 보여 주고 실패를 턴 답·단계 요약에 적는다. 각 호출은 원장에 따로 예약하며 보낸 뒤 재시도하지 않는다. 진행 기록(progress)은 화면 표시용이며 경력 사실이 아니다.
- (v0.7.7, S1-22) 점검 항목(보완 대화·1차 AI 점검·JD 점검)의 `example`은 작성 예시다. 경력 사실이 아니며, 확정 경력에 없는 수치·기간·인원·기술·범위는 `[빈칸]`으로만 남긴다. 서버는 빈칸 밖의 숫자·영문 기술명·책임 범위 표현이 확정 경력에 없거나, 빈칸 안에 숫자가 있거나, 평가어가 있으면 예시를 null로 바꾼다(항목은 남는다). 빈칸이 남은 사용자 문장은 경력 후보·사실 확인 후보가 되지 않는다.
- (v0.7.6, S1-18) 공고 맞춤 대화도 단계로 나눈다: JD 점검(요구사항 대조 → AI 점검, 문서를 고치지 않고 근거 약함·미기재 요구에 질문만) / 답변 턴(수정안 작성 → 근거 검토). 요구사항 대조는 검색 화면과 같은 연결 규칙을 쓰며, 근거를 찾지 못한 요구는 '미기재'이지 경험 없음이 아니다. AI 점검의 요구 id·fact id는 서버가 검증한다. 근거 검토는 다른 호출이 수정안마다 keep/drop을 판정하고, keep도 결정적 근거·안티슬롭·적용 가능성 검사를 다시 통과해야 제안이 된다. 근거 검토가 거절·실패·전송 불명·형식 오류·판정 누락이면 해당 수정안은 제안하지 않고(닫힌 쪽 실패) 사용자 문장 후보만 기존 확인 절차로 남는다. 각 호출은 원장에 따로 예약하고 보낸 뒤 재시도하지 않으며, 하나라도 전송 불명이면 작업 전송 상태를 unknown으로 남긴다.
- ResumeFactRevision은 사용자가 확인한 사실 집합이다. 희망 조건은 SearchIntent.conditions로 분리한다. 사용자 확인 전 ExtractionDraft를 실사용 경력으로 검색·지원에 쓰지 않는다.
- 검색 query는 같은 fact revision의 role/skill/responsibility 등에서 만든다. 이름·연락처·정확한 주소·생년월일 등 불필요한 개인정보는 query에서 제거한다. query 문자열을 React로 고정하지 않는다.
- mock 결과도 입력된 역할/기술 차이에 따라 검색 계획과 결과 근거가 달라져야 한다. 합성 데이터는 synthetic으로 표시한다. 실제 Liner 호출·과금·공고 유효성을 검증하지 않은 결과를 live로 표시하지 않는다.
- Liner 검색과 대화형 편집의 모델은 별도 adapter다. Claude Code는 개발 도구다. 소비자용 대화가 실제로 작동하려면 제품 런타임의 모델/provider 계약과 비용 검증이 필요하다.
- 공고·사이트·직무명 중복은 제공자의 공고 ID, canonical URL, 원문에서 확인한 동일 채용 정보를 사용해 판단한다. 회사명+제목 유사도만으로 서로 다른 채용을 하나로 합치지 않는다. 동일 여부가 불확실하면 자동 지원 전에 검토 대기로 둔다.

## 대화형 수정과 제출 문서

- JobSnapshot, ResumeFactRevision, base ResumeRevision을 대화 요청에 고정한다. 늦은 모델 응답은 현재 revision을 덮어쓰지 않고 stale 제안으로 남긴다.
- EditProposal은 실제 문서 변경안이다. before/after, 원인, fact IDs, 미확인 질문을 보여준다. 단순 조언 메시지와 구분한다. 새 사실을 확인한 후에는 새 fact revision을 만들고 그 버전에서 변경안을 다시 평가한다.
- JSON 포인터나 임의 코드로 문서를 수정하게 하지 않는다. 모델 제안의 블록 ID와 허용 operation을 검증한다. remove/reorder/replace/insert별 before/after 조건과 전체 블록 집합의 유일성은 서비스가 검사한다.
- ResumeBlock의 fact IDs는 같은 fact revision에 존재해야 한다. 문구가 근거 범위를 넘어 성과·책임·경력 기간·자격을 부풀리면 질문 또는 수정으로 돌린다. 사실 근거가 없는 장식 문구를 필수 경력 사실처럼 추가하지 않는다.
- 사용자가 보는 final preview와 렌더링할 content hash가 같아야 한다. 실제 PDF의 글꼴·줄바꿈·누락을 확인한다. filename만 같다는 이유로 같은 파일로 간주하지 않는다.
- `fixed_document`는 확정한 파일을 재사용한다. 새 지원 대상 회사명·지원 동기·요구 형식과의 충돌을 점검한다. `tailor_within_facts`는 정책의 allowed_edits 범위에서만 공고별 새 revision과 PDF를 만든다. 새 사실·필수 답변이 필요하면 대기한다.

## 지원 권한과 실행

- `ApplicationAuthorization`은 회사/공고, application revision, resume revision, artifact ID와 실제 hash, 전체 답변 hash, target URL, 계정, 사이트 adapter version, form snapshot hash, 만료를 고정한다. hash는 내용 식별자이며 독자적인 권한 증명이 아니다.
- manual은 해당 공고의 최종 내용을 사용자가 확인한 권한이다. policy는 활성 정책의 범위를 통과한 특정 공고의 실행 권한이다. policy를 `user_reviewed_at` 또는 user_reviewed=true로 꾸미지 않는다.
- 정책에 따른 제출은 같은 정책/계정/기간/한도 안에서 공고마다 수동 승인을 다시 요구하지 않는다. 그래도 공고마다 새 authorization을 만들고, 과거 회사의 manual authorization을 재사용하지 않는다.
- 실제 사이트·계정 binding, 정책 allowed_sites와 account_binding_ids, 필수 조건의 확정 충족, 공고 유효성, 문서와 질문 검증을 서버에서 확인한다. 조건을 모르면 충족으로 추정하지 않는다. recommend/prepare는 submit 권한을 만들지 않는다.
- executor 종류와 사이트 adapter를 분리한다. Chrome/Ego 모두 동일한 application/attempt 기록을 사용한다. 지원하지 않는 사이트·새 문항·계정 변경·로그인·CAPTCHA·뜻이 불명확한 확약은 waiting_user로 넘긴다. 계정 비밀번호·쿠키를 공통 지원 payload로 전송하지 않는다.
- 폼 내용은 데이터다. 페이지의 지시문으로 서버 정책, 허용 domain, 파일 접근 범위, 모델의 실행 권한을 바꾸지 않는다. 자동 fill/upload 이후 값과 첨부 파일을 다시 읽어 확인하고, 폼이 바뀌면 권한을 갱신한다.
- DB의 dispatched는 브라우저로 전송 의도를 내보내기 직전 저장하는 경계다. 이후 crash/timeout에는 외부 효과가 없었다고 단정하지 않는다. 브라우저 명령 자체에도 attempt ID와 단일 실행 토큰을 연결한다.
- 전송 후 `submitted`는 접수 증거를 요구한다. 사용자 직접 확인 기록은 user_report로 구분해 표시한다. 외부 ATS가 우리 DB와 하나의 transaction이 된다고 가정하지 않는다. own demo receipt의 강한 reconcile 성질은 해당 자체 폼에만 적용한다.
- submission_unknown은 영속 상태다. observe는 접수 조회이며 재제출이 아니다. 자동 재전송, 다른 채널로 우회 제출, 사용 횟수 자동 환불을 하지 않는다. 확인 근거가 없으면 계속 불명 상태일 수 있다.

## 자동 지원 정책과 캠페인

- 정책 revision 작성과 활성화를 나눈다. activate는 정확한 content hash, mode, 기간, 한도, 계정, 사이트 범위에 대한 사용자 설정을 확인한다. 예제의 하루 3건·총 10건 등은 schema fixture이며 실제 사용자 동의나 기본 활성값이 아니다.
- fixed_document의 artifact는 seed_resume_revision에서 실제 렌더링한 파일이어야 한다. 정책의 fact revision은 그 이력서에 사용한 확정 사실과 일치해야 한다. 새 경력이 추가되면 새 정책 revision과 명시적 활성화를 적용한다.
- 캠페인의 seed application revision·job snapshot·resume revision은 고정한다. 자동으로 지원한 공고를 새 seed로 삼아 범위를 늘리지 않는다. 사용자가 다른 기준을 직접 선택하려면 별도의 캠페인 생성으로 기록한다.
- 캠페인은 사용자가 기준으로 선택한 지원 건의 스냅샷에서 시작한다. 완료된 지원 이력이 없는 준비 건을 기준으로 제공할 경우 UI에서 아직 제출되지 않았음을 분명히 표시하고, 자동으로 완료 이력을 만들어내지 않는다.
- total_limit은 daily_limit보다 작을 수 있지만 실제 허용 수는 둘 중 남은 범위에 한정된다. valid_from<expires_at, 현재 시각, 날짜 경계를 서버가 검증한다. revision 변경으로 기존 policy_id의 예약/사용량을 초기화하지 않는다.
- pause/revoke/expiry는 새 dispatch를 차단한다. 이미 전송 중인 지원을 취소했다고 표시하지 않는다. 일일 한도 및 비용 예약 경쟁은 BEGIN IMMEDIATE와 현재 generation 검사로 직렬화하고 외부 대기는 쓰기 transaction 밖에서 수행한다.
- 입력 비용/검색 비용/문서 생성 비용은 provider 원장에 별도 예약한다. 정책의 지원 건별 예약 비용과 중복 계산하거나 누락하지 않도록 비용 항목을 식별한다. 전송 불명 provider 호출은 새 generation으로 자동 재호출하지 않는다.

## 지원 이력과 채용 단계

Application.current는 현재 작업 내용이며, 실제 제출은 Attempt→Authorization→ApplicationRevision→Artifact 경로로 당시 파일과 답변을 재현한다. 현재 이력서를 고쳐도 과거 제출 파일을 덮어쓰지 않는다. JobSnapshot도 제출 당시 내용으로 남긴다.

submission_state는 실행/접수 상태이고 recruitment_stage는 회사의 채용 진행 상태다. 폼 요청 거절을 채용 불합격으로 기록하지 않는다. 답장이 없으면 unknown을 유지한다. 사용자가 기록한 면접/오퍼/불합격에는 관찰 시각과 source=user를 남기고, 향후 이메일 연동은 별도 사용자 연결 범위에서 구현한다.

## 남은 통합 계약

이 디렉터리의 API는 제품 웹/서버 경계다. 인증 공급자 로그인·계정 복구, 로컬 executor pairing/재연결, 사이트별 실제 readback, 브라우저 증거의 검증된 업로드, 파일 보존·삭제 작업, 정확한 OCR/DOCX·PDF 렌더러는 해당 구현 단계에서 더 구체화해야 한다. 현재 명세는 이 기능들이 이미 작동한다고 가정하지 않는다. 각 기능의 타입/메시지/보존 정책을 추가할 때 이 서비스 규칙과 인수 기준을 함께 갱신한다.
