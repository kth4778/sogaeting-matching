// Claude 호출 3개(재순위, 이유 설명, 채팅). 로컬 서버(local-server.js)와 Vercel 함수(api/)가 함께 쓴다.
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

export const MODEL = "claude-opus-5-5";

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

async function rerank(client, { me, candidates }) {
  const list = candidates
    .map(c => `[${c.profile.id}] 임베딩 유사도 ${c.embed.toFixed(3)}\n${describe(c.profile)}`)
    .join("\n\n");
  const res = await client.messages.parse({
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

async function explain(client, { me, partner, embed, llmScore }) {
  const res = await client.messages.parse({
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

// 답장과 함께 「대화를 계속할지」를 판단한다. 무례가 계속되면 상대가 대화방을 나간다.
const ChatSchema = z.object({
  reply: z.string(),
  leave: z.boolean(),
  reason: z.string(),
});

// 화면의 대화 기록을 API 메시지로 바꾼다. 연달아 보낸 메시지는 한 턴으로 합친다.
function toTurns(history) {
  const turns = [];
  for (const m of history.filter(m => m.from !== "sys")) {
    const role = m.from === "me" ? "user" : "assistant";
    if (turns.at(-1)?.role === role) turns.at(-1).content += `\n${m.text}`;
    else turns.push({ role, content: m.text });
  }
  // 대화는 user 차례로 시작해야 한다
  while (turns[0]?.role === "assistant") turns.shift();
  return turns;
}

async function chat(client, { me, partner, history }) {
  const res = await client.messages.parse({
    model: MODEL,
    max_tokens: 2000,
    output_config: { effort: "low", format: zodOutputFormat(ChatSchema) },
    system: `너는 소개팅 앱에서 막 매칭된 사람 "${partner.name}"이다. 아래 프로필 그대로의 사람처럼 답한다.\n${describe(partner)}\n\n상대(나에게 말 거는 사람) 프로필:\n${describe(me)}\n\n규칙: 첫 대화라 존댓말, 1~2문장으로 짧게, 메신저 말투. 프로필에 없는 개인정보(연락처, 주소)는 만들어 말하지 않는다.\n대화를 계속할지 판단: 상대가 욕설·모욕·성희롱·협박을 하거나, 불편하다고 말했는데도 무례를 이어 가면 leave를 true로 하고 reply에는 짧게 대화를 끝내는 말을 쓴다. 한 번의 가벼운 실수나 농담이면 leave는 false로 두고 불편하다고 솔직히 말한다. reason은 그렇게 판단한 이유 한 문장(상대에게는 보이지 않음).`,
    messages: toTurns(history),
  });
  if (!res.parsed_output) throw new Error(`LLM 응답을 해석하지 못했습니다 (stop_reason: ${res.stop_reason})`);
  return { ...res.parsed_output, usage: res.usage };
}

export const ROUTES = { "/api/rerank": rerank, "/api/explain": explain, "/api/chat": chat };

// SDK 오류를 화면 로그에 그대로 보여줄 수 있는 문장으로 바꾼다
export function toErrorMessage(err) {
  if (err instanceof Anthropic.AuthenticationError) return [401, "API 키가 올바르지 않습니다 (401)."];
  if (err instanceof Anthropic.RateLimitError) return [429, "요청이 너무 많습니다 (429). 잠시 뒤 다시 시도하세요."];
  if (err instanceof Anthropic.APIError) return [502, `Claude API 오류 (${err.status}): ${err.message}`];
  return [500, err.message];
}
