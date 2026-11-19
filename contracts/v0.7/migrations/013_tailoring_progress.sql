-- Career Evidence v0.7.6 migration: 공고(JD) 맞춤 대화 단계별 진행 기록과 턴 결과 (DECISIONS S1-18).
-- 007~012 are never edited. No BEGIN/COMMIT here: the runner owns the transaction.
-- 열만 더한다(표 재생성 없음). 기존 세션·메시지 행은 NULL로 남는다.
-- progress_json: worker가 단계 경계마다 이 세션의 최근 턴 진행 상태를 덮어쓴다(화면 표시용, 경력 사실 아님).
-- result_json: assistant 메시지의 턴 결과(요구사항 점검표·AI 점검 질문·단계 요약·뺀 수정안과 이유). 사용자 메시지는 NULL.
ALTER TABLE ce7_tailoring_sessions ADD COLUMN progress_json TEXT CHECK(progress_json IS NULL OR json_valid(progress_json));
ALTER TABLE ce7_messages ADD COLUMN result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json));
