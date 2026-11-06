"use client";

// 화면 위 실시간 시계 (한국 시간). 날짜가 바뀌면 onDayChange 를 불러서 패널들을 새로고침해요.
import { useEffect, useRef, useState } from "react";

const fmtDate = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric", weekday: "short" });
const fmtTime = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false });
const dayKey = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(d);

export default function LiveClock({ onDayChange }: { onDayChange: () => void }) {
  const [now, setNow] = useState<Date | null>(null);
  const day = useRef<string | null>(null);
  const cb = useRef(onDayChange);
  useEffect(() => {
    cb.current = onDayChange;
  }, [onDayChange]);

  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setNow(d);
      const k = dayKey(d);
      if (day.current && day.current !== k) cb.current(); // 자정이 지났어요
      day.current = k;
    };
    tick();
    const id = setInterval(tick, 15_000);
    // 노트북을 덮었다 열거나 다른 탭에 있다 돌아왔을 때도 바로 확인
    const onVis = () => document.visibilityState === "visible" && tick();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  if (!now) return null;
  return (
    <span className="tabular-nums text-cyan-200/80" aria-label="현재 날짜와 시간">
      {fmtDate.format(now)} · {fmtTime.format(now)}
    </span>
  );
}
