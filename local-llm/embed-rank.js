// 2단계 임베딩 후보 추리기: 프로필 글을 벡터로 바꿔 나와 가까운 순서로 줄 세운다
import { embed, EMBED_MODEL } from "./ollama.js";

// 임베딩에 넣는 글. 이름·나이 같은 조건은 1단계 규칙이 이미 봤으니 취향과 성격만 넣는다
export function profileText(p) {
  return `관심사: ${p.interests.join(", ")}\n소개: ${p.intro}\n성격: ${p.personality}`;
}

export function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / Math.sqrt(na * nb);
}

// 같은 글은 다시 계산하지 않는다 (가상 프로필 20명은 서버가 켜져 있는 동안 한 번만)
const cache = new Map();

export async function embedRank({ me, people }, embedFn = embed) {
  const texts = [me, ...people].map(profileText);
  const missing = [...new Set(texts.filter(t => !cache.has(t)))];
  if (missing.length) (await embedFn(missing)).forEach((v, i) => cache.set(missing[i], v));
  const mine = cache.get(texts[0]);
  const scores = people
    .map((p, i) => ({ id: p.id, embed: cosine(mine, cache.get(texts[i + 1])) }))
    .sort((a, b) => b.embed - a.embed);
  return { scores, model: EMBED_MODEL, computed: missing.length };
}
