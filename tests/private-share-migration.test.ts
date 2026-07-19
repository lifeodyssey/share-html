import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "vitest";

const migration = readFileSync(
  new URL("../supabase/migrations/0003_private_share_access.sql", import.meta.url),
  "utf8"
);

const executableSql = migration
  .replaceAll(/--.*$/gm, "")
  .replaceAll(/\s+/g, " ")
  .trim()
  .toLowerCase();

function requiredMatch(pattern: RegExp, description: string): RegExpMatchArray {
  const match = executableSql.match(pattern);
  assert.ok(match, description);
  return match;
}

describe("private share migration", () => {
  test("allows exactly public-unlisted and private-link visibility modes", () => {
    requiredMatch(
      /add constraint shares_visibility_check check \(visibility in \('public_unlisted', 'private_link'\)\)/,
      "migration must restrict visibility to the two supported modes"
    );
  });

  test("couples visibility to a complete, versioned access-key state", () => {
    requiredMatch(
      /add constraint shares_access_key_consistency_check check \( \( visibility = 'public_unlisted' and access_key_hash is null and access_key_version is null \) or \( visibility = 'private_link' and access_key_hash is not null and access_key_hash ~ '\^\[0-9a-f\]\{64\}\$' and access_key_version is not null and access_key_version = 1 \) \)/,
      "migration must couple each visibility mode to the correct access-key state"
    );
  });

  test("authenticated users cannot update profile roles", () => {
    assert.match(
      executableSql,
      /revoke update on table public\.profiles from authenticated;/,
      "migration must first remove the existing table-wide UPDATE grant"
    );
    assert.match(
      executableSql,
      /grant update \(display_name\) on table public\.profiles to authenticated;/,
      "authenticated profile updates must be limited to display_name"
    );
    assert.doesNotMatch(
      executableSql,
      /grant update \([^)]*\brole\b[^)]*\) on table public\.profiles to authenticated;/,
      "role must never be included in a column-level UPDATE grant"
    );
    assert.doesNotMatch(
      executableSql,
      /grant update on table public\.profiles to authenticated;/,
      "table-wide profile UPDATE must not be re-granted"
    );
  });

  test("authenticated share reads exclude credentials and storage internals", () => {
    assert.match(
      executableSql,
      /revoke select on table public\.shares from authenticated;/,
      "migration must remove the existing table-wide SELECT grant"
    );

    const [, grantedColumns] = requiredMatch(
      /grant select \(([^)]*)\) on table public\.shares to authenticated;/,
      "migration must replace broad SELECT with an explicit safe column list"
    );
    const columns = new Set(grantedColumns.split(",").map((column) => column.trim()));

    for (const publicColumn of ["id", "slug", "owner_user_id", "visibility", "lifecycle_status"]) {
      assert.ok(columns.has(publicColumn), `expected safe column ${publicColumn} to remain selectable`);
    }
    for (const sensitiveColumn of [
      "access_key_hash",
      "access_key_version",
      "claim_token_hash",
      "entry_path",
      "r2_prefix",
      "content_hash",
    ]) {
      assert.equal(
        columns.has(sensitiveColumn),
        false,
        `sensitive column ${sensitiveColumn} must not be granted to authenticated`
      );
    }
    assert.doesNotMatch(
      executableSql,
      /grant select on table public\.shares to authenticated;/,
      "table-wide share SELECT must not be re-granted"
    );
  });
});
