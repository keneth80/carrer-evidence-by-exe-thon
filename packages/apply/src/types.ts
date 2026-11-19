// 지원(S05) 공용 타입. 계약 이름은 contracts/v0.7/schemas/domain.schema.json의 Answer·TargetBinding을 따른다.

export type AnswerSource = 'confirmed_fact' | 'user_answer' | 'policy_answer';
export type Answer = { question_id: string; question_text: string; answer: string; source: AnswerSource; source_ids: string[] };

export type QuestionKind = 'text' | 'email' | 'textarea' | 'checkbox';
export type FormQuestion = { question_id: string; label: string; kind: QuestionKind; required: boolean; max_length: number };

// 확장이 실제 페이지에서 관측한 폼 구조. 값은 포함하지 않는다(값은 readback).
export type FormSnapshot = {
  site_id: string;
  adapter_version: string;
  posting: { posting_id: string; company_name: string; title: string };
  questions: FormQuestion[];
  file: { field: string; accept: string; required: boolean } | null;
};

// 입력·첨부 뒤 페이지에서 다시 읽은 값. file.sha256은 페이지의 file input에 실제로 들어간 bytes의 hash다.
export type Readback = {
  answers: { question_id: string; value: string }[];
  file: { name: string; size: number; type: string; sha256: string } | null;
};

export type Issue = { code: string; message: string };

export type TargetBinding = {
  executor: 'chrome' | 'ego'; site_id: string; adapter_version: string;
  account_binding_id: string; target_url: string; form_snapshot_hash: string;
};
