// 로컬 실행용 서버: 정적 파일 제공 + LLM 단계 3개(llm.js) + 임베딩(local-llm/).
// 규칙 거르기는 브라우저, 임베딩은 로컬 LLM(Ollama), 재순위·이유·채팅은 Claude가 맡는다.
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { ROUTES, claudeRunner, toErrorMessage } from "./llm.js";
import { embedRank } from "./local-llm/embed-rank.js";
import { ollamaRunner } from "./local-llm/ollama.js";

// 재순위·이유·채팅을 누가 할지: claude(기본) 또는 ollama(.env에 LLM_PROVIDER=ollama)
const PROVIDER = process.env.LLM_PROVIDER === "ollama" ? "ollama" : "claude";

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "public");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml" };

// 키가 없을 때도 페이지는 떠야 하므로 클라이언트는 요청 때 만든다
let client;
function claude() {
  if (!process.env.ANTHROPIC_API_KEY) throw new MissingKeyError();
  client ??= new Anthropic();
  return client;
}
class MissingKeyError extends Error {}

async function readJson(req) {
  let body = "";
  for await (const chunk of req) body += chunk;
  return JSON.parse(body);
}

function send(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  // 임베딩은 이 컴퓨터의 Ollama가 한다 (Claude 키가 없어도 된다)
  if (url.pathname === "/api/embed" && req.method === "POST") {
    const started = Date.now();
    try {
      send(res, 200, { ...(await embedRank(await readJson(req))), ms: Date.now() - started });
    } catch (err) {
      console.error("[/api/embed]", err.message);
      send(res, 502, { error: `로컬 임베딩 서버(Ollama)에 연결할 수 없어요: ${err.message}` });
    }
    return;
  }
  const handler = ROUTES[url.pathname];

  if (handler && req.method === "POST") {
    const started = Date.now();
    try {
      const run = PROVIDER === "ollama" ? ollamaRunner() : claudeRunner(claude());
      const result = await handler(run, await readJson(req));
      send(res, 200, { ...result, model: run.model, ms: Date.now() - started });
    } catch (err) {
      const [status, message] = err instanceof MissingKeyError
        ? [503, ".env에 ANTHROPIC_API_KEY가 비어 있습니다. 키를 넣고 서버를 다시 켜세요."]
        : toErrorMessage(err);
      console.error(`[${url.pathname}]`, message);
      send(res, status, { error: message });
    }
    return;
  }
  // 정적 파일. public 밖으로 나가는 경로는 막는다.
  const file = path.join(PUBLIC_DIR, url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname));
  if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, { error: "forbidden" });
  try {
    const data = await readFile(file);
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream" });
    res.end(data);
  } catch {
    send(res, 404, { error: "not found" });
  }
}).listen(PORT, () => {
  console.log(`http://localhost:${PORT} · LLM: ${PROVIDER}`);
  if (PROVIDER === "claude" && !process.env.ANTHROPIC_API_KEY) console.log("경고: ANTHROPIC_API_KEY가 없습니다. LLM 단계는 실패로 표시됩니다.");
});
