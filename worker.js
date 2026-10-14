// GitHub Pages 배포판이 Claude를 부를 때 거치는 중계 서버 (Cloudflare Worker).
// API 키는 Cloudflare 비밀 저장소(env.ANTHROPIC_API_KEY)에만 있고 브라우저로 내려가지 않는다.
import Anthropic from "@anthropic-ai/sdk";
import { MODEL, ROUTES, toErrorMessage } from "./llm.js";

// 이 사이트에서 온 요청만 받는다 (브라우저 기준. 주소를 아는 사람이 흉내 낼 수는 있으므로 아래 한도도 둔다)
const ALLOWED_ORIGINS = ["https://kth4778.github.io", "http://localhost:3000"];
const MAX_BODY_BYTES = 20_000;   // 프로필 6명 + 대화 기록이면 충분한 크기
const MAX_CHAT_TURNS = 30;       // 채팅 기록이 길어져 비용이 커지는 것을 막는다
const PER_MINUTE = 15;           // IP당 1분에 받는 요청 수

// 같은 Worker 인스턴스 안에서만 세는 간단한 한도 (정확한 전역 한도는 아님)
const hits = new Map();
function overLimit(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter(t => now - t < 60_000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > PER_MINUTE;
}

function json(status, data, headers) {
  return new Response(JSON.stringify(data), { status, headers: { ...headers, "Content-Type": "application/json; charset=utf-8" } });
}

export default {
  async fetch(req, env) {
    const origin = req.headers.get("Origin") ?? "";
    const cors = {
      "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin",
    };
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });

    const handler = ROUTES[new URL(req.url).pathname];
    if (!handler || req.method !== "POST") return json(404, { error: "not found" }, cors);
    if (!ALLOWED_ORIGINS.includes(origin)) return json(403, { error: "허용되지 않은 사이트에서 온 요청입니다." }, cors);
    if (overLimit(req.headers.get("CF-Connecting-IP") ?? "unknown")) return json(429, { error: "요청이 너무 많아요. 1분 뒤 다시 시도하세요." }, cors);

    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return json(413, { error: "요청이 너무 큽니다." }, cors);
    const body = JSON.parse(raw);
    if (Array.isArray(body.history)) body.history = body.history.slice(-MAX_CHAT_TURNS);

    const started = Date.now();
    try {
      const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
      const result = await handler(client, body);
      return json(200, { ...result, model: MODEL, ms: Date.now() - started }, cors);
    } catch (err) {
      const [status, message] = toErrorMessage(err);
      return json(status, { error: message }, cors);
    }
  },
};
