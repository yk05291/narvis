"use client";

// 앱 설치(PWA): 서비스 워커 등록 + 크롬/엣지가 '설치 가능'하다고 알려주면 INSTALL 버튼 표시
import { useEffect, useState } from "react";

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

export default function InstallButton() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
    const standalone = window.matchMedia("(display-mode: standalone)").matches;
    const t = setTimeout(() => setInstalled(standalone), 0);
    const onPrompt = (e: Event) => {
      e.preventDefault(); // 브라우저 기본 안내 대신 우리 버튼으로
      setPrompt(e as InstallPrompt);
    };
    const onInstalled = () => {
      setInstalled(true);
      setPrompt(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      clearTimeout(t);
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed || !prompt) return null;
  return (
    <button
      onClick={async () => {
        await prompt.prompt();
        const r = await prompt.userChoice;
        if (r.outcome === "accepted") setPrompt(null);
      }}
      className="text-emerald-300 hover:text-emerald-200"
      title="NARVIS를 앱으로 설치 (Dock·홈 화면에서 바로 실행)"
    >
      ⬇ INSTALL
    </button>
  );
}
