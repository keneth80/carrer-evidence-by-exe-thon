# Chrome 확장 기초 버전

기준일: 2026-11-15. 이 폴더는 **로드 가능한 형태의 Manifest V3 기초 코드**다. 자체 폼의 존재 여부를 읽는 진단 동작만 포함한다. 실제 Chrome에 로드하여 실행하는 검증은 아직 수행하지 않았다.

## 포함한 동작

- 확장 아이콘으로 사이드패널을 연다.
- 패널에서 요청하면 정확히 `http://127.0.0.1:4310/demo/apply`인 현재 탭의 최상위 frame만 검사한다.
- 고정 selector `form[data-ce-demo="career-evidence-demo-v1"][data-ce-schema="demo-form.v1"]`가 정확히 하나인지 확인한다.
- 표식 개수와 document 식별자만 읽는다. 답변·파일·쿠키·토큰을 읽거나 API를 호출하지 않는다.
- URL·sender·요청 필드를 검사한다. 메시지로 URL, selector, script를 받지 않는다.

`CE_STARTER_INSPECT`는 개발용 진단 메시지다. 계약 v0.4의 HELLO가 아니며 서버 form session·application·승인을 만들지 않는다. 폼 표식은 신뢰 또는 사용자 승인 증거가 아니다. 진단 결과는 검사 시점의 관측이며 계속 유지되는 연결 권한이 아니다.

## 로컬에서 확인

1. 프로젝트 루트에서 `npm run dev`를 실행하고 위 테스트 주소를 연다.
2. Chrome의 `chrome://extensions`에서 개발자 모드를 켠다.
3. 압축해제된 확장 프로그램 로드를 선택하고 `apps/extension` 폴더를 지정한다. 별도 npm 설치나 build가 필요하지 않다.
4. 테스트 탭에서 Career Evidence 확장 아이콘을 클릭한다. 이 사용자 동작이 activeTab 접근의 시작점이다.
5. 현재 테스트 폼 확인을 누른다. 주소·폼 표식이 일치하면 검사 시각이 표시된다.
6. 다른 origin, 다른 경로, 쿼리 또는 fragment가 있는 URL에서는 거절되는지 확인한다. `localhost`와 `127.0.0.1`은 이 설정에서 서로 다른 대상이다.

확장 패널만 따로 열거나 다른 탭으로 이동한 뒤에는 activeTab 권한이 없을 수 있다. 대상 탭에서 확장 아이콘을 다시 클릭한다. 허용 주소를 바꿀 때는 서버·웹·`guard.mjs`의 값을 함께 바꾸고 다시 검증한다. 메시지로 동적 허용 주소를 추가하지 않는다.

## 권한과 파일

| 파일 | 역할 |
| --- | --- |
| manifest.json | activeTab·scripting·sidePanel 세 권한과 module service worker |
| guard.mjs | 고정 대상·사이드패널 sender·닫힌 진단 요청 검사 |
| service-worker.js | 진단 요청 처리와 top-frame 읽기. 상태 저장·재시도 없음 |
| sidepanel.html / .css / .js | 한국어 안내·버튼·관측 결과. 탭 변경 시 관측을 초기화 |
| guard.test.mjs | 허용 대상과 sender, 임의 operation·필드 거절 단위 검증 |

현재 사용하지 않는 storage 권한, host_permissions, externally_connectable, content script 상시 주입은 없다. 이후 복구 포인터를 구현할 때 v0.4에 따라 storage 권한과 접근 수준을 검토한다. 확장 worker 메모리에 접수 상태의 권위를 두지 않는다.

## 다음 구현 단계

핵심 검색→비교→근거 흐름 완료 후 `contracts/v0.4/EXTENSION_PROTOCOL.md`와 메시지 schema를 따른다.

1. 정확한 application·form session·tab·document의 연결과 고정 page bridge.
2. 고정 필드 입력과 사용자 입력 덮어쓰기 확인, 실제 값 readback.
3. 서버에 등록된 합성 PDF 바이트 첨부와 실제 bytes hash 대조.
4. 사용자 최종 확인, 초안 revision·전체 payload·동의 버전에 결속한 approval.
5. prepared attempt, 실제 multipart 제출, 서버 receipt 확인.
6. 응답 유실 시 GET 복구와 명시적 reconcile. 자동 재제출 금지.

이후 쓰기 동작에서는 매번 현재 활성 탭을 다시 선택하지 않는다. 연결 시 고정한 tab_id·document_id를 사용하고 페이지 변경 시 다시 연결한다. 입력·첨부·승인·제출은 이번 기초 버전에 구현되지 않았다.

## 검증 범위

`node --test apps/extension/guard.test.mjs`는 순수 guard 로직을 확인한다. 실제 Chrome의 권한 부여, worker 종료, 탭·document 교체, 사이드패널 표시, File/DataTransfer, 한글 입력, 서버 접수는 별도 통합 검증 대상이다. 브라우저 통합 결과는 **NOT_RUN**으로 유지한다.

공식 문서 확인: [Side Panel API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel), [activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab), [Scripting API](https://developer.chrome.com/docs/extensions/reference/api/scripting). 이 확장에서는 호환성을 위해 chrome.* 이름을 사용한다.
