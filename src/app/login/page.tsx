"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok && data.ok) {
      router.replace("/");
      router.refresh();
    }
    else setError(data.error ?? "로그인 실패");
  }

  return (
    <main className="hud-bg flex min-h-screen items-center justify-center px-4 text-cyan-50">
      <form onSubmit={submit} className="glass flex w-full max-w-sm flex-col gap-4 p-6">
        <h1 className="flex items-center gap-3 font-mono text-sm tracking-[0.3em] text-cyan-300">
          <Image src="/logo-96.png" alt="NARVIS 로고" width={40} height={40} priority className="narvis-logo rounded-full" />
          NARVIS // AUTH
        </h1>
        <p className="text-sm text-cyan-100/70">Boss 확인이 필요합니다.</p>
        <input
          type="password"
          autoFocus
          className="rounded-md bg-black/40 px-3 py-2 outline-none ring-1 ring-cyan-400/30 focus:ring-cyan-300"
          placeholder="비밀번호"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p className="text-sm text-rose-400">⚠ {error}</p>}
        <button className="btn btn-ok" disabled={busy || !password}>
          {busy ? "확인 중…" : "접속"}
        </button>
      </form>
    </main>
  );
}
