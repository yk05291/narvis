// 음성 출력 (TTS)
// Groq에는 한국어 음성 합성 모델이 없어서, 브라우저 내장 음성(speechSynthesis, 맥의 'Yuna' 등)을 써요.
// 브라우저 음성은 소리 파형을 Web Audio로 꺼낼 수 없어서, 단어가 읽힐 때마다 오는 신호(boundary)로
// '말하는 리듬'을 만들어 코어를 움직여요. (나중에 오디오 파일을 주는 TTS로 바꾸면 recorder.ts 처럼 AnalyserNode 로 진짜 파형 연결 가능)
import { setLevel } from "./level";

let speaking = false;
let envelope = 0;
let raf = 0;

export function ttsSupported() {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

function koreanVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices().filter((v) => v.lang?.toLowerCase().startsWith("ko"));
  // 자연스러운 음성 우선
  const prefer = ["Yuna", "Google 한국의", "Sora", "Heami", "Narae"];
  for (const name of prefer) {
    const v = voices.find((x) => x.name.includes(name));
    if (v) return v;
  }
  return voices[0] ?? null;
}

// 읽기 좋게 정리: 링크·기호·이모지 빼기
export function cleanForSpeech(text: string) {
  return text
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[*_#>`~|]/g, " ")
    .replace(/^\s*-\s+/gm, "")
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")
    .replace(/(\d{1,2}):(\d{2})/g, (_, h, m) => (m === "00" ? `${Number(h)}시` : `${Number(h)}시 ${Number(m)}분`))
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
