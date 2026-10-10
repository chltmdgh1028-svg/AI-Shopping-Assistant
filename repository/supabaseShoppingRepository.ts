"use client";

import type { Session, User } from "@supabase/supabase-js";
import { STORAGE_SCHEMA_VERSION } from "@/domain/preferenceMigration";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { getSupabaseBrowserEnv } from "@/lib/supabase/env";
import { localShoppingRepository, readJson, schemaKey, writeJson } from "@/repository/localShoppingRepository";
import type { AnalysisResult, UserPreference, UserProfile } from "@/types/shopping";

const migrationKey = (userId: string) => `shopping-assistant:supabase-migrated:${userId}`;
const maxHistory = 12;
const kakaoProfileScope = "profile_nickname profile_image";

export type CloudIdentity = {
  userId: string;
  isAnonymous: boolean;
  displayName?: string;
  avatarUrl?: string;
  provider?: string;
};

export type CloudState = {
  available: boolean;
  loading: boolean;
  online: boolean;
  migrated: boolean;
  identity: CloudIdentity | null;
  error?: string;
};

export type RemoteShoppingSnapshot = {
  profile: UserProfile | null;
  preferences: UserPreference[] | null;
  history: AnalysisResult[];
};

export const emptyCloudState: CloudState = {
  available: Boolean(getSupabaseBrowserEnv()),
  loading: true,
  online: false,
  migrated: false,
  identity: null,
};

export function getLocalSnapshot(): RemoteShoppingSnapshot {
  return {
    profile: localShoppingRepository.getProfile(),
    preferences: localShoppingRepository.getPreferences(),
    history: localShoppingRepository.getHistory(),
  };
}

export function cacheSnapshot(snapshot: RemoteShoppingSnapshot) {
  if (snapshot.profile) localShoppingRepository.saveProfile(snapshot.profile);
  if (snapshot.preferences) localShoppingRepository.savePreferences(snapshot.preferences);
  localShoppingRepository.setHistory(snapshot.history.slice(0, maxHistory));
}

export async function ensureSupabaseSession() {
  const supabase = createSupabaseBrowserClient();
  if (!supabase) return null;

  const current = await supabase.auth.getSession();
  if (current.error) throw current.error;
  if (current.data.session) return current.data.session;

  const signedIn = await supabase.auth.signInAnonymously();
  if (signedIn.error) throw signedIn.error;
  return signedIn.data.session;
}

export async function getCloudIdentity(session?: Session | null): Promise<CloudIdentity | null> {
  const supabase = createSupabaseBrowserClient();
  if (!supabase) return null;
  const active = session ?? (await supabase.auth.getSession()).data.session;
  const user = active?.user;
  if (!user) return null;
  return identityFromUser(user);
}

export async function loadRemoteSnapshot(): Promise<RemoteShoppingSnapshot> {
  const supabase = createSupabaseBrowserClient();
  if (!supabase) return getLocalSnapshot();

  const [{ data: profileRow, error: profileError }, { data: preferenceRow, error: preferenceError }, { data: historyRows, error: historyError }] = await Promise.all([
    supabase.from("profiles").select("profile").maybeSingle(),
    supabase.from("preferences").select("preferences").maybeSingle(),
    supabase.from("analysis_history").select("result").order("analyzed_at", { ascending: false }).limit(maxHistory),
  ]);

  if (profileError) throw profileError;
  if (preferenceError) throw preferenceError;
  if (historyError) throw historyError;

  return {
    profile: profileRow?.profile ?? null,
    preferences: preferenceRow?.preferences ?? null,
    history: historyRows?.map((row) => row.result) ?? [],
  };
}

export async function migrateLocalSnapshotIfNeeded(userId: string, remote: RemoteShoppingSnapshot) {
  const alreadyMigrated = readJson<boolean>(migrationKey(userId), false);
  if (alreadyMigrated) return false;

  const local = getLocalSnapshot();
  await saveRemoteSnapshot({
    profile: remote.profile ?? local.profile,
    preferences: remote.preferences ?? local.preferences,
    history: mergeHistory(remote.history, local.history),
  });
  writeJson(migrationKey(userId), true);
  return true;
}

export async function saveRemoteProfile(profile: UserProfile) {
  const supabase = createSupabaseBrowserClient();
  if (!supabase) return;
  const userId = await requireUserId();
  const { error } = await supabase.from("profiles").upsert({ user_id: userId, profile }, { onConflict: "user_id" });
  if (error) throw error;
}

export async function saveRemotePreferences(preferences: UserPreference[]) {
  const supabase = createSupabaseBrowserClient();
  if (!supabase) return;
  const userId = await requireUserId();
  const { error } = await supabase.from("preferences").upsert(
    {
      user_id: userId,
      preferences,
      schema_version: readJson<number>(schemaKey, STORAGE_SCHEMA_VERSION),
    },
    { onConflict: "user_id" },
  );
  if (error) throw error;
}

export async function saveRemoteAnalysis(result: AnalysisResult) {
  const supabase = createSupabaseBrowserClient();
  if (!supabase) return;
  const userId = await requireUserId();
  const { error } = await supabase.from("analysis_history").upsert(
    {
      user_id: userId,
      id: result.id,
      result,
      analyzed_at: result.analyzedAt,
    },
    { onConflict: "user_id,id" },
  );
  if (error) throw error;
}

export async function deleteRemoteAnalysis(id: string) {
  const supabase = createSupabaseBrowserClient();
  if (!supabase) return;
  const { error } = await supabase.from("analysis_history").delete().eq("id", id);
  if (error) throw error;
}

export async function saveRemoteSnapshot(snapshot: RemoteShoppingSnapshot) {
  await ensureSupabaseSession();
  const tasks: Array<Promise<void>> = [];
  if (snapshot.profile) tasks.push(saveRemoteProfile(snapshot.profile));
  if (snapshot.preferences?.length) tasks.push(saveRemotePreferences(snapshot.preferences));
  tasks.push(...snapshot.history.slice(0, maxHistory).map((item) => saveRemoteAnalysis(item)));
  await Promise.all(tasks);
}

export async function linkKakaoIdentity() {
  const supabase = createSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured.");
  await ensureSupabaseSession();
  const { error } = await supabase.auth.linkIdentity({
    provider: "kakao",
    options: { redirectTo: `${window.location.origin}/auth/callback`, scopes: kakaoProfileScope },
  });
  if (error) throw error;
}

export async function signInWithKakao() {
  const supabase = createSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured.");
  await supabase.auth.signOut({ scope: "local" });
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "kakao",
    options: { redirectTo: `${window.location.origin}/auth/callback`, scopes: kakaoProfileScope },
  });
  if (error) throw error;
}

export function subscribeToAuthChanges(onChange: (identity: CloudIdentity | null) => void) {
  const supabase = createSupabaseBrowserClient();
  if (!supabase) return () => undefined;
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    onChange(session?.user ? identityFromUser(session.user) : null);
  });
  return () => data.subscription.unsubscribe();
}

async function requireUserId() {
  const session = await ensureSupabaseSession();
  const userId = session?.user.id;
  if (!userId) throw new Error("Supabase session is not available.");
  return userId;
}

function identityFromUser(user: User): CloudIdentity {
  const metadata = user.user_metadata ?? {};
  const identities = user.identities ?? [];
  const provider = identities.find((identity) => identity.provider !== "anonymous")?.provider;
  return {
    userId: user.id,
    isAnonymous: Boolean(user.is_anonymous),
    displayName: stringMetadata(metadata.name) ?? stringMetadata(metadata.full_name) ?? stringMetadata(metadata.nickname) ?? stringMetadata(metadata.preferred_username),
    avatarUrl: stringMetadata(metadata.avatar_url) ?? stringMetadata(metadata.picture),
    provider,
  };
}

function stringMetadata(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function mergeHistory(remote: AnalysisResult[], local: AnalysisResult[]) {
  const byId = new Map<string, AnalysisResult>();
  for (const item of [...local, ...remote]) byId.set(item.id, item);
  return [...byId.values()]
    .sort((a, b) => new Date(b.analyzedAt).getTime() - new Date(a.analyzedAt).getTime())
    .slice(0, maxHistory);
}
