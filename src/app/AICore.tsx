"use client";

// 3D 홀로그램 AI 코어 (Three.js)
// 상태별 움직임 (설계서 7.2):
//   STANDBY   천천히 숨쉬듯 커졌다 작아짐 + 느린 회전
//   LISTENING 마이크 소리 크기에 맞춰 바깥 링이 퍼짐
//   THINKING  빠르게 회전 + 보라빛으로 빛남
//   SPEAKING  말하는 소리 크기에 맞춰 커지고 밝아지고 입자가 출렁임
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { audioLevel, type CoreState } from "@/lib/voice/level";

const CYAN = new THREE.Color("#00f0ff");
const VIOLET = new THREE.Color("#a78bfa");
const N = 900;

function glowTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.25, "rgba(255,255,255,0.6)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

function webglAvailable() {
  try {
    const c = document.createElement("canvas");
    return Boolean(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

export default function AICore({
  state,
  className = "h-[220px] w-[220px]",
  pulse = 0,
}: {
  state: CoreState;
  className?: string;
  pulse?: number; // 값이 바뀔 때마다 '깨어나는' 빛 폭발 효과 (박수 감지 등)
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef(state);
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  const pulseAt = useRef(-10);
  useEffect(() => {
    if (pulse > 0) pulseAt.current = performance.now() / 1000;
  }, [pulse]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    if (!webglAvailable()) {
      const t = setTimeout(() => setFallback(true), 0);
      return () => clearTimeout(t);
    }
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.z = 3.6;

    const group = new THREE.Group();
    scene.add(group);
    const tex = glowTexture();

    // 1) 입자 구 (피보나치 구 위에 고르게 배치)
    const base = new Float32Array(N * 3);
    const phase = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const y = 1 - (i / (N - 1)) * 2;
      const r = Math.sqrt(1 - y * y);
      const th = Math.PI * (3 - Math.sqrt(5)) * i;
      base.set([Math.cos(th) * r, y, Math.sin(th) * r], i * 3);
      phase[i] = Math.random() * Math.PI * 2;
    }
    const pos = new Float32Array(base);
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const pMat = new THREE.PointsMaterial({
      size: 0.05,
      map: tex,
      color: CYAN.clone(),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(pGeo, pMat);
    group.add(points);

    // 2) 정이십면체 와이어프레임 (홀로그램 느낌)
    const icoGeo = new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(1.25, 1));
    const icoMat = new THREE.LineBasicMaterial({ color: CYAN.clone(), transparent: true, opacity: 0.18 });
    const ico = new THREE.LineSegments(icoGeo, icoMat);
    group.add(ico);

    // 3) 가운데 빛나는 핵
    const glowMat = new THREE.SpriteMaterial({
      map: tex,
      color: CYAN.clone(),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const glow = new THREE.Sprite(glowMat);
    glow.scale.setScalar(1.4);
    scene.add(glow);

    // 4) 듣는 중일 때 퍼지는 바깥 링
    const ringMat = new THREE.MeshBasicMaterial({
      color: CYAN.clone(),
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.45, 1.5, 96), ringMat);
    scene.add(ring);

    const resize = () => {
      const w = mount.clientWidth || 1;
      const h = mount.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    const color = CYAN.clone();
    let scale = 1;
    let smoothLevel = 0;
    let spin = 0;
    let last = performance.now();
    let raf = 0;

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = now / 1000;
      const st = stateRef.current;
      // 소리 크기를 부드럽게 따라가기
      smoothLevel += (audioLevel.value - smoothLevel) * Math.min(1, dt * 14);
      // 깨어나는 효과: 0.8초 동안 크게 부풀었다가 가라앉음
      const since = t - pulseAt.current;
      const burst = since >= 0 && since < 1.2 ? Math.exp(-since * 4) : 0;
      const lv = Math.max(st === "LISTENING" || st === "SPEAKING" ? smoothLevel : 0, burst);

      // 크기
      let target = 1;
      if (st === "STANDBY") target = reduceMotion ? 0.95 : 0.9 + 0.1 * (0.5 + 0.5 * Math.sin(t * 1.6));
      if (st === "LISTENING") target = 1 + lv * 0.18;
      if (st === "THINKING") target = 0.95 + 0.04 * Math.sin(t * 6);
      if (st === "SPEAKING") target = 1 + lv * 0.38;
      scale += (target - scale) * Math.min(1, dt * 10);
      group.scale.setScalar(scale * (1 + burst * 0.35));

      // 회전 속도
      const speed = reduceMotion ? 0.05 : { STANDBY: 0.15, LISTENING: 0.3, THINKING: 1.6, SPEAKING: 0.45 }[st];
      spin += speed * dt;
      group.rotation.y = spin;
      group.rotation.x = Math.sin(spin * 0.4) * 0.3;
      ico.rotation.y = -spin * 0.6;

      // 색 (생각 중이면 보라로)
      color.lerp(st === "THINKING" ? VIOLET : CYAN, Math.min(1, dt * 4));
      pMat.color.copy(color);
      icoMat.color.copy(color);
      glowMat.color.copy(color);
      ringMat.color.copy(color);

      // 밝기
      glowMat.opacity = Math.min(1, 0.55 + lv * 0.6 + (st === "THINKING" ? 0.25 : 0));
      glow.scale.setScalar(1.3 + lv * 0.9 + (st === "THINKING" ? 0.2 : 0));
      pMat.size = 0.045 + lv * 0.04;
      icoMat.opacity = 0.14 + lv * 0.3 + (st === "THINKING" ? 0.12 : 0);

      // 입자 출렁임: 말할 때 크게, 평소엔 아주 살짝
      const amp = (reduceMotion ? 0.01 : 0.03) + lv * 0.22;
      for (let i = 0; i < N; i++) {
        const k = 1 + amp * Math.sin(t * 3 + phase[i] + base[i * 3 + 1] * 4);
        pos[i * 3] = base[i * 3] * k;
        pos[i * 3 + 1] = base[i * 3 + 1] * k;
        pos[i * 3 + 2] = base[i * 3 + 2] * k;
      }
      pGeo.attributes.position.needsUpdate = true;

      // 듣는 중: 링이 소리에 맞춰 퍼짐
      const ringTarget = Math.max(st === "LISTENING" ? 0.25 + lv * 0.75 : 0, burst);
      ringMat.opacity += (ringTarget - ringMat.opacity) * Math.min(1, dt * 10);
      ring.scale.setScalar(1 + lv * 0.35 + burst * (1 - burst) * 2.2 + (st === "LISTENING" && !reduceMotion ? 0.04 * Math.sin(t * 5) : 0));

      renderer.render(scene, camera);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      pGeo.dispose();
      pMat.dispose();
      icoGeo.dispose();
      icoMat.dispose();
      glowMat.dispose();
      ring.geometry.dispose();
      ringMat.dispose();
      tex.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  if (fallback) {
    // WebGL이 안 되는 환경: 예전 CSS 코어
    return (
      <div className={`core ${state === "THINKING" ? "core-thinking" : ""}`} aria-hidden>
        <div className="core-ring" />
        <div className="core-ring core-ring-2" />
        <div className="core-center" />
      </div>
    );
  }
  return <div ref={mountRef} className={className} aria-hidden data-core-state={state} />;
}
