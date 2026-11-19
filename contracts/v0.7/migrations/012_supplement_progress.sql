-- Career Evidence v0.7.5 migration: 보완 대화 단계별 진행 기록 (DECISIONS S1-17).
-- 007~011 are never edited. No BEGIN/COMMIT here: the runner owns the transaction.
-- 열 하나만 더한다(표 재생성 없음). 기존 세션 행은 NULL로 남고, worker가 단계 경계마다 이 턴의 진행 상태를 덮어쓴다.
-- 진행 기록은 화면 표시용이며 경력 사실이 아니다. 끝난 턴의 단계 요약은 assistant 메시지 result_json에 따로 남는다.
ALTER TABLE ce8_supplement_sessions ADD COLUMN progress_json TEXT CHECK(progress_json IS NULL OR json_valid(progress_json));
