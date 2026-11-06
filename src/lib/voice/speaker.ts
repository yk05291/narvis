// 음성 출력 (TTS)
// Groq에는 한국어 음성 합성 모델이 없어서, 브라우저 내장 음성(speechSynthesis, 맥의 'Yuna' 등)을 써요.
// 브라우저 음성은 소리 파형을 Web Audio로 꺼낼 수 없어서, 단어가 읽힐 때마다 오는 신호(boundary)로
// '말하는 리듬'을 만들어 코어를 움직여요. (나중에 오디오 파일을 주는 TTS로 바꾸면 recorder.ts 처럼 AnalyserNode 로 진짜 파형 연결 가능)
import { readRms, setLevel } from "./level";

let speaking = false;
let envelope = 0;
let raf = 0;

export function ttsSupported() {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

function pickVoice(langPrefix: string, prefer: string[]): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices().filter((v) => v.lang?.toLowerCase().replace("_", "-").startsWith(langPrefix));
  for (const name of prefer) {
    const v = voices.find((x) => x.name.includes(name));
    if (v) return v;
  }
  return voices[0] ?? null;
}

// 한국어: 남성 목소리 우선 (맥: Reed·Eddy·Rocko), 없으면 다른 한국어 목소리
function koreanVoice(): SpeechSynthesisVoice | null {
  return pickVoice("ko", ["Reed", "Eddy", "Rocko", "Grandpa", "Yuna", "Google 한국의"]);
}

// 영어(미국) 남성 목소리 (인사용)
function englishMaleVoice(): SpeechSynthesisVoice | null {
  return pickVoice("en-us", ["Reed", "Eddy", "Rocko", "Fred", "Ralph", "Aaron", "Alex", "Microsoft Guy", "Microsoft David", "Google US English"]);
}

// 읽기 좋게 정리: 링크·기호·이모지 빼기
const DAY_NAME: Record<string, string> = { 월: "월요일", 화: "화요일", 수: "수요일", 목: "목요일", 금: "금요일", 토: "토요일", 일: "일요일" };
const hm = (h: string, m: string) => (m === "00" ? `${Number(h)}시` : m === "30" ? `${Number(h)}시 반` : `${Number(h)}시 ${Number(m)}분`);

export function cleanForSpeech(text: string) {
  return text
    .replace(/https?:\/\/\S+/g, " ")
    // 2026-11-06 (금) / 2026‑11‑06 → 11월 6일 금요일
    .replace(
      /\d{4}[-‑.]\s?(\d{1,2})[-‑.]\s?(\d{1,2})\.?(\s*)(?:\(([월화수목금토일])\)|([월화수목금토일])(?![가-힣]))?/g,
      (_, m, d, sp, w1, w2) => `${Number(m)}월 ${Number(d)}일${w1 || w2 ? ` ${DAY_NAME[w1 || w2]}` : sp}`,
    )
    // 2026-2 종강 → 2학기 종강 (학교 학기 표기)
    .replace(/\b\d{4}-([12])(?!\d)/g, (_, n) => `${n}학기`)
    // 12월 21일(월) → 12월 21일 월요일
    .replace(/(\d{1,2}월 \d{1,2}일)\s*\(([월화수목금토일])\)/g, (_, d, w) => `${d} ${DAY_NAME[w]}`)
    // 12월 15일 화요일 ~ 12월 21일 월요일 → …부터 …까지
    .replace(/(\d{1,2}월 \d{1,2}일(?: [월화수목금토일]요일)?)\s*~\s*(\d{1,2}월 \d{1,2}일(?: [월화수목금토일]요일)?)/g, "$1부터 $2까지")
    .replace(/\s*·\s*/g, ", ")
    // 11/6 → 11월 6일
    .replace(/(?<![\d:])(\d{1,2})\/(\d{1,2})(?![\d/])/g, (_, m, d) => `${Number(m)}월 ${Number(d)}일`)
    // 13:00–15:00 / 13:00~15:00 → 13시부터 15시까지
    .replace(/(\d{1,2}):(\d{2})\s*[-–~‑]\s*(\d{1,2}):(\d{2})/g, (_, h1, m1, h2, m2) => `${hm(h1, m1)}부터 ${hm(h2, m2)}까지`)
    // D-3 → 3일 남음, D-DAY → 오늘 마감
    .replace(/D-DAY/gi, "오늘 마감")
    .replace(/D-(\d+)/g, (_, n) => `${n}일 남음`)
    .replace(/[*_#>`~|]/g, " ")
    .replace(/^\s*-\s+/gm, "")
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")
    .replace(/(\d{1,2}):(\d{2})/g, (_, h, m) => hm(h, m))
    .replace(/\s+/g, " ")
    .trim();
}

// 크롬은 긴 문장을 한 번에 읽다가 멈추는 버그가 있어서 문장 단위로 나눠요
function splitSentences(text: string) {
  const parts = text.match(/[^.!?。\n]+[.!?。]?/g) ?? [text];
  const out: string[] = [];
  for (const p of parts) {
    const s = p.trim();
    if (!s) continue;
    if (out.length && (out[out.length - 1] + " " + s).length < 120) out[out.length - 1] += " " + s;
    else out.push(s);
  }
  return out;
}

function animate() {
  // 신호가 오면 envelope 가 튀어 오르고, 천천히 줄어들어요 + 살짝 떨림
  envelope *= 0.9;
  const jitter = speaking ? 0.12 + Math.random() * 0.12 : 0;
  setLevel(Math.min(1, envelope + jitter));
  if (speaking || envelope > 0.01) raf = requestAnimationFrame(animate);
  else setLevel(0);
}

export function stopSpeaking() {
  if (!ttsSupported()) return;
  speaking = false;
  window.speechSynthesis.cancel();
}

export function speak(text: string, opts: { rate?: number; onEnd?: () => void } = {}) {
  const clean = cleanForSpeech(text);
  if (!ttsSupported() || !clean) {
    opts.onEnd?.();
    return;
  }
  stopSpeaking();
  const voice = koreanVoice();
  const sentences = splitSentences(clean);
  speaking = true;
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(animate);

  // 안전장치: 브라우저가 '다 읽었음' 신호를 안 주는 경우가 있어서, 예상 시간이 넉넉히 지나면 강제로 끝내요
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(guard);
    speaking = false;
    opts.onEnd?.();
  };
  const guard = setTimeout(() => {
    window.speechSynthesis.cancel();
    finish();
  }, 4000 + clean.length * 180);

  sentences.forEach((s, i) => {
    const u = new SpeechSynthesisUtterance(s);
    u.lang = "ko-KR";
    if (voice) u.voice = voice;
    u.rate = opts.rate ?? 1.05;
    u.onstart = () => (envelope = 0.7);
    u.onboundary = () => (envelope = 0.55 + Math.random() * 0.45);
    if (i === sentences.length - 1) {
      u.onend = finish;
      u.onerror = (e) => {
        // 다음 말 때문에 끊긴 건(interrupted/canceled) 정상
        if (e.error !== "interrupted" && e.error !== "canceled") console.warn("tts error", e.error);
        finish();
      };
    }
    window.speechSynthesis.speak(u);
  });
}

// 음성 목록은 늦게 로드되기도 해서 미리 한 번 불러두기
if (typeof window !== "undefined" && "speechSynthesis" in window) {
  window.speechSynthesis.getVoices();
  window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
}

// ---------- 영어 인사 (미국 남성) ----------
// 1순위: 서버(Groq Orpheus 'troy') 음성 파일 → AnalyserNode 로 진짜 파형을 코어에 연결
// 2순위: 브라우저의 미국 영어 남성 목소리
const greetingAudio = new Map<string, Promise<Blob | null>>();

export function prefetchGreeting(text: string) {
  if (!greetingAudio.has(text)) {
    greetingAudio.set(
      text,
      fetch("/api/voice/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) })
        .then((r) => (r.ok && r.headers.get("content-type")?.startsWith("audio/") ? r.blob() : null))
        .catch(() => null),
    );
  }
  return greetingAudio.get(text)!;
}

async function playBlob(blob: Blob, onEnd: () => void) {
  const ctx = new AudioContext();
  const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  src.connect(analyser);
  analyser.connect(ctx.destination);
  const data = new Float32Array(new ArrayBuffer(analyser.fftSize * 4));
  let id = 0;
  const loop = () => {
    setLevel(readRms(analyser, data)); // 진짜 소리 크기 → 코어
    id = requestAnimationFrame(loop);
  };
  src.onended = () => {
    cancelAnimationFrame(id);
    setLevel(0);
    ctx.close().catch(() => {});
    onEnd();
  };
  await ctx.resume().catch(() => {});
  src.start();
  loop();
}

export async function speakGreeting(text: string, onEnd: () => void) {
  stopSpeaking();
  const blob = await prefetchGreeting(text);
  if (blob) {
    try {
      await playBlob(blob, onEnd);
      return;
    } catch {
      /* 아래 브라우저 목소리로 */
    }
  }
  if (!ttsSupported()) return onEnd();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-US";
  const v = englishMaleVoice();
  if (v) u.voice = v;
  u.rate = 1;
  u.pitch = 0.9; // 조금 낮게 (차분한 30대 남성 느낌)
  speaking = true;
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(animate);
  u.onboundary = () => (envelope = 0.55 + Math.random() * 0.45);
  // 브라우저가 '다 읽었음' 신호를 안 줘도 6초 뒤엔 다음(듣기)으로 넘어가요
  let finished = false;
  const done = () => {
    if (finished) return;
    finished = true;
    clearTimeout(guard);
    speaking = false;
    onEnd();
  };
  const guard = setTimeout(() => {
    window.speechSynthesis.cancel();
    done();
  }, 6000);
  u.onend = done;
  u.onerror = done;
  window.speechSynthesis.speak(u);
}
