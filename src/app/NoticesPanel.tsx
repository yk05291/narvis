"use client";

// 학교 공지 패널: 마감 임박 / 최근 공지 탭
import { useEffect, useState } from "react";
import { cachedJson, fetchJson } from "@/lib/clientCache";

export type Notice = {
  id: string;
  category: string;
  title: string;
  posted_at: string | null;
  source_url: string;
  structured_data: { summary?: string | null; application_end?: string | null };
};

function dday(end: string) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
  const diff = Math.round((Date.parse(end) - Date.parse(today)) / 86400000);
  if (diff < 0) return "마감";
  return diff === 0 ? "D-DAY" : `D-${diff}`;
}

export default function NoticesPanel({ limit = 6 }: { limit?: number }) {
  type Data = { latest: Notice[]; open: Notice[] };
  const [data, setData] = useState<Data | null>(() => cachedJson<Data>("/api/notices") ?? null);
  const [tab, setTab] = useState<"open" | "latest">(() => (cachedJson<Data>("/api/notices")?.open.length === 0 ? "latest" : "open"));

  useEffect(() => {
    let alive = true;
    fetchJson<Data & { error?: string }>("/api/notices")
      .then((d) => {
        if (!alive) return;
        setData({ latest: d.latest ?? [], open: d.open ?? [] });
        if (!d.open?.length) setTab("latest");
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  if (!data) return null;
  const list = (tab === "open" ? data.open : data.latest).slice(0, limit);

  return (
    <section className="glass w-full p-4" aria-label="학교 공지">
      <div className="mb-3 flex items-center gap-4 font-mono text-xs tracking-widest">
        <span className="text-cyan-300">NOTICES //</span>
        <button onClick={() => setTab("open")} className={tab === "open" ? "text-cyan-300" : "text-cyan-100/40"}>
          마감 임박 ({data.open.length})
        </button>
        <button onClick={() => setTab("latest")} className={tab === "latest" ? "text-cyan-300" : "text-cyan-100/40"}>
          최근
        </button>
      </div>
      <ul className="space-y-2 text-sm">
        {list.map((n) => (
          <li key={n.id} className="flex items-start gap-2">
            <span className="shrink-0 rounded bg-cyan-400/10 px-1.5 py-0.5 text-[11px] text-cyan-300">{n.category}</span>
            <a href={n.source_url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 hover:text-cyan-300">
              <span className="line-clamp-2">{n.title}</span>
              {n.structured_data?.summary && (
                <span className="line-clamp-1 block text-xs text-cyan-100/50">{n.structured_data.summary}</span>
              )}
            </a>
            {n.structured_data?.application_end ? (
              <span
                className={`shrink-0 font-mono text-xs ${dday(n.structured_data.application_end) === "마감" ? "text-cyan-100/40" : "text-amber-300"}`}
              >
                {dday(n.structured_data.application_end)}
              </span>
            ) : (
              <span className="shrink-0 font-mono text-[11px] text-cyan-100/40">{n.posted_at?.slice(5)}</span>
            )}
          </li>
        ))}
        {list.length === 0 && <li className="text-cyan-100/50">지금 신청 중인 공지가 없어요.</li>}
      </ul>
    </section>
  );
}
