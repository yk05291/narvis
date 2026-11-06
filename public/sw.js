// NARVIS 서비스 워커 (앱 설치용)
// - 화면은 항상 인터넷에서 새로 받아요 (최신 유지). 인터넷이 끊기면 안내 화면만 보여줘요.
// - API·개인 데이터는 절대 저장(캐시)하지 않아요.
const CACHE = "narvis-v1";
const OFFLINE = "/offline.html";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll([OFFLINE, "/icon-192.png"])));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.mode !== "navigate") return; // 화면 이동만 다뤄요 (API 등은 브라우저 기본 동작)
  e.respondWith(fetch(req).catch(() => caches.match(OFFLINE)));
});
