"use client";

import Image from "next/image";
import { Check, ChevronDown, Clock3, Heart, Home, Link2, Loader2, Sparkles, UserRound } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { preferenceCategoryLabels, preferenceDefinitions } from "@/data/preferences";
import { traitToLabel } from "@/domain/materialEvaluation";
import { localShoppingRepository } from "@/repository/localShoppingRepository";
import { analyzeProduct } from "@/services/analyzeProduct";
import type { AnalysisResult, FitPreference, Gender, ProductInput, UserPreference, UserProfile } from "@/types/shopping";

type Tab = "home" | "history" | "preferences" | "profile";

const defaultProfile: UserProfile = {
  gender: "prefer_not_to_say",
  heightCm: 170,
  weightKg: 65,
  preferredFit: "relaxed",
};

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

const loadingSteps = ["상품 정보를 읽고 있어요", "소재 확인 중", "사이즈표 확인 중", "내 취향과 비교 중", "분석 완료"];

export function ShoppingApp() {
  const [tab, setTab] = useState<Tab>("home");
  const [profile, setProfile] = useState<UserProfile>(() => localShoppingRepository.getProfile() ?? defaultProfile);
  const [preferences, setPreferences] = useState<UserPreference[]>(() => localShoppingRepository.getPreferences());
  const [history, setHistory] = useState<AnalysisResult[]>(() => localShoppingRepository.getHistory());
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [url, setUrl] = useState("https://demo.shopping-assistant.local/wool-blend-knit");
  const [manualText, setManualText] = useState("");
  const [useManual, setUseManual] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [loadingIndex, setLoadingIndex] = useState(0);

  useEffect(() => {
    if (!isAnalyzing) return;
    const timer = window.setInterval(() => {
      setLoadingIndex((index) => Math.min(index + 1, loadingSteps.length - 1));
    }, 520);
    return () => window.clearInterval(timer);
  }, [isAnalyzing]);

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
    setLoadingIndex(0);
    const analysis = await analyzeProduct(
      input ?? { url, manualText: useManual ? manualText : undefined },
      profile,
      preferences,
    );
    localShoppingRepository.saveAnalysis(analysis);
    setResult(analysis);
    setHistory(localShoppingRepository.getHistory());
    setIsAnalyzing(false);
    setTab("home");
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-4 pb-28 pt-5 sm:px-6 lg:px-8">
      <header className="mb-5 flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#8f5f3d]">Shopping Assistant</p>
          <h1 className="mt-1 text-2xl font-semibold text-[#201c19]">나에게 맞는 옷인지 먼저 확인하세요</h1>
        </div>
        <button
          className="rounded-full border border-[#ded6cd] bg-white/70 p-3 text-[#5c3a26] shadow-sm"
          aria-label="프로필 열기"
          onClick={() => setTab("profile")}
        >
          <UserRound size={20} />
        </button>
      </header>

      {tab === "home" && (
        <div className="grid gap-4 lg:grid-cols-[1fr_1.05fr]">
          <section className="rounded-[28px] bg-[#fffdf9] p-5 shadow-sm ring-1 ring-[#e8e0d7]">
            <div className="relative mb-5 h-52 overflow-hidden rounded-[22px] bg-[#d8c7b3]">
              <Image
                src="https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=1200&q=80"
                alt="옷을 고르는 사람"
                fill
                sizes="(max-width: 1024px) 100vw, 480px"
                className="object-cover"
                priority
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/45 to-transparent" />
              <p className="absolute bottom-4 left-4 max-w-[17rem] text-xl font-semibold leading-tight text-white">
                링크 하나로 소재, 사이즈, 관리 난도를 함께 봅니다.
              </p>
            </div>
            <div className="space-y-3">
              <label className="text-sm font-medium text-[#5b5249]" htmlFor="url">
                사고 싶은 옷 링크
              </label>
              <div className="flex items-center gap-2 rounded-2xl border border-[#ded6cd] bg-white px-3 py-2">
                <Link2 className="shrink-0 text-[#8f5f3d]" size={19} />
                <input
                  id="url"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  className="min-w-0 flex-1 border-0 bg-transparent py-2 text-sm outline-none"
                  placeholder="https://..."
                />
              </div>
              <button
                onClick={() => runAnalysis()}
                disabled={isAnalyzing}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#201c19] px-4 py-3.5 font-semibold text-white disabled:opacity-60"
              >
                {isAnalyzing ? <Loader2 className="animate-spin" size={18} /> : <Sparkles size={18} />}
                분석하기
              </button>
              <button
                onClick={() => runAnalysis({ url: "https://demo.shopping-assistant.local/wool-blend-knit" })}
                className="w-full rounded-2xl border border-[#ded6cd] bg-[#f8f1ea] px-4 py-3 text-sm font-semibold text-[#5c3a26]"
              >
                샘플 상품으로 체험하기
              </button>
            </div>

            <div className="mt-5 rounded-2xl bg-[#f4eee7] p-4">
              <button
                className="flex w-full items-center justify-between text-left text-sm font-semibold"
                onClick={() => setUseManual((value) => !value)}
              >
                URL 분석 실패 시 직접 붙여넣기
                <ChevronDown className={useManual ? "rotate-180 transition" : "transition"} size={18} />
              </button>
              {useManual && (
                <textarea
                  value={manualText}
                  onChange={(event) => setManualText(event.target.value)}
                  rows={6}
                  className="mt-3 w-full rounded-2xl border border-[#ded6cd] bg-white p-3 text-sm outline-none"
                  placeholder={"상품명\nWool 60% Nylon 25% Acrylic 15%\nM 어깨 46 가슴 106 총장 65\n세탁: 찬물 울코스 권장"}
                />
              )}
            </div>

            {isAnalyzing && (
              <div className="mt-5 rounded-2xl border border-[#e1d7ce] bg-white p-4">
                {loadingSteps.map((step, index) => (
                  <div key={step} className="flex items-center gap-3 py-1.5 text-sm">
                    <span className={`flex h-5 w-5 items-center justify-center rounded-full ${index <= loadingIndex ? "bg-[#201c19] text-white" : "bg-[#ece6dd] text-[#7a7169]"}`}>
                      {index < loadingIndex ? <Check size={13} /> : index + 1}
                    </span>
                    <span className={index <= loadingIndex ? "font-medium text-[#201c19]" : "text-[#7a7169]"}>{step}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>{result ? <AnalysisView result={result} /> : <EmptyResult />}</section>
        </div>
      )}

      {tab === "history" && <HistoryView history={history} onOpen={(item) => { setResult(item); setTab("home"); }} />}
      {tab === "preferences" && (
        <PreferencesView selected={selectedPreferenceIds} onToggle={togglePreference} />
      )}
      {tab === "profile" && <ProfileView key={JSON.stringify(profile)} profile={profile} onSave={saveProfile} />}

      <BottomNav tab={tab} onChange={setTab} />
    </main>
  );
}

function EmptyResult() {
  return (
    <div className="flex h-full min-h-[28rem] flex-col justify-center rounded-[28px] border border-dashed border-[#d8cfc4] bg-white/55 p-6 text-center">
      <Sparkles className="mx-auto mb-3 text-[#8f5f3d]" />
      <h2 className="text-xl font-semibold">분석 결과가 여기에 표시됩니다</h2>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[#756f68]">
        상품 정보가 부족하면 부족하다고 말하고, 사이즈표가 없으면 추천 사이즈를 만들지 않습니다.
      </p>
    </div>
  );
}

function AnalysisView({ result }: { result: AnalysisResult }) {
  return (
    <article className="space-y-4">
      <section className="overflow-hidden rounded-[28px] bg-[#201c19] text-white shadow-sm">
        <div className="relative h-52">
          <Image src={result.product.images[0]} alt={result.product.productName} fill sizes="(max-width: 1024px) 100vw, 520px" className="object-cover opacity-70" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#201c19] via-[#201c19]/30 to-transparent" />
          <div className="absolute bottom-4 left-5 right-5">
            <p className="text-sm text-white/75">{result.product.brand ?? "브랜드 미확인"}</p>
            <h2 className="text-2xl font-semibold">{result.product.productName}</h2>
          </div>
        </div>
        <div className="grid grid-cols-[7rem_1fr] gap-4 p-5">
          <div>
            <p className="text-sm text-white/70">나와의 궁합</p>
            <p className="text-5xl font-semibold">{result.score.total}%</p>
          </div>
          <div>
            <p className="text-lg font-semibold">{result.score.verdict}</p>
            <p className="mt-2 text-sm leading-6 text-white/75">{result.score.summary}</p>
          </div>
        </div>
      </section>

      <InfoCard title="내가 원하는 조건과 비교">
        <div className="space-y-2">
          {result.preferenceMatches.map((match) => (
            <details key={match.preferenceId} className="rounded-2xl bg-[#f7f2eb] p-3">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
                <span className="font-medium">{match.label}</span>
                <span className="text-sm text-[#8f5f3d]">{ratingLabel(match.rating)}</span>
              </summary>
              <p className="mt-2 text-sm leading-6 text-[#756f68]">{match.reason}</p>
            </details>
          ))}
        </div>
      </InfoCard>

      <InfoCard title="소재 분석">
        <p className="mb-3 text-sm font-medium text-[#5c3a26]">{result.material.blendSummary}</p>
        <div className="grid grid-cols-2 gap-2 text-sm">
          {[
            ["보온성", result.material.traits.warmth],
            ["부드러움", result.material.traits.softness],
            ["통기성", result.material.traits.breathability],
            ["내구성", result.material.traits.durability],
            ["보풀 위험", result.material.traits.pillingRisk, true],
            ["관리 편의성", result.material.traits.careEase],
          ].map(([label, score, reverse]) => (
            <div key={String(label)} className="rounded-2xl bg-[#f7f2eb] p-3">
              <p className="text-[#756f68]">{label}</p>
              <p className="font-semibold">{traitToLabel(score as 1 | 2 | 3 | 4 | 5, Boolean(reverse))}</p>
            </div>
          ))}
        </div>
        <div className="mt-3 space-y-2">
          {result.material.materialNotes.map((note) => (
            <details key={note.name} className="rounded-2xl border border-[#e5ddd4] p-3">
              <summary className="cursor-pointer list-none font-medium">{note.name} {note.percentage}%</summary>
              <p className="mt-2 text-sm text-[#756f68]">{[...note.pros, ...note.cons].join(" ")}</p>
            </details>
          ))}
        </div>
      </InfoCard>

      <InfoCard title="추천 사이즈">
        <div className="flex items-end gap-3">
          <p className="text-4xl font-semibold">{result.size.recommendedSize ?? "미확인"}</p>
          <p className="pb-1 text-sm text-[#756f68]">신뢰도 {confidenceLabel(result.size.confidence)}</p>
        </div>
        <p className="mt-2 text-sm leading-6 text-[#756f68]">{result.size.reason}</p>
        {result.size.alternatives.length > 0 && (
          <p className="mt-2 text-sm">대안: {result.size.alternatives.join(", ")}</p>
        )}
      </InfoCard>

      <InfoCard title="관리법">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-[#8f5f3d]">
          {result.care.source === "product_page" ? "상품 정보" : "소재 특성을 기반으로 예상"}
        </p>
        <CareLine label="세탁" value={result.care.washing} />
        <CareLine label="건조" value={result.care.drying} />
        <CareLine label="보관" value={result.care.storage} />
        {result.care.cautions.map((caution) => (
          <p key={caution} className="mt-2 text-sm text-[#756f68]">{caution}</p>
        ))}
      </InfoCard>
    </article>
  );
}

function InfoCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[24px] bg-[#fffdf9] p-5 shadow-sm ring-1 ring-[#e8e0d7]">
      <h3 className="mb-4 text-lg font-semibold">{title}</h3>
      {children}
    </section>
  );
}

function CareLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="mb-2 grid grid-cols-[4rem_1fr] gap-3 text-sm">
      <span className="font-semibold">{label}</span>
      <span className="leading-6 text-[#756f68]">{value}</span>
    </div>
  );
}

function PreferencesView({ selected, onToggle }: { selected: Set<string>; onToggle: (id: UserPreference["id"]) => void }) {
  const categories = Object.entries(preferenceCategoryLabels);
  return (
    <section className="rounded-[28px] bg-[#fffdf9] p-5 shadow-sm ring-1 ring-[#e8e0d7]">
      <h2 className="text-2xl font-semibold">내 취향</h2>
      <p className="mt-2 text-sm leading-6 text-[#756f68]">MVP에서는 복수 선택만 보여주고, 데이터는 중요도 확장에 맞게 저장합니다.</p>
      <div className="mt-5 space-y-6">
        {categories.map(([category, label]) => (
          <div key={category}>
            <h3 className="mb-3 font-semibold">{label}</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              {preferenceDefinitions.filter((item) => item.category === category).map((item) => (
                <button
                  key={item.id}
                  onClick={() => onToggle(item.id)}
                  className={`rounded-2xl border p-4 text-left transition ${selected.has(item.id) ? "border-[#8f5f3d] bg-[#f2e6dc]" : "border-[#e5ddd4] bg-white"}`}
                >
                  <span className="font-medium">{item.label}</span>
                  <span className="mt-1 block text-sm leading-5 text-[#756f68]">{item.plainLanguage}</span>
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
    <section className="rounded-[28px] bg-[#fffdf9] p-5 shadow-sm ring-1 ring-[#e8e0d7]">
      <h2 className="text-2xl font-semibold">프로필</h2>
      <p className="mt-2 text-sm leading-6 text-[#756f68]">키와 몸무게만으로도 사용할 수 있고, 상세 치수를 넣으면 사이즈 추천 신뢰도가 올라갑니다.</p>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
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
      <button onClick={() => onSave(draft)} className="mt-5 w-full rounded-2xl bg-[#201c19] px-4 py-3.5 font-semibold text-white">
        프로필 저장
      </button>
    </section>
  );
}

function HistoryView({ history, onOpen }: { history: AnalysisResult[]; onOpen: (result: AnalysisResult) => void }) {
  if (history.length === 0) return <EmptyResult />;
  return (
    <section className="rounded-[28px] bg-[#fffdf9] p-5 shadow-sm ring-1 ring-[#e8e0d7]">
      <h2 className="text-2xl font-semibold">분석 기록</h2>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {history.map((item) => (
          <button key={item.id} onClick={() => onOpen(item)} className="overflow-hidden rounded-[22px] border border-[#e5ddd4] bg-white text-left">
            <div className="relative h-36">
              <Image src={item.product.images[0]} alt="" fill sizes="320px" className="object-cover" />
            </div>
            <div className="p-4">
              <p className="line-clamp-1 font-semibold">{item.product.productName}</p>
              <p className="mt-1 text-sm text-[#756f68]">궁합 {item.score.total}% · 추천 사이즈 {item.size.recommendedSize ?? "미확인"}</p>
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
    { id: "preferences", label: "내 취향", icon: Heart },
    { id: "profile", label: "프로필", icon: UserRound },
  ] as const;
  return (
    <nav className="safe-bottom fixed bottom-0 left-0 right-0 z-20 border-t border-[#e5ddd4] bg-[#fffdf9]/95 px-4 pt-2 backdrop-blur">
      <div className="mx-auto grid max-w-md grid-cols-4 gap-1">
        {items.map((item) => {
          const Icon = item.icon;
          const active = tab === item.id;
          return (
            <button key={item.id} onClick={() => onChange(item.id)} className={`rounded-2xl px-2 py-2 text-xs font-medium ${active ? "bg-[#201c19] text-white" : "text-[#756f68]"}`}>
              <Icon className="mx-auto mb-1" size={19} />
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
    <label className="text-sm font-medium text-[#5b5249]">
      {label}
      <input
        type="number"
        min={optional ? 0 : 1}
        value={optional && value === 0 ? "" : value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-1 w-full rounded-2xl border border-[#ded6cd] bg-white px-3 py-3 outline-none"
      />
    </label>
  );
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="text-sm font-medium text-[#5b5249]">
      {label}
      <input value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded-2xl border border-[#ded6cd] bg-white px-3 py-3 outline-none" />
    </label>
  );
}

function SelectField({ label, value, options, onChange }: { label: string; value: string; options: Record<string, string>; onChange: (value: string) => void }) {
  return (
    <label className="text-sm font-medium text-[#5b5249]">
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded-2xl border border-[#ded6cd] bg-white px-3 py-3 outline-none">
        {Object.entries(options).map(([key, label]) => (
          <option key={key} value={key}>{label}</option>
        ))}
      </select>
    </label>
  );
}

function ratingLabel(rating: string) {
  if (rating === "excellent") return "◎ 매우 적합";
  if (rating === "good") return "○ 적합";
  if (rating === "fair") return "△ 보통";
  return "× 아쉬움";
}

function confidenceLabel(confidence: string) {
  if (confidence === "high") return "높음";
  if (confidence === "medium") return "보통";
  if (confidence === "low") return "낮음";
  return "없음";
}
