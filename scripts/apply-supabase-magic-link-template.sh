#!/usr/bin/env bash
set -euo pipefail

PROJECT_REF="${PROJECT_REF:-hihvtuyweqxnsmqmegdt}"
TEMPLATE_PATH="${TEMPLATE_PATH:-supabase/email-templates/magic-link.html}"
SUBJECT_PATH="${SUBJECT_PATH:-supabase/email-templates/magic-link.subject.txt}"

if [[ -z "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
  echo "Missing SUPABASE_ACCESS_TOKEN." >&2
  echo "Create one at https://supabase.com/dashboard/account/tokens and rerun:" >&2
  echo "SUPABASE_ACCESS_TOKEN=sbp_... $0" >&2
  exit 1
fi

if [[ ! -f "$TEMPLATE_PATH" ]]; then
  echo "Template not found: $TEMPLATE_PATH" >&2
  exit 1
fi

if [[ ! -f "$SUBJECT_PATH" ]]; then
  echo "Subject file not found: $SUBJECT_PATH" >&2
  exit 1
fi

subject="$(tr -d '\r' < "$SUBJECT_PATH" | sed -n '1p')"
payload="$(jq -n \
  --arg subject "$subject" \
  --rawfile content "$TEMPLATE_PATH" \
  '{
    mailer_subjects_magic_link: $subject,
    mailer_templates_magic_link_content: $content
  }')"

curl --fail-with-body -sS \
  -X PATCH "https://api.supabase.com/v1/projects/${PROJECT_REF}/config/auth" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "$payload" \
  | jq 'to_entries | map(select(.key | test("^mailer_(subjects|templates)_magic_link"))) | from_entries'
