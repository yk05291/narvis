// 마이크 녹음 (STT 입력)
// - Web Audio AnalyserNode 로 소리 크기를 재서 코어에 전달
// - 말을 하다가 1.5초 조용하면 자동으로 녹음 끝 (최대 30초)
import { readRms, setLevel } from "./level";

const SILENCE_LEVEL = 0.16; // 이보다 작으면 '조용함' (RMS 약 0.007)
const SILENCE_MS = 1500;
const MAX_MS = 30_000;
const NO_SPEECH_MS = 7000; // 7초 동안 아무 말도 없으면 그만

export type Recording = { stop: () => void; result: Promise<Blob | null> };

function pickMime() {
  const types = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  return types.find((t) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) ?? "";
}

export async function startRecording(): Promise<Recording> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("이 브라우저는 마이크를 지원하지 않아요.");
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });

  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);
  const buf = new Float32Array(new ArrayBuffer(analyser.fftSize * 4));

  const mime = pickMime();
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);

  let heardSpeech = false;
  let lastLoud = performance.now();
  const startedAt = performance.now();
  let raf = 0;

  const cleanup = () => {
    cancelAnimationFrame(raf);
    stream.getTracks().forEach((t) => t.stop());
    ctx.close().catch(() => {});
    setLevel(0);
  };

  const result = new Promise<Blob | null>((resolve) => {
    rec.onstop = () => {
      cleanup();
      if (!heardSpeech || chunks.length === 0) return resolve(null);
      resolve(new Blob(chunks, { type: rec.mimeType || "audio/webm" }));
    };
  });

  const tick = () => {
    const level = readRms(analyser, buf);
    setLevel(level);
    const now = performance.now();
    if (level > SILENCE_LEVEL) {
      heardSpeech = true;
      lastLoud = now;
    }
    const elapsed = now - startedAt;
    if (
      (heardSpeech && now - lastLoud > SILENCE_MS) ||
      elapsed > MAX_MS ||
      (!heardSpeech && elapsed > NO_SPEECH_MS)
    ) {
      if (rec.state === "recording") rec.stop();
      return;
    }
    raf = requestAnimationFrame(tick);
  };

  rec.start(250);
  raf = requestAnimationFrame(tick);

  return {
    // 버튼으로 직접 멈추기 (말한 게 있으면 그대로 보내요)
    stop: () => {
      if (rec.state === "recording") rec.stop();
    },
    result,
  };
}

// 녹음 파일 → 서버(STT) → 글자
export async function transcribe(blob: Blob): Promise<string> {
  const ext = blob.type.includes("mp4") ? "m4a" : blob.type.includes("ogg") ? "ogg" : "webm";
  const form = new FormData();
  form.append("audio", blob, `speech.${ext}`);
  const res = await fetch("/api/voice/stt", { method: "POST", body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "음성 인식 실패");
  return (data.text ?? "").trim();
}
