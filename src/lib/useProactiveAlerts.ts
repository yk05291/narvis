"use client";

// 능동 알림 관리: 오늘 알림 목록을 받아두고, 시간이 되면 onFire 를 불러요.
// - 15초마다 확인, 10분마다 목록 새로 받기 (과제가 새로 생겼을 수도 있어서)
// - 이미 띄운 알림은 브라우저에 기억해서 새로고침해도 다시 안 띄워요
// - 페이지를 늦게 열었으면, 30분 안에 지난 알림까지만 한 번 보여줘요
import { useEffect, useRef } from "react";

export type ProactiveAlert = {
  id: string;
  at: string;
  kind: "class" | "leave" | "assignment" | "academic" | "event";
  title: string;
  body: string;
};

const SHOWN_KEY = "narvis_alerts_shown";
const LATE_WINDOW_MS = 30 * 60 * 1000;

function loadShown(): Record<string, number> {
  try {
    const raw = JSON.parse(localStorage.getItem(SHOWN_KEY) ?? "{}") as Record<string, number>;
    // 이틀 지난 기록은 정리
    const cutoff = Date.now() - 2 * 86400000;
    return Object.fromEntries(Object.entries(raw).filter(([, t]) => t > cutoff));
  } catch {
    return {};
  }
}
function saveShown(v: Record<string, number>) {
  try {
    localStorage.setItem(SHOWN_KEY, JSON.stringify(v));
  } catch {}
}

export function useProactiveAlerts({
  enabled,
  refreshKey,
  onFire,
}: {
  enabled: boolean;
  refreshKey: number;
  onFire: (a: ProactiveAlert) => void;
}) {
  const alerts = useRef<ProactiveAlert[]>([]);
  const fire = useRef(onFire);
  useEffect(() => {
    fire.current = onFire;
  }, [onFire]);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;

    // 시간 된 알림 띄우기
    const check = () => {
      const now = Date.now();
      const shown = loadShown();
      let changed = false;
      for (const a of alerts.current) {
        const at = Date.parse(a.at);
        if (shown[a.id] || at > now || now - at > LATE_WINDOW_MS) continue;
        shown[a.id] = now;
        changed = true;
        fire.current(a);
      }
      if (changed) saveShown(shown);
    };

    // 목록 받기 → 받자마자 바로 한 번 확인 (페이지를 막 열었을 때 방금 지난 알림도 놓치지 않게)
    const load = () =>
      fetch("/api/alerts")
        .then((r) => r.json())
        .then((d) => {
          if (!alive || !Array.isArray(d.alerts)) return;
          alerts.current = d.alerts;
          check();
        })
        .catch(() => {});

    load();
    const reload = setInterval(load, 10 * 60 * 1000);
    const tick = setInterval(check, 15_000);
    const onVis = () => document.visibilityState === "visible" && check();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      alive = false;
      clearInterval(reload);
      clearInterval(tick);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [enabled, refreshKey]);
}

// 시스템 알림 (맥 알림 센터 등). 권한이 있을 때만.
export function systemNotify(a: ProactiveAlert) {
  try {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    new Notification(`NARVIS · ${a.title}`, { body: a.body, tag: a.id, icon: "/favicon.ico" });
  } catch {}
}
