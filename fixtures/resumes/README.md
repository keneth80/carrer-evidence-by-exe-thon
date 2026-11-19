# 합성 이력서 입력 자료

두 PDF와 같은 내용의 텍스트를 제공한다. 모두 가상 인물·회사이며 실제 사용자 이력서가 아니다. 프론트엔드와 백엔드 경력에서 서로 다른 검색 계획이 생기는지 확인하기 위한 입력이다.

1. `frontend.synthetic.pdf` 또는 `backend.synthetic.pdf`를 실제 업로드 API로 전달한다.
2. 문서 추출 결과를 화면에서 확인·정정·확정한다. fixture ID로 완성된 프로필을 바로 선택하지 않는다.
3. 확인된 경력에서 SearchIntent가 생성되는지 확인한다. `expected.json`은 검색 결과의 정답 문자열이 아니라 역할·기술·연락처 제외·사실 추가 금지의 기대값이다.
4. 부정문에 등장하는 기술을 보유 기술로 추출하지 않는다. 희망 조건은 이력서와 별도로 입력한다.
5. PDF 추출 실패 시 같은 내용의 `.txt`를 붙여넣는 복구 경로를 확인한다. 실패를 정상 추출로 기록하지 않는다.

PDF는 1페이지이며 한국어 텍스트를 추출할 수 있도록 생성했다. 생성 당시의 추출·시각 검사는 통합 검증 보고서에 기록한다. 제품 파서의 실제 구현·실행 검증은 별도다. 파일 hash는 `expected.json`과 전체 패키지 manifest에 기록한다.

## Word(.docx) 합성 입력 (2026-11-19, DECISIONS S1-12)

`frontend.synthetic.docx`는 `frontend.synthetic.txt`와 같은 내용이다('사용 기술'은 표, 머리글은 본문이 아니라 추출되지 않아야 함). `node scripts/make-docx-fixture.mjs`로 같은 bytes를 다시 만든다. hash는 `docx.synthetic.json`에 둔다. `expected.json`은 동결 정답 자료라 바꾸지 않았다.
