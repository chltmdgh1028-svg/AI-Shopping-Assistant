"use client";

import type { Session, User } from "@supabase/supabase-js";
import { STORAGE_SCHEMA_VERSION } from "@/domain/preferenceMigration";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { getSupabaseBrowserEnv } from "@/lib/supabase/env";
import { archiveShoppingCache, cacheOwnerKey, clearShoppingCache, localShoppingRepository, readJson, schemaKey, writeJson } from "@/repository/localShoppingRepository";
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
  linkedProviders: string[];
  isLinked: boolean;
};

export type CloudState = {
  available: boolean;
  loading: boolean;
  online: boolean;
  migrated: boolean;
  identity: CloudIdentity | null;
  error?: string;
};

export type AuthFlowDiagnostics = {
  message?: string;
  code?: string;
  status?: number;
  name?: string;
  hasSession: boolean;
  userId?: string;
  isAnonymous?: boolean;
  providers: string[];
  currentProvider?: string;
};

export class AuthFlowError extends Error {
  diagnostics: AuthFlowDiagnostics;

  constructor(message: string, diagnostics: AuthFlowDiagnostics) {
    super(message);
    this.name = "AuthFlowError";
    this.diagnostics = diagnostics;
  }
}

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

export function cacheSnapshot(snapshot: RemoteShoppingSnapshot, ownerId?: string) {
  if (snapshot.profile) localShoppingRepository.saveProfile(snapshot.profile);
  if (snapshot.preferences) localShoppingRepository.savePreferences(snapshot.preferences);
  localShoppingRepository.setHistory(snapshot.history.slice(0, maxHistory));
  if (ownerId) writeJson(cacheOwnerKey, ownerId);
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
  const cacheOwner = readJson<string | null>(cacheOwnerKey, null);
  if (cacheOwner && cacheOwner !== userId) return false;

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
  const userId = await requireUserId();
  const { error } = await supabase.from("analysis_history").delete().eq("user_id", userId).eq("id", id);
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
  const session = await ensureSupabaseSession();
  const user = session?.user;
  if (!user) throw new AuthFlowError("Supabase session is not available.", diagnosticsFromUser(null));

  const before = diagnosticsFromUser(user);
  if (!user.is_anonymous) {
    throw new AuthFlowError("이미 Kakao 계정으로 보관 중입니다.", before);
  }

  const { data, error } = await supabase.auth.linkIdentity({
    provider: "kakao",
    options: { redirectTo: `${window.location.origin}/auth/callback`, scopes: kakaoProfileScope, skipBrowserRedirect: true },
  });
  if (error) throw toAuthFlowError("Kakao identity linking URL을 만들지 못했습니다.", error, before);
  if (!data.url) throw new AuthFlowError("Kakao identity linking URL이 비어 있습니다.", before);
  window.location.assign(data.url);
}

export async function signInWithKakao() {
  const supabase = createSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured.");
  await archiveAndClearCurrentCache();
  const signedOut = await supabase.auth.signOut({ scope: "local" });
  if (signedOut.error) throw signedOut.error;
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "kakao",
    options: { redirectTo: `${window.location.origin}/auth/callback`, scopes: kakaoProfileScope, skipBrowserRedirect: true },
  });
  if (error) throw error;
  if (!data.url) throw new Error("Kakao login URL is empty.");
  window.location.assign(data.url);
}

export async function signOutOfSupabase() {
  const supabase = createSupabaseBrowserClient();
  if (!supabase) return;
  await archiveAndClearCurrentCache();
  const { error } = await supabase.auth.signOut();
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

async function archiveAndClearCurrentCache() {
  const identity = await getCloudIdentity();
  if (identity?.userId) archiveShoppingCache(identity.userId);
  clearShoppingCache();
}

function identityFromUser(user: User): CloudIdentity {
  const metadata = user.user_metadata ?? {};
  const identities = user.identities ?? [];
  const provider = identities.find((identity) => identity.provider !== "anonymous")?.provider;
  const linkedProviders = identities.map((identity) => identity.provider).filter(Boolean);
  const kakaoData = identities.find((identity) => identity.provider === "kakao")?.identity_data ?? {};
  return {
    userId: user.id,
    isAnonymous: Boolean(user.is_anonymous),
    displayName:
      stringMetadata(metadata.name) ??
      stringMetadata(metadata.full_name) ??
      stringMetadata(metadata.nickname) ??
      stringMetadata(metadata.preferred_username) ??
      stringMetadata(kakaoData.name) ??
      stringMetadata(kakaoData.nickname),
    avatarUrl: stringMetadata(metadata.avatar_url) ?? stringMetadata(metadata.picture) ?? stringMetadata(kakaoData.avatar_url) ?? stringMetadata(kakaoData.picture) ?? stringMetadata(kakaoData.profile_image_url),
    provider,
    linkedProviders,
    isLinked: linkedProviders.some((linkedProvider) => linkedProvider !== "anonymous"),
  };
}

function diagnosticsFromUser(user: User | null, error?: unknown): AuthFlowDiagnostics {
  const identities = user?.identities ?? [];
  const providers = identities.map((identity) => identity.provider).filter(Boolean);
  const authError = error && typeof error === "object" ? (error as { message?: unknown; code?: unknown; status?: unknown; name?: unknown }) : null;
  return {
    message: typeof authError?.message === "string" ? authError.message : undefined,
    code: typeof authError?.code === "string" ? authError.code : undefined,
    status: typeof authError?.status === "number" ? authError.status : undefined,
    name: typeof authError?.name === "string" ? authError.name : undefined,
    hasSession: Boolean(user),
    userId: user?.id,
    isAnonymous: user?.is_anonymous,
    providers,
    currentProvider: providers.find((provider) => provider !== "anonymous") ?? providers[0],
  };
}

function toAuthFlowError(message: string, error: unknown, sessionDiagnostics: AuthFlowDiagnostics) {
  const diagnostics = { ...sessionDiagnostics, ...diagnosticsFromUser(null, error), hasSession: sessionDiagnostics.hasSession, userId: sessionDiagnostics.userId, isAnonymous: sessionDiagnostics.isAnonymous, providers: sessionDiagnostics.providers, currentProvider: sessionDiagnostics.currentProvider };
  console.warn("Kakao linkIdentity failed", diagnostics);
  return new AuthFlowError(message, diagnostics);
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
