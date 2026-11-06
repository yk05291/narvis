"use client";

// GOALS: 학업·취업·개인 목표 + 진행률 + 목표일 D-day
import { useEffect, useState } from "react";
import { cachedJson, fetchJson } from "@/lib/clientCache";

type Category = "ACADEMIC" | "CAREER" | "PERSONAL";
type Goal = {
  id: string;
  category: Category;
  title: string;
  target_date: string | null;
  progress: number;
  is_completed: boolean;
};
const CAT: Record<Category, { ko: string; cls: string }> = {
  ACADEMIC: { ko: "학업", cls: "text-cyan-300 bg-cyan-400/10" },
  CAREER: { ko: "취업", cls: "text-emerald-300 bg-emerald-400/10" },
  PERSONAL: { ko: "개인", cls: "text-violet-300 bg-violet-400/10" },
};
const URL_ALL = "/api/goals?all=1";
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());

function dday(target: string | null) {
  if (!target) return null;
  const diff = Math.round((Date.parse(target) - Date.parse(today())) / 86400000);
  if (diff < 0) return { text: "기한 지남", cls: "text-rose-300" };
  if (diff === 0) return { text: "D-DAY", cls: "text-amber-300" };
  return { text: `D-${diff}`, cls: diff <= 14 ? "text-amber-300" : "text-cyan-100/50" };
}

export default function GoalsPanel({ refreshKey }: { refreshKey: number }) {
  const [list, setList] = useState<Goal[] | null>(() => cachedJson<{ goals: Goal[] }>(URL_ALL)?.goals ?? null);
  const [showDone, setShowDone] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<{ category: Category; title: string; target_date: string }>({ category: "ACADEMIC", title: "", target_date: "" });
  const [error, setError] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchJson<{ goals?: Goal[]; error?: string }>(URL_ALL)
      .then((d) => alive && (d.error ? setError(d.error) : setList(d.goals ?? [])))
      .catch(() => alive && setError("목표를 불러오지 못했어요."));
    return () => {
      alive = false;
    };
  }, [refreshKey]);

  async function patch(g: Goal, body: { progress?: number; done?: boolean }) {
    const res = await fetch("/api/goals", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: g.id, ...body }) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return setError(d.error ?? "바꾸지 못했어요.");
    setList((l) => l?.map((x) => (x.id === g.id ? d.goal : x)) ?? null);
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/goals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return setError(d.error ?? "저장하지 못했어요.");
    setList((l) => [...(l ?? []), d.goal]);
    setAdding(false);
  }

  async function remove(id: string) {
    if (confirmDel !== id) return setConfirmDel(id);
    setConfirmDel(null);
    const res = await fetch(`/api/goals?id=${id}`, { method: "DELETE" });
    if (res.ok) setList((l) => l?.filter((x) => x.id !== id) ?? null);
    else setError("지우지 못했어요.");
  }

  const shown = (list ?? []).filter((g) => showDone || !g.is_completed);
  const active = (list ?? []).filter((g) => !g.is_completed);
  const avg = active.length ? Math.round(active.reduce((s, g) => s + g.progress, 0) / active.length) : 0;

  return (
    <section className="glass w-full p-4" aria-label="목표">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-xs tracking-widest text-emerald-300">
          GOALS // {active.length ? `평균 ${avg}%` : "목표 없음"}
        </span>
        <span className="flex items-center gap-3 text-xs">
          <label className="flex cursor-pointer items-center gap-1 text-cyan-100/60">
            <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
            달성한 것도
          </label>
          <button
            className="btn btn-ok"
            onClick={() => {
              setForm({ category: "ACADEMIC", title: "", target_date: "" });
              setAdding((v) => !v);
              setError(null);
            }}
          >
            {adding ? "닫기" : "+ 목표"}
          </button>
        </span>
      </div>

      {adding && (
        <form onSubmit={add} className="mb-3 grid gap-2 rounded border border-cyan-400/20 p-3">
          <div className="flex gap-2">
            <select
              aria-label="분류"
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value as Category })}
              className="rounded bg-black/40 px-2 py-1.5 text-sm outline-none ring-1 ring-cyan-400/30 [color-scheme:dark]"
            >
              <option value="ACADEMIC">학업</option>
              <option value="CAREER">취업</option>
              <option value="PERSONAL">개인</option>
            </select>
            <input
              required
              aria-label="목표"
              placeholder="예: 정보처리기사 필기 합격"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="min-w-0 flex-1 rounded bg-black/40 px-2 py-1.5 text-sm outline-none ring-1 ring-cyan-400/30 focus:ring-cyan-300"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-cyan-100/60" htmlFor="goal-date">
              목표일(선택)
            </label>
            <input
              id="goal-date"
              type="date"
              value={form.target_date}
              onChange={(e) => setForm({ ...form, target_date: e.target.value })}
              className="flex-1 rounded bg-black/40 px-2 py-1.5 text-sm outline-none ring-1 ring-cyan-400/30 [color-scheme:dark]"
            />
            <button className="btn btn-ok">저장</button>
          </div>
        </form>
      )}

      {error && <p className="mb-2 text-sm text-rose-300">{error}</p>}
      {list === null && !error && <p className="text-sm text-cyan-100/50">불러오는 중…</p>}
      {list && shown.length === 0 && (
        <p className="text-sm text-cyan-100/50">목표가 없어요. 채팅으로 &quot;이번 학기에 토익 800 넘기는 게 목표야&quot;처럼 말해도 돼요.</p>
      )}

      <ul className="space-y-3">
        {shown.map((g) => {
          const d = g.is_completed ? { text: "달성 🎉", cls: "text-emerald-300" } : dday(g.target_date);
          return (
            <li key={g.id} className={g.is_completed ? "opacity-60" : ""}>
              <div className="mb-1 flex items-center gap-2 text-sm">
                <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] ${CAT[g.category].cls}`}>{CAT[g.category].ko}</span>
                <span className={`min-w-0 flex-1 truncate ${g.is_completed ? "line-through" : ""}`} title={g.title}>
                  {g.title}
                </span>
                {d && <span className={`shrink-0 font-mono text-xs ${d.cls}`}>{d.text}</span>}
              </div>
              <div className="flex items-center gap-2">
                <div
                  className="h-1.5 flex-1 overflow-hidden rounded bg-cyan-400/10"
                  role="progressbar"
                  aria-valuenow={g.progress}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${g.title} 진행률`}
                >
                  <div className="h-full bg-gradient-to-r from-emerald-400 to-cyan-300 transition-all duration-500" style={{ width: `${g.progress}%` }} />
                </div>
                <span className="w-9 text-right font-mono text-[11px] text-cyan-100/60">{g.progress}%</span>
                {!g.is_completed && (
                  <>
                    <button onClick={() => patch(g, { progress: g.progress - 10 })} disabled={g.progress <= 0} className="px-1 text-xs text-cyan-100/50 hover:text-cyan-200" aria-label="진행률 10% 내리기">
                      −
                    </button>
                    <button onClick={() => patch(g, { progress: g.progress + 10 })} disabled={g.progress >= 100} className="px-1 text-xs text-cyan-100/50 hover:text-cyan-200" aria-label="진행률 10% 올리기">
                      +
                    </button>
                  </>
                )}
                <button
                  onClick={() => patch(g, { done: !g.is_completed, ...(g.is_completed ? { progress: 90 } : {}) })}
                  className="text-xs text-cyan-100/50 hover:text-emerald-300"
                >
                  {g.is_completed ? "되돌리기" : "달성"}
                </button>
                <button
                  onClick={() => remove(g.id)}
                  onBlur={() => setConfirmDel(null)}
                  className={`text-xs ${confirmDel === g.id ? "text-rose-300" : "text-cyan-100/30 hover:text-rose-300"}`}
                >
                  {confirmDel === g.id ? "정말?" : "삭제"}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
