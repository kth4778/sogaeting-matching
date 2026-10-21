// 로컬 LLM(Ollama) 연결. 임베딩은 늘 여기서 하고, 재순위·이유·채팅은 LLM_PROVIDER=ollama일 때 여기서 한다(기본은 Claude).
// 바이브코딩 주차에 쓰던 모델과 같다: 임베딩 bge-m3, 대화 qwen3.6:27b
import { z } from "zod";

const OLLAMA = process.env.OLLAMA_URL ?? "http://localhost:11434";
export const EMBED_MODEL = "bge-m3";

// 문장 여러 개를 한 번에 숫자 벡터로 바꾼다
export async function embed(texts) {
  const res = await fetch(`${OLLAMA}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBED_MODEL, input: texts }),
  });
  if (!res.ok) throw new Error(`Ollama 임베딩 오류 (${res.status})`);
  return (await res.json()).embeddings;
}

// 재순위·이유·채팅 질문지(../llm.js)를 로컬 모델로 묻는다. Claude 쪽 claudeRunner와 주고받는 모양이 같다
// qwen3.6:27b는 생각 끄기(think: false)가 먹혀서 한 답에 몇 초면 된다
export const CHAT_MODEL = process.env.OLLAMA_CHAT_MODEL ?? "qwen3.6:27b";

export function ollamaRunner(model = CHAT_MODEL, fetchFn = fetch) {
  const run = async ({ system, messages, schema }) => {
    const res = await fetchFn(`${OLLAMA}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "system", content: system }, ...messages],
        format: z.toJSONSchema(schema), // 답을 이 JSON 모양으로만 쓰게 한다
        think: false,
        stream: false,
      }),
    });
    if (!res.ok) throw new Error(`Ollama 오류 (${res.status})`);
    const data = await res.json();
    return { output: schema.parse(JSON.parse(data.message.content)), usage: null };
  };
  run.model = model;
  return run;
}
