import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { HistoryStage } from "@/components/HistoryStage";
import { demoProduct } from "@/data/demoProduct";
import { localShoppingRepository as repository } from "@/repository/localShoppingRepository";
import type { AnalysisResult, UserPreference, UserProfile } from "@/types/shopping";

const record = (id: string): AnalysisResult =>
  ({
    id,
    analyzedAt: "2026-10-10T00:00:00.000Z",
    product: { ...demoProduct, productName: `상품 ${id}`, images: [] },
    material: { blendSummary: "", traits: {}, materialNotes: [], assumptions: [] },
    preferenceMatches: [],
    size: { alternatives: [], confidence: "high", recommendedSize: "M", reason: "" },
    care: { source: "product_page", washing: "", drying: "", storage: "", cautions: [] },
    score: { total: 70, verdict: "조건부 추천", summary: "", components: { preferenceMatch: 70, materialMatch: 70, sizeConfidence: 70, careCompatibility: 70 }, reasons: [] },
  }) as unknown as AnalysisResult;

const profile: UserProfile = { gender: "female", heightCm: 165, weightKg: 55, preferredFit: "regular", chestCm: 90 };
const preferences: UserPreference[] = [{ id: "warmth", weight: 3 }];
const onOpen = vi.fn();
const onStart = vi.fn();

// The app's own wiring: the repository is the source of truth, state follows it.
function Harness() {
  const [history, setHistory] = useState(() => repository.getHistory());
  return <HistoryStage history={history} onOpen={onOpen} onStart={onStart} onDelete={(id) => setHistory(repository.deleteAnalysis(id))} />;
}

beforeAll(() => {
  // jsdom has no layout, no matchMedia and no element scrolling; give it just enough to drive the carousel.
  window.matchMedia ??= ((query: string) => ({ matches: false, media: query, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, onchange: null, dispatchEvent: () => false })) as typeof window.matchMedia;
  // Each cover is 100px wide and sits next to the previous one.
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => 100 });
  Object.defineProperty(HTMLElement.prototype, "offsetLeft", {
    configurable: true,
    get(this: HTMLElement) {
      return this.parentElement ? Array.from(this.parentElement.children).indexOf(this) * 100 : 0;
    },
  });
  Element.prototype.scrollTo = function scrollTo(this: Element, options?: ScrollToOptions | number) {
    if (typeof options === "object" && options.left !== undefined) {
      this.scrollLeft = options.left;
      this.dispatchEvent(new Event("scroll"));
    }
  } as typeof Element.prototype.scrollTo;
});

beforeEach(() => {
  window.localStorage.clear();
  repository.saveProfile(profile);
  repository.savePreferences(preferences);
  for (const id of ["a", "b", "c"]) repository.saveAnalysis(record(id)); // newest first: c, b, a
});

afterEach(() => cleanup());

const heading = () => screen.getByRole("heading", { level: 2 });

async function deleteCurrent(name: string) {
  fireEvent.click(screen.getByRole("button", { name: `${name} 기록 메뉴` }));
  fireEvent.click(await screen.findByRole("menuitem", { name: /기록에서 삭제/ }));
  const dialog = await screen.findByRole("alertdialog");
  await act(async () => {
    fireEvent.click(within(dialog).getByRole("button", { name: "삭제" }));
  });
}

describe("deleting from the history carousel", () => {
  it("never deletes without confirmation, and cancel keeps the record", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "상품 c 기록 메뉴" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /기록에서 삭제/ }));

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("이 상품을 기록에서 삭제할까요?")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "취소" }));

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(repository.getHistory()).toHaveLength(3);
  });

  it("closes the confirmation with Escape without deleting", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "상품 c 기록 메뉴" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /기록에서 삭제/ }));
    await screen.findByRole("alertdialog");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(repository.getHistory()).toHaveLength(3);
  });

  it("removes the record, writes localStorage, and moves on to the next one", async () => {
    render(<Harness />);
    expect(heading().textContent).toContain("상품 c");

    await deleteCurrent("상품 c");

    expect(repository.getHistory().map((item) => item.id)).toEqual(["b", "a"]);
    expect(window.localStorage.getItem("shopping-assistant:history")).not.toContain('"id":"c"');
    expect(heading().textContent).toContain("상품 b");
    expect(screen.getAllByRole("button", { name: /MATCH/ })).toHaveLength(2);
  });

  it("keeps a valid position when the last record in the row is deleted", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "다음 상품" }));
    await waitFor(() => expect(heading().textContent).toContain("상품 b"));
    fireEvent.click(screen.getByRole("button", { name: "다음 상품" }));
    await waitFor(() => expect(heading().textContent).toContain("상품 a"));

    await deleteCurrent("상품 a");

    expect(repository.getHistory().map((item) => item.id)).toEqual(["c", "b"]);
    await waitFor(() => expect(heading().textContent).toContain("상품 b"));
    expect((screen.getByRole("button", { name: "다음 상품" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows the empty state after the last record, and leaves profile and preferences alone", async () => {
    window.localStorage.clear();
    repository.saveProfile(profile);
    repository.savePreferences(preferences);
    repository.saveAnalysis(record("only"));
    render(<Harness />);

    await deleteCurrent("상품 only");

    expect(screen.getByText("아직 남아 있는 분석 기록이 없어요.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "상품 분석하러 가기" }));
    expect(onStart).toHaveBeenCalled();
    expect(repository.getHistory()).toEqual([]);
    expect(repository.getProfile()).toEqual(profile);
    expect(repository.getPreferences()).toEqual(preferences);
  });

  it("is reachable without hover: the menu button is always rendered and labelled", () => {
    render(<Harness />);
    const button = screen.getByRole("button", { name: "상품 c 기록 메뉴" });
    expect(button.getAttribute("aria-haspopup")).toBe("menu");
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });
});
