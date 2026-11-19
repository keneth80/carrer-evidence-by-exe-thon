# 공식 참고 자료와 확인 범위

확인일: 2026-11-16 (Asia/Seoul). 구현 시 설치 버전·계정·최신 문서를 다시 확인한다. 이 문서의 열람은 실제 API 호출·비용·브라우저 동작·채용사이트 접수를 검증한 기록이 아니다.

| 자료 | URL | 이번 통합 설계에 반영한 범위 |
| --- | --- | --- |
| Liner Search API | https://liner.com/developers/docs/search-api | 구조화 웹 검색 결과와 출처를 검색 계층으로 사용 |
| Liner Search Agent | https://liner.com/developers/docs/search-agent-api | 답변·출처 SSE, 선택 공고의 근거 수집 |
| Liner Deep Research | https://liner.com/developers/docs/deep-research-agent-api | 심층 기업 조사는 선택 기능 |
| Claude Code memory | https://code.claude.com/docs/en/memory | 프로젝트 CLAUDE.md와 필요한 문서의 선택 로드 |
| Claude Code best practices | https://code.claude.com/docs/en/best-practices | 간결한 지침, 검증 가능한 작업, 문맥 관리 |
| Claude Code CLI reference | https://code.claude.com/docs/en/cli-reference | `claude`, `claude -c`로 시작·재개 |
| Chrome activeTab | https://developer.chrome.com/docs/extensions/develop/concepts/activeTab | 사용자 동작에 따른 현재 탭의 일시 권한 |
| Chrome scripting | https://developer.chrome.com/docs/extensions/reference/api/scripting | script 실행에 필요한 권한과 탭·frame 대상 |
| Chrome sidePanel | https://developer.chrome.com/docs/extensions/reference/api/sidePanel | 확장 사이드패널 UI |
| Ego runtime | https://www.egolite.app/document/en/docs/ego-browser | 설치 가이드 기준 API 선택, 파일 첨부, 결과 확인 |
| Ego custom harness | https://www.egolite.app/document/en/docs/custom-agent-harness | 사용자 PC 실행과 원격 실행의 host bridge 구분 |

검색 결과 수·자동 지원 한도·문서 버전·서버 상태 머신·예산 예약은 Career Evidence의 설계 결정이다. provider의 현재 가격이나 보장으로 해석하지 않는다. 과거 계약에 남아 있는 비용 예시는 그 문서의 날짜 기준이다. 현재 가격 검증 없이 운영 예산 계산에 그대로 사용하지 않는다.

채용시장의 규모·경쟁 서비스·합격 확률은 이번 통합 자료에서 새로 조사하지 않았다. 공고 적합도는 근거에 따른 지원 판단 보조 정보이며 합격 확률이나 채용 성과 보장이 아니다.

## 1인 Claude Code 운영 추가 확인 — 2026-11-17

- 프로젝트 지침 파일: https://code.claude.com/docs/en/memory
- 프로젝트 폴더에서 시작·이어가기·작은 변경 검증: https://code.claude.com/docs/en/common-workflows

한 명의 개발자가 세션 하나로 진행한다는 결정은 이 프로젝트의 운영 제안이다. 병렬 실행이 사용량·시간을 줄인다는 공식 보장으로 해석하지 않는다.
