// 박수 두 번 감지기 (AudioWorklet — 브라우저의 오디오 스레드에서 2.7ms마다 실행돼요)
//
// 박수의 특징
//  1) 갑자기 아주 커져요 (주변 소음보다 훨씬 큼)
//  2) 고음 성분이 많아요 (손뼉 '짝!' 은 쉿 소리처럼 날카로움)
//  3) 금방 사라져요 (0.1초 안에 확 작아짐) ← 말소리·음악은 길게 이어져서 여기서 걸러져요
// 박수 두 번이 0.15~0.8초 간격이면 "double" 메시지를 보내요.

class ClapProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.floor = 0.003; // 주변 소음 크기 (계속 천천히 따라감)
    this.prev = 0; // 직전 샘플 (고음 성분 계산용)
    this.t = 0; // 지금까지 처리한 시간(초)
    this.candidate = null; // 박수인지 확인 중인 소리 { at, peak }
    this.lastClapAt = -10;
    this.refractoryUntil = 0; // 박수 감지 직후 잠깐 쉬기
    this.paused = false;
    this.port.onmessage = (e) => {
      if (e.data?.type === "pause") this.paused = !!e.data.value;
    };
  }

  process(inputs) {
    const ch = inputs[0]?.[0];
    const dt = 128 / sampleRate;
    this.t += dt;
    if (!ch) return true;

    // 이 128샘플 묶음의 크기(RMS), 최고점(peak), 고음 성분(HF: 샘플끼리 차이의 크기)
    let sum = 0;
    let hf = 0;
    let peak = 0;
    for (let i = 0; i < ch.length; i++) {
      const x = ch[i];
      sum += x * x;
      const d = x - this.prev;
      hf += d * d;
      this.prev = x;
      const a = x < 0 ? -x : x;
      if (a > peak) peak = a;
    }
    const rms = Math.sqrt(sum / ch.length);
    const hfr = Math.sqrt(hf / ch.length) / (rms + 1e-9); // 고음 비율 (낮은 소리·노크 ≈ 0.1, 박수 ≈ 0.4~0.8). 말소리의 날카로운 자음도 높지만 금방 안 사라져서 1)에서 걸러져요

    if (this.paused) {
      this.candidate = null;
      this.floor += (rms - this.floor) * 0.01;
      return true;
    }

    // 1) 확인 중인 소리가 있으면: 80ms 뒤에 충분히 작아졌는지(= 금방 사라졌는지) 보기
    if (this.candidate) {
      const c = this.candidate;
      if (rms > c.peak) c.peak = rms;
      const age = this.t - c.at;
      if (age >= 0.08) {
        const decayed = rms < c.peak * 0.3;
        this.candidate = null;
        if (decayed) this.onClap(c.at, c.peak);
      }
      return true;
    }

    // 2) 새 소리가 갑자기 커졌는지
    const loud = rms > Math.max(0.02, this.floor * 8) && peak > 0.12;
    if (loud && hfr > 0.3 && this.t > this.refractoryUntil) {
      this.candidate = { at: this.t, peak: rms };
      this.port.postMessage({ type: "onset", rms, hfr });
      return true;
    }

    // 3) 조용할 땐 주변 소음 크기를 천천히 따라가기
    if (!loud) this.floor += (Math.min(rms, 0.05) - this.floor) * 0.002;
    return true;
  }

  onClap(at, peak) {
    const gap = at - this.lastClapAt;
    this.port.postMessage({ type: "clap", gap, peak });
    if (gap >= 0.15 && gap <= 0.8) {
      this.port.postMessage({ type: "double" });
      this.lastClapAt = -10;
      this.refractoryUntil = this.t + 1.5;
    } else {
      this.lastClapAt = at;
    }
  }
}

registerProcessor("clap-processor", ClapProcessor);
