"use client";

import Image from "next/image";
import {
  AlertCircle,
  Check,
  ChevronDown,
  Heart,
  History,
  Link2,
  Ruler,
  Search,
  ShieldCheck,
  Shirt,
  SlidersHorizontal,
  Sparkles,
  UserRound,
  WandSparkles,
  WashingMachine,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { preferenceCategoryLabels, preferenceDefinitions } from "@/data/preferences";
import { traitToLabel } from "@/domain/materialEvaluation";
import { localShoppingRepository } from "@/repository/localShoppingRepository";
import { analyzeProduct } from "@/services/analyzeProduct";
import { ProductAnalysisError } from "@/services/productParser";
import type { AnalysisResult, FitPreference, Gender, ProductInput, UserPreference, UserProfile } from "@/types/shopping";

type View = "home" | "result" | "history" | "preferences" | "profile";
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

const loadingSteps = ["소재 확인", "사이즈표 확인", "핏 추정", "취향 비교", "관리 난도 정리"];
const LOADING_STEP_MS = 480;
const MIN_ANALYZING_MS = loadingSteps.length * LOADING_STEP_MS;

const heroFacts = [
  ["WOOL", "60%"],
  ["WARMTH", "HIGH"],
  ["RELAXED", "FIT"],
  ["YOUR SIZE", "L"],
];

export function ShoppingApp() {
  const [view, setView] = useState<View>("home");
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
    }, LOADING_STEP_MS);
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

  function go(next: View) {
    setView(next);
    requestAnimationFrame(() => {
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
    });
  }

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
      // Local analysis resolves almost instantly; hold the stage long enough to read as a transition.
      const [analysis] = await Promise.all([
        analyzeProduct(input ?? { url, manualText: useManual ? manualText : undefined }, profile, preferences),
        new Promise((resolve) => window.setTimeout(resolve, MIN_ANALYZING_MS)),
      ]);
      localShoppingRepository.saveAnalysis(analysis);
      setResult(analysis);
      setHistory(localShoppingRepository.getHistory());
      setView("result");
    } catch (error) {
      const known = error instanceof ProductAnalysisError;
      setUseManual(true);
      setView("home");
      setAnalysisError({
        title: "자동으로 모두 읽지 못했어요",
        message: known
          ? error.message
          : "상품 설명이나 소재표를 붙여넣으면 이어서 분석할 수 있어요.",
        code: known ? error.code : "analysis_failed",
      });
    } finally {
      setIsAnalyzing(false);
    }
  }

  return (
    <main className="fashion-app">
      <AppNav view={view} hasResult={Boolean(result)} onChange={go} />
      {isAnalyzing ? (
        <AnalyzingStage activeIndex={loadingIndex} />
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
              onAnalyze={() => runAnalysis()}
              onDemo={() => runAnalysis({ url: "https://demo.shopping-assistant.local/wool-blend-knit" })}
            />
          )}
          {view === "result" && result && <ResultStage result={result} onEditProfile={() => go("profile")} />}
          {view === "result" && !result && (
            <EmptyJourney title="아직 결과가 없어요" body="상품 URL을 먼저 분석하면 나와의 궁합이 여기에 나타납니다." onAction={() => go("home")} />
          )}
          {view === "history" && <HistoryStage history={history} onOpen={(item) => { setResult(item); go("result"); }} onStart={() => go("home")} />}
          {view === "preferences" && <PreferencesStage selected={selectedPreferenceIds} onToggle={togglePreference} />}
          {view === "profile" && <ProfileStage profile={profile} onSave={saveProfile} />}
        </>
      )}
    </main>
  );
}

function AppNav({ view, hasResult, onChange }: { view: View; hasResult: boolean; onChange: (view: View) => void }) {
  const items: Array<{ id: View; label: string; icon: LucideIcon; disabled?: boolean }> = [
    { id: "home", label: "홈", icon: Search },
    { id: "result", label: "결과", icon: Sparkles, disabled: !hasResult },
    { id: "preferences", label: "취향", icon: Heart },
    { id: "profile", label: "핏", icon: UserRound },
    { id: "history", label: "기록", icon: History },
  ];

  return (
    <nav className="app-nav" aria-label="주요 화면">
      <button className="brand-mark" onClick={() => onChange("home")}>
        Shopping Assistant
      </button>
      <div className="nav-track">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              className={`nav-pill ${view === item.id ? "is-active" : ""}`}
              onClick={() => onChange(item.id)}
              disabled={item.disabled}
            >
              <Icon size={15} aria-hidden="true" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function HomeStage(props: {
  url: string;
  setUrl: (value: string) => void;
  manualText: string;
  setManualText: (value: string) => void;
  useManual: boolean;
  setUseManual: (value: boolean | ((current: boolean) => boolean)) => void;
  error: AnalysisErrorState;
  onAnalyze: () => void;
  onDemo: () => void;
}) {
  return (
    <section className="home-stage stage-reveal">
      <div className="hero-media" aria-hidden="true">
        <Image
          src="https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=1800&q=82"
          alt=""
          fill
          sizes="100vw"
          className="object-cover"
          priority
        />
      </div>
      <div className="hero-scrim" />

      <div className="hero-composition">
        <div className="hero-copy">
          <p className="brand-line">Personal styling product</p>
          <h1>이 옷, 나한테 맞을까?</h1>
        </div>

        <div className="hero-facts" aria-label="분석 예시">
          <p className="facts-caption">샘플 상품으로 본 분석 예시</p>
          {heroFacts.map(([label, value]) => (
            <div key={label} className="hero-fact">
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>

        <form
          className="url-lens"
          onSubmit={(event) => {
            event.preventDefault();
            props.onAnalyze();
          }}
        >
          <label htmlFor="product-url" className="sr-only">상품 URL</label>
          <Link2 aria-hidden="true" size={22} />
          <input
            id="product-url"
            name="product-url"
            type="url"
            autoComplete="off"
            value={props.url}
            onChange={(event) => props.setUrl(event.target.value)}
            placeholder="상품 URL을 붙여넣기…"
            inputMode="url"
          />
          <button type="submit" className="lens-submit">
            <span>분석하기</span>
            <Search aria-hidden="true" size={18} />
          </button>
        </form>

        <div className="home-actions">
          <button className="text-action" onClick={props.onDemo}>
            <WandSparkles size={17} aria-hidden="true" />
            샘플로 보기
          </button>
          <button className="text-action" onClick={() => props.setUseManual((value) => !value)} aria-expanded={props.useManual}>
            <SlidersHorizontal size={17} aria-hidden="true" />
            설명 직접 입력
          </button>
        </div>

        {props.error && <InlineFailure error={props.error} />}

        {props.useManual && (
          <div className="manual-drawer stage-reveal">
            <label htmlFor="manual-product-info">상품 설명</label>
            <textarea
              id="manual-product-info"
              name="manual-product-info"
              autoComplete="off"
              value={props.manualText}
              onChange={(event) => props.setManualText(event.target.value)}
              rows={6}
              placeholder={"상품명…\nWool 60% Nylon 25% Acrylic 15%\nM 어깨 46 가슴 106 총장 65\n세탁: 찬물 울코스 권장"}
            />
          </div>
        )}
      </div>
    </section>
  );
}

function AnalyzingStage({ activeIndex }: { activeIndex: number }) {
  return (
    <section className="analyzing-stage stage-reveal" role="status" aria-live="polite">
      <div className="analysis-figure" aria-hidden="true">
        <Image
          src="https://images.unsplash.com/photo-1503342217505-b0a15ec3261c?auto=format&fit=crop&w=1400&q=80"
          alt=""
          fill
          sizes="(max-width: 768px) 100vw, 54vw"
          className="object-cover"
          priority
        />
      </div>
      <div className="analysis-copy">
        <p className="brand-line">Analyzing</p>
        <h2>{loadingSteps[activeIndex]}</h2>
        <p>상품 페이지를 옷의 언어로 다시 읽고 있어요.</p>
        <div className="analysis-steps">
          {loadingSteps.map((step, index) => (
            <div key={step} className={`analysis-step ${index <= activeIndex ? "is-active" : ""}`}>
              <span>{index < activeIndex ? <Check size={14} aria-hidden="true" /> : index + 1}</span>
              <strong>{step}</strong>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ResultStage({ result, onEditProfile }: { result: AnalysisResult; onEditProfile: () => void }) {
  const insights = buildTopInsights(result);
  const materialTakeaways = [
    { label: "Warmth", value: traitToLabel(result.material.traits.warmth), icon: Shirt },
    { label: "Touch", value: traitToLabel(result.material.traits.softness), icon: Heart },
    { label: "Care", value: traitToLabel(result.material.traits.careEase), icon: WashingMachine },
    { label: "Pilling", value: traitToLabel(result.material.traits.pillingRisk, true), icon: ShieldCheck },
  ];

  return (
    <article className="result-stage stage-reveal">
      <section className="result-hero">
        <div className="result-media" aria-hidden="true">
          <Image
            src={result.product.images[0] || "https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=1600&q=80"}
            alt=""
            fill
            sizes="100vw"
            className="object-cover"
            priority
          />
        </div>
        <div className="result-scrim" />
        <div className="result-score">
          <span>{result.score.total}</span>
          <strong>MATCH</strong>
        </div>
        <div className="result-title">
          <p>{result.product.brand ?? "브랜드 미확인"}</p>
          <h1>{verdictCopy(result.score.verdict)}</h1>
          <p>{result.score.summary}</p>
        </div>
      </section>

      <div className="result-flow">
        <section className="product-strip">
          <div>
            <p className="strip-label">Product</p>
            <h2>{result.product.productName}</h2>
          </div>
          <div className="strip-meta">
            <span>{sourceLabel(result.product.factsSource)}</span>
            <span>{metadataLabel(result)}</span>
          </div>
        </section>

        <section className="insight-band" aria-label="핵심 판단">
          {insights.map((insight) => (
            <div key={insight.text}>
              <insight.icon size={19} aria-hidden="true" />
              <p>{insight.text}</p>
            </div>
          ))}
        </section>

        <EditorialSection label="SIZE" title={result.size.recommendedSize ?? "미확인"} kicker="추천 사이즈">
          <p>{result.size.reason}</p>
          <div className="inline-cluster">
            <span>신뢰도 {confidenceLabel(result.size.confidence)}</span>
            {result.size.alternatives.map((size) => <span key={size}>대안 {size}</span>)}
          </div>
          {(result.size.confidence === "low" || result.size.confidence === "unavailable") && (
            <button onClick={onEditProfile} className="quiet-button">추천 정확도 높이기</button>
          )}
        </EditorialSection>

        <EditorialSection label="MATERIAL" title={result.material.blendSummary} kicker="소재 감각">
          <div className="takeaway-row">
            {materialTakeaways.map((item) => (
              <div key={item.label}>
                <item.icon size={18} aria-hidden="true" />
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>
          <details className="editorial-details">
            <summary>소재별 근거 보기</summary>
            <div>
              {result.material.materialNotes.length === 0 && <p>소재 정보가 없어 상세 근거를 만들지 않았습니다.</p>}
              {result.material.materialNotes.map((note) => (
                <p key={note.name}>
                  <strong>{note.name} {note.percentage}%</strong>
                  {[...note.pros, ...note.cons].join(" ")}
                </p>
              ))}
            </div>
          </details>
        </EditorialSection>

        <EditorialSection label="PREFERENCE MATCH" title="취향과의 거리" kicker="선택한 기준">
          <div className="preference-report">
            {result.preferenceMatches.map((match) => (
              <details key={match.preferenceId} className="editorial-details">
                <summary>
                  <span>{match.label}</span>
                  <strong>{ratingLabel(match.rating)}</strong>
                </summary>
                <p>{match.reason}</p>
              </details>
            ))}
          </div>
        </EditorialSection>

        <EditorialSection label="CARE" title="입고 관리하기" kicker={result.care.source === "product_page" ? "상품 안내 기준" : "소재 기반 추정"}>
          <div className="care-script">
            <p><strong>세탁</strong>{result.care.washing}</p>
            <p><strong>건조</strong>{result.care.drying}</p>
            <p><strong>보관</strong>{result.care.storage}</p>
            <p><strong>주의</strong>{result.care.cautions.join(" ") || "제조사 라벨을 한 번 더 확인하세요."}</p>
          </div>
        </EditorialSection>

        <EvidenceSection result={result} />
      </div>
    </article>
  );
}

function EditorialSection({ label, title, kicker, children }: { label: string; title: string; kicker: string; children: React.ReactNode }) {
  return (
    <section className="editorial-section">
      <div className="section-index">{label}</div>
      <div className="section-body">
        <p>{kicker}</p>
        <h2 className={title.length <= 4 ? "is-display" : undefined}>{title}</h2>
        <div className="section-content">{children}</div>
      </div>
    </section>
  );
}

function EvidenceSection({ result }: { result: AnalysisResult }) {
  const warnings = result.product.extractionMetadata?.warnings ?? [];
  return (
    <section className="evidence-note">
      <h2>분석 근거</h2>
      <div>
        {result.score.reasons.map((reason) => <p key={reason}>{reason}</p>)}
        {warnings.map((warning) => <p key={warning}>{warning}</p>)}
      </div>
    </section>
  );
}

function ProfileStage({ profile, onSave }: { profile: UserProfile; onSave: (profile: UserProfile) => void }) {
  const [draft, setDraft] = useState(profile);
  const [showBasics, setShowBasics] = useState(false);
  const [showMeasurements, setShowMeasurements] = useState(false);

  return (
    <section className="profile-stage stage-reveal">
      <div className="profile-visual">
        <p className="brand-line">Your fit</p>
        <h1>{draft.heightCm} / {draft.weightKg}</h1>
        <p>{fitLabels[draft.preferredFit]} 핏을 기준으로 추천합니다.</p>
        <div className="profile-lines" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </div>

      <div className="profile-editor">
        <h2>현재 정보만으로 기본 추천이 가능합니다.</h2>
        <p>필요한 만큼만 열어 수정하세요. 상세 측정은 처음부터 요구하지 않습니다.</p>

        <ProgressivePanel title="신체 정보" open={showBasics} onToggle={() => setShowBasics((value) => !value)}>
          <div className="field-grid">
            <SelectField label="성별" value={draft.gender} options={genderLabels} onChange={(value) => setDraft({ ...draft, gender: value as Gender })} />
            <SelectField label="선호 핏" value={draft.preferredFit} options={fitLabels} onChange={(value) => setDraft({ ...draft, preferredFit: value as FitPreference })} />
            <NumberField label="키 cm" value={draft.heightCm} onChange={(heightCm) => setDraft({ ...draft, heightCm })} />
            <NumberField label="몸무게 kg" value={draft.weightKg} onChange={(weightKg) => setDraft({ ...draft, weightKg })} />
            <TextField label="평소 상의 사이즈" value={draft.topSize ?? ""} onChange={(topSize) => setDraft({ ...draft, topSize })} />
            <TextField label="평소 하의 사이즈" value={draft.bottomSize ?? ""} onChange={(bottomSize) => setDraft({ ...draft, bottomSize })} />
          </div>
        </ProgressivePanel>

        <ProgressivePanel title="추천 정확도 높이기" open={showMeasurements} onToggle={() => setShowMeasurements((value) => !value)}>
          <div className="field-grid">
            <NumberField label="가슴둘레 cm" value={draft.chestCm ?? 0} optional onChange={(chestCm) => setDraft({ ...draft, chestCm: chestCm || undefined })} />
            <NumberField label="허리둘레 cm" value={draft.waistCm ?? 0} optional onChange={(waistCm) => setDraft({ ...draft, waistCm: waistCm || undefined })} />
            <NumberField label="어깨너비 cm" value={draft.shoulderCm ?? 0} optional onChange={(shoulderCm) => setDraft({ ...draft, shoulderCm: shoulderCm || undefined })} />
          </div>
        </ProgressivePanel>

        <button onClick={() => onSave(draft)} className="primary-action">
          <span>프로필 저장</span>
          <Check size={17} aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}

function PreferencesStage({ selected, onToggle }: { selected: Set<string>; onToggle: (id: UserPreference["id"]) => void }) {
  const selectedCount = selected.size;
  return (
    <section className="preferences-stage stage-reveal">
      <div className="preference-intro">
        <p className="brand-line">What matters to you?</p>
        <h1>나의 쇼핑 성향 만들기</h1>
        <p>{selectedCount}개의 기준이 분석에 반영됩니다.</p>
      </div>

      <div className="preference-canvas">
        {Object.entries(preferenceCategoryLabels).map(([category, label]) => (
          <section key={category} className="preference-cluster">
            <h2>{label}</h2>
            <div>
              {preferenceDefinitions.filter((item) => item.category === category).map((item) => (
                <button
                  key={item.id}
                  onClick={() => onToggle(item.id)}
                  className={`preference-tile ${selected.has(item.id) ? "is-selected" : ""}`}
                  aria-pressed={selected.has(item.id)}
                >
                  <span>{item.label}</span>
                  <strong>{preferenceCopy(item.id, item.plainLanguage)}</strong>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}

function HistoryStage({ history, onOpen, onStart }: { history: AnalysisResult[]; onOpen: (result: AnalysisResult) => void; onStart: () => void }) {
  if (history.length === 0) {
    return <EmptyJourney title="아직 분석 기록이 없습니다" body="상품 링크를 분석하면 궁합 점수와 추천 사이즈가 이곳에 쌓입니다." onAction={onStart} />;
  }

  return (
    <section className="history-stage stage-reveal">
      <div className="archive-head">
        <p className="brand-line">Archive</p>
        <h1>다시 볼 옷들</h1>
      </div>
      <div className="archive-list">
        {history.map((item) => (
          <button key={item.id} onClick={() => onOpen(item)} className="archive-item">
            <span>{item.score.total}</span>
            <Image src={item.product.images[0]} alt="" width={180} height={220} className="object-cover" loading="lazy" />
            <strong>{item.product.productName}</strong>
            <small>추천 사이즈 {item.size.recommendedSize ?? "미확인"}</small>
          </button>
        ))}
      </div>
    </section>
  );
}

function ProgressivePanel({ title, open, onToggle, children }: { title: string; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <section className="progressive-panel">
      <button onClick={onToggle} aria-expanded={open}>
        <span>{title}</span>
        <ChevronDown className={open ? "is-open" : ""} size={19} aria-hidden="true" />
      </button>
      {open && <div className="progressive-content stage-reveal">{children}</div>}
    </section>
  );
}

function EmptyJourney({ title, body, onAction }: { title: string; body: string; onAction?: () => void }) {
  return (
    <section className="empty-journey stage-reveal">
      <Shirt size={34} aria-hidden="true" />
      <h1>{title}</h1>
      <p>{body}</p>
      {onAction && <button className="primary-action" onClick={onAction}>상품 분석하러 가기</button>}
    </section>
  );
}

function InlineFailure({ error }: { error: NonNullable<AnalysisErrorState> }) {
  return (
    <div className="inline-failure" role="status" aria-live="polite">
      <AlertCircle size={18} aria-hidden="true" />
      <div>
        <p>{error.title}</p>
        <span>{error.message}</span>
      </div>
    </div>
  );
}

function NumberField({ label, value, optional, onChange }: { label: string; value: number; optional?: boolean; onChange: (value: number) => void }) {
  return (
    <label className="field-label">
      {label}
      <input
        type="number"
        name={label}
        autoComplete="off"
        min={optional ? 0 : 1}
        value={optional && value === 0 ? "" : value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="field-label">
      {label}
      <input name={label} autoComplete="off" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function SelectField({ label, value, options, onChange }: { label: string; value: string; options: Record<string, string>; onChange: (value: string) => void }) {
  return (
    <label className="field-label">
      {label}
      <select name={label} autoComplete="off" value={value} onChange={(event) => onChange(event.target.value)}>
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
    { icon: Shirt, text: warm ? "보온성이 좋은 편이에요" : "보온성은 보통 수준이에요" },
    { icon: Ruler, text: sizeOk ? "사이즈 근거가 비교적 충분해요" : "사이즈 신뢰도는 낮게 봤어요" },
    { icon: WashingMachine, text: careEasy ? "관리 난도는 무난해요" : "관리에 조금 신경 써야 해요" },
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
  if (verdict === "추천해요") return "나와 잘 맞아요.";
  if (verdict === "조건부 추천") return "확인하고 사면 좋아요.";
  return "조금 더 신중히 보세요.";
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

function preferenceCopy(id: UserPreference["id"], fallback: string) {
  const copies: Partial<Record<UserPreference["id"], string>> = {
    warmth: "겨울에 추운 건 싫어요.",
    soft_touch: "까슬거리는 소재는 싫어요.",
    easy_wash: "복잡한 세탁은 귀찮아요.",
    long_lasting: "금방 망가지는 옷은 싫어요.",
    low_pilling: "보풀이 빨리 올라오는 옷은 피하고 싶어요.",
    quality_first: "오래 만족할 만한 완성도가 중요해요.",
  };
  return copies[id] ?? fallback;
}
