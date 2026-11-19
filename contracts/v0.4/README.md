# Career Evidence 데이터·API 계약 v0.4

웹·Chrome 확장 구현에 사용할 계약 묶음입니다. 기준은 팀 기획서 v0.2와 UI·UX v0.3이며, 작성일은 2026.11.15입니다. **실행 서비스·배포된 API·완성된 Chrome 확장이 아닙니다.**

## 먼저 볼 파일

| 파일 | 용도 |
| --- | --- |
| SPEC.md | 19개 주제로 정리한 전체 설계. PDF와 같은 본문 |
| DECISIONS.md | 결정 이유·보류 사항·구현 시 제안값 |
| openapi.yaml | OpenAPI 3.1.1 HTTP 계약, 29 operation |
| schemas/domain.schema.json | JSON Schema 2020-12 데이터·요청·응답 형식 |
| schemas/extension.schema.json | 확장 메시지 진입 schema. domain schema를 로컬 registry로 참조 |
| schema.sql | 빈 SQLite DB에 적용하는 migration candidate. 17개 테이블 |
| DB_MAPPING.md | 공개 필드와 DB 열의 매핑·삽입 순서·runtime 책임 |
| EXTENSION_PROTOCOL.md | 탭/폼 연결, 메시지, 승인·접수·복구 |
| LINER_ADAPTER.md | 실제 provider 계약과 정규화·오류·비용 처리 |
| examples/ | 유효한 합성 요청·응답 19개, canonical payload와 digest |
| fixtures/synthetic_resume.pdf | 파일 바이트 결속 검증용 가상 PDF. 실제 이력서 아님 |
| tests/ · VALIDATION.md | 로컬 계약 검증과 남은 통합 검증 |

## 검증 실행 - Miniconda

압축을 푼 폴더에서 실행합니다. 아래 명령은 Liner 호출이나 외부 제출을 수행하지 않습니다.

```bash
conda create -n career-contracts python=3.12 -y
conda activate career-contracts
python -m pip install -r requirements-validation.txt
python -m unittest discover -s tests -v
```

SQLite JSON 함수와 foreign key 지원이 필요합니다. 생성 SQL은 모든 연결에서 foreign_keys를 켜는 의무를 대체하지 않습니다. 이 산출물은 Python 3.12.14, SQLite 3.53.1, PyYAML 6.0.3, jsonschema 4.26.0에서 검증했습니다. 정확한 실행 결과는 VALIDATION.md를 확인하세요.

OpenAPI 참조는 상대 경로를 사용하므로 openapi.yaml만 옮기지 말고 schemas 폴더를 함께 유지하세요. schema의 career-evidence.example URL은 식별자이며 실제 네트워크 조회용 주소가 아닙니다. 검증 코드는 로컬 registry로 해결합니다.

## 구현 순서

1. 기존 저장소·API 키·예산을 확인하고 타입·DB 연결·합성 fixture부터 연결합니다.
2. session/context → search task → analysis/facts/assessment를 구현합니다.
3. 저장 근거 재평가와 회사1곳 브리프를 연결합니다.
4. 11/18 핵심 흐름이 완주하면 지원 초안·자체 폼·확장을 추가합니다.
5. 서버의 승인·시도·receipt/reconcile을 구현하고 실제 브라우저/서버 장애 흐름을 검증합니다.

## 인계 시 주의할 경계

- 테스트는 SQL 제약·데이터 형식·예시 일관성을 검증합니다. 실제 handler의 소유권·CSRF·Origin·clock·JCS·worker CAS를 구현한 테스트가 아닙니다.
- 문자열 길이·동의·문항 ID·인용 ID·회사/공고/context 관계는 서버에서 다시 확인해야 합니다.
- 부분 실패를 보류 판정으로, 전송 실패를 미접수 확정으로 바꾸지 않습니다.
- 예시 canonical 직렬화는 ASCII key와 정수만 쓰는 fixture의 제한된 도우미입니다. 범용 JCS 구현으로 복사하지 않습니다.
- 정적 자료·가상 자료·실제 provider 결과의 provenance를 유지합니다.
- 실제 구직자 데이터·기업 제출·상용 배포는 이 묶음의 검증 범위 밖입니다.
