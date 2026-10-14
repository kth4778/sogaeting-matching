// 정적 파일 제공 + Claude API 호출 3개(재순위, 이유 설명, 채팅)만 하는 작은 서버.
// 규칙 거르기와 임베딩은 브라우저에서 돌고, 여기는 LLM 단계만 맡는다.
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

const PORT = 3000;
const MODEL = "claude-opus-5-5";
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

// LLM에 넘길 프로필 요약. 사진·id 같은 판단과 무관한 칸은 뺀다.
function describe(p) {
  return `${p.name} (${p.gender}, ${p.age}살, ${p.region}, ${p.job}) / ${p.smoking}, 술 ${p.drinking}, ${p.religion}, ${p.mbti}
관심사: ${p.interests.join(", ")}
소개: ${p.intro}
성격: ${p.personality}`;
}

const RerankSchema = z.object({
  ranking: z.array(z.object({
    id: z.string(),
    score: z.number().int().min(0).max(100),
    oneLine: z.string(),
  })),
});

const ExplainSchema = z.object({
  headline: z.string(),
  reasons: z.array(z.object({ title: z.string(), detail: z.string() })),
  caution: z.string(),
  firstDate: z.string(),
});

async function rerank({ me, candidates }) {
  const list = candidates
    .map(c => `[${c.profile.id}] 임베딩 유사도 ${c.embed.toFixed(3)}\n${describe(c.profile)}`)
    .join("\n\n");
  const res = await claude().messages.parse({
    model: MODEL,
    max_tokens: 4000,
    output_config: { effort: "low", format: zodOutputFormat(RerankSchema) },
    system: "너는 소개팅 매칭 심사자다. 임베딩 점수는 관심사 단어가 비슷한지만 본 값이다. 너는 성격, 대화 스타일, 생활 리듬, 가치관까지 읽고 실제로 대화가 잘 통할 순서로 다시 줄 세운다.",
    messages: [{
      role: "user",
      content: `## 나\n${describe(me)}\n\n## 후보 ${candidates.length}명\n${list}\n\n후보 전원을 잘 맞는 순서로 ranking에 넣어라. score는 0~100 궁합 점수, oneLine은 그 순위를 준 이유 한 문장(한국어, 40자 이내).`,
    }],
  });
  if (!res.parsed_output) throw new Error(`LLM 응답을 해석하지 못했습니다 (stop_reason: ${res.stop_reason})`);
  return { ...res.parsed_output, usage: res.usage };
}

async function explain({ me, partner, embed, llmScore }) {
  const res = await claude().messages.parse({
    model: MODEL,
    max_tokens: 4000,
    output_config: { effort: "low", format: zodOutputFormat(ExplainSchema) },
    system: "너는 소개팅 앱의 매칭 이유를 사용자에게 설명하는 역할이다. 두 프로필에 실제로 적힌 내용만 근거로 쓰고, 없는 사실을 지어내지 않는다. 친근한 존댓말을 쓴다.",
    messages: [{
      role: "user",
      content: `## 나\n${describe(me)}\n\n## 1위 상대\n${describe(partner)}\n\n임베딩 유사도 ${embed.toFixed(3)}, 재순위 점수 ${llmScore}점.\nheadline: 왜 1위인지 한 문장(35자 이내). reasons: 근거 3개(title 10자 이내, detail 한두 문장). caution: 어긋날 수 있는 점 한 문장. firstDate: 두 사람에게 맞는 첫 만남 제안 한 문장.`,
    }],
  });
  if (!res.parsed_output) throw new Error(`LLM 응답을 해석하지 못했습니다 (stop_reason: ${res.stop_reason})`);
  return { ...res.parsed_output, usage: res.usage };
}

async function chat({ me, partner, history }) {
  const res = await claude().messages.create({
    model: MODEL,
    max_tokens: 2000,
    output_config: { effort: "low" },
    system: `너는 소개팅 앱에서 막 매칭된 사람 "${partner.name}"이다. 아래 프로필 그대로의 사람처럼 답한다.\n${describe(partner)}\n\n상대(나에게 말 거는 사람) 프로필:\n${describe(me)}\n\n규칙: 첫 대화라 존댓말, 1~2문장으로 짧게, 메신저 말투. 프로필에 없는 개인정보(연락처, 주소)는 만들어 말하지 않는다.`,
    messages: history.map(m => ({ role: m.from === "me" ? "user" : "assistant", content: m.text })),
  });
  const text = res.content.filter(b => b.type === "text").map(b => b.text).join("").trim();
  return { text, usage: res.usage };
}

const ROUTES = { "/api/rerank": rerank, "/api/explain": explain, "/api/chat": chat };

async function readJson(req) {
  let body = "";
  for await (const chunk of req) body += chunk;
  return JSON.parse(body);
}

function send(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

// SDK 오류를 화면 로그에 그대로 보여줄 수 있는 문장으로 바꾼다
function toErrorMessage(err) {
  if (err instanceof MissingKeyError) return [503, ".env에 ANTHROPIC_API_KEY가 비어 있습니다. 키를 넣고 서버를 다시 켜세요."];
  if (err instanceof Anthropic.AuthenticationError) return [401, "API 키가 올바르지 않습니다 (401)."];
  if (err instanceof Anthropic.RateLimitError) return [429, "요청이 너무 많습니다 (429). 잠시 뒤 다시 시도하세요."];
  if (err instanceof Anthropic.APIError) return [502, `Claude API 오류 (${err.status}): ${err.message}`];
  return [500, err.message];
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const handler = ROUTES[url.pathname];

  if (handler && req.method === "POST") {
    const started = Date.now();
    try {
      const result = await handler(await readJson(req));
      send(res, 200, { ...result, model: MODEL, ms: Date.now() - started });
    } catch (err) {
      const [status, message] = toErrorMessage(err);
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
  console.log(`http://localhost:${PORT}`);
  if (!process.env.ANTHROPIC_API_KEY) console.log("경고: ANTHROPIC_API_KEY가 없습니다. LLM 단계는 실패로 표시됩니다.");
});
