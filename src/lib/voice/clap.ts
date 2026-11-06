// 박수 두 번 → onDouble 호출. 마이크를 계속 듣는 동안만 동작해요 (CLAP ON일 때).
// 실제 감지는 public/clap-processor.js (AudioWorklet)가 오디오 스레드에서 해요.

export type ClapListener = {
  pause: (v: boolean) => void; // NARVIS가 듣거나 말하는 중엔 멈추기 (자기 목소리에 반응 안 하게)
  stop: () => void;
};

export async function startClapListener(onDouble: () => void, onDebug?: (m: unknown) => void): Promise<ClapListener> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("이 브라우저는 마이크를 지원하지 않아요.");
  if (typeof AudioWorkletNode === "undefined") throw new Error("이 브라우저는 박수 감지를 지원하지 않아요.");

  // 박수의 날카로운 소리가 깎이지 않게 잡음 제거·자동 볼륨은 끄고, 스피커 소리 되울림만 줄여요
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false },
  });
  const ctx = new AudioContext();
  await ctx.audioWorklet.addModule("/clap-processor.js");
  const src = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, "clap-processor");
  node.port.onmessage = (e) => {
    onDebug?.(e.data);
    if (e.data?.type === "double") onDouble();
  };
  src.connect(node); // 스피커로는 안 내보내요 (출력 연결 없음)

  // 브라우저가 소리 처리를 잠깐 멈춰뒀으면 다시 켜기 (사용자가 화면을 누르면 풀려요)
  const resume = () => ctx.state === "suspended" && ctx.resume().catch(() => {});
  resume();
  window.addEventListener("pointerdown", resume);

  return {
    pause: (v) => node.port.postMessage({ type: "pause", value: v }),
    stop: () => {
      window.removeEventListener("pointerdown", resume);
      src.disconnect();
      node.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      ctx.close().catch(() => {});
    },
  };
}

// 깨어날 때 짧은 '띠링' 소리 (Web Audio로 직접 만든 소리)
export function playWakeChime() {
  try {
    const ctx = new AudioContext();
    const now = ctx.currentTime;
    [880, 1320].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = f;
      const t = now + i * 0.09;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.18, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + 0.3);
    });
    setTimeout(() => ctx.close().catch(() => {}), 600);
  } catch {}
}
