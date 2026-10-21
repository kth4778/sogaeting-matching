// 로컬 LLM(Ollama) 연결. 지금은 임베딩만 여기서 하고, 재순위·이유·채팅은 아직 Claude(../llm.js)가 한다.
// 바이브코딩 주차에 쓰던 모델과 같다: 임베딩 bge-m3, 대화 qwen3.6:27b
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
