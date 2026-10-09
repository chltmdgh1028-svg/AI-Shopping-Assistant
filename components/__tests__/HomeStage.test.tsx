import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { HomeStage } from "@/components/HomeStage";
import { demoUrl } from "@/data/demoProduct";

beforeAll(() => {
  window.matchMedia ??= ((query: string) => ({ matches: false, media: query, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, onchange: null, dispatchEvent: () => false })) as typeof window.matchMedia;
});
afterEach(() => cleanup());

function renderHome(url: string) {
  const setUrl = vi.fn();
  render(
    <HomeStage
      url={url}
      setUrl={setUrl}
      manualText=""
      setManualText={() => undefined}
      useManual={false}
      setUseManual={() => undefined}
      error={null}
      onAnalyze={() => undefined}
      onDemo={() => undefined}
    />,
  );
  return { setUrl, input: screen.getByLabelText("상품 URL") as HTMLInputElement };
}

describe("the sample address in the Home input", () => {
  it("disappears when the field is touched, so a real link can be pasted straight away", () => {
    const { setUrl, input } = renderHome(demoUrl);
    expect(input.value).toBe(demoUrl);
    fireEvent.focus(input);
    expect(setUrl).toHaveBeenCalledWith("");
  });

  it("never wipes a link the user typed", () => {
    const { setUrl, input } = renderHome("https://shop.example.com/knit");
    fireEvent.focus(input);
    expect(setUrl).not.toHaveBeenCalled();
  });
});
