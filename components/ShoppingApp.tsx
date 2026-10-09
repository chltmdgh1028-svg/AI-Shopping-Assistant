"use client";

import Image from "next/image";
import {
  AlertCircle,
  Check,
  ChevronDown,
  Circle,
  Clock3,
  Heart,
  Home,
  Link2,
  Loader2,
  Minus,
  Ruler,
  Search,
  ShieldCheck,
  Shirt,
  UserRound,
  WandSparkles,
  WashingMachine,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { preferenceCategoryLabels, preferenceDefinitions } from "@/data/preferences";
import { traitToLabel } from "@/domain/materialEvaluation";
import { localShoppingRepository } from "@/repository/localShoppingRepository";
import { analyzeProduct } from "@/services/analyzeProduct";
import { ProductAnalysisError } from "@/services/productParser";
import type { AnalysisResult, FitPreference, Gender, ProductInput, UserPreference, UserProfile } from "@/types/shopping";

type Tab = "home" | "history" | "preferences" | "profile";
type AnalysisErrorState = { title: string; message: string; code?: string } | null;

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

const fitLabels: Record<FitPreference, string> = {
  slim: "슬림",
  regular: "정핏",
  relaxed: "여유",
  oversized: "오버핏",
};

const genderLabels: Record<Gender, string> = {
  female: "여성",
  male: "남성",
  non_binary: "논바이너리",
  prefer_not_to_say: "선택 안 함",
};

const loadingSteps = ["URL 안전성 확인", "상품 페이지 읽는 중", "구조화 데이터 확인", "소재와 사이즈 정리", "내 조건과 비교"];

export function ShoppingApp() {
  const [tab, setTab] = useState<Tab>("home");
  const [profile, setProfile] = useState<UserProfile>(defaultProfile);
  const [preferences, setPreferences] = useState<UserPreference[]>(defaultPreferences);
  const [history, setHistory] = useState<AnalysisResult[]>([]);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [url, setUrl] = useState("https://demo.shopping-assistant.local/wool-blend-knit");
  const [manualText, setManualText] = useState("");
  const [useManual, setUseManual] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [loadingIndex, setLoadingIndex] = useState(0);
  const [analysisError, setAnalysisError] = useState<AnalysisErrorState>(null);

  useEffect(() => {
    if (!isAnalyzing) return;
    const timer = window.setInterval(() => {
      setLoadingIndex((index) => Math.min(index + 1, loadingSteps.length - 1));
    }, 560);
    return () => window.clearInterval(timer);
  }, [isAnalyzing]);

  useEffect(() => {
    queueMicrotask(() => {
      setProfile(localShoppingRepository.getProfile() ?? defaultProfile);
      setPreferences(localShoppingRepository.getPreferences());
      setHistory(localShoppingRepository.getHistory());
    });
  }, []);

  const selectedPreferenceIds = useMemo(() => new Set(preferences.map((item) => item.id)), [preferences]);

  function saveProfile(next: UserProfile) {
    setProfile(next);
    localShoppingRepository.saveProfile(next);
  }

  function togglePreference(id: UserPreference["id"]) {
    const next = selectedPreferenceIds.has(id)
      ? preferences.filter((item) => item.id !== id)
      : [...preferences, { id, weight: 2 as const }];
    setPreferences(next);
    localShoppingRepository.savePreferences(next);
  }

  async function runAnalysis(input?: ProductInput) {
    setIsAnalyzing(true);
    setAnalysisError(null);
    setLoadingIndex(0);
    try {
      const analysis = await analyzeProduct(input ?? { url, manualText: useManual ? manualText : undefined }, profile, preferences);
      localShoppingRepository.saveAnalysis(analysis);
      setResult(analysis);
      setHistory(localShoppingRepository.getHistory());
      setTab("home");
      requestAnimationFrame(() => {
        const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
      });
    } catch (error) {
      const known = error instanceof ProductAnalysisError;
      setUseManual(true);
      setAnalysisError({
        title: "자동으로 모두 읽지 못했어요",
        message: known
          ? error.message
          : "이 쇼핑몰에서는 상품 정보를 자동으로 확인하지 못했습니다. 상품 설명이나 소재표를 붙여넣으면 이어서 분석할 수 있어요.",
        code: known ? error.code : "analysis_failed",
      });
    } finally {
      setIsAnalyzing(false);
    }
  }

  return (
    <main className="min-h-[100dvh] bg-[var(--app-bg)] text-[var(--ink)]">
      <div className="mx-auto grid w-full max-w-6xl gap-6 px-4 pb-28 pt-4 sm:px-6 lg:grid-cols-[25rem_1fr] lg:px-8 lg:pb-12">
        <aside className="lg:sticky lg:top-4 lg:self-start">
          <Header onProfile={() => setTab("profile")} />
          <AnalyzePanel
            url={url}
            setUrl={setUrl}
            manualText={manualText}
            setManualText={setManualText}
            useManual={useManual}
            setUseManual={setUseManual}
            isAnalyzing={isAnalyzing}
            loadingIndex={loadingIndex}
            error={analysisError}
            onAnalyze={() => runAnalysis()}
            onDemo={() => runAnalysis({ url: "https://demo.shopping-assistant.local/wool-blend-knit" })}
          />
        </aside>

        <section className={`min-w-0 ${tab === "home" && result ? "order-first lg:order-none" : ""}`}>
          {tab === "home" && (result ? <AnalysisView result={result} onEditProfile={() => setTab("profile")} /> : <InitialCanvas historyCount={history.length} />)}
          {tab === "history" && <HistoryView history={history} onOpen={(item) => { setResult(item); setTab("home"); }} />}
          {tab === "preferences" && <PreferencesView selected={selectedPreferenceIds} onToggle={togglePreference} />}
          {tab === "profile" && <ProfileView key={JSON.stringify(profile)} profile={profile} onSave={saveProfile} />}
        </section>
      </div>

      <BottomNav tab={tab} onChange={setTab} />
    </main>
  );
}

function Header({ onProfile }: { onProfile: () => void }) {
  return (
    <header className="mb-4 flex items-start justify-between gap-4 lg:mb-5">
      <div>
        <p className="text-[0.72rem] font-medium text-[var(--muted)]">Shopping Assistant</p>
        <h1 className="keep-ko mt-2 max-w-[20rem] text-[1.85rem] font-semibold leading-[1.08] tracking-[-0.02em] sm:text-[2.35rem]">
          이 옷이 나에게 맞는지 먼저 봅니다
        </h1>
      </div>
      <button className="surface-button mt-1" aria-label="프로필 열기" onClick={onProfile}>
        <UserRound size={20} strokeWidth={1.7} />
      </button>
    </header>
  );
}

function AnalyzePanel(props: {
  url: string;
  setUrl: (value: string) => void;
  manualText: string;
  setManualText: (value: string) => void;
  useManual: boolean;
  setUseManual: (value: boolean | ((current: boolean) => boolean)) => void;
  isAnalyzing: boolean;
  loadingIndex: number;
  error: AnalysisErrorState;
  onAnalyze: () => void;
  onDemo: () => void;
}) {
  return (
    <section className="panel-shell">
      <div className="relative overflow-hidden rounded-[1.35rem] bg-[#d9dde0]">
        <Image
          src="https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=1200&q=80"
          alt="쇼핑백을 든 사람"
          width={900}
          height={620}
          className="h-48 w-full object-cover saturate-[0.82] sm:h-56 lg:h-48"
          priority
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/62 via-black/10 to-transparent" />
        <div className="absolute bottom-4 left-4 right-4">
          <p className="max-w-[18rem] text-[1.35rem] font-semibold leading-tight tracking-[-0.02em] text-white">
            링크를 넣으면 소재, 사이즈, 관리 난도를 내 기준으로 읽어줍니다
          </p>
        </div>
      </div>

      <div className="mt-5 space-y-3">
        <label className="form-label" htmlFor="url">상품 URL</label>
        <div className="input-shell">
          <Link2 className="shrink-0 text-[var(--accent)]" size={18} strokeWidth={1.7} />
          <input
            id="url"
            name="product-url"
            type="url"
            autoComplete="off"
            value={props.url}
            onChange={(event) => props.setUrl(event.target.value)}
            className="min-w-0 flex-1 border-0 bg-transparent py-3 text-[0.95rem] outline-none"
            placeholder="https://shop.example.com/product…"
            inputMode="url"
          />
        </div>
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <button onClick={props.onAnalyze} disabled={props.isAnalyzing} className="primary-button group">
            <span>{props.isAnalyzing ? "분석 중" : "분석하기"}</span>
            <span className="button-orbit">
              {props.isAnalyzing ? <Loader2 className="animate-spin" size={16} /> : <Search size={16} />}
            </span>
          </button>
          <button onClick={props.onDemo} disabled={props.isAnalyzing} className="secondary-icon-button" aria-label="샘플 상품으로 체험하기">
            <WandSparkles size={18} strokeWidth={1.7} />
          </button>
        </div>
      </div>

      {props.error && <InlineFailure error={props.error} />}
      {props.isAnalyzing && <ProgressSteps activeIndex={props.loadingIndex} />}

      <div className="mt-4 rounded-[1.15rem] bg-[var(--soft-panel)] p-3">
        <button
          className="flex w-full items-center justify-between gap-3 text-left text-[0.95rem] font-medium"
          onClick={() => props.setUseManual((value) => !value)}
        >
          상품 설명 직접 붙여넣기
          <ChevronDown className={props.useManual ? "rotate-180 transition-transform duration-300" : "transition-transform duration-300"} size={18} />
        </button>
        {props.useManual && (
          <div className="mt-3 animate-soft-reveal">
            <textarea
              name="manual-product-info"
              autoComplete="off"
              value={props.manualText}
              onChange={(event) => props.setManualText(event.target.value)}
              rows={7}
              className="input-shell block w-full resize-none p-3 leading-6"
              placeholder={"상품명…\nWool 60% Nylon 25% Acrylic 15%\nM 어깨 46 가슴 106 총장 65\n세탁: 찬물 울코스 권장"}
            />
            <p className="mt-2 text-[0.8rem] leading-5 text-[var(--muted)]">
              자동 분석이 막힌 쇼핑몰도 설명, 소재표, 사이즈표를 붙여넣으면 같은 분석 흐름으로 이어집니다.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

function InlineFailure({ error }: { error: NonNullable<AnalysisErrorState> }) {
  return (
    <div className="mt-4 rounded-[1.15rem] bg-[#fff6ee] p-4 text-[#6f351e] ring-1 ring-[#f0d1bf]" role="status" aria-live="polite">
      <div className="flex items-start gap-3">
        <AlertCircle className="mt-0.5 shrink-0" size={18} />
        <div>
          <p className="font-semibold">{error.title}</p>
          <p className="mt-1 text-[0.88rem] leading-5">{error.message}</p>
        </div>
      </div>
    </div>
  );
}

function ProgressSteps({ activeIndex }: { activeIndex: number }) {
  return (
    <div className="mt-4 rounded-[1.15rem] bg-[#f7f8f7] p-4 ring-1 ring-[var(--line)]" role="status" aria-live="polite">
      <div className="mb-3 flex items-center justify-between">
        <p className="font-medium">상품 정보를 정리하고 있어요</p>
        <span className="text-[0.8rem] text-[var(--muted)]">{activeIndex + 1}/{loadingSteps.length}</span>
      </div>
      <div className="space-y-2">
        {loadingSteps.map((step, index) => (
          <div key={step} className="flex items-center gap-3">
            <span className={`grid h-6 w-6 place-items-center rounded-full transition-colors duration-300 ${index <= activeIndex ? "bg-[var(--ink)] text-white" : "bg-white text-[var(--muted)] ring-1 ring-[var(--line)]"}`}>
              {index < activeIndex ? <Check size={13} /> : <Circle size={8} fill="currentColor" />}
            </span>
            <span className={`text-[0.88rem] ${index <= activeIndex ? "text-[var(--ink)]" : "text-[var(--muted)]"}`}>{step}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function InitialCanvas({ historyCount }: { historyCount: number }) {
  return (
    <div className="quiet-canvas">
      <div className="mx-auto max-w-xl text-center">
        <div className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-full bg-white shadow-[0_22px_70px_rgba(22,25,27,0.08)] ring-1 ring-[var(--line)]">
          <Shirt className="text-[var(--accent)]" size={28} strokeWidth={1.5} />
        </div>
        <h2 className="text-[1.8rem] font-semibold leading-tight tracking-[-0.02em]">좋은 옷보다 나에게 맞는 옷</h2>
        <p className="mx-auto mt-3 max-w-md text-[0.98rem] leading-7 text-[var(--muted)]">
          소재 설명, 사이즈표, 관리법을 한 번에 읽고 내 체형과 취향에 맞춰 판단합니다.
        </p>
      </div>
      <div className="mt-8 grid gap-3 sm:grid-cols-3">
        <MiniProof icon={ShieldCheck} title="사실과 추론 구분" text="상품 정보와 소재 기반 예상을 분리합니다." />
        <MiniProof icon={Ruler} title="사이즈 신뢰도" text="정보가 부족하면 확정하지 않습니다." />
        <MiniProof icon={Clock3} title="기록 저장" text={`${historyCount}개의 최근 분석을 이 기기에 보관 중입니다.`} />
      </div>
    </div>
  );
}

function AnalysisView({ result, onEditProfile }: { result: AnalysisResult; onEditProfile: () => void }) {
  const insights = buildTopInsights(result);

  return (
    <article className="animate-soft-reveal space-y-5">
      <section className="result-hero">
        <div className="relative min-h-[20rem] overflow-hidden rounded-[1.7rem] bg-[#16191b]">
          <Image
            src={result.product.images[0] || "https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=1200&q=80"}
            alt={result.product.productName}
            fill
            sizes="(max-width: 1024px) 100vw, 700px"
            className="object-cover opacity-70"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#121416] via-[#121416]/54 to-transparent" />
          <div className="absolute bottom-0 left-0 right-0 p-5 sm:p-7">
            <p className="mb-2 text-sm text-white/70">{result.product.brand ?? "브랜드 미확인"}</p>
            <h2 className="max-w-xl text-[1.8rem] font-semibold leading-tight tracking-[-0.02em] text-white sm:text-[2.4rem]">
              {result.product.productName}
            </h2>
            <p className="mt-2 text-sm text-white/72">{sourceLabel(result.product.factsSource)} · {metadataLabel(result)}</p>
          </div>
        </div>

        <div className="grid gap-4 p-5 sm:grid-cols-[12rem_1fr] sm:p-7">
          <div>
            <p className="text-sm text-[var(--muted)]">나와의 궁합</p>
            <div className="mt-1 flex items-end gap-1">
              <span className="text-[4.2rem] font-semibold leading-none tracking-[-0.06em]">{result.score.total}</span>
              <span className="pb-2 text-xl font-medium">점</span>
            </div>
          </div>
          <div className="self-end">
            <p className="text-[1.45rem] font-semibold tracking-[-0.02em]">{verdictCopy(result.score.verdict)}</p>
            <p className="mt-2 max-w-xl text-[1rem] leading-7 text-[var(--muted)]">{result.score.summary}</p>
            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              {insights.map((insight) => (
                <div key={insight.text} className="rounded-[1rem] bg-[var(--soft-panel)] px-3 py-3">
                  <insight.icon className={insight.tone === "good" ? "text-[var(--accent)]" : "text-[#a15d2a]"} size={17} strokeWidth={1.7} />
                  <p className="mt-2 text-[0.86rem] leading-5">{insight.text}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <SizePanel result={result} onEditProfile={onEditProfile} />
      <MaterialPanel result={result} />
      <PreferencePanel result={result} />
      <CarePanel result={result} />
      <EvidencePanel result={result} />
    </article>
  );
}

function SizePanel({ result, onEditProfile }: { result: AnalysisResult; onEditProfile: () => void }) {
  return (
    <section className="content-section">
      <div className="section-heading">
        <Ruler size={20} strokeWidth={1.6} />
        <h3>추천 사이즈</h3>
      </div>
      <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
        <div className="rounded-[1.35rem] bg-[var(--ink)] p-5 text-white">
          <p className="text-sm text-white/65">추천</p>
          <p className="mt-1 text-[3.4rem] font-semibold leading-none">{result.size.recommendedSize ?? "미확인"}</p>
          <p className="mt-3 text-sm text-white/70">신뢰도 {confidenceLabel(result.size.confidence)}</p>
        </div>
        <div className="rounded-[1.35rem] bg-[var(--soft-panel)] p-5">
          <p className="leading-7 text-[var(--muted)]">{result.size.reason}</p>
          {result.size.alternatives.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {result.size.alternatives.map((size) => (
                <span key={size} className="rounded-full bg-white px-3 py-1.5 text-sm ring-1 ring-[var(--line)]">대안 {size}</span>
              ))}
            </div>
          )}
          {(result.size.confidence === "low" || result.size.confidence === "unavailable") && (
            <button onClick={onEditProfile} className="mt-4 rounded-full bg-white px-4 py-2 text-sm font-medium text-[var(--ink)] ring-1 ring-[var(--line)] active:scale-[0.98]">
              내 치수 추가하기
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

function MaterialPanel({ result }: { result: AnalysisResult }) {
  const materialTakeaways = [
    { label: "따뜻함", value: traitToLabel(result.material.traits.warmth), icon: Shirt },
    { label: "촉감", value: traitToLabel(result.material.traits.softness), icon: Heart },
    { label: "관리", value: traitToLabel(result.material.traits.careEase), icon: WashingMachine },
    { label: "보풀", value: traitToLabel(result.material.traits.pillingRisk, true), icon: Minus },
  ];

  return (
    <section className="content-section">
      <div className="section-heading">
        <Shirt size={20} strokeWidth={1.6} />
        <h3>소재는 어떤 느낌인가요</h3>
      </div>
      <p className="mb-4 text-[0.95rem] font-medium text-[var(--accent)]">{result.material.blendSummary}</p>
      <div className="grid gap-3 sm:grid-cols-4">
        {materialTakeaways.map((item) => (
          <div key={item.label} className="rounded-[1.2rem] bg-[var(--soft-panel)] p-4">
            <item.icon size={18} strokeWidth={1.7} className="text-[var(--accent)]" />
            <p className="mt-3 text-sm text-[var(--muted)]">{item.label}</p>
            <p className="font-semibold">{item.value}</p>
          </div>
        ))}
      </div>
      <details className="details-block">
        <summary>왜 그런가요?</summary>
        <div className="mt-3 space-y-3">
          {result.material.materialNotes.length === 0 && <p className="text-sm text-[var(--muted)]">소재 정보가 없어 상세 근거를 만들지 않았습니다.</p>}
          {result.material.materialNotes.map((note) => (
            <div key={note.name} className="rounded-[1rem] bg-white p-4 ring-1 ring-[var(--line)]">
              <p className="font-medium">{note.name} {note.percentage}%</p>
              <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{[...note.pros, ...note.cons].join(" ")}</p>
            </div>
          ))}
        </div>
      </details>
    </section>
  );
}

function PreferencePanel({ result }: { result: AnalysisResult }) {
  return (
    <section className="content-section">
      <div className="section-heading">
        <Heart size={20} strokeWidth={1.6} />
        <h3>내가 원하는 조건과 비교</h3>
      </div>
      <div className="space-y-2">
        {result.preferenceMatches.map((match) => (
          <details key={match.preferenceId} className="details-block">
            <summary>
              <span>{match.label}</span>
              <span className="text-[var(--accent)]">{ratingLabel(match.rating)}</span>
            </summary>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{match.reason}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

function CarePanel({ result }: { result: AnalysisResult }) {
  return (
    <section className="content-section">
      <div className="section-heading">
        <WashingMachine size={20} strokeWidth={1.6} />
        <h3>관리법</h3>
      </div>
      <p className="mb-4 text-sm text-[var(--muted)]">
        출처: {result.care.source === "product_page" ? "상품 제조사 안내" : "소재 특성을 기반으로 한 일반 권장사항"}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <CareTile label="세탁" value={result.care.washing} />
        <CareTile label="건조" value={result.care.drying} />
        <CareTile label="보관" value={result.care.storage} />
        <CareTile label="주의" value={result.care.cautions.join(" ") || "제조사 라벨을 한 번 더 확인하세요."} />
      </div>
    </section>
  );
}

function EvidencePanel({ result }: { result: AnalysisResult }) {
  const warnings = result.product.extractionMetadata?.warnings ?? [];
  return (
    <section className="content-section">
      <div className="section-heading">
        <ShieldCheck size={20} strokeWidth={1.6} />
        <h3>분석 근거</h3>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {result.score.reasons.map((reason) => (
          <div key={reason} className="rounded-[1.1rem] bg-[var(--soft-panel)] p-4 text-sm">{reason}</div>
        ))}
      </div>
      {warnings.length > 0 && (
        <div className="mt-4 rounded-[1.1rem] bg-[#fff6ee] p-4 text-sm leading-6 text-[#7b4327]">
          {warnings.map((warning) => <p key={warning}>{warning}</p>)}
        </div>
      )}
    </section>
  );
}

function CareTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[1.2rem] bg-[var(--soft-panel)] p-4">
      <p className="text-sm font-medium text-[var(--accent)]">{label}</p>
      <p className="mt-2 leading-6 text-[var(--muted)]">{value}</p>
    </div>
  );
}

function MiniProof({ icon: Icon, title, text }: { icon: typeof ShieldCheck; title: string; text: string }) {
  return (
    <div className="rounded-[1.25rem] bg-white p-4 ring-1 ring-[var(--line)]">
      <Icon size={18} strokeWidth={1.7} className="text-[var(--accent)]" />
      <p className="mt-3 font-medium">{title}</p>
      <p className="mt-1 text-sm leading-5 text-[var(--muted)]">{text}</p>
    </div>
  );
}

function PreferencesView({ selected, onToggle }: { selected: Set<string>; onToggle: (id: UserPreference["id"]) => void }) {
  const categories = Object.entries(preferenceCategoryLabels);
  return (
    <section className="content-section">
      <h2 className="text-[1.9rem] font-semibold tracking-[-0.02em]">내 취향</h2>
      <p className="mt-2 max-w-xl leading-7 text-[var(--muted)]">중요도 확장이 가능한 데이터 구조를 유지하면서, 지금은 빠르게 선택할 수 있게 단순화했습니다.</p>
      <div className="mt-6 space-y-7">
        {categories.map(([category, label]) => (
          <div key={category}>
            <h3 className="mb-3 font-semibold">{label}</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              {preferenceDefinitions.filter((item) => item.category === category).map((item) => (
                <button key={item.id} onClick={() => onToggle(item.id)} className={`preference-choice ${selected.has(item.id) ? "is-selected" : ""}`}>
                  <span className="font-medium">{item.label}</span>
                  <span className="mt-1 block text-sm leading-5 text-[var(--muted)]">{item.plainLanguage}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ProfileView({ profile, onSave }: { profile: UserProfile; onSave: (profile: UserProfile) => void }) {
  const [draft, setDraft] = useState(profile);
  return (
    <section className="content-section">
      <h2 className="text-[1.9rem] font-semibold tracking-[-0.02em]">프로필</h2>
      <p className="mt-2 max-w-xl leading-7 text-[var(--muted)]">키와 몸무게만으로도 사용할 수 있습니다. 상세 치수를 넣으면 사이즈 추천 신뢰도가 올라갑니다.</p>
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <SelectField label="성별" value={draft.gender} options={genderLabels} onChange={(value) => setDraft({ ...draft, gender: value as Gender })} />
        <SelectField label="선호 핏" value={draft.preferredFit} options={fitLabels} onChange={(value) => setDraft({ ...draft, preferredFit: value as FitPreference })} />
        <NumberField label="키 cm" value={draft.heightCm} onChange={(heightCm) => setDraft({ ...draft, heightCm })} />
        <NumberField label="몸무게 kg" value={draft.weightKg} onChange={(weightKg) => setDraft({ ...draft, weightKg })} />
        <TextField label="평소 상의 사이즈" value={draft.topSize ?? ""} onChange={(topSize) => setDraft({ ...draft, topSize })} />
        <TextField label="평소 하의 사이즈" value={draft.bottomSize ?? ""} onChange={(bottomSize) => setDraft({ ...draft, bottomSize })} />
        <NumberField label="가슴둘레 cm" value={draft.chestCm ?? 0} optional onChange={(chestCm) => setDraft({ ...draft, chestCm: chestCm || undefined })} />
        <NumberField label="허리둘레 cm" value={draft.waistCm ?? 0} optional onChange={(waistCm) => setDraft({ ...draft, waistCm: waistCm || undefined })} />
        <NumberField label="어깨너비 cm" value={draft.shoulderCm ?? 0} optional onChange={(shoulderCm) => setDraft({ ...draft, shoulderCm: shoulderCm || undefined })} />
      </div>
      <button onClick={() => onSave(draft)} className="primary-button mt-5 w-full sm:w-auto">
        <span>프로필 저장</span>
        <span className="button-orbit"><Check size={16} /></span>
      </button>
    </section>
  );
}

function HistoryView({ history, onOpen }: { history: AnalysisResult[]; onOpen: (result: AnalysisResult) => void }) {
  if (history.length === 0) {
    return (
      <section className="quiet-canvas">
        <Clock3 className="mx-auto text-[var(--accent)]" size={30} strokeWidth={1.6} />
        <h2 className="mt-4 text-center text-[1.7rem] font-semibold tracking-[-0.02em]">아직 분석 기록이 없습니다</h2>
        <p className="mx-auto mt-2 max-w-md text-center leading-7 text-[var(--muted)]">상품 링크를 분석하면 궁합 점수와 추천 사이즈가 이곳에 저장됩니다.</p>
      </section>
    );
  }

  return (
    <section className="content-section">
      <h2 className="text-[1.9rem] font-semibold tracking-[-0.02em]">분석 기록</h2>
      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {history.map((item) => (
          <button key={item.id} onClick={() => onOpen(item)} className="history-card">
            <div className="relative h-40 overflow-hidden rounded-[1.1rem]">
              <Image src={item.product.images[0]} alt="" fill sizes="320px" className="object-cover" />
            </div>
            <div className="mt-4">
              <p className="line-clamp-1 font-semibold">{item.product.productName}</p>
              <p className="mt-1 text-sm text-[var(--muted)]">궁합 {item.score.total}점 · 추천 사이즈 {item.size.recommendedSize ?? "미확인"}</p>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}

function BottomNav({ tab, onChange }: { tab: Tab; onChange: (tab: Tab) => void }) {
  const items = [
    { id: "home", label: "홈", icon: Home },
    { id: "history", label: "기록", icon: Clock3 },
    { id: "preferences", label: "취향", icon: Heart },
    { id: "profile", label: "프로필", icon: UserRound },
  ] as const;
  return (
    <nav className="safe-bottom fixed bottom-0 left-0 right-0 z-20 border-t border-[var(--line)] bg-[rgba(248,248,246,0.94)] px-4 pt-2 backdrop-blur-md lg:hidden">
      <div className="mx-auto grid max-w-md grid-cols-4 gap-1">
        {items.map((item) => {
          const Icon = item.icon;
          const active = tab === item.id;
          return (
            <button key={item.id} onClick={() => onChange(item.id)} className={`bottom-nav-item ${active ? "is-active" : ""}`}>
              <Icon className="mx-auto mb-1" size={19} strokeWidth={1.7} />
              {item.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function NumberField({ label, value, optional, onChange }: { label: string; value: number; optional?: boolean; onChange: (value: number) => void }) {
  return (
    <label className="form-label">
      {label}
      <input
        type="number"
        name={label}
        autoComplete="off"
        min={optional ? 0 : 1}
        value={optional && value === 0 ? "" : value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="input-shell mt-1 w-full px-3 py-3"
      />
    </label>
  );
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="form-label">
      {label}
      <input name={label} autoComplete="off" value={value} onChange={(event) => onChange(event.target.value)} className="input-shell mt-1 w-full px-3 py-3" />
    </label>
  );
}

function SelectField({ label, value, options, onChange }: { label: string; value: string; options: Record<string, string>; onChange: (value: string) => void }) {
  return (
    <label className="form-label">
      {label}
      <select name={label} autoComplete="off" value={value} onChange={(event) => onChange(event.target.value)} className="input-shell mt-1 w-full px-3 py-3">
        {Object.entries(options).map(([key, optionLabel]) => (
          <option key={key} value={key}>{optionLabel}</option>
        ))}
      </select>
    </label>
  );
}

function buildTopInsights(result: AnalysisResult) {
  const warm = result.material.traits.warmth >= 4;
  const sizeOk = result.size.confidence === "high" || result.size.confidence === "medium";
  const careEasy = result.score.components.careCompatibility >= 70;
  return [
    { icon: Shirt, tone: warm ? "good" : "caution", text: warm ? "보온성이 좋은 편이에요" : "보온성은 보통 수준이에요" },
    { icon: Ruler, tone: sizeOk ? "good" : "caution", text: sizeOk ? "사이즈 근거가 비교적 충분해요" : "사이즈 신뢰도는 낮게 봤어요" },
    { icon: WashingMachine, tone: careEasy ? "good" : "caution", text: careEasy ? "관리 난도는 무난해요" : "관리에 조금 신경 써야 해요" },
  ] as const;
}

function sourceLabel(source: string) {
  if (source === "demo") return "샘플 상품";
  if (source === "manual_input") return "직접 입력 정보";
  return "상품 페이지 정보";
}

function metadataLabel(result: AnalysisResult) {
  const metadata = result.product.extractionMetadata;
  if (!metadata) return "추출 정보 없음";
  if (metadata.aiProvider === "unavailable") return "AI 추출 미연결";
  return metadata.status === "partial" ? "일부 자동 추출" : "자동 추출";
}

function verdictCopy(verdict: string) {
  if (verdict === "추천해요") return "나와 잘 맞아요";
  if (verdict === "조건부 추천") return "확인하고 사면 좋아요";
  return "조금 더 신중히 보세요";
}

function ratingLabel(rating: string) {
  if (rating === "excellent") return "매우 적합";
  if (rating === "good") return "적합";
  if (rating === "fair") return "보통";
  return "아쉬움";
}

function confidenceLabel(confidence: string) {
  if (confidence === "high") return "높음";
  if (confidence === "medium") return "보통";
  if (confidence === "low") return "낮음";
  return "없음";
}
