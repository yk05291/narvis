"use client";

// NARVIS가 기억하고 있는 것 목록 (Boss가 동의한 것만). 하나씩 지울 수 있어요.
import { useEffect, useState } from "react";

type Memory = { id: string; memory_key: string; memory_value: string; updated_at: string };

export default function MemoryPanel({ refreshKey, onClose }: { refreshKey: number; onClose: () => void }) {
  const [list, setList] = useState<Memory[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/memories")
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        if (d.error) setError(d.error);
        else setList(d.memories);
      })
      .catch(() => alive && setError("기억을 불러오지 못했어요."));
    return () => {
      alive = false;
    };
  }, [refreshKey]);

  async function remove(id: string) {
    const res = await fetch(`/api/memories?id=${id}`, { method: "DELETE" });
    if (res.ok) setList((l) => l?.filter((m) => m.id !== id) ?? null);
    else setError("지우지 못했어요.");
  }

  return (
    <section className="glass w-full max-w-3xl p-4" aria-label="NARVIS의 기억">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-mono text-xs tracking-widest text-violet-300">MEMORY // NARVIS가 기억하는 것</h2>
        <button onClick={onClose} className="text-cyan-100/50 hover:text-cyan-300" aria-label="기억 패널 닫기">
          ✕
        </button>
      </div>
      <p className="mb-3 text-xs text-cyan-100/50">
        대화 중에 &quot;기억해도 될까요?&quot;에서 &apos;기억하기&apos;를 누른 것만 저장돼요. 지우면 바로 잊어요.
      </p>
      {error && <p className="text-sm text-rose-300">{error}</p>}
      {list === null && !error && <p className="text-sm text-cyan-100/50">불러오는 중…</p>}
      {list?.length === 0 && (
        <p className="text-sm text-cyan-100/50">아직 기억하는 게 없어요. 예: &quot;나 매운 거 못 먹어&quot;라고 말해 보세요.</p>
      )}
      <ul className="space-y-1.5">
        {list?.map((m) => (
          <li key={m.id} className="flex items-center justify-between gap-3 text-sm">
            <span>
              <span className="mr-2 rounded bg-violet-400/10 px-1.5 py-0.5 text-xs text-violet-300">{m.memory_key}</span>
              {m.memory_value}
            </span>
            <button onClick={() => remove(m.id)} className="shrink-0 text-xs text-cyan-100/50 hover:text-rose-300">
              지우기
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
