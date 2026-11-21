-- Career Evidence v0.7.9 migration: 공고 맞춤 세션에 사용자가 붙여넣은 공고 본문 (DECISIONS S1-28).
-- 007~013 are never edited. No BEGIN/COMMIT here: the runner owns the transaction.
-- 열만 더한다(표 재생성 없음). 기존 세션 행은 NULL로 남는다.
-- job_text: 실시간 검색 공고는 요약(약 100자)만 저장된다. 사용자가 채용 사이트에서 복사해 붙여넣은 본문을 세션에 둔다.
-- 공고 스냅샷(ce7_job_snapshots, 검색 시점 관측 기록)은 바꾸지 않는다. 본문은 자료이며 경력 사실·지시가 아니다.
ALTER TABLE ce7_tailoring_sessions ADD COLUMN job_text TEXT CHECK(job_text IS NULL OR length(job_text) BETWEEN 1 AND 20000);
