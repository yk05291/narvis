"use client";

// STUDY PROGRESS: 이번 주 과제 완료율 + 마감 순 목록 + 체크해서 완료 + 직접 추가 + 삭제
import { useEffect, useMemo, useState } from "react";
import { cachedJson, fetchJson } from "@/lib/clientCache";

type Assignment = { id: string; subject_name: string; title: string; due_date: string; is_completed: boolean };

const fmt = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  month: "numeric",
  day: "numeric",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const kstDate = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(d);

function badge(a: Assignment, now: number) {
  if (a.is_completed) return { text: "완료", cls: "text-cyan-100/40" };
  const due = new Date(a.due_date);
  if (due.getTime() < now) return { text: "기한 지남", cls: "text-rose-300" };
  const days = Math.round((Date.parse(kstDate(due)) - Date.parse(kstDate(new Date(now)))) / 86400000);
  if (days === 0) return { text: "오늘 마감", cls: "text-amber-300" };
  return { text: `D-${days}`, cls: days <= 2 ? "text-amber-300" : "text-cyan-100/60" };
}

const URL_ALL = "/api/assignments?all=1";

// 이번 주(월~일, 한국 시간) 범위
function thisWeek(now: number) {
  const today = new Date(`${kstDate(new Date(now))}T12:00:00+09:00`);
  const dow = (today.getUTCDay() + 6) % 7;
  const mon = kstDate(new Date(today.getTime() - dow * 86400000));
  const sun = kstDate(new Date(today.getTime() + (6 - dow) * 86400000));
  return { mon, sun };
}

// 기본 마감: 일주일 뒤 23:59 (한국 시간)
function defaultDue() {
  const d = new Date(Date.now() + 7 * 86400000);
  return `${kstDate(d)}T23:59`;
}

export default function AssignmentsPanel({ refreshKey, onChanged }: { refreshKey: number; onChanged: () => void }) {
  type Data = { assignments: Assignment[]; subjects: string[] };
  const [list, setList] = useState<Assignment[] | null>(() => cachedJson<Data>(URL_ALL)?.assignments ?? null);
  const [subjects, setSubjects] = useState<string[]>(() => cachedJson<Data>(URL_ALL)?.subjects ?? []);
  const [showDone, setShowDone] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ subject_name: "", title: "", due: "" });
  const [error, setError] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [now, setNow] = useState(() => (cachedJson(URL_ALL) ? Date.now() : 0));
  // 방금 체크한 건 잠깐 목록에 남겨서 줄 긋는 게 보이게
  const [recentlyDone] = useState(() => new Set<string>());

  useEffect(() => {
    let alive = true;
    fetchJson<Data & { error?: string }>(URL_ALL) // 완료율 계산을 위해 항상 전부 받아요
      .then((d) => {
        if (!alive) return;
        if (d.error) setError(d.error);
        else {
          setList(d.assignments);
          setSubjects(d.subjects ?? []);
          setNow(Date.now());
        }
      })
      .catch(() => alive && setError("과제를 불러오지 못했어요."));
    return () => {
      alive = false;
    };
  }, [refreshKey]);

  const sorted = useMemo(
    () =>
      [...(list ?? [])]
        .filter((a) => showDone || !a.is_completed || recentlyDone.has(a.id))
        .sort((a, b) => Number(a.is_completed) - Number(b.is_completed) || a.due_date.localeCompare(b.due_date)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [list, showDone],
  );

  // 이번 주 진행률
  const week = useMemo(() => {
    if (!list || !now) return { done: 0, total: 0 };
    const { mon, sun } = thisWeek(now);
    const inWeek = list.filter((a) => {
      const d = kstDate(new Date(a.due_date));
      return d >= mon && d <= sun;
    });
    return { done: inWeek.filter((a) => a.is_completed).length, total: inWeek.length };
  }, [list, now]);
  const pct = week.total ? Math.round((week.done / week.total) * 100) : 0;

  async function toggle(a: Assignment) {
    if (!a.is_completed) recentlyDone.add(a.id);
    setList((l) => l?.map((x) => (x.id === a.id ? { ...x, is_completed: !a.is_completed } : x)) ?? null);
    const res = await fetch("/api/assignments", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: a.id, done: !a.is_completed }),
    });
    if (!res.ok) {
      setError("바꾸지 못했어요. 다시 시도해 주세요.");
      setList((l) => l?.map((x) => (x.id === a.id ? a : x)) ?? null); // 원래대로
      return;
    }
    onChanged();
  }

  async function remove(id: string) {
    if (confirmDel !== id) return setConfirmDel(id);
    setConfirmDel(null);
    const res = await fetch(`/api/assignments?id=${id}`, { method: "DELETE" });
    if (res.ok) {
      setList((l) => l?.filter((x) => x.id !== id) ?? null);
      onChanged();
    } else setError("지우지 못했어요.");
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/assignments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return setError(d.error ?? "저장하지 못했어요.");
    setList((l) => [...(l ?? []), d.assignment]);
    setNow(Date.now());
    setAdding(false);
    onChanged();
  }

  const openCount = list?.filter((a) => !a.is_completed).length ?? 0;

  return (
    <section className="glass w-full max-w-3xl p-4" aria-label="과제">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-xs tracking-widest text-amber-300">STUDY PROGRESS // 남은 과제 {openCount}</span>
        <span className="flex items-center gap-3 text-xs">
          <label className="flex cursor-pointer items-center gap-1 text-cyan-100/60">
            <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
            완료한 것도 보기
          </label>
          <button
            onClick={() => {
              setForm({ subject_name: subjects[0] ?? "", title: "", due: defaultDue() });
              setAdding((v) => !v);
              setError(null);
            }}
            className="btn btn-ok"
          >
            {adding ? "닫기" : "+ 과제 추가"}
          </button>
        </span>
      </div>

      <div className="mb-3">
        <div className="mb-1 flex justify-between font-mono text-[11px] text-cyan-100/60">
          <span>이번 주 과제</span>
          <span>
            {week.total ? `${week.done}/${week.total} 완료 · ${pct}%` : "이번 주 마감 과제 없음"}
          </span>
        </div>
        <div
          className="h-1.5 w-full overflow-hidden rounded bg-cyan-400/10"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="이번 주 과제 완료율"
        >
          <div className="h-full bg-gradient-to-r from-cyan-400 to-emerald-300 transition-all duration-700" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {adding && (
        <form onSubmit={add} className="mb-3 grid gap-2 rounded border border-cyan-400/20 p-3 sm:grid-cols-[1fr_1.5fr_auto_auto]">
          <input
            list="narvis-subjects"
            required
            placeholder="과목"
            aria-label="과목"
            value={form.subject_name}
            onChange={(e) => setForm({ ...form, subject_name: e.target.value })}
            className="rounded bg-black/40 px-2 py-1.5 text-sm outline-none ring-1 ring-cyan-400/30 focus:ring-cyan-300"
          />
          <datalist id="narvis-subjects">
            {subjects.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          <input
            required
            placeholder="과제 제목 (예: 연결 리스트 구현)"
            aria-label="과제 제목"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            className="rounded bg-black/40 px-2 py-1.5 text-sm outline-none ring-1 ring-cyan-400/30 focus:ring-cyan-300"
          />
          <input
            type="datetime-local"
            required
            aria-label="마감"
            value={form.due}
            onChange={(e) => setForm({ ...form, due: e.target.value })}
            className="rounded bg-black/40 px-2 py-1.5 text-sm outline-none ring-1 ring-cyan-400/30 focus:ring-cyan-300 [color-scheme:dark]"
          />
          <button className="btn btn-ok">저장</button>
        </form>
      )}

      {error && <p className="mb-2 text-sm text-rose-300">{error}</p>}
      {list === null && !error && <p className="text-sm text-cyan-100/50">불러오는 중…</p>}
      {list && sorted.length === 0 && (
        <p className="text-sm text-cyan-100/50">남은 과제가 없어요 🎉 (채팅으로 &quot;금요일까지 ○○ 과제 추가해줘&quot;도 돼요)</p>
      )}

      <ul className="space-y-1.5">
        {sorted.map((a) => {
          const b = badge(a, now);
          return (
            <li key={a.id} className="flex items-center gap-3 text-sm">
              <input
                type="checkbox"
                checked={a.is_completed}
                onChange={() => toggle(a)}
                aria-label={`${a.title} 완료`}
                className="h-4 w-4 shrink-0 accent-cyan-400"
              />
              <span className={`flex-1 ${a.is_completed ? "text-cyan-100/40 line-through" : ""}`}>
                <span className="mr-1 text-xs text-cyan-300">{a.subject_name}</span>
                {a.title}
                <span className="block font-mono text-[11px] text-cyan-100/40">{fmt.format(new Date(a.due_date))}</span>
              </span>
              <span className={`shrink-0 font-mono text-xs ${b.cls}`}>{b.text}</span>
              <button
                onClick={() => remove(a.id)}
                onBlur={() => setConfirmDel(null)}
                className={`shrink-0 text-xs ${confirmDel === a.id ? "text-rose-300" : "text-cyan-100/30 hover:text-rose-300"}`}
              >
                {confirmDel === a.id ? "정말 삭제?" : "삭제"}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
