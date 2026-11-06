"use client";

import { useEffect, useRef, useState } from "react";
import CalibrationPanel, { type Onboarding } from "./CalibrationPanel";
import TodayPanel, { GOOGLE_MSG } from "./TodayPanel";
import AICore from "./AICore";
import BriefingCard from "./BriefingCard";
import MemoryPanel from "./MemoryPanel";
import AssignmentsPanel from "./AssignmentsPanel";
import NoticesPanel, { type Notice } from "./NoticesPanel";
import FocusLayer from "./FocusLayer";
import LiveClock from "./LiveClock";
import GoalsPanel from "./GoalsPanel";
import AcademicPanel from "./AcademicPanel";
import type { CoreState } from "@/lib/voice/level";
import { startRecording, transcribe, type Recording } from "@/lib/voice/recorder";
import { speak, stopSpeaking, ttsSupported } from "@/lib/voice/speaker";
import { systemNotify, useProactiveAlerts, type ProactiveAlert } from "@/lib/useProactiveAlerts";

type ChatTurn = { role: "user" | "assistant"; text: string; notices?: Notice[] };
type PendingAction = { id: string; kind: string; summary: string };
type FocusId = "briefing" | "schedule" | "academic" | "study" | "goals" | "notices" | "memory";
const FOCUS_TITLE: Record<FocusId, string> = {
  briefing: "MORNING BRIEFING",
  schedule: "SCHEDULE",
  academic: "ACADEMIC CALENDAR",
  study: "STUDY PROGRESS",
  goals: "GOALS",
  notices: "NOTICES",
  memory: "MEMORY",
};

// 주소(https://...)를 누를 수 있는 링크로 바꿔서 보여줘요
function Linkify({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s)]+)/g);
  return (
    <>
      {parts.map((p, i) =>
        /^https?:\/\//.test(p) ? (
          <a key={i} href={p} target="_blank" rel="noreferrer" className="break-all text-cyan-300 underline">
            링크
          </a>
        ) : (
          p
        ),
      )}
    </>
  );
}

const GREETING_MAIN = (title: string) => `안녕하세요, ${title}. NARVIS 온라인입니다. 무엇을 도와드릴까요?`;
const GREETING_ONBOARD =
  "안녕하세요. 저는 NARVIS, 당신의 개인 AI 비서입니다. 워크스페이스를 맞춰 볼게요.\n먼저, 제가 뭐라고 불러드리면 될까요? 그리고 한양여대 무슨 과에 다니세요?";
const GREETING_RESUME = "지난번에 하던 설정을 이어서 할게요. CALIBRATION 패널을 보고 비어 있는 항목을 알려주시거나, 다 맞으면 확인 · 저장을 눌러 주세요.";

export default function Home() {
  const [mode, setMode] = useState<"loading" | "onboarding" | "main">("loading");
  const [ob, setOb] = useState<Onboarding | null>(null);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [scheduleKey, setScheduleKey] = useState(0);
  // Focus Mode: 가운데로 꺼낸 패널 (auto: 답 읽기가 끝나면 자동으로 돌아감)
  const [focus, setFocus] = useState<{ id: FocusId; auto: boolean; closing: boolean } | null>(null);
  const [focusHover, setFocusHover] = useState(false);
  const panelRefs = useRef<Partial<Record<FocusId, HTMLElement | null>>>({});
  const memoryBtnRef = useRef<HTMLButtonElement>(null);
  const [voiceOn, setVoiceOn] = useState(true);
  const [alertsOn, setAlertsOn] = useState(true);
  const [toasts, setToasts] = useState<ProactiveAlert[]>([]);
  const [hint, setHint] = useState<string | null>(null);
  const recRef = useRef<Recording | null>(null);
  const [input, setInput] = useState("");
  const [core, setCore] = useState<CoreState>("STANDBY");
  const coreRef = useRef<CoreState>("STANDBY");
  useEffect(() => {
    coreRef.current = core;
  }, [core]);
  const [pending, setPending] = useState<PendingAction[]>([]);
  const [error, setError] = useState<string | null>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  function enterMain(title: string, msg?: string) {
    setMode("main");
    setTurns([{ role: "assistant", text: msg ?? GREETING_MAIN(title) }]);
  }

  useEffect(() => {
    fetch("/api/onboarding")
      .then((r) => r.json())
      .then((d: Onboarding) => {
        if (d.step === "done") return enterMain(d.draft?.boss_title ?? "Boss");
        setOb(d);
        setMode("onboarding");
        const started = Object.keys(d.draft ?? {}).length > 0;
        setTurns([{ role: "assistant", text: started ? GREETING_RESUME : GREETING_ONBOARD }]);
      })
      .catch(() => enterMain("Boss"));
    fetch("/api/actions")
      .then((r) => r.json())
      .then((d) => setPending(d.pending ?? []))
      .catch(() => {});
  }, []);

  function openFocus(id: FocusId, auto: boolean) {
    setFocusHover(false);
    setFocus({ id, auto, closing: false });
  }
  function closeFocus() {
    setFocus((f) => (f ? { ...f, closing: true } : f));
  }

  // 자동으로 꺼낸 패널은: NARVIS가 다 읽고 나서(또는 음성이 꺼져 있으면 읽을 시간 뒤) 제자리로
  useEffect(() => {
    if (!focus?.auto || focus.closing || focusHover || core !== "STANDBY") return;
    const t = setTimeout(closeFocus, voiceOn ? 2500 : 9000);
    return () => clearTimeout(t);
  }, [focus, focusHover, core, voiceOn]);

  // 구글 연결에서 돌아왔을 때 (?google=connected 등): 어느 화면이든 결과를 알려주고 주소 정리
  const [googleNote, setGoogleNote] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    const g = new URLSearchParams(window.location.search).get("google");
    if (!g) return;
    window.history.replaceState(null, "", "/");
    const t = setTimeout(() => setGoogleNote({ ok: g === "connected", text: GOOGLE_MSG[g] ?? `구글 연결 결과: ${g}` }), 0);
    return () => clearTimeout(t);
  }, []);

  // 음성 출력 켜기/끄기 설정은 이 브라우저에만 기억 (localStorage)
  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem("narvis_voice");
    } catch {}
    const t = setTimeout(() => setVoiceOn(saved !== "off" && ttsSupported()), 0);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem("narvis_alerts");
    } catch {}
    const t = setTimeout(() => setAlertsOn(saved !== "off"), 0);
    return () => clearTimeout(t);
  }, []);

  async function toggleAlerts() {
    const next = !alertsOn;
    setAlertsOn(next);
    try {
      localStorage.setItem("narvis_alerts", next ? "on" : "off");
    } catch {}
    // 켤 때 한 번: 맥 알림 센터에 띄워도 되는지 브라우저가 물어봐요
    if (next && typeof Notification !== "undefined" && Notification.permission === "default") {
      await Notification.requestPermission().catch(() => {});
    }
  }

  // 능동 알림: 시간이 되면 HUD 카드 + 대화 기록 + (음성 켜짐이면) 읽기 + 시스템 알림
  useProactiveAlerts({
    enabled: alertsOn && mode === "main",
    refreshKey: scheduleKey,
    onFire: (a) => {
      setToasts((t) => [...t.filter((x) => x.id !== a.id), a].slice(-3));
      setTurns((t) => [...t, { role: "assistant", text: `🔔 ${a.body}` }]);
      systemNotify(a);
      if (voiceOn && ttsSupported()) {
        speechQueue.current.push(a.body);
        setQueueTick((n) => n + 1);
      }
    },
  });

  // 알림 읽기 줄: 듣기·생각·말하기 중이 아닐 때 하나씩 차례로 읽어요
  const speechQueue = useRef<string[]>([]);
  const [queueTick, setQueueTick] = useState(0);
  useEffect(() => {
    if (core !== "STANDBY" || !voiceOn || speechQueue.current.length === 0) return;
    const t = setTimeout(() => {
      const text = speechQueue.current.shift();
      if (!text) return;
      setCore("SPEAKING");
      speak(text, { onEnd: () => setCore((x) => (x === "SPEAKING" ? "STANDBY" : x)) });
    }, 400);
    return () => clearTimeout(t);
  }, [core, voiceOn, queueTick]);
  // 알림 카드는 1분 뒤 자동으로 사라져요
  useEffect(() => {
    if (toasts.length === 0) return;
    const t = setTimeout(() => setToasts((x) => x.slice(1)), 60_000);
    return () => clearTimeout(t);
  }, [toasts]);

  function toggleVoice() {
    const next = !voiceOn;
    setVoiceOn(next);
    if (!next) {
      stopSpeaking();
      setCore((c) => (c === "SPEAKING" ? "STANDBY" : c));
    }
    try {
      localStorage.setItem("narvis_voice", next ? "on" : "off");
    } catch {}
  }

  // NARVIS 답을 소리로 읽기 → 코어는 SPEAKING
  function sayReply(text: string) {
    if (!voiceOn || !text) return setCore("STANDBY");
    setCore("SPEAKING");
    speak(text, { onEnd: () => setCore((c) => (c === "SPEAKING" ? "STANDBY" : c)) });
  }

  // 마이크 버튼: 누르면 듣기 시작, 다시 누르면(또는 말이 끝나고 조용해지면) 멈추고 받아쓰기
  async function toggleMic() {
    if (core === "LISTENING") {
      recRef.current?.stop();
      return;
    }
    if (core === "THINKING") return;
    stopSpeaking();
    setError(null);
    setHint(null);
    let rec: Recording;
    try {
      rec = await startRecording();
    } catch (e) {
      const name = e instanceof DOMException ? e.name : "";
      setError(
        name === "NotAllowedError"
          ? "마이크 권한이 꺼져 있어요. 주소창 왼쪽 자물쇠 아이콘에서 마이크를 '허용'으로 바꿔 주세요."
          : e instanceof Error
            ? e.message
            : "마이크를 켜지 못했어요.",
      );
      return setCore("STANDBY");
    }
    recRef.current = rec;
    setCore("LISTENING");
    const blob = await rec.result;
    recRef.current = null;
    if (!blob) {
      setHint("말소리가 들리지 않았어요. 마이크 버튼을 누르고 말씀해 주세요.");
      return setCore("STANDBY");
    }
    setCore("THINKING");
    try {
      const text = await transcribe(blob);
      if (!text) {
        setHint("잘 못 알아들었어요. 한 번 더 말씀해 주세요.");
        return setCore("STANDBY");
      }
      await send(text);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setCore("STANDBY");
    }
  }

  // 새 메시지가 오면 대화창 안에서만 맨 아래로 (페이지 전체는 안 움직이게)
  useEffect(() => {
    const el = chatScrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [turns, core]);

  async function send(spoken?: string) {
    const text = (spoken ?? input).trim();
    if (!text || (core === "THINKING" && spoken === undefined)) return;
    stopSpeaking();
    const next = [...turns, { role: "user" as const, text }];
    setTurns(next);
    if (spoken === undefined) setInput("");
    setError(null);
    setHint(null);
    setCore("THINKING");
    let reply = "";
    try {
      // 첫 인사말(assistant)은 빼고 보내요 — 대화는 user로 시작해야 해서
      const firstUser = next.findIndex((t) => t.role === "user");
      const res = await fetch(mode === "onboarding" ? "/api/onboarding" : "/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ turns: next.slice(firstUser).map(({ role, text }) => ({ role, text })) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "알 수 없는 오류");
      reply = data.reply;
      setTurns([...next, { role: "assistant", text: data.reply, notices: data.notices }]);
      if (mode === "onboarding") setOb({ step: data.step, draft: data.draft, missing: data.missing });
      if (data.pending?.length) setPending((p) => [...p, ...data.pending]);
      if (mode === "main") setScheduleKey((k) => k + 1);
      if (mode === "main" && data.focus) openFocus(data.focus as FocusId, true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    sayReply(reply);
  }

  async function onboardingAction(action: "confirm" | "edit" | "restart") {
    setCore("THINKING");
    setError(null);
    try {
      const res = await fetch("/api/onboarding/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "알 수 없는 오류");
      if (action === "confirm") {
        setOb(null);
        enterMain(data.draft.boss_title, `${data.message} 무엇을 도와드릴까요?`);
      } else {
        setOb({ step: data.step, draft: data.draft, missing: data.missing });
        setMode("onboarding");
        setTurns((t) => (action === "restart" ? [] : t).concat({ role: "assistant", text: data.message }));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCore("STANDBY");
    }
  }

  async function decide(id: string, approve: boolean) {
    const res = await fetch("/api/actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, approve }),
    });
    const data = await res.json();
    setPending((p) => p.filter((a) => a.id !== id));
    setScheduleKey((k) => k + 1);
    setTurns((t) => [...t, { role: "assistant", text: data.message ?? data.error }]);
  }

  // 패널 하나를 그려요. 사이드바(작게)와 Focus(크게) 둘 다에서 써요.
  function renderPanel(id: FocusId, inFocus: boolean) {
    switch (id) {
      case "briefing":
        return (
          <BriefingCard
            refreshKey={scheduleKey}
            compact={!inFocus}
            onExpand={() => openFocus("briefing", false)}
            speaking={core === "SPEAKING"}
            onSpeak={(text) => {
              if (!ttsSupported()) return setError("이 브라우저는 음성 읽기를 지원하지 않아요.");
              if (!inFocus) openFocus("briefing", true);
              setCore("SPEAKING");
              speak(text, { onEnd: () => setCore((c) => (c === "SPEAKING" ? "STANDBY" : c)) });
            }}
          />
        );
      case "schedule":
        return <TodayPanel refreshKey={scheduleKey} />;
      case "study":
        return <AssignmentsPanel refreshKey={scheduleKey} onChanged={() => setScheduleKey((k) => k + 1)} />;
      case "academic":
        return <AcademicPanel refreshKey={scheduleKey} limit={inFocus ? 14 : 5} />;
      case "goals":
        return <GoalsPanel refreshKey={scheduleKey} />;
      case "notices":
        return <NoticesPanel limit={inFocus ? 10 : 4} />;
      case "memory":
        return <MemoryPanel refreshKey={scheduleKey} onClose={closeFocus} />;
    }
  }

  // 사이드바 칸: Focus로 꺼내지는 동안엔 자리만 남기고 투명하게
  const slot = (id: FocusId) => (
    <div
      key={id}
      ref={(el) => {
        panelRefs.current[id] = el;
      }}
      className={`transition-opacity duration-300 ${focus?.id === id ? "opacity-0" : "opacity-100"}`}
    >
      {renderPanel(id, false)}
    </div>
  );

  const status = { THINKING: "PROCESSING", LISTENING: "LISTENING", SPEAKING: "SPEAKING", STANDBY: mode === "onboarding" ? "CALIBRATING" : "ONLINE" }[core];

  return (
    <main className="hud-bg relative min-h-screen overflow-x-hidden text-cyan-50 lg:h-screen lg:overflow-hidden">
      <div className="hud-grid pointer-events-none fixed inset-0" aria-hidden />

      {/* ── 위쪽 얇은 바 ── */}
      <header className="relative z-30 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 whitespace-nowrap px-4 pt-4 font-mono text-[11px] tracking-[0.2em] text-cyan-300/70 lg:absolute lg:inset-x-0 lg:top-0 lg:px-6">
        <span className="flex items-center gap-2">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-cyan-300 shadow-[0_0_8px_#00f0ff]" />
          NARVIS // v1.1
          <span className="ml-3 hidden sm:inline">
            <LiveClock onDayChange={() => setScheduleKey((k) => k + 1)} />
          </span>
        </span>
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {mode === "main" && (
            <button
              ref={memoryBtnRef}
              onClick={() => (focus?.id === "memory" ? closeFocus() : openFocus("memory", false))}
              className={focus?.id === "memory" ? "text-violet-300" : "hover:text-cyan-200"}
              aria-pressed={focus?.id === "memory"}
            >
              MEMORY
            </button>
          )}
          {mode === "main" && (
            <button onClick={() => onboardingAction("restart")} className="hover:text-cyan-200" disabled={core === "THINKING"}>
              PROFILE
            </button>
          )}
          {mode === "main" && (
            <button
              onClick={toggleAlerts}
              className={alertsOn ? "text-cyan-300" : "text-cyan-100/40"}
              aria-pressed={alertsOn}
              title="수업·마감·학사일정을 시간 맞춰 먼저 알려주기"
            >
              ALERTS {alertsOn ? "ON" : "OFF"}
            </button>
          )}
          <button
            onClick={toggleVoice}
            className={voiceOn ? "text-cyan-300" : "text-cyan-100/40"}
            aria-pressed={voiceOn}
            title="NARVIS 답을 소리로 읽기"
          >
            VOICE {voiceOn ? "ON" : "OFF"}
          </button>
        </span>
      </header>

      {/* ── 능동 알림 카드 (위 가운데) ── */}
      {toasts.length > 0 && (
        <div className="fixed left-1/2 top-12 z-[60] flex w-[min(480px,calc(100vw-32px))] -translate-x-1/2 flex-col gap-2" role="status" aria-live="polite">
          {toasts.map((a) => (
            <div key={a.id} className="glass glass-alert alert-in flex items-start gap-3 px-4 py-3 text-sm">
              <span aria-hidden className="text-lg leading-none">
                {{ class: "📚", leave: "🚶", assignment: "⏰", academic: "🏫", event: "📅" }[a.kind]}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-mono text-[11px] tracking-widest text-amber-300">{a.title}</span>
                <span className="text-cyan-50/90">{a.body}</span>
              </span>
              <button onClick={() => setToasts((t) => t.filter((x) => x.id !== a.id))} className="text-cyan-100/50 hover:text-cyan-200" aria-label="알림 닫기">
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ── 가운데: 거대한 AI 코어 (화면의 주인공) ── */}
      <div
        className={`pointer-events-none relative flex justify-center pt-2 lg:absolute lg:inset-0 lg:items-center lg:pt-0 ${focus ? "z-[45]" : "z-0"}`}
      >
        <div className={`core-wrap ${focus && !focus.closing ? "core-focused" : ""}`}>
          <AICore state={core} className="h-[min(46vh,92vw)] w-[min(46vh,92vw)] lg:h-[min(76vh,60vw)] lg:w-[min(76vh,60vw)]" />
        </div>
      </div>

      {/* ── 아래 가운데: 상태 + 큰 마이크 ── */}
      <div className="relative z-20 flex flex-col items-center gap-2 pb-2 lg:absolute lg:bottom-5 lg:left-1/2 lg:-translate-x-1/2 lg:pb-0">
        <span className={`font-mono text-[11px] tracking-[0.4em] ${core === "LISTENING" ? "text-rose-200" : "text-cyan-300/80"}`}>
          {status}
          {core === "LISTENING" && " · 말을 마치면 자동 전송"}
        </span>
        <button
          type="button"
          onClick={toggleMic}
          disabled={core === "THINKING" || mode === "loading"}
          className={`mic-orb ${core === "LISTENING" ? "mic-orb-rec" : ""}`}
          aria-label={core === "LISTENING" ? "듣기 멈추기" : "음성으로 말하기"}
          title={core === "LISTENING" ? "듣기 멈추기" : "음성으로 말하기"}
        >
          {core === "LISTENING" ? "■" : "🎤"}
        </button>
      </div>

      {/* ── 왼쪽 사이드바: 정보 패널들 ── */}
      <aside
        className="hud-scroll relative z-10 mx-auto mt-4 flex w-full max-w-xl flex-col gap-3 px-4 lg:absolute lg:bottom-5 lg:left-5 lg:top-12 lg:mt-0 lg:w-[320px] lg:max-w-none lg:overflow-y-auto lg:px-0 xl:w-[350px]"
        aria-label="정보 패널"
      >
        {mode === "onboarding" && ob && (
          <>
            <CalibrationPanel ob={ob} busy={core === "THINKING"} onAction={onboardingAction} />
            <p className="px-1 text-xs text-cyan-100/50">
              구글 캘린더는 설정이 끝난 뒤 연결해도 되고,{" "}
              <a href="/api/google/connect" className="text-cyan-300 underline">
                지금 연결
              </a>
              할 수도 있어요.
            </p>
          </>
        )}
        {mode === "main" && (
          <>
            {slot("briefing")}
            {slot("schedule")}
            {slot("academic")}
            {slot("study")}
            {slot("goals")}
            {slot("notices")}
          </>
        )}
      </aside>

      {/* ── 오른쪽 사이드바: 알림 + 대화 ── */}
      <aside
        className="relative z-10 mx-auto mt-3 flex w-full max-w-xl flex-col gap-3 px-4 pb-6 lg:absolute lg:bottom-5 lg:right-5 lg:top-12 lg:mt-0 lg:w-[350px] lg:max-w-none lg:px-0 lg:pb-0 xl:w-[380px]"
        aria-label="대화"
      >
        {googleNote && (
          <div role="status" className={`glass flex items-center justify-between gap-3 px-4 py-3 text-sm ${googleNote.ok ? "text-emerald-200" : "text-rose-200"}`}>
            <span>{googleNote.text}</span>
            <span className="flex shrink-0 gap-3">
              {!googleNote.ok && (
                <a href="/api/google/connect" className="underline">
                  다시 시도
                </a>
              )}
              <button onClick={() => setGoogleNote(null)} aria-label="닫기">
                ✕
              </button>
            </span>
          </div>
        )}

        {mode === "main" && pending.length > 0 && (
          <section className="glass glass-alert p-4">
            <h2 className="mb-2 font-mono text-[11px] tracking-widest text-amber-300">APPROVAL // {pending.length}</h2>
            <ul className="space-y-2">
              {pending.map((a) => (
                <li key={a.id} className="flex flex-col gap-2 text-sm">
                  {a.kind === "save_memory" ? (
                    <span>
                      <span className="mr-1 text-violet-300">💭 기억해도 될까요?</span>
                      {a.summary.replace(/^기억 · [^:]+:\s*/, "")}
                    </span>
                  ) : (
                    <span>{a.summary}</span>
                  )}
                  <span className="flex justify-end gap-2">
                    <button onClick={() => decide(a.id, true)} className="btn btn-ok">
                      {a.kind === "save_memory" ? "기억하기" : "승인"}
                    </button>
                    <button onClick={() => decide(a.id, false)} className="btn btn-no">
                      {a.kind === "save_memory" ? "아니요" : "취소"}
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="glass flex min-h-[320px] flex-1 flex-col lg:min-h-0" aria-label="대화 기록">
          <div className="px-4 pt-3 font-mono text-[11px] tracking-widest text-cyan-300/80">COMMS // 대화</div>
          <div ref={chatScrollRef} className="hud-scroll flex-1 space-y-3 overflow-y-auto p-4 max-lg:max-h-[50vh]">
            {turns.map((t, i) => (
              <div key={i} className={t.role === "user" ? "text-right" : ""}>
                <div className={`bubble ${t.role === "user" ? "bubble-user" : "bubble-ai"}`}>
                  <Linkify text={t.text} />
                </div>
                {t.notices && t.notices.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {t.notices.map((n) => (
                      <li key={n.id}>
                        <a
                          href={n.source_url}
                          target="_blank"
                          rel="noreferrer"
                          className="block rounded-md border border-cyan-400/20 px-3 py-1.5 text-xs hover:border-cyan-300"
                        >
                          <span className="text-cyan-300">[{n.category}]</span> {n.title}
                          {n.structured_data?.application_end && (
                            <span className="ml-1 text-amber-300">· 마감 {n.structured_data.application_end}</span>
                          )}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
            {core === "THINKING" && <div className="font-mono text-xs text-cyan-300/70">NARVIS 분석 중…</div>}
            {hint && <div className="text-sm text-amber-300/80">{hint}</div>}
            {error && <div className="text-sm text-rose-400">⚠ {error}</div>}
          </div>
          <form
            className="flex gap-2 border-t border-cyan-400/15 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <input
              className="min-w-0 flex-1 rounded-md bg-black/30 px-3 py-2 text-sm outline-none ring-1 ring-cyan-400/25 focus:ring-cyan-300"
              placeholder={mode === "onboarding" ? "예: 다혜님이라고 불러줘, 컴퓨터정보과야" : "예: 오늘 일정 알려줘"}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              aria-label="메시지"
            />
            <button className="btn btn-ok" disabled={core === "THINKING" || mode === "loading"}>
              전송
            </button>
          </form>
        </section>
      </aside>

      {/* ── Focus Mode: 패널이 가운데로 ── */}
      {focus && mode === "main" && (
        <FocusLayer
          key={focus.id}
          title={FOCUS_TITLE[focus.id]}
          getSource={() => (focus.id === "memory" ? memoryBtnRef.current : (panelRefs.current[focus.id] ?? null))}
          closing={focus.closing}
          onClose={closeFocus}
          onClosed={() => setFocus(null)}
          onHoverChange={setFocusHover}
        >
          {renderPanel(focus.id, true)}
        </FocusLayer>
      )}
    </main>
  );
}
