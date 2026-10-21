// Vercel 서버 함수 공통 처리. API 키는 Vercel 환경 변수에만 있고 브라우저로 내려가지 않는다.
// (_로 시작하는 파일은 Vercel이 주소로 만들지 않는다)
import Anthropic from "@anthropic-ai/sdk";
import { MODEL, ROUTES, toErrorMessage } from "../llm.js";

const MAX_BODY_BYTES = 20_000;   // 프로필 6명 + 대화 기록이면 충분한 크기
const MAX_CHAT_TURNS = 30;       // 채팅 기록이 길어져 비용이 커지는 것을 막는다
const PER_MINUTE = 15;           // IP당 1분에 받는 요청 수 (같은 인스턴스 안에서만 세는 간단한 한도)

// GitHub Pages 배포판에서도 이 서버를 부를 수 있게 허용한다 (Vercel 주소에서는 같은 출처라 필요 없음)
const ALLOWED_ORIGINS = ["https://kth4778.github.io"];

const hits = new Map();
function overLimit(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter(t => now - t < 60_000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > PER_MINUTE;
}

export function handle(path) {
  return async function (req, res) {
    const origin = req.headers.origin;
    if (ALLOWED_ORIGINS.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      res.setHeader("Vary", "Origin");
    }
    if (req.method === "OPTIONS") return res.status(204).end();
    if (req.method !== "POST") return res.status(405).json({ error: "POST만 받습니다." });
    const ip = String(req.headers["x-forwarded-for"] ?? "unknown").split(",")[0];
    if (overLimit(ip)) return res.status(429).json({ error: "rate" });

    const body = req.body ?? {};
    if (JSON.stringify(body).length > MAX_BODY_BYTES) return res.status(413).json({ error: "요청이 너무 큽니다." });
    if (Array.isArray(body.history)) {
      body.history = body.history.slice(-MAX_CHAT_TURNS);
      // 자른 기록이 상대 말로 시작하면 하나 더 버린다 (대화는 내 말로 시작해야 한다)
      if (body.history[0]?.from === "them") body.history.shift();
    }
    if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: "서버에 ANTHROPIC_API_KEY가 설정되지 않았습니다." });

    const started = Date.now();
    try {
      const result = await ROUTES[path](new Anthropic(), body);
      res.status(200).json({ ...result, model: MODEL, ms: Date.now() - started });
    } catch (err) {
      const [status, message] = toErrorMessage(err);
      res.status(status).json({ error: status === 429 ? "rate" : message });
    }
  };
}
