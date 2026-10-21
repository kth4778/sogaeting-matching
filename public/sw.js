// 최소 오프라인: 같은 주소의 앱 셸(html·css·js·이미지)은 캐시 우선, 새 버전은 뒤에서 받아 둔다. /api/ 요청은 캐시하지 않는다.
const CACHE = "app-shell-v2"; // 로고·아이콘을 바꾸면 올려서 옛 캐시를 버린다
const OFFLINE_HTML = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>오늘, 누구와?</title><body style="margin:0;display:grid;place-items:center;height:100vh;font-family:-apple-system,sans-serif;background:#fff8f9;color:#1d1d1f;text-align:center">
<div><p style="font-size:17px;font-weight:600;margin:0 0 8px">인터넷에 연결되지 않았어요</p><p style="font-size:14px;color:#6e6e73;margin:0">연결되면 다시 열어 주세요</p></div>`;

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(["./", "index.html", "logo.png", "icon-192.png"]).catch(() => {})));
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.includes("/api/")) return;
  e.respondWith(caches.open(CACHE).then(async cache => {
    const hit = await cache.match(e.request);
    const net = fetch(e.request).then(res => {
      if (res.ok) cache.put(e.request, res.clone());
      return res;
    });
    if (hit) { net.catch(() => {}); return hit; }
    return net.catch(() => e.request.mode === "navigate"
      ? new Response(OFFLINE_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } })
      : Response.error());
  }));
});
