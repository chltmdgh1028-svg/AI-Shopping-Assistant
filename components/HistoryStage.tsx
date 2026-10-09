"use client";

import { ChevronLeft, ChevronRight, MoreHorizontal, Trash2 } from "lucide-react";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { EmptyJourney, Mask, ProductVisual } from "@/components/common";
import { useFrameGate, useReducedMotion } from "@/components/motion/hooks";
import { RollingNumber } from "@/components/motion/RollingNumber";
import { formatPriceLabel } from "@/domain/pricing";
import type { AnalysisResult } from "@/types/shopping";

export function HistoryStage({
  history,
  onOpen,
  onDelete,
  onStart,
}: {
  history: AnalysisResult[];
  onOpen: (result: AnalysisResult) => void;
  onDelete: (id: string) => void;
  onStart: () => void;
}) {
  // Told apart so the screen can say "nothing left" after the last record is deleted, not "nothing yet".
  const [hadRecords, setHadRecords] = useState(history.length > 0);
  if (history.length > 0 && !hadRecords) setHadRecords(true);

  if (history.length === 0) {
    return hadRecords ? (
      <EmptyJourney title="아직 남아 있는 분석 기록이 없어요." body="상품 링크를 분석하면 이곳에 다시 쌓여요." onAction={onStart} />
    ) : (
      <EmptyJourney title="아직 분석 기록이 없습니다" body="상품 링크를 분석하면 궁합 점수와 추천 사이즈가 이곳에 쌓입니다." onAction={onStart} />
    );
  }

  return (
    <section className="history-stage stage-reveal">
      <div className="archive-head">
        <p className="brand-line">Archive</p>
        <Mask as="h1">다시 볼 옷들</Mask>
      </div>
      <Coverflow items={history} onOpen={onOpen} onDelete={onDelete} />
    </section>
  );
}

function Coverflow({ items, onOpen, onDelete }: { items: AnalysisResult[]; onOpen: (result: AnalysisResult) => void; onDelete: (id: string) => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const geometry = useRef({ centers: [] as number[], pitch: 1 });
  const [active, setActive] = useState(0);
  const activeRef = useRef(0);
  const gate = useFrameGate();
  const reduced = useReducedMotion();

  // Cache where each cover sits so a scroll frame only does arithmetic and writes two CSS variables
  // per cover (--o signed distance from center, --a its absolute value). Transforms do the rest.
  const measure = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    const covers = itemRefs.current.filter((el): el is HTMLButtonElement => Boolean(el));
    const centers = covers.map((el) => el.offsetLeft + el.offsetWidth / 2);
    geometry.current = { centers, pitch: centers.length > 1 ? centers[1] - centers[0] : covers[0]?.offsetWidth || 1 };
  }, []);

  const update = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    const { centers, pitch } = geometry.current;
    const middle = track.scrollLeft + track.clientWidth / 2;

    centers.forEach((center, index) => {
      const offset = Math.max(-2.5, Math.min(2.5, (center - middle) / pitch));
      const el = itemRefs.current[index];
      el?.style.setProperty("--o", offset.toFixed(3));
      el?.style.setProperty("--a", Math.abs(offset).toFixed(3));
    });

    const nearest = Math.max(0, Math.min(centers.length - 1, Math.round(track.scrollLeft / pitch)));
    if (nearest !== activeRef.current) {
      activeRef.current = nearest;
      setActive(nearest);
    }
  }, []);

  // When a record is deleted the list shrinks. Stay on the same position, so the next record slides in; after
  // the last one is deleted that position no longer exists, so the new last record is shown instead.
  useLayoutEffect(() => {
    measure();
    const track = trackRef.current;
    if (track) {
      const index = Math.max(0, Math.min(items.length - 1, activeRef.current));
      track.scrollLeft = index * geometry.current.pitch;
    }
    update();
  }, [measure, update, items.length]);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const onScroll = () => gate(update);
    const onResize = () => {
      measure();
      update();
    };
    track.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    return () => {
      track.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
    };
  }, [gate, measure, update]);

  const goTo = useCallback(
    (index: number, focus = false) => {
      const next = Math.max(0, Math.min(items.length - 1, index));
      trackRef.current?.scrollTo({ left: next * geometry.current.pitch, behavior: reduced ? "auto" : "smooth" });
      if (focus) itemRefs.current[next]?.focus({ preventScroll: true });
    },
    [items.length, reduced],
  );

  // Arrow keys, Home and End move between covers while focus is anywhere inside the carousel.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight") goTo(active + 1, true);
      else if (event.key === "ArrowLeft") goTo(active - 1, true);
      else if (event.key === "Home") goTo(0, true);
      else if (event.key === "End") goTo(items.length - 1, true);
      else return;
      event.preventDefault();
    };
    root.addEventListener("keydown", onKeyDown);
    return () => root.removeEventListener("keydown", onKeyDown);
  }, [active, goTo, items.length]);

  const current = items[active] ?? items[0];

  return (
    <>
      <div className="coverflow" ref={rootRef}>
        <div className="coverflow-track" ref={trackRef} role="group" aria-roledescription="캐러셀" aria-label="분석한 상품">
          {items.map((item, index) => (
            <button
              key={item.id}
              ref={(el) => {
                itemRefs.current[index] = el;
              }}
              type="button"
              className={`cf-item ${index === active ? "is-active" : ""}`}
              tabIndex={index === active ? 0 : -1}
              aria-label={`${item.product.productName}, MATCH ${item.score.total}${index === active ? ", 결과 보기" : ", 가운데로 이동"}`}
              aria-current={index === active}
              onClick={() => (index === active ? onOpen(item) : goTo(index))}
            >
              <span className="cf-frame">
                {/* The centered cover is the source of the shared-element morph into Result (see motion.css). */}
                <span className="cf-visual">
                  <ProductVisual key={item.product.images[0] ?? "none"} src={item.product.images[0]} />
                </span>
              </span>
            </button>
          ))}
        </div>

        <div className="cf-controls">
          <button type="button" className="cf-arrow" aria-label="이전 상품" disabled={active === 0} onClick={() => goTo(active - 1)}>
            <ChevronLeft size={20} aria-hidden="true" />
          </button>
          <span className="cf-count" aria-hidden="true">
            {active + 1} / {items.length}
          </span>
          <button type="button" className="cf-arrow" aria-label="다음 상품" disabled={active === items.length - 1} onClick={() => goTo(active + 1)}>
            <ChevronRight size={20} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="coverflow-info" aria-live="polite">
        <p className="info-date">{formatDate(current.analyzedAt)}</p>
        <Mask as="h2" key={`name-${current.id}`} className="info-name">
          {current.product.productName}
        </Mask>

        <dl className="info-stats">
          <div>
            <dt>현재 가격</dt>
            <dd>{priceNode(current)}</dd>
          </div>
          <div>
            <dt>MATCH</dt>
            <dd>
              <RollingNumber text={String(current.score.total)} />
            </dd>
          </div>
          <div>
            <dt>추천 사이즈</dt>
            <dd>
              <Mask key={current.id}>{current.size.recommendedSize ?? "미확인"}</Mask>
            </dd>
          </div>
        </dl>

        <ul className="info-tags" key={`tags-${current.id}`}>
          {featuresOf(current).map((tag, index) => (
            <li key={tag} style={{ "--i": index } as CSSProperties}>
              {tag}
            </li>
          ))}
        </ul>

        <div className="info-actions">
          <button type="button" className="primary-action" onClick={() => onOpen(current)}>
            <span>결과 보기</span>
          </button>
          <RecordMenu name={current.product.productName} onDelete={() => onDelete(current.id)} />
        </div>
      </div>
    </>
  );
}

function priceNode(item: AnalysisResult) {
  const pricing = item.product.pricing;
  if (pricing) return <RollingNumber text={formatPriceLabel(pricing.currentPrice, pricing.currency)} />;
  return <span className="price-missing">{item.product.price ?? "확인 못 함"}</span>;
}

/** What the user chose that this garment satisfies, then its lead fiber. Never invents a feature. */
function featuresOf(item: AnalysisResult) {
  const good = item.preferenceMatches
    .filter((match) => match.available !== false && (match.rating === "excellent" || match.rating === "good"))
    .slice(0, 2)
    .map((match) => match.label);
  const lead = item.product.materials[0];
  const tags = [...good, ...(lead ? [`${lead.name} ${lead.percentage}%`] : [])];
  return tags.length > 0 ? tags : ["분석 결과 보기"];
}

function formatDate(iso: string) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("ko-KR", { month: "long", day: "numeric" }) + " 분석";
}

/**
 * Delete is a secondary action: a small "more" button beside 결과 보기, always visible (not hover-only), reachable
 * by tap, keyboard and screen reader. Deleting always asks first.
 */
function RecordMenu({ name, onDelete }: { name: string; onDelete: () => void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const titleId = useId();

  useEffect(() => {
    if (!menuOpen) return;
    menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node) && !moreRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        moreRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  // The dialog holds focus: it opens on the safe choice, Escape cancels, Tab cycles between its two buttons.
  useEffect(() => {
    if (!confirming) return;
    cancelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setConfirming(false);
        moreRef.current?.focus();
      } else if (event.key === "Tab") {
        const first = cancelRef.current;
        const last = confirmRef.current;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [confirming]);

  return (
    <div className="record-menu">
      <button
        ref={moreRef}
        type="button"
        className="more-button"
        aria-label={`${name} 기록 메뉴`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-controls={menuOpen ? menuId : undefined}
        onClick={() => setMenuOpen((open) => !open)}
      >
        <MoreHorizontal size={20} aria-hidden="true" />
      </button>

      {menuOpen && (
        <div ref={menuRef} id={menuId} className="menu-popover" role="menu" aria-label="기록 메뉴">
          <button
            type="button"
            role="menuitem"
            className="menu-item is-danger"
            onClick={() => {
              setMenuOpen(false);
              setConfirming(true);
            }}
          >
            <Trash2 size={16} aria-hidden="true" />
            기록에서 삭제
          </button>
        </div>
      )}

      {confirming && (
        <div className="confirm-scrim">
          <div className="confirm-card" role="alertdialog" aria-modal="true" aria-labelledby={titleId}>
            <h2 id={titleId}>이 상품을 기록에서 삭제할까요?</h2>
            <p className="confirm-name">{name}</p>
            <p>이 기록만 지워지고, 프로필과 취향 설정은 그대로 남아요.</p>
            <div className="confirm-actions">
              <button
                ref={cancelRef}
                type="button"
                className="quiet-button"
                onClick={() => {
                  setConfirming(false);
                  moreRef.current?.focus();
                }}
              >
                취소
              </button>
              <button
                ref={confirmRef}
                type="button"
                className="danger-button"
                onClick={() => {
                  setConfirming(false);
                  onDelete();
                }}
              >
                삭제
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
