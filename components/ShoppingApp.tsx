"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnalyzingStage, DONE_HOLD_MS, FLOOD_COVER_MS, LOADING_STEP_MS, loadingSteps, MIN_ANALYZING_MS, type AnalyzingTarget } from "@/components/AnalyzingStage";
import { AppNav, type View } from "@/components/AppNav";
import { CloudSyncCard } from "@/components/CloudSyncCard";
import { EmptyJourney, type AnalysisErrorState } from "@/components/common";
import { HistoryStage } from "@/components/HistoryStage";
import { HomeStage } from "@/components/HomeStage";
import { withViewTransition } from "@/components/motion/viewTransition";
import { PreferencesStage } from "@/components/PreferencesStage";
import { ProfileStage } from "@/components/ProfileStage";
import { ResultStage } from "@/components/ResultStage";
import { demoProduct, demoUrl } from "@/data/demoProduct";
import { localShoppingRepository } from "@/repository/localShoppingRepository";
import {
  cacheSnapshot,
  deleteRemoteAnalysis,
  emptyCloudState,
  ensureSupabaseSession,
  getCloudIdentity,
  linkKakaoIdentity,
  loadRemoteSnapshot,
  migrateLocalSnapshotIfNeeded,
  saveRemoteAnalysis,
  saveRemotePreferences,
  saveRemoteProfile,
  signInWithKakao,
  subscribeToAuthChanges,
  type CloudState,
} from "@/repository/supabaseShoppingRepository";
import { analyzeProduct } from "@/services/analyzeProduct";
import { ProductAnalysisError } from "@/services/productParser";
import type { AnalysisResult, ProductInput, UserPreference, UserProfile } from "@/types/shopping";

const defaultProfile: UserProfile = {
  gender: "prefer_not_to_say",
  heightCm: 170,
  weightKg: 65,
  preferredFit: "relaxed",
};

const defaultPreferences: UserPreference[] = [
  { id: "warmth", weight: 2 },
  { id: "soft_touch", weight: 2 },
  { id: "low_pilling", weight: 2 },
  { id: "easy_wash", weight: 1 },
];

const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function describeTarget(input: ProductInput): AnalyzingTarget {
  if (input.manualText) return { kind: "url", host: "직접 입력한 상품 설명" };
  if (!input.url || input.url.includes("demo.shopping-assistant.local")) return { kind: "sample", name: demoProduct.productName };
  try {
    return { kind: "url", host: new URL(input.url).hostname };
  } catch {
    return { kind: "url", host: "상품 페이지" };
  }
}

export function ShoppingApp() {
  const [view, setView] = useState<View>("home");
  const [profile, setProfile] = useState<UserProfile>(defaultProfile);
  const [preferences, setPreferences] = useState<UserPreference[]>(defaultPreferences);
  const [history, setHistory] = useState<AnalysisResult[]>([]);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [url, setUrl] = useState(demoUrl);
  const [manualText, setManualText] = useState("");
  const [useManual, setUseManual] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [loadingIndex, setLoadingIndex] = useState(0);
  const [analysisError, setAnalysisError] = useState<AnalysisErrorState>(null);
  const [target, setTarget] = useState<AnalyzingTarget>({ kind: "sample", name: demoProduct.productName });
  const [flood, setFlood] = useState<{ x: number; y: number } | null>(null);
  const [cloud, setCloud] = useState<CloudState>(emptyCloudState);
  const analysisInFlight = useRef(false);

  useEffect(() => {
    if (!isAnalyzing) return;
    const timer = window.setInterval(() => {
      // Never moves backwards: once "분석 완료" is set, a late tick must not undo it.
      setLoadingIndex((index) => (index >= loadingSteps.length - 2 ? index : index + 1));
    }, LOADING_STEP_MS);
    return () => window.clearInterval(timer);
  }, [isAnalyzing]);

  useEffect(() => {
    let cancelled = false;

    const loadLocal = () => {
      setProfile(localShoppingRepository.getProfile() ?? defaultProfile);
      setPreferences(localShoppingRepository.getPreferences());
      setHistory(localShoppingRepository.getHistory());
    };

    const loadCloud = async () => {
      if (!emptyCloudState.available) {
        setCloud({ ...emptyCloudState, loading: false });
        return;
      }

      setCloud((current) => ({ ...current, loading: true }));
      try {
        const session = await ensureSupabaseSession();
        const identity = await getCloudIdentity(session);
        if (!identity) throw new Error("Supabase session is not available.");
        const beforeMigration = await loadRemoteSnapshot();
        const migrated = await migrateLocalSnapshotIfNeeded(identity.userId, beforeMigration);
        const remote = await loadRemoteSnapshot();
        if (cancelled) return;
        cacheSnapshot(remote);
        setProfile(remote.profile ?? defaultProfile);
        setPreferences(remote.preferences ?? defaultPreferences);
        setHistory(remote.history);
        setCloud({ available: true, loading: false, online: true, migrated, identity });
      } catch {
        if (cancelled) return;
        setCloud((current) => ({
          ...current,
          available: true,
          loading: false,
          online: false,
          error: "클라우드 저장소에 연결하지 못해 이 기기의 저장 기록을 사용 중입니다.",
        }));
      }
    };

    queueMicrotask(() => {
      loadLocal();
      void loadCloud();
    });

    const unsubscribe = subscribeToAuthChanges((identity) => {
      if (cancelled || !identity) return;
      setCloud((current) => ({ ...current, identity, loading: true }));
      void loadCloud();
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  // iOS Safari only applies :active (the press state) once any touchstart listener exists.
  useEffect(() => {
    const noop = () => undefined;
    document.addEventListener("touchstart", noop, { passive: true });
    return () => document.removeEventListener("touchstart", noop);
  }, []);

  const selectedPreferenceIds = useMemo(() => new Set<string>(preferences.map((item) => item.id)), [preferences]);

  function go(next: View) {
    withViewTransition(() => {
      setView(next);
      window.scrollTo({ top: 0, behavior: "instant" });
    });
  }

  function openResult(item: AnalysisResult) {
    withViewTransition(
      () => {
        setResult(item);
        setView("result");
        window.scrollTo({ top: 0, behavior: "instant" });
      },
      { sharedElement: true },
    );
  }

  function deleteHistoryItem(id: string) {
    setHistory(localShoppingRepository.deleteAnalysis(id));
    // A deleted record must not stay reachable through the Result tab.
    setResult((current) => (current?.id === id ? null : current));
    deleteRemoteAnalysis(id).catch(() => {
      setCloud((current) => ({ ...current, online: false, error: "삭제 내역을 클라우드에 반영하지 못했어요. 이 기기에는 삭제되었습니다." }));
    });
  }

  function saveProfile(next: UserProfile) {
    setProfile(next);
    localShoppingRepository.saveProfile(next);
    saveRemoteProfile(next).catch(() => {
      setCloud((current) => ({ ...current, online: false, error: "프로필을 클라우드에 저장하지 못해 이 기기에 보관했습니다." }));
    });
  }

  function togglePreference(id: UserPreference["id"]) {
    const next = selectedPreferenceIds.has(id)
      ? preferences.filter((item) => item.id !== id)
      : [...preferences, { id, weight: 2 as const }];
    setPreferences(next);
    localShoppingRepository.savePreferences(next);
    saveRemotePreferences(next).catch(() => {
      setCloud((current) => ({ ...current, online: false, error: "취향 설정을 클라우드에 저장하지 못해 이 기기에 보관했습니다." }));
    });
  }

  function connectKakao() {
    linkKakaoIdentity().catch(() => {
      setCloud((current) => ({ ...current, error: "Kakao 연결을 시작하지 못했어요. 잠시 후 다시 시도해 주세요." }));
    });
  }

  function loadLinkedKakao() {
    signInWithKakao().catch(() => {
      setCloud((current) => ({ ...current, error: "Kakao 로그인을 시작하지 못했어요. 잠시 후 다시 시도해 주세요." }));
    });
  }

  async function runAnalysis(origin: HTMLElement | null, input?: ProductInput) {
    // A double tap or Enter+click must not start two analyses (each one can cost a Gemini call).
    if (analysisInFlight.current) return;
    analysisInFlight.current = true;
    setAnalysisError(null);

    // An emptied input means "show me the sample", so the placeholder address never has to be typed over.
    const request = input ?? { url: url.trim() || demoUrl, manualText: useManual ? manualText : undefined };
    setTarget(describeTarget(request));

    // The real work starts now. The flood below is only the way the screen changes while it runs.
    const pending = analyzeProduct(request, profile, preferences);
    pending.catch(() => undefined);

    try {
      if (origin && !prefersReducedMotion()) {
        const box = origin.getBoundingClientRect();
        setFlood({ x: box.left + box.width / 2, y: box.top + box.height / 2 });
        await sleep(FLOOD_COVER_MS);
      }

      setLoadingIndex(0);
      setIsAnalyzing(true);
      const stageStartedAt = Date.now();
      const analysis = await pending;

      // Fast results (demo, manual text) still hold the stage long enough to read as a transition.
      const remaining = MIN_ANALYZING_MS - (Date.now() - stageStartedAt);
      if (remaining > 0) await sleep(remaining);
      setLoadingIndex(loadingSteps.length - 1);
      await sleep(DONE_HOLD_MS);

      localShoppingRepository.saveAnalysis(analysis);
      saveRemoteAnalysis(analysis).catch(() => {
        setCloud((current) => ({ ...current, online: false, error: "분석 기록을 클라우드에 저장하지 못해 이 기기에 보관했습니다." }));
      });
      withViewTransition(
        () => {
          setResult(analysis);
          setHistory(localShoppingRepository.getHistory());
          setView("result");
          setIsAnalyzing(false);
          window.scrollTo({ top: 0, behavior: "instant" });
        },
        { sharedElement: true },
      );
    } catch (error) {
      const known = error instanceof ProductAnalysisError;
      setUseManual(true);
      setView("home");
      setIsAnalyzing(false);
      setAnalysisError({
        title: "자동으로 모두 읽지 못했어요",
        message: known ? error.message : "상품 설명이나 소재표를 붙여넣으면 이어서 분석할 수 있어요.",
        code: known ? error.code : "analysis_failed",
      });
    } finally {
      analysisInFlight.current = false;
    }
  }

  return (
    <main className="fashion-app">
      <AppNav view={view} hasResult={Boolean(result)} onChange={go} />
      {isAnalyzing ? (
        <AnalyzingStage activeIndex={loadingIndex} target={target} />
      ) : (
        <>
          {view === "home" && (
            <HomeStage
              url={url}
              setUrl={setUrl}
              manualText={manualText}
              setManualText={setManualText}
              useManual={useManual}
              setUseManual={setUseManual}
              error={analysisError}
              onAnalyze={(origin) => runAnalysis(origin)}
              onDemo={(origin) => runAnalysis(origin, { url: demoUrl })}
            />
          )}
          {view === "result" && result && (
            <ResultStage
              key={result.id}
              result={result}
              onEditProfile={() => go("profile")}
              onEditPreferences={() => go("preferences")}
              onManualInput={() => {
                setUseManual(true);
                go("home");
              }}
            />
          )}
          {view === "result" && !result && (
            <EmptyJourney title="아직 결과가 없어요" body="상품 URL을 먼저 분석하면 나와의 궁합이 여기에 나타납니다." onAction={() => go("home")} />
          )}
          {view === "history" && (
            <HistoryStage
              history={history}
              onOpen={openResult}
              onDelete={deleteHistoryItem}
              onStart={() => go("home")}
              syncCta={<CloudSyncCard state={cloud} onLinkKakao={connectKakao} onSignInKakao={loadLinkedKakao} />}
            />
          )}
          {view === "preferences" && <PreferencesStage selected={selectedPreferenceIds} onToggle={togglePreference} />}
          {view === "profile" && <ProfileStage profile={profile} onSave={saveProfile} syncCta={<CloudSyncCard state={cloud} onLinkKakao={connectKakao} onSignInKakao={loadLinkedKakao} />} />}
        </>
      )}

      {flood && <div className="flood" style={{ "--x": `${flood.x}px`, "--y": `${flood.y}px` } as React.CSSProperties} onAnimationEnd={() => setFlood(null)} aria-hidden="true" />}
    </main>
  );
}
