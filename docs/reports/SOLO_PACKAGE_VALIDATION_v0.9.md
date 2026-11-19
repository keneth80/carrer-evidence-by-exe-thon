# 1인 개발 패키지 v0.9 검증 보고서

기준일: **2026-11-17 · 한국 시간**. 사용자 결정은 개발자가 전체 개발을 맡는 것이다. 이번 변경은 운영 지침과 작업 계획이며 제품 기능 구현이 아니다. 제품·API와 runtime 버전은 v0.7/0.7.0을 유지한다.

## 변경 범위

- README·CLAUDE·DECISIONS·현재 상태·코드맵·데모 계획을 1인 책임으로 연결했다.
- `docs/SOLO_DEVELOPMENT.md`, `prompts/solo-start.md`, `docs/solo/TASKBOARD.md`, `docs/solo/tasks.json`을 추가했다.
- 첫 구현을 S01 등록·확정과 S02 검색 연결로 나누고 S03 실제 Liner 연결을 구분했다.
- 협업자 구현 대기·필수 타인 검토를 개발 완료 조건에서 제거했다. 사실 근거·소유권·접수 불명·정책 범위 등 제품 인수 기준은 유지한다.
- 과거 v0.8 팀 PDF·XLSX·원고·JSON·역할별 프롬프트는 `docs/archive/v0.8-team/`에 보존했다.
- 기존 사용자 코드가 있으면 새 패키지로 덮어쓰지 않고 운영 지침부터 병합하도록 안내했다.

## 검증 범위와 한계

현재 자료의 진입 경로·Markdown 상대 링크·작업 ID·선행 관계·초기 상태를 확인한다. 기존 apps/packages/scripts/tests/contracts/fixtures와 package·lockfile·실행 설정의 bytes를 v0.8 사본과 대조한다. 과거 팀 PDF·XLSX도 이동 전후 bytes를 대조한다.

런타임 코드가 바뀌지 않았으므로 npm 전체 검사나 브라우저·실제 provider 검증을 반복하지 않는다. 과거 제품 기반 검사는 [v0.7 기록](VALIDATION.md), 팀 자료 검사는 [v0.8 기록](TEAM_PACKAGE_VALIDATION_v0.8.md)이며 신규 제품 기능의 완료 증거가 아니다.

사용자 PC의 코드·계정·실제 진행 상태는 확인하지 않았다. 이력서 중심 제품 흐름과 실제 기업 지원의 구현·검증은 이후 Claude Code 작업이다. 작업표는 패키지 초기 상태이며 전 작업 미착수, 담당 개발자, 목표일 미정이다.

이번 턴에 첨부된 Career_Evidence_Team_Brief_v0.2.pdf는 이용할 수 없어 새로 읽거나 대조하지 않았다. 현재 제공된 v0.8 통합 자료의 운영 부분을 기준으로 갱신했다.

## 패키지 검증 결과

최종 대조 결과는 아래에 기록한다. ZIP에 node_modules·dist·DB·실제 비밀 값·임시 작업 파일을 포함하지 않으며 전체 파일 hash와 ZIP CRC를 확인한 결과만 제공한다.


| 검사 | 실제 결과 |
| --- | --- |
| `node scripts/check-integration.mjs` | PASS · 필수 진입 32개, Markdown 39개, 상대 링크 18개, v0.4 기준 hash 37개, 합성 입력 2종 |
| 1인 작업표 | PASS · S01~S09 고유 ID, 선행 관계 순환 없음, 진입 파일 존재 |
| 초기 담당·상태 | PASS · 전 작업 개발자 담당, 미착수, 목표일 미정, 타인 필수 검토 없음 |
| 기존 제품 코드·계약 | PASS · apps 22개, packages 8개, scripts 8개, tests 3개, contracts 62개, fixtures 6개 동일 |
| 실행 설정 | PASS · package/lockfile·Node·TypeScript 설정 동일, runtime 0.7.0 |
| 과거 팀 자료 | PASS · PDF·XLSX·원고·JSON·역할 프롬프트 10개 bytes 보존 |
| 실제 사용자 저장소·제품 신규 흐름·외부 지원 | NOT_RUN / NOT_INSPECTED |
