"use client";

// 아침 브리핑 카드: 브리핑 시간이 지나면 메인 화면 맨 위에 떠요
import { useEffect, useState } from "react";
import { cachedJson, fetchJson } from "@/lib/clientCache";

type Item = { time?: string; title: string; sub?: string | null; link?: string | null };
type Briefing = {
  date: string;
  generated_at: string;
  classes: Item[];
  events: Item[];
  deadlines: Item[];
  new_notices: Item[];
  closing_notices: Item[];
  leave_by: string | null;
  spoken: string;
};
type Result =
  | { status: "disabled" }
  | { status: "not_yet"; briefing_time: string }
  | { status: "ready"; briefing_time: string; briefing: Briefing };

const DAY = ["일", "월", "화", "수", "목", "금", "토"];
const DISMISS_KEY = "narvis_briefing_dismissed";

function Section({ title, items, accent }: { title: string; items: Item[]; accent: string }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h3 className={`mb-1 font-mono text-[11px] tracking-widest ${accent}`}>{title}</h3>
      <ul className="space-y-1 text-sm">
        {items.map((it, i) => (
          <li key={i} className="flex items-baseline gap-2">
            {it.time && <span className="w-24 shrink-0 font-mono text-xs text-cyan-100/60">{it.time}</span>}
            {it.link ? (
              <a href={it.link} target="_blank" rel="noreferrer" className="hover:text-cyan-300">
                {it.title}
              </a>
            ) : (
              <span>{it.title}</span>
            )}
            {it.sub && <span className="truncate text-xs text-cyan-100/40">{it.sub}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function BriefingCard({
  onSpeak,
  speaking,
  refreshKey,
  compact = false,
  onExpand,
}: {
  onSpeak: (text: string) => void;
  speaking: boolean;
  refreshKey: number;
  compact?: boolean; // 사이드바용 짧은 모양
  onExpand?: () => void; // '자세히' → 화면 가운데로
}) {
  const [r, setR] = useState<Result | null>(() => cachedJson<Result>("/api/briefing") ?? null);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchJson<Result & { error?: string }>("/api/briefing")
      .then((d) => {
        if (!alive || d.error) return;
        setR(d);
        if (d.status === "ready") {
          let saved: string | null = null;
          try {
            saved = localStorage.getItem(DISMISS_KEY);
          } catch {}
          setDismissed(saved === d.briefing.date);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [refreshKey]);

  async function load(params: string) {
    setBusy(true);
    try {
      const d = await fetch(`/api/briefing?${params}`).then((res) => res.json());
      if (!d.error) {
        setR(d);
        setDismissed(false);
      }
    } finally {
      setBusy(false);
    }
  }

  function dismiss(date: string) {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, date);
    } catch {}
  }

  if (!r || r.status === "disabled") return null;

  if (r.status === "not_yet" || dismissed) {
    // 작게 접힌 상태
    return (
      <div className="glass flex w-full items-center justify-between gap-2 px-4 py-3 font-mono text-xs text-cyan-100/50">
        <span>{r.status === "not_yet" ? `아침 브리핑은 ${r.briefing_time}에 준비돼요` : "오늘 브리핑을 닫았어요"}</span>
        <button onClick={() => load("now=1")} disabled={busy} className="text-cyan-300 hover:underline">
          {busy ? "준비 중…" : "지금 브리핑 보기"}
        </button>
      </div>
    );
  }

  const b = r.briefing;
  const [, m, d] = b.date.split("-");
  const dow = DAY[new Date(`${b.date}T12:00:00+09:00`).getUTCDay()];
  const madeAt = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false }).format(
    new Date(b.generated_at),
  );
  const empty = !b.classes.length && !b.events.length && !b.deadlines.length && !b.new_notices.length && !b.closing_notices.length;

  if (compact) {
    return (
      <section className="glass w-full p-4" aria-label="아침 브리핑">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="font-mono text-xs tracking-widest text-cyan-300">BRIEFING // {Number(m)}.{Number(d)} ({dow})</span>
          <span className="flex items-center gap-2 text-xs">
            <button onClick={() => onSpeak(b.spoken)} className="btn btn-ok px-2 py-1" disabled={speaking} aria-label="브리핑 듣기">
              {speaking ? "…" : "▶"}
            </button>
            {onExpand && (
              <button onClick={onExpand} className="text-cyan-100/60 hover:text-cyan-300">
                자세히
              </button>
            )}
          </span>
        </div>
        <p className="line-clamp-3 text-sm leading-relaxed text-cyan-50/80">{b.spoken}</p>
        {b.leave_by && <p className="mt-2 text-xs text-amber-200">🚶 {b.leave_by}까지 출발</p>}
      </section>
    );
  }

  return (
    <section className="glass w-full p-4" aria-label="아침 브리핑">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-xs tracking-widest text-cyan-300">
          MORNING BRIEFING // {Number(m)}월 {Number(d)}일 ({dow})
        </span>
        <span className="flex items-center gap-3 text-xs">
          <button onClick={() => onSpeak(b.spoken)} className="btn btn-ok" disabled={speaking}>
            {speaking ? "읽는 중…" : "▶ 듣기"}
          </button>
          <button onClick={() => load("force=1")} disabled={busy} className="text-cyan-100/50 hover:text-cyan-300" title="지금 정보로 다시 만들기">
            {busy ? "갱신 중…" : "새로고침"}
          </button>
          <button onClick={() => dismiss(b.date)} className="text-cyan-100/50 hover:text-cyan-300" aria-label="오늘 브리핑 닫기">
            ✕
          </button>
        </span>
      </div>

      <p className="mb-4 whitespace-pre-wrap text-sm leading-relaxed text-cyan-50/90">{b.spoken}</p>

      {b.leave_by && (
        <p className="mb-3 rounded border border-amber-300/30 bg-amber-300/5 px-3 py-2 text-sm text-amber-200">
          🚶 첫 수업에 맞추려면 <b>{b.leave_by}</b>까지 출발하세요 (통학 시간 + 여유 10분)
        </p>
      )}

      {empty ? (
        <p className="text-sm text-cyan-100/50">오늘은 수업·일정·마감이 없어요. 여유로운 하루예요.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Section title="수업" items={b.classes} accent="text-cyan-300" />
          <Section title="일정" items={b.events} accent="text-emerald-300" />
          <Section title="곧 마감인 과제" items={b.deadlines} accent="text-amber-300" />
          <Section title="신청 마감 다가오는 공지" items={b.closing_notices} accent="text-amber-300" />
          <Section title="새 학교 공지" items={b.new_notices} accent="text-violet-300" />
        </div>
      )}
      <p className="mt-3 text-right font-mono text-[10px] text-cyan-100/30">{madeAt} 기준</p>
    </section>
  );
}
