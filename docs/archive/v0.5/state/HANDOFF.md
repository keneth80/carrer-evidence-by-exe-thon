# 다음 작업 인계

## 현재 위치

Claude Code 전용 v0.5 starter foundation이 준비되었다. 기본 화면은 저장 기능 없는 합성 preview다. 서버 `/api/v1/*`는 501이며 worker와 live 어댑터는 미구현 오류로 종료한다. 기준 제품 계약은 `contracts/v0.4/`다.

## 다음 한 작업

**세션 → context → mock 검색 task 저장 → persistent worker 처리 → 저장 결과 조회**를 첫 제품 흐름으로 구현한다. `prompts/00-start.md`의 범위를 실행한다. 시작할 때 기존 코드가 이미 이를 구현했다면 중복 생성하지 말고 현재 상태와 다음 결함을 확인한다.

## 우선 읽을 파일

CLAUDE.md → README.md → docs/CODEMAP.md → prompts/00-start.md → 필요한 01/02 프롬프트와 v0.4 계약.

## 재현 명령

```bash
npm ci
npm run doctor
npm test
npm run db:check
npm run build
npm run dev
```

계약 테스트는 README의 Miniconda 환경을 준비한 뒤 `npm run check:contracts`로 실행한다. `npm run worker`는 현재 exit 1이 정상적인 미구현 표시이며, worker를 구현한 뒤 이 설명과 상태를 함께 갱신한다.

## 보존할 것

- contracts/v0.4 원본·해시·합성 PDF와 기존 61 테스트.
- source/fact/evaluation 분리, revision 고정, mock provenance.
- DB 객체 변경 감지와 기존 DB 자동 reset 금지.
- 정해진 127.0.0.1 origin 및 자체 테스트 폼 범위.

## 다음 구현에서 확인할 것

세션 A/B 소유권, context revision 경쟁, 같은 idempotency key 재호출, task 저장 후 재시작, lease 만료와 이전 worker 결과 거절, mock 네트워크 0회, 저장 후보를 통한 새로고침 복구를 검증한다. 실제 키·사용자 이력서·기업 제출·배포 없이 이 단계는 완료할 수 있다.

## 이후 인계 템플릿

작업 종료 시 이 파일의 다음 한 작업을 갱신하고 아래 항목을 추가한다.

- 완료한 사용자 흐름과 변경 파일
- 실행한 검증 명령·결과
- 남은 결함·NOT_RUN 항목
- 다음 한 작업과 완료 기준
- 관련 결정 기록 ID

