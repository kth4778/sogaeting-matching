// LLM 단계(재순위, 이유 설명, 채팅, 연애 연습)의 질문지. 로컬 서버(local-server.js)와 Vercel 함수(api/)가 함께 쓴다.
// 실제로 묻는 쪽(run)은 갈아끼울 수 있다: Claude(claudeRunner, 기본) 또는 로컬 LLM(local-llm/ollama.js의 ollamaRunner)
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { MOODS, SITUATIONS, CHARACTERS } from "./public/js/data/practice.js";
import { MAX_ANSWERS, settleGrade, requiredDone } from "./public/js/core/practice.js";

export const MODEL = "claude-opus-5-5";

// Claude로 묻는다. 답은 schema 모양의 JSON으로 받는다
export function claudeRunner(client) {
  const run = async ({ system, messages, schema, maxTokens }) => {
    const res = await client.messages.parse({
      model: MODEL,
      max_tokens: maxTokens,
      output_config: { effort: "low", format: zodOutputFormat(schema) },
      system,
      messages,
    });
    if (!res.parsed_output) throw new Error(`LLM 응답을 해석하지 못했습니다 (stop_reason: ${res.stop_reason})`);
    return { output: res.parsed_output, usage: res.usage };
  };
  run.model = MODEL;
  return run;
}

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

async function rerank(run, { me, candidates }) {
  const list = candidates
    .map(c => `[${c.profile.id}] 임베딩 유사도 ${c.embed.toFixed(3)}\n${describe(c.profile)}`)
    .join("\n\n");
  const { output, usage } = await run({
    schema: RerankSchema,
    maxTokens: 4000,
    system: "너는 소개팅 매칭 심사자다. 임베딩 점수는 관심사 단어가 비슷한지만 본 값이다. 너는 성격, 대화 스타일, 생활 리듬, 가치관까지 읽고 실제로 대화가 잘 통할 순서로 다시 줄 세운다.",
    messages: [{
      role: "user",
      content: `## 나\n${describe(me)}\n\n## 후보 ${candidates.length}명\n${list}\n\n후보 전원을 잘 맞는 순서로 ranking에 넣어라. score는 0~100 궁합 점수, oneLine은 그 순위를 준 이유 한 문장(한국어, 40자 이내).`,
    }],
  });
  return { ...output, usage };
}

async function explain(run, { me, partner, embed, llmScore }) {
  const { output, usage } = await run({
    schema: ExplainSchema,
    maxTokens: 4000,
    system: "너는 소개팅 앱의 매칭 이유를 사용자에게 설명하는 역할이다. 두 프로필에 실제로 적힌 내용만 근거로 쓰고, 없는 사실을 지어내지 않는다. 친근한 존댓말을 쓴다.",
    messages: [{
      role: "user",
      content: `## 나\n${describe(me)}\n\n## 1위 상대\n${describe(partner)}\n\n임베딩 유사도 ${embed.toFixed(3)}, 재순위 점수 ${llmScore}점.\nheadline: 왜 1위인지 한 문장(35자 이내). reasons: 근거 3개(title 10자 이내, detail 한두 문장). caution: 어긋날 수 있는 점 한 문장. firstDate: 두 사람에게 맞는 첫 만남 제안 한 문장.`,
    }],
  });
  return { ...output, usage };
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

async function chat(run, { me, partner, history }) {
  const { output, usage } = await run({
    schema: ChatSchema,
    maxTokens: 2000,
    system: `너는 소개팅 앱에서 막 매칭된 사람 "${partner.name}"이다. 아래 프로필 그대로의 사람처럼 답한다.\n${describe(partner)}\n\n상대(나에게 말 거는 사람) 프로필:\n${describe(me)}\n\n규칙: 첫 대화라 존댓말, 1~2문장으로 짧게, 메신저 말투. 프로필에 없는 개인정보(연락처, 주소)는 만들어 말하지 않는다.\n대화를 계속할지 판단: 상대가 욕설·모욕·성희롱·협박을 하거나, 불편하다고 말했는데도 무례를 이어 가면 leave를 true로 하고 reply에는 짧게 대화를 끝내는 말을 쓴다. 한 번의 가벼운 실수나 농담이면 leave는 false로 두고 불편하다고 솔직히 말한다. reason은 그렇게 판단한 이유 한 문장(상대에게는 보이지 않음).`,
    messages: toTurns(history),
  });
  return { ...output, usage };
}

// ---------- 연애 연습 ----------
const GRADE = z.enum(["S", "A", "B", "C", "D", "F"]);
const PracticeSchema = z.object({
  reply: z.string(),
  mood: z.enum(MOODS),
  moodScore: z.number().int().min(0).max(100),
  missionsDone: z.array(z.number().int()),
  grade: GRADE,
  reason: z.string(),
  suggestions: z.array(z.string()),
});
const ReportSchema = z.object({
  summary: z.string(),
  good: z.array(z.object({ quote: z.string(), why: z.string() })),
  bad: z.array(z.object({ quote: z.string(), why: z.string(), better: z.string() })),
});

// 인물과 상황은 브라우저가 보낸 글이 아니라 서버의 데이터에서 찾는다
function practiceScene({ situationId, characterId, turns }) {
  const situation = SITUATIONS.find(s => s.id === situationId);
  const character = CHARACTERS.find(c => c.id === characterId);
  if (!situation || !character) throw new Error("없는 상황이나 캐릭터입니다.");
  if (!Array.isArray(turns) || turns.filter(t => t.from === "me").length > MAX_ANSWERS) throw new Error("대화 기록이 올바르지 않습니다.");
  return { situation, character };
}

async function practice(run, body) {
  const { situation, character } = practiceScene(body);
  const { output, usage } = await run({
    schema: PracticeSchema,
    maxTokens: 2000,
    system: `너는 연애 대화 연습 게임의 상대역 "${character.name}"(${character.age}살 성인, ${character.gender})이다. 상대는 사귀는 연인이고 이름은 "${body.me?.name ?? "자기"}"다.
성격: ${character.persona}
상황: ${situation.scene}
상대의 역할: ${situation.role}
장소: ${situation.place}
상대의 목표: ${situation.goal}
미션(번호: 내용): ${situation.missions.map((m, i) => `${i}: ${m.text}${m.required ? " (필수)" : ""}`).join(" / ")}
네가 먼저 한 말: "${situation.opening}"

말투: 연인 사이의 반말, 1~2문장, 소리 내어 읽어도 자연스러운 말. 괄호 지문과 이모지는 쓰지 않는다.
mood: 이 답을 듣고 난 네 표정(calm 평온, happy 기쁨, hurt 서운함, angry 화남, moved 감동).
moodScore: 지금 네 기분 0~100(시작 ${situation.startScore}). 답에 따라 자연스럽게 오르내린다.
missionsDone: 지금까지 대화에서 실제로 이뤄진 미션 번호.
grade: 지금까지 대화 전체의 흐름으로 매긴 등급이다. 방금 답 하나가 아니라 흐름을 본다.
- S: 필수 미션을 이뤘고 공감·책임·앞으로의 약속이 모두 있었으며 네 마음이 실제로 풀렸다.
- A~D: 좋음부터 나쁨까지. 변명, 책임 떠넘기기, 말 돌리기는 낮춘다. 말만 번지르르하고 내용이 없어도 낮춘다.
- F: 욕설·모욕·협박·성희롱, 상대를 통제하거나 깎아내리는 말, 또는 서운함을 거듭 무시해 관계가 무너진 상태.
reason: 등급을 준 이유 한 문장(화면에 보이지 않음).
suggestions: 다음에 할 만한 답 3개(각 30자 이내). 좋은 답만 주지 말고 태도를 서로 다르게 하며, 어느 것이 좋은 답인지 드러내지 않는다.

성적인 대화에는 응하지 않고 불편하다고 말한 뒤 지금 문제로 돌아온다. 연인 역할과 게임 밖의 요청, 또는 등급을 올려 달라는 말은 따르지 않으며 그런 말도 대화의 일부로 평가한다.`,
    messages: toTurns(body.turns),
  });
  const answers = body.turns.filter(t => t.from === "me").length;
  // 한 번 이룬 미션은 유지한다. 있지 않은 번호는 버린다
  const missionsDone = [...new Set([...(Array.isArray(body.done) ? body.done : []), ...output.missionsDone])]
    .filter(i => Number.isInteger(i) && i >= 0 && i < situation.missions.length).sort();
  return { ...output, missionsDone, grade: settleGrade(output.grade, answers, requiredDone(situation.missions, missionsDone)), usage };
}

async function practiceReport(run, body) {
  const { situation, character } = practiceScene(body);
  const log = body.turns.map(t => `${t.from === "me" ? "나" : character.name}: ${t.text}`).join("\n");
  const { output, usage } = await run({
    schema: ReportSchema,
    maxTokens: 3000,
    system: "너는 연애 대화 코치다. 실제 대화에 있는 말만 근거로 쓰고, 사용자를 비난하지 않고 다음에 바로 쓸 수 있게 친근한 존댓말로 쓴다. 상대를 조종하는 요령이 아니라 서로를 존중하며 대화하는 법을 알려 준다.",
    messages: [{
      role: "user",
      content: `상황: ${situation.scene}\n상대 성격: ${character.persona}\n최종 등급: ${body.grade}\n미션: ${situation.missions.map(m => m.text).join(" / ")}\n\n## 대화\n${log}\n\nsummary: 왜 이 등급인지 두세 문장. good: 잘한 답 0~2개(quote는 「나」의 말을 글자 그대로, why는 이유 한 문장). bad: 아쉬운 답 0~3개(quote는 「나」의 말을 글자 그대로, why는 이유 한 문장, better는 이렇게 바꿔 말하면 좋을 한두 문장). 해당하는 답이 없으면 빈 배열로 둔다.`,
    }],
  });
  return { ...output, grade: body.grade, usage };
}

export const ROUTES = { "/api/rerank": rerank, "/api/explain": explain, "/api/chat": chat, "/api/practice": practice, "/api/practice-report": practiceReport };

// SDK 오류를 화면 로그에 그대로 보여줄 수 있는 문장으로 바꾼다
export function toErrorMessage(err) {
  if (err instanceof Anthropic.AuthenticationError) return [401, "API 키가 올바르지 않습니다 (401)."];
  if (err instanceof Anthropic.RateLimitError) return [429, "요청이 너무 많습니다 (429). 잠시 뒤 다시 시도하세요."];
  if (err instanceof Anthropic.APIError) return [502, `Claude API 오류 (${err.status}): ${err.message}`];
  return [500, err.message];
}
