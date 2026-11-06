"use client";

// ACADEMIC CALENDAR: 한양여대 공식 학사일정 (진행 중 + 다가오는 일정, 월별로)
import { useEffect, useState } from "react";
import { cachedJson, fetchJson } from "@/lib/clientCache";

type Ev = { id: string; title: string; start_date: string; end_date: string; category: string };
const URL = "/api/academic?limit=40";
const DOW = ["일", "월", "화", "수", "목", "금", "토"];
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
const md = (iso: string) => {
  const d = new Date(`${iso}T12:00:00+09:00`);
  return `${d.getUTCMonth() + 1}.${d.getUTCDate()}(${DOW[d.getUTCDay()]})`;
};
const CAT_CLS: Record<string, string> = {
  학사: "text-cyan-300 bg-cyan-400/10",
  행사: "text-violet-300 bg-violet-400/10",
  입시: "text-amber-300 bg-amber-400/10",
  장학: "text-emerald-300 bg-emerald-400/10",
};

function badge(e: Ev, t: string) {
  if (e.start_date <= t && e.end_date >= t) return { text: "진행 중", cls: "text-emerald-300" };
  const diff = Math.round((Date.parse(e.start_date) - Date.parse(t)) / 86400000);
  return { text: diff === 0 ? "D-DAY" : `D-${diff}`, cls: diff <= 7 ? "text-amber-300" : "text-cyan-100/50" };
}

export default function AcademicPanel({ refreshKey, limit = 5 }: { refreshKey: number; limit?: number }) {
  const [events, setEvents] = useState<Ev[] | null>(() => cachedJson<{ events: Ev[] }>(URL)?.events ?? null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchJson<{ events?: Ev[]; error?: string }>(URL)
      .then((d) => alive && (d.error ? setError(d.error) : setEvents(d.events ?? [])))
      .catch(() => alive && setError("학사일정을 불러오지 못했어요."));
    return () => {
      alive = false;
    };
  }, [refreshKey]);

  const t = today();
  const shown = (events ?? []).slice(0, limit);
  // 월별로 묶기
  const groups: { month: string; items: Ev[] }[] = [];
  for (const e of shown) {
    const m = `${Number(e.start_date.slice(5, 7))}월`;
    const g = groups.at(-1);
    if (g?.month === m) g.items.push(e);
    else groups.push({ month: m, items: [e] });
  }

  return (
    <section className="glass w-full p-4" aria-label="학사일정">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono text-xs tracking-widest text-cyan-300">ACADEMIC // 학사일정</span>
        <a
          href="https://www.hywoman.ac.kr/ko/cms/FrCon/index.do?MENU_ID=570"
          target="_blank"
          rel="noreferrer"
          className="text-[11px] text-cyan-100/40 hover:text-cyan-300"
        >
          학교 홈페이지 ↗
        </a>
      </div>
      {error && <p className="text-sm text-rose-300">{error}</p>}
      {events === null && !error && <p className="text-sm text-cyan-100/50">불러오는 중…</p>}
      {events && events.length === 0 && <p className="text-sm text-cyan-100/50">다가오는 학사일정이 없어요.</p>}
      <div className="space-y-2">
        {groups.map((g) => (
          <div key={g.month}>
            <div className="mb-1 font-mono text-[11px] text-cyan-100/40">{g.month}</div>
            <ul className="space-y-1.5">
              {g.items.map((e) => {
                const b = badge(e, t);
                return (
                  <li key={e.id} className="flex items-baseline gap-2 text-sm">
                    <span className="w-[92px] shrink-0 font-mono text-[11px] text-cyan-100/60">
                      {md(e.start_date)}
                      {e.end_date !== e.start_date && <span className="block">~{md(e.end_date)}</span>}
                    </span>
                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] ${CAT_CLS[e.category] ?? CAT_CLS["학사"]}`}>{e.category}</span>
                    <span className="min-w-0 flex-1">{e.title}</span>
                    <span className={`shrink-0 font-mono text-[11px] ${b.cls}`}>{b.text}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
