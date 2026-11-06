// 소리 크기(0~1)를 화면 코어와 공유하는 작은 저장소
// React 상태로 하면 1초에 60번 다시 그려져서 느려지니, 그냥 변수 하나를 같이 읽어요.
export type CoreState = "STANDBY" | "LISTENING" | "THINKING" | "SPEAKING";

export const audioLevel = {
  value: 0, // 지금 소리 크기 0~1
};

export function setLevel(v: number) {
  audioLevel.value = Math.max(0, Math.min(1, v));
}

// 개발 모드에서만: 자동 테스트가 소리 크기를 읽을 수 있게
if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
  (window as unknown as { __narvisLevel: typeof audioLevel }).__narvisLevel = audioLevel;
}

// AnalyserNode 에서 지금 소리 크기(RMS)를 0~1로 계산
export function readRms(analyser: AnalyserNode, buf: Float32Array<ArrayBuffer>) {
  analyser.getFloatTimeDomainData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  const rms = Math.sqrt(sum / buf.length);
  // 말소리 RMS는 보통 0.005~0.2 → 제곱근으로 펴서 작은 소리도 보이고 큰 소리는 덜 꽉 차게
  return Math.min(1, Math.sqrt(rms) * 1.9);
}
