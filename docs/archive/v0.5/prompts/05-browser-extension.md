# 5단계 — 자체 폼과 Chrome 확장

핵심 웹 흐름과 지원 서버의 검증 기록을 확인하고 자체 폼 1종의 브라우저 입력을 구현해줘. 제품의 Chrome 확장을 만드는 작업이며, Claude Code의 Chrome 기능 설치가 필수는 아니야.

## 읽을 계약

contracts/v0.4/EXTENSION_PROTOCOL.md 전체, schemas/extension.schema.json, domain schema의 확장 메시지·승인·attempt 정의, 관련 OpenAPI. 실제 runtime 경로는 CODEMAP에서 확인해줘.

## 구현 범위

1. 자체 target `career-evidence-demo-v1`의 동일 origin 폼과 고정 page bridge를 연결해줘. 메시지로 임의 URL·method·header·selector·script를 받지 말아줘.
2. Chrome이 제공하는 sender의 tab/frame/document/origin을 검증하고 현재 top frame과 정확한 document에만 응답해줘. nonce를 인증이나 XSS 방어로 간주하지 말아줘.
3. 정해진 문항 입력→합성 PDF 실제 첨부→현재 폼 값과 bytes hash의 readback→최종 확인 순서로 연결해줘.
4. 동의 변경은 draft revision에 먼저 저장하고 새 내용을 다시 읽어 확인시켜줘. 체크박스 변경만으로 승인을 만들지 말고 최종 사용자 제출 동작에서 승인 API를 호출해줘.
5. approval→prepared attempt→실제 FormData 제출→receipt 표시를 연결해줘. 응답을 잃으면 GET으로 기존 상태를 먼저 조회해줘.
6. 확장 service worker 재시작·탭 이동·document 교체·다른 탭·만료 후 복구를 구현해줘. 중요한 상태는 서버가 보관하고 확장에는 키·쿠키·CSRF·파일 bytes를 메시지로 보내지 말아줘.

## 완료 기준

실제 Chrome에서 한글 입력·실제 파일 첨부·값 확인·최종 확인·접수 번호 표시를 수행한다. 두 번 클릭, 응답 손실, 재시작, 다른 문서로 이동, 오래된 revision, 닫힌 attempt를 확인한다. 실제 브라우저를 사용할 수 없으면 빌드·메시지 단위 테스트만 PASS로 기록하고 브라우저 검증을 NOT_RUN으로 남긴다.

브라우저 권한은 이 동작에 필요한 최소 범위로 정하고, 전체 사이트 접근이나 외부 기업 제출을 추가하지 말아줘. 실행 절차와 검증 결과를 docs/state·README·CODEMAP에 반영해줘.
