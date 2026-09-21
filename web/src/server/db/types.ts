export type RunStage = "idea" | "research" | "hooks" | "draft" | "style" | "revision" | "ready";
export type RunStatus = "queued" | "running" | "waiting_for_user" | "failed" | "complete";

export interface CreationRun {
  id: string;
  owner_id: string;
  kind: "post" | "revision";
  mode: "quick" | "guided";
  entry: "topic" | "find" | "surprise" | "revision";
  topic: string;
  direction: string;
  idea_id: string | null;
  draft_id: string | null;
  selected_idea: unknown;
  selected_hook: unknown;
  stage: RunStage;
  status: RunStatus;
  stages: Record<string, unknown>;
  prompt_version: string;
  model: string;
  research_model: string | null;
  writing_model: string | null;
  ai_settings_revision: number | null;
  error_code: string | null;
  error_message: string | null;
  attempts: number;
  lease_owner: string | null;
  lease_until: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface UserAiSettingsRow {
  owner_id: string;
  provider: "anthropic";
  api_key_encrypted: string;
  key_suffix: string;
  research_model: string;
  writing_model: string;
  status: "valid" | "invalid" | "unchecked";
  revision: number;
  validated_at: Date | null;
  created_at: Date;
  updated_at: Date;
}
