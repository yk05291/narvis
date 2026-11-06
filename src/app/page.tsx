"use client";

import { useEffect, useRef, useState } from "react";
import CalibrationPanel, { type Onboarding } from "./CalibrationPanel";
import TodayPanel, { GOOGLE_MSG } from "./TodayPanel";
import AICore from "./AICore";
import BriefingCard from "./BriefingCard";
import type { CoreState } from "@/lib/voice/level";
import { startRecording, transcribe, type Recording } from "@/lib/voice/recorder";
import { speak, stopSpeaking, ttsSupported } from "@/lib/voice/speaker";

type ChatTurn = { role: "user" | "assistant"; text: string; notices?: Notice[] };
type PendingAction = { id: string; kind: string; summary: string };
type Notice = {
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
const GREETING_RESUME = "지난번에 하던 설정을 이어서 할게요. 위 패널에서 비어 있는 항목을 알려주세요.";

export default function Home() {
  const [mode, setMode] = useState<"loading" | "onboarding" | "main">("loading");
  const [ob, setOb] = useState<Onboarding | null>(null);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [scheduleKey, setScheduleKey] = useState(0);
  const [voiceOn, setVoiceOn] = useState(true);
  const [hint, setHint] = useState<string | null>(null);
  const recRef = useRef<Recording | null>(null);
  const [input, setInput] = useState("");
  const [core, setCore] = useState<CoreState>("STANDBY");
  const [pending, setPending] = useState<PendingAction[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notices, setNotices] = useState<{ latest: Notice[]; open: Notice[] }>({ latest: [], open: [] });
  const [noticeTab, setNoticeTab] = useState<"open" | "latest">("open");
  const bottomRef = useRef<HTMLDivElement>(null);

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
    fetch("/api/notices")
      .then((r) => r.json())
      .then((d) => {
        setNotices({ latest: d.latest ?? [], open: d.open ?? [] });
        if (!d.open?.length) setNoticeTab("latest");
      })
      .catch(() => {});
  }, []);

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

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
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

  return (
    <main className="hud-bg flex min-h-screen flex-col items-center gap-6 px-4 py-8 text-cyan-50">
      <header className="flex w-full max-w-3xl flex-wrap items-center justify-between gap-x-4 gap-y-2 whitespace-nowrap font-mono text-xs tracking-[0.12em] text-cyan-300/70 sm:tracking-[0.3em]">
        <span>NARVIS // v0.6</span>
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {mode === "main" && (
            <button onClick={() => onboardingAction("restart")} className="hover:text-cyan-300" disabled={core === "THINKING"}>
              프로필 설정
            </button>
          )}
          <button
            onClick={toggleVoice}
            className={voiceOn ? "text-cyan-300" : "text-cyan-100/40"}
            aria-pressed={voiceOn}
            title="NARVIS 답을 소리로 읽기"
          >
            {voiceOn ? "VOICE ON" : "VOICE OFF"}
          </button>
          <span>
            {{ THINKING: "PROCESSING…", LISTENING: "LISTENING…", SPEAKING: "SPEAKING", STANDBY: mode === "onboarding" ? "CALIBRATING" : "SYSTEM ONLINE" }[core]}
          </span>
        </span>
      </header>

      <AICore state={core} />

      {googleNote && (
        <div
          role="status"
          className={`glass flex w-full max-w-3xl items-center justify-between gap-3 px-4 py-3 text-sm ${googleNote.ok ? "text-emerald-200" : "text-rose-200"}`}
        >
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

      {mode === "onboarding" && ob && (
        <p className="w-full max-w-3xl text-right text-xs text-cyan-100/50">
          구글 캘린더는 설정이 끝난 뒤 연결해도 되고,{" "}
          <a href="/api/google/connect" className="text-cyan-300 underline">
            지금 연결
          </a>
          할 수도 있어요.
        </p>
      )}

      {mode === "onboarding" && ob && (
        <CalibrationPanel ob={ob} busy={core === "THINKING"} onAction={onboardingAction} />
      )}

      {mode === "main" && (
        <BriefingCard
          refreshKey={scheduleKey}
          speaking={core === "SPEAKING"}
          onSpeak={(text) => {
            if (!ttsSupported()) return setError("이 브라우저는 음성 읽기를 지원하지 않아요.");
            setCore("SPEAKING");
            speak(text, { onEnd: () => setCore((c) => (c === "SPEAKING" ? "STANDBY" : c)) });
          }}
        />
      )}

      {mode === "main" && <TodayPanel refreshKey={scheduleKey} />}

      {mode === "main" && pending.length > 0 && (
        <section className="glass w-full max-w-3xl p-4">
          <h2 className="mb-2 font-mono text-xs tracking-widest text-amber-300">
            승인 대기 중 ({pending.length})
          </h2>
          <ul className="space-y-2">
            {pending.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>{a.summary}</span>
                <span className="flex gap-2">
                  <button onClick={() => decide(a.id, true)} className="btn btn-ok">승인</button>
                  <button onClick={() => decide(a.id, false)} className="btn btn-no">취소</button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {mode === "main" && (notices.latest.length > 0 || notices.open.length > 0) && (
        <section className="glass w-full max-w-3xl p-4">
          <div className="mb-3 flex gap-4 font-mono text-xs tracking-widest">
            <button
              onClick={() => setNoticeTab("open")}
              className={noticeTab === "open" ? "text-cyan-300" : "text-cyan-100/40"}
            >
              마감 임박 ({notices.open.length})
            </button>
            <button
              onClick={() => setNoticeTab("latest")}
              className={noticeTab === "latest" ? "text-cyan-300" : "text-cyan-100/40"}
            >
              최근 학교 공지
            </button>
          </div>
          <ul className="space-y-2 text-sm">
            {(noticeTab === "open" ? notices.open : notices.latest).map((n) => (
              <li key={n.id} className="flex items-start gap-2">
                <span className="shrink-0 rounded bg-cyan-400/10 px-1.5 py-0.5 text-xs text-cyan-300">{n.category}</span>
                <a href={n.source_url} target="_blank" rel="noreferrer" className="flex-1 hover:text-cyan-300">
                  {n.title}
                  {n.structured_data?.summary && (
                    <span className="block text-xs text-cyan-100/50">{n.structured_data.summary}</span>
                  )}
                </a>
                {n.structured_data?.application_end ? (
                  <span
                    className={`shrink-0 font-mono text-xs ${dday(n.structured_data.application_end) === "마감" ? "text-cyan-100/40" : "text-amber-300"}`}
                  >
                    {dday(n.structured_data.application_end)}
                  </span>
                ) : (
                  <span className="shrink-0 font-mono text-xs text-cyan-100/40">{n.posted_at}</span>
                )}
              </li>
            ))}
            {noticeTab === "open" && notices.open.length === 0 && (
              <li className="text-cyan-100/50">지금 신청 중인 공지가 없어요.</li>
            )}
          </ul>
        </section>
      )}

      <section className="glass flex w-full max-w-3xl flex-1 flex-col">
        <div className="flex-1 space-y-3 overflow-y-auto p-4" style={{ maxHeight: "50vh" }}>
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
          {core === "LISTENING" && (
            <div className="font-mono text-xs text-cyan-300/70">듣고 있어요… 말을 마치면 잠시 후 자동으로 보내요</div>
          )}
          {hint && <div className="text-sm text-amber-300/80">{hint}</div>}
          {error && <div className="text-sm text-rose-400">⚠ {error}</div>}
          <div ref={bottomRef} />
        </div>
        <form
          className="flex gap-2 border-t border-cyan-400/20 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <input
            className="flex-1 rounded-md bg-black/40 px-3 py-2 outline-none ring-1 ring-cyan-400/30 focus:ring-cyan-300"
            placeholder={
              mode === "onboarding"
                ? "예: 다혜님이라고 불러줘, 컴퓨터정보과 2학년 2학기야"
                : "예: 오늘 일정 알려줘 / 금요일까지 자료구조 과제 추가해줘"
            }
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <button
            type="button"
            onClick={toggleMic}
            disabled={core === "THINKING" || mode === "loading"}
            className={`btn ${core === "LISTENING" ? "btn-rec" : "btn-no"}`}
            aria-label={core === "LISTENING" ? "듣기 멈추기" : "음성으로 말하기"}
            title={core === "LISTENING" ? "듣기 멈추기" : "음성으로 말하기"}
          >
            {core === "LISTENING" ? "■" : "🎤"}
          </button>
          <button className="btn btn-ok" disabled={core === "THINKING" || mode === "loading"}>전송</button>
        </form>
      </section>
    </main>
  );
}
