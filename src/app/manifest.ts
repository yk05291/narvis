// NARVIS를 앱처럼 설치하기 위한 정보 (PWA)
import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "NARVIS — 개인 AI 비서",
    short_name: "NARVIS",
    description: "한양여대 학생을 위한 음성 AI 비서: 일정·학사일정·공지·과제·브리핑",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#050811",
    theme_color: "#050811",
    lang: "ko",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
