# 통합 개발 패키지 v0.7 검증 보고서

이 문서는 v0.7 개발 기반을 만들 때 실행한 검사의 보존 기록이다. v0.8 팀 자료를 추가하면서 제품 기능을 새로 구현하거나 아래 실행 검사를 모두 반복한 것은 아니다. 이번 문서·업무표·패키지 검증은 [팀 자료 v0.8 검증 보고서](TEAM_PACKAGE_VALIDATION_v0.8.md)를 참조한다.

기준일: 2026-11-16 (Asia/Seoul). 환경: Linux, Node v24.22.1, npm 11.9.0, Python 3.12.14. 이 보고서는 **이번 패키지에서 실제 실행한 검사**를 기록한다. 제품 사용자 흐름 구현 완료와 구분한다.

## 1. 검사 결과

| 검사 | 결과 | 확인 범위 |
| --- | --- | --- |
| `npm ci --no-audit --no-fund` | PASS | 현재 lockfile로 35개 패키지 설치 |
| `npm run doctor` | PASS | Node·의존성·현재 진입 문서·mock 설정. Claude CLI 로그인은 검증하지 않음 |
| `npm test` | PASS 26 | 기존 도메인·mock Liner·DB 초기화·확장 guard 회귀 |
| `npm run build` | PASS | TypeScript 검사 포함, React 웹 bundle과 확장 파일 빌드 |
| `npm run db:check` | PASS | v0.4 제품 테이블 17개, metadata 1개, FK. memory DB 사용 |
| `npm run smoke:http` | PASS 6 요청 | 실제 로컬 HTTP health/preview/입력 오류/미구현 501/origin 거절 |
| `npm run check:contracts` | PASS | v0.4 61개 + v0.7 38개 테스트, 생성 mock 객체 9개, baseline hash |
| `npm run check:integration` | PASS | 필수 진입 32개·현재 Markdown 34개·상대 링크 13개·v0.4 hash 37개·이력서 입력 2종 |
| 합성 이력서 PDF 2개 | PASS | 각 1페이지, 한국어 텍스트 추출·역할 신호·누락 glyph 검사, 렌더 PNG 시각 확인 |
| 패키지 무결성 | PASS | 172개 파일·SHA-256 전체 대조·ZIP CRC. 의존성·빌드 결과·DB·키 제외 |

Python 검사는 이 작성 환경에서 실행했다. 사용자 환경을 위한 Miniconda 재현 명령은 루트 README와 contracts/v0.7/README에 있다. npm의 환경 경고는 빌드나 검사의 실패로 이어지지 않았다. API 키와 실제 사용자 자료는 사용하지 않았다.

## 2. 이번 통합에서 바꾼 것

제품·화면·아키텍처·브라우저 연결·개발 순서·Claude Code 프롬프트를 원본 이력서에서 시작하는 v0.7 흐름으로 통합했다. 현재 기준과 과거 참고 자료를 분리했다. 과거 CLAUDE 사본은 중첩 지침으로 자동 발견되지 않도록 참고용 파일명으로 보관한다.

기반 코드 변경은 버전 표시, health의 현재/목표 계약·미구현 기능 상태, 첫 과업 안내, worker 진입 안내, 통합 검사 명령 연결이다. v0.4 계약 bytes와 기존 동작의 회귀 기준을 유지했다. 새 DB SQL은 격리 검사에서만 사용하고 실제 파일 DB에는 적용하지 않았다.

새 v0.7 계약은 JSON Schema 정의 60개·API 작업 48개·추가 테이블 29개·트리거 34개로 원본·확정 경력·검색·대화 수정·실제 파일·지원 권한·접수 상태·정책·캠페인을 정의한다. 최종 계약을 고정한 뒤 신규 38개 검사를 다시 실행해 모두 통과했다. 다른 공고에 같은 PDF를 새 정책 권한으로 사용하는 정상 경로와, 접수 불명 건의 공고 키 변경을 통한 중복 방지 우회를 막는 회귀가 포함된다. 형식과 DB 제약의 검증이며 handler나 브라우저 구현의 검증이 아니다. 세부 범위는 [계약 검증](../../contracts/v0.7/VALIDATION.md)을 따른다.

## 3. 실제 제품 기능의 현재 상태

| 항목 | 상태 |
| --- | --- |
| 이력서 업로드·추출·확정 경력·이력서 기반 제품 검색 | NOT_IMPLEMENTED / 인수 시나리오 NOT_RUN |
| 대화형 실제 문서 편집·제출 PDF 렌더러 | NOT_IMPLEMENTED / NOT_RUN |
| 영속 제품 worker·실제 Liner adapter | NOT_IMPLEMENTED / NOT_RUN |
| Chrome 실제 로드·입력·첨부·제출 | NOT_RUN. 현재 코드는 폼 표식 진단 골격 |
| Ego 설치·로컬 연결·제출 | NOT_RUN |
| 실제 채용사이트 접수·정책 자동 지원 | NOT_RUN |
| 사용자 DB migration·운영 인증·배포 | NOT_RUN |
| Claude Code에서 첫 개발 프롬프트 실행 | NOT_RUN_HERE |

현재 제품 API `/api/v1/*`는 501을 반환하며 worker/live/apply 설정은 미구현 상태를 알린다. 합성 preview와 계약 테스트를 완성 제품으로 표시하지 않는다. 실제 사용자 흐름은 [인수 기준](../ACCEPTANCE.md)에 따라 단계별로 구현하고 확인한다.

## 4. 재현과 다음 작업

루트 README의 설치 후 `npm test`, `npm run build`, `npm run db:check`, `npm run smoke:http`, `npm run check:contracts`, `npm run check:integration`을 실행할 수 있다. `npm run check`는 이 검사들을 묶는 명령이다. 실패 원인을 숨기는 자동 성공 fallback은 없다.

다음 구현은 `prompts/00-start.md`와 `prompts/01-resume-search.md`의 이력서 등록→내용 확인→SearchIntent→영속 mock 검색→공고 노출이다. `fixtures/resumes/` 파일을 실제 업로드 경로에 넣어 검증한다. fixture의 PDF 추출 가능성 확인은 제품 파서 구현을 대신하지 않는다.
