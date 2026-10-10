import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(join(process.cwd(), "supabase/migrations/20261010120000_user_storage.sql"), "utf8");

describe("Supabase storage schema", () => {
  it("stores one profile and preference set per authenticated user", () => {
    expect(migration).toContain("create table if not exists public.profiles");
    expect(migration).toContain("user_id uuid primary key references auth.users(id)");
    expect(migration).toContain("create table if not exists public.preferences");
    expect(migration).toContain("schema_version integer not null default 1");
  });

  it("prevents duplicate migrated history rows per user", () => {
    expect(migration).toContain("create table if not exists public.analysis_history");
    expect(migration).toContain("primary key (user_id, id)");
    expect(migration).toContain("analysis_history_user_analyzed_at_idx");
  });

  it("enforces owner-only RLS for each shopping table", () => {
    for (const table of ["profiles", "preferences", "analysis_history"]) {
      expect(migration).toContain(`alter table public.${table} enable row level security`);
      expect(migration).toContain("to authenticated");
      expect(migration).toContain("using ((select auth.uid()) = user_id)");
      expect(migration).toContain("with check ((select auth.uid()) = user_id)");
    }
  });
});
