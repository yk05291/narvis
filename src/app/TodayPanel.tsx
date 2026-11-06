"use client";

// 오늘 일정 대시보드: 수업 + 구글 캘린더 + NARVIS 일정 + 마감 과제를 시간순으로
import { useEffect, useState } from "react";
import { cachedJson, fetchJson } from "@/lib/clientCache";

type Item = { time: string; end?: string; title: string; kind: "수업" | "구글" | "일정" | "마감" | "학사"; sub?: string | null; link?: string | null };
type Schedule = {
  date: string;
  classes: { subject_name: string; start_time: string; end_time: string; classroom: string | null }[];
  events: { title: string; start_time: string; end_time: string; location: string | null }[];
  google_events: { title: string; start_time: string; end_time: string; all_day: boolean; location: string | null; link: string | null }[];
  google_status: "ok" | "not_connected" | "error";
  assignments_due: { subject_name: string; title: string; due_date: string }[];
  academic_events?: { title: string; start_date: string; end_date: string; category: string }[];
  google: { configured: boolean; connected: boolean; email: string | null };
};

const hm = (iso: string) =>
  new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));

const KIND_STYLE: Record<Item["kind"], string> = {
  수업: "text-cyan-300 bg-cyan-400/10",
  구글: "text-emerald-300 bg-emerald-400/10",
  일정: "text-violet-300 bg-violet-400/10",
  마감: "text-amber-300 bg-amber-400/10",
  학사: "text-sky-300 bg-sky-400/10",
};

function toItems(s: Schedule): Item[] {
  const items: Item[] = [
    ...s.classes.map((c) => ({ time: c.start_time.slice(0, 5), end: c.end_time.slice(0, 5), title: c.subject_name, kind: "수업" as const, sub: c.classroom })),
    ...s.google_events.map((e) => ({
      time: e.all_day ? "종일" : hm(e.start_time),
      end: e.all_day ? undefined : hm(e.end_time),
      title: e.title,
      kind: "구글" as const,
      sub: e.location,
      link: e.link,
    })),
    ...s.events.map((e) => ({ time: hm(e.start_time), end: hm(e.end_time), title: e.title, kind: "일정" as const, sub: e.location })),
    ...s.assignments_due.map((a) => ({ time: hm(a.due_date), title: `${a.subject_name} · ${a.title}`, kind: "마감" as const })),
    ...(s.academic_events ?? []).map((e) => ({
      time: "종일",
      title: e.title,
      kind: "학사" as const,
      sub: e.start_date !== e.end_date ? `~${Number(e.end_date.slice(5, 7))}/${Number(e.end_date.slice(8))}` : null,
    })),
  ];
  // "종일"이 맨 위, 나머지는 시간순
  return items.sort((a, b) => (a.time === "종일" ? -1 : b.time === "종일" ? 1 : a.time.localeCompare(b.time)));
}

export const GOOGLE_MSG: Record<string, string> = {
  connected: "구글 캘린더가 연결됐어요!",
  denied: "구글 연결이 취소됐어요. 직접 취소한 게 아니라면, 구글 클라우드에서 앱이 '테스트' 상태인지 확인해 주세요 (대상 → 앱 게시).",
  scope_denied: "캘린더 권한 체크박스를 켜야 연결돼요. 다시 시도해 주세요.",
  bad_state: "연결 확인에 실패했어요. 다시 시도해 주세요.",
  not_configured: "아직 구글 앱 등록(환경변수)이 안 돼 있어요.",
  error: "구글 연결 중 오류가 났어요. 다시 시도해 주세요.",
};

export default function TodayPanel({ refreshKey }: { refreshKey: number }) {
  const [s, setS] = useState<Schedule | null>(() => cachedJson<Schedule>("/api/schedule") ?? null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchJson<Schedule & { error?: string }>("/api/schedule")
      .then((d) => alive && !d.error && setS(d))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [refreshKey]);

  async function disconnectGoogle() {
    setBusy(true);
    await fetch("/api/google/disconnect", { method: "POST" }).catch(() => {});
    const d = await fetch("/api/schedule").then((r) => r.json());
    if (!d.error) setS(d);
    setToast("구글 캘린더 연결을 해제했어요.");
    setBusy(false);
  }

  if (!s) return null;
  const items = toItems(s);
  const [, m, d] = s.date.split("-");
  const dow = ["일", "월", "화", "수", "목", "금", "토"][new Date(`${s.date}T12:00:00+09:00`).getUTCDay()];

  return (
    <section className="glass w-full max-w-3xl p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-xs tracking-widest text-cyan-300">
          TODAY // {Number(m)}월 {Number(d)}일 ({dow})
        </span>
        {s.google.connected ? (
          <span className="flex items-center gap-2 text-xs text-cyan-100/50">
            <span className="text-emerald-300">● 구글 캘린더</span>
            {s.google.email}
            <button onClick={disconnectGoogle} disabled={busy} className="underline hover:text-rose-300">
              해제
            </button>
          </span>
        ) : s.google.configured ? (
          <a href="/api/google/connect" className="btn btn-ok text-xs">
            구글 캘린더 연결
          </a>
        ) : (
          <span className="text-xs text-cyan-100/40">구글 캘린더 미설정</span>
        )}
      </div>

      {toast && (
        <div className="mb-3 flex justify-between rounded border border-cyan-400/30 px-3 py-2 text-sm">
          {toast}
          <button onClick={() => setToast(null)} className="text-cyan-100/50" aria-label="닫기">
            ✕
          </button>
        </div>
      )}
      {s.google_status === "error" && (
        <p className="mb-2 text-xs text-rose-300">구글 캘린더를 불러오지 못했어요. 나머지 일정만 보여드려요.</p>
      )}

      {items.length === 0 ? (
        <p className="text-sm text-cyan-100/50">오늘은 일정이 없어요.</p>
      ) : (
        <ul className="space-y-1.5 text-sm">
          {items.map((it, i) => (
            <li key={i} className="flex items-baseline gap-3">
              <span className="w-24 shrink-0 font-mono text-xs text-cyan-100/60">
                {it.time}
                {it.end && `–${it.end}`}
              </span>
              <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs ${KIND_STYLE[it.kind]}`}>{it.kind}</span>
              {it.link ? (
                <a href={it.link} target="_blank" rel="noreferrer" className="hover:text-cyan-300">
                  {it.title}
                </a>
              ) : (
                <span>{it.title}</span>
              )}
              {it.sub && <span className="text-xs text-cyan-100/40">{it.sub}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
