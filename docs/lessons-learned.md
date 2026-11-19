# 학습된 교훈 (Lessons Learned)

이 파일은 **프로젝트 간 영구 누적 지식 베이스**입니다.
같은 실수가 반복되지 않도록 모든 dev 에이전트가 코드 작성 전 의무적으로 참조합니다.

## 운영 규칙

- **자동 승격**: 같은 패턴의 오류가 2회 이상 발생하면 `/harness-core:lessons`가 자동으로 L 엔트리 추가
- **사용자 통보**: 자동 승격 직후 사용자에게 알림 → 잘못된 승격은 "L{N} 취소"로 무효화 가능
- **명시적 등록**: 사용자가 "이건 교훈이야"라고 알려주면 1회 발생이라도 즉시 L 등록
- **30개 한도**: 30개 초과 시 가장 오래되고 위반 0회인 엔트리부터 archive로 이동
- **수정 권한**: `/harness-core:lessons`로만 수정. dev 에이전트는 읽기 전용
- **프로젝트 간 공유**: 여러 프로젝트에 공통인 교훈은 사용자가 `~/.claude/harness-lessons.md`에 옮겨 두면 `/harness-core:init`이 새 프로젝트를 만들 때 시작점으로 복사한다

## 엔트리 형식

```markdown
## L{N} — {짧은 한 줄 제목}

- **승격 시각**: YYYY-MM-DD HH:MM
- **승격 사유**: 동일 패턴이 N회 발생 (E1, E5, E12)
- **관련 파일**: src/path/to/file.py
- **관련 기능 ID**: F1, F3 (해당하면)
- **외부 시스템**: ElevenLabs / ComfyUI / etc. (해당하면)
- **재발 방지 규칙**:
  - 구체적이고 실행 가능한 규칙 1
  - 구체적이고 실행 가능한 규칙 2
- **위반 검사 방법**: code-verifier가 어떻게 이 위반을 잡을지
- **위반 카운트**: 0 (code-verifier가 위반 발견할 때마다 증가)
```

---

# 등록된 교훈

## L1 — LLM이 '그대로 복사'를 어긴다 — 사용자 원문은 서버가 다시 고른다

- **승격 시각**: 2026-11-19 11:30
- **승격 사유**: 사용자 명시 등록("1~4번 다 적용해줘" — 반복 패턴 교훈 등록 승인). 관련 오류 E1
- **관련 파일**: apps/worker/src/tailor-task.ts, packages/liner/src/chat.ts
- **외부 시스템**: Liner Router(claude-sonnet-5.5)
- **재발 방지 규칙**:
  - 사용자 진술을 사실 후보로 만들 때 모델 출력 문장을 그대로 저장하지 않는다. `userSentenceFor`로 사용자 메시지의 원문 문장(겹침 60% 이상)을 골라 저장하고, 못 고르면 제외한다.
  - 원문 일치가 필요한 모든 LLM 출력(인용·근거 quote)은 서버에서 원문과 대조·보정한다.
- **위반 검사 방법**: screenChanges 밖에서 needs_fact_confirmation 후보의 after를 그대로 INSERT하는 코드 검색
- **위반 카운트**: 0

## L2 — LLM은 오늘 날짜를 모른다 — 기간 판단 요청에는 기준일을 넣는다

- **승격 시각**: 2026-11-19 11:30
- **승격 사유**: 사용자 명시 등록("1~4번 다 적용해줘" — 반복 패턴 교훈 등록 승인). 관련 오류 E2
- **관련 파일**: packages/liner/src/review.ts
- **외부 시스템**: Liner Router
- **재발 방지 규칙**:
  - 기간·재직·연차를 판단하게 하는 live 요청 메시지에는 `오늘 날짜(기준일): YYYY-MM-DD`를 넣는다(buildReviewRequest의 today 인자).
  - 테스트로 요청 본문에 기준일이 있는지 확인한다.
- **위반 검사 방법**: packages/liner/src/*.ts의 build*Request에서 기간 관련 지시가 있는데 기준일 문자열이 없는 경우 검색
- **위반 카운트**: 0

## L3 — 저장소 검색에 grep -r을 쓰지 않는다 — rg 또는 .env 제외

- **승격 시각**: 2026-11-19 11:30
- **승격 사유**: 사용자 명시 등록("1~4번 다 적용해줘" — 반복 패턴 교훈 등록 승인). 관련 오류 E3(10회)
- **관련 파일**: (작업 명령)
- **외부 시스템**: —
- **재발 방지 규칙**:
  - 코드·문서 검색은 `rg`(.gitignore를 따름)를 쓴다.
  - grep -r이 꼭 필요하면 `--exclude='.env*'`를 붙인다.
- **위반 검사 방법**: 하네스 감사 로그에서 'grep -r가 시크릿 파일(.env)까지 훑습니다' 사유 건수가 늘지 않는지 확인(audit_report.py)
- **위반 카운트**: 0

## L4 — SQLite CHECK 변경 migration은 '재생성 후 재삽입' 순서로 쓴다

- **승격 시각**: 2026-11-19 11:30
- **승격 사유**: 사용자 명시 등록("1~4번 다 적용해줘" — 반복 패턴 교훈 등록 승인). 관련 오류 E4
- **관련 파일**: contracts/v0.7/migrations/009_docx_intake.sql, 010_resume_review.sql
- **외부 시스템**: SQLite
- **재발 방지 규칙**:
  - `PRAGMA defer_foreign_keys = ON` → 행을 TEMP 표로 복사 → 새 표 CREATE → 옛 표 DROP → RENAME → TEMP에서 INSERT → TEMP DROP → 트리거·색인 재생성 순서를 지킨다.
  - 행을 DROP 전에 새 표로 옮기면 FK 지연 카운터가 남아 COMMIT이 실패한다. 이미 적용한 migration은 고치지 않고 새 번호로 쓴다.
  - 부모 행·자식 행이 있는 DB에서 적용·재열기·foreign_key_check·트리거 동작을 테스트한다.
- **위반 검사 방법**: migrations/*.sql에서 'INSERT INTO <새표> ... SELECT' 가 'DROP TABLE <옛표>' 보다 앞에 오는 패턴 검색
- **위반 카운트**: 0

## L5 — 생성 fixture는 결정적이어야 한다 — 압축 도구의 숨은 시각 값을 고정한다

- **승격 시각**: 2026-11-19 11:30
- **승격 사유**: 사용자 명시 등록("1~4번 다 적용해줘" — 반복 패턴 교훈 등록 승인). 관련 오류 E5
- **관련 파일**: scripts/make-docx-fixture.mjs
- **외부 시스템**: jszip
- **재발 방지 규칙**:
  - jszip으로 fixture를 만들 때 파일마다 date를 고정하고 `createFolders: false`로 폴더 항목(현재 시각)을 만들지 않는다.
  - 생성 스크립트를 두 번 돌려 sha256이 같은지 확인한다.
- **위반 검사 방법**: scripts/*.mjs에서 zip.file( 호출에 createFolders:false·date가 없는 경우 검색
- **위반 카운트**: 0

