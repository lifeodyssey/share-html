export type LifecycleStatus =
  | "uploading"
  | "scanning"
  | "active"
  | "needs_review"
  | "blocked"
  | "deleted"
  | "failed";

export type ModerationStatus = "pending" | "clean" | "suspicious" | "blocked";

export type RiskReason = {
  code: string;
  weight: number;
  detail: string;
};

export type ShareRecord = {
  id: string;
  slug: string;
  owner_user_id: string | null;
  share_type: "single_html" | "static_site";
  title: string | null;
  description: string | null;
  entry_path: string;
  r2_prefix: string;
  size_bytes: number;
  content_hash: string;
  visibility: "public_unlisted";
  lifecycle_status: LifecycleStatus;
  moderation_status: ModerationStatus;
  risk_score: number;
  risk_reasons: RiskReason[];
  claim_token_hash: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type PublicShare = {
  id: string;
  slug: string;
  title: string | null;
  lifecycle_status: LifecycleStatus;
  moderation_status: ModerationStatus;
  risk_score: number;
  risk_reasons: RiskReason[];
  share_url: string;
  preview_url: string;
  expires_at: string | null;
  created_at: string;
  size_bytes: number;
  owner_user_id: string | null;
};
