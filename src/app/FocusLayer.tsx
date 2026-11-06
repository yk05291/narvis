"use client";

// Focus Mode: 사이드바의 패널을 화면 가운데(AI 코어 아래)로 '날아오게' 띄우고, 끝나면 제자리로 돌려보내요.
// 원리(FLIP): 원래 자리(사이드바)의 위치·크기를 재고 → 가운데 카드를 그 자리에서 시작하는 것처럼 보이게 한 뒤 → 제자리(가운데)로 움직여요.
import { useEffect, useLayoutEffect, useRef, useState } from "react";

const EASE = "cubic-bezier(.2,.8,.2,1)";
const DURATION = 520;

export default function FocusLayer({
  title,
  getSource,
  closing,
  onClose,
  onClosed,
  onHoverChange,
  children,
}: {
  title: string;
  getSource: () => HTMLElement | null; // 사이드바의 원래 패널 (없으면 그냥 페이드). 애니메이션 시작할 때 재요
  closing: boolean; // true가 되면 제자리로 돌아가는 애니메이션
  onClose: () => void; // ✕, Esc, 바깥 클릭
  onClosed: () => void; // 돌아가는 애니메이션이 끝남
  onHoverChange?: (hovering: boolean) => void; // 마우스 올리면 자동 닫힘 멈춤
  children: React.ReactNode;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  // 이 레이어는 화면에서 무언가를 눌렀을 때만 생겨서 window 를 바로 쓸 수 있어요
  const [width] = useState(() => (typeof window === "undefined" ? 600 : Math.min(620, window.innerWidth - 32)));
  const reduce = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // 사이드바 자리 → 가운데 자리로 바꾸는 transform 계산
  function fromSource(): string | null {
    const card = cardRef.current;
    const sourceEl = getSource();
    if (!card || !sourceEl) return null;
    // 이미 움직이는 중이면 멈추고 '진짜 제자리'를 재요 (안 그러면 움직인 거리가 0으로 나와요)
    card.getAnimations().forEach((a) => a.cancel());
    const a = sourceEl.getBoundingClientRect();
    const b = card.getBoundingClientRect();
    if (!a.width || !b.width) return null;
    const s = a.width / b.width;
    return `translate(${a.left - b.left}px, ${a.top - b.top}px) scale(${s})`;
  }

  // 등장
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    card.getAnimations().forEach((a) => a.cancel());
    const from = reduce ? null : fromSource();
    card.animate(
      from
        ? [
            { transform: from, opacity: 0.4 },
            { transform: "none", opacity: 1 },
          ]
        : [{ opacity: 0 }, { opacity: 1 }],
      { duration: reduce ? 150 : DURATION, easing: EASE, fill: "both" },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 퇴장 (제자리로)
  useEffect(() => {
    if (!closing) return;
    const card = cardRef.current;
    if (!card) return onClosed();
    const to = reduce ? null : fromSource();
    const anim = card.animate(
      to
        ? [
            { transform: "none", opacity: 1 },
            { transform: to, opacity: 0.3 },
          ]
        : [{ opacity: 1 }, { opacity: 0 }],
      { duration: reduce ? 150 : DURATION - 80, easing: EASE, fill: "both" },
    );
    anim.onfinish = onClosed;
    return () => anim.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closing]);

  // Esc로 닫기
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      {/* 바깥을 누르면 닫혀요 (화면은 살짝만 어둡게: 코어가 계속 보이도록) */}
      <div
        className={`focus-backdrop fixed inset-0 z-40 transition-opacity duration-500 ${closing ? "opacity-0" : "opacity-100"}`}
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="focus-card fixed z-50 flex max-h-[56vh] flex-col"
        style={{ width, left: `calc(50% - ${width / 2}px)`, transformOrigin: "0 0" }}
        onMouseEnter={() => onHoverChange?.(true)}
        onMouseLeave={() => onHoverChange?.(false)}
      >
        <div className="mb-1 flex items-center justify-between px-1 font-mono text-[11px] tracking-[0.25em] text-cyan-300/80">
          <span>FOCUS // {title}</span>
          <button onClick={onClose} className="px-1 text-cyan-100/60 hover:text-cyan-200" aria-label="닫기">
            ✕
          </button>
        </div>
        <div className="hud-scroll min-h-0 overflow-y-auto">{children}</div>
      </div>
    </>
  );
}
