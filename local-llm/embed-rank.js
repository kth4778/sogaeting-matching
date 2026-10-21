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
// 화면에 그릴 3차원 좌표도 같은 글 묶음이면 다시 계산하지 않는다
const pcaCache = new Map();

export const SHOW_DIMS = 16; // 화면에 막대로 보여 줄 앞쪽 차원 수

const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);

// 벡터 여러 개를 퍼짐이 큰 방향 3개(주성분)로 줄인다. 거듭제곱법(power iteration)으로
// 사람 수 × 사람 수 크기의 그램 행렬에서 고유벡터를 하나씩 찾는다 (1024차원 공분산보다 훨씬 작다)
export function pca3(vectors, iterations = 200) {
  const n = vectors.length;
  const d = vectors[0].length;
  const mean = Array.from({ length: d }, (_, j) => vectors.reduce((s, v) => s + v[j], 0) / n);
  const X = vectors.map(v => v.map((x, j) => x - mean[j]));
  const G = X.map(a => X.map(b => dot(a, b)));
  const total = G.reduce((s, row, i) => s + row[i], 0);
  const found = [];
  const coords = vectors.map(() => [0, 0, 0]);
  const variance = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    let u = Array.from({ length: n }, (_, i) => 1 / (i + 1.5) + (i % 3) * 0.1 + k * 0.01 * i);
    let lambda = 0;
    for (let it = 0; it < iterations; it++) {
      let w = G.map(row => dot(row, u));
      for (const f of found) { const c = dot(w, f); w = w.map((x, i) => x - c * f[i]); }
      const norm = Math.sqrt(dot(w, w));
      if (norm < 1e-12) { lambda = 0; break; }
      u = w.map(x => x / norm);
      lambda = dot(u, G.map(row => dot(row, u)));
    }
    if (!(lambda > total * 1e-9)) break; // 남은 퍼짐이 없으면 나머지 축은 0
    // 부호는 정해져 있지 않으니 첫 번째(나)가 양수 쪽에 오도록 고정한다
    const pivot = Math.abs(u[0]) > 1e-9 ? u[0] : u.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), 0);
    if (pivot < 0) u = u.map(x => -x);
    found.push(u);
    u.forEach((x, i) => { coords[i][k] = x * Math.sqrt(lambda); });
    variance[k] = lambda / total;
  }
  return { coords, variance };
}

export async function embedRank({ me, people }, embedFn = embed) {
  const texts = [me, ...people].map(profileText);
  const missing = [...new Set(texts.filter(t => !cache.has(t)))];
  if (missing.length) (await embedFn(missing)).forEach((v, i) => cache.set(missing[i], v));
  const vectors = texts.map(t => cache.get(t));
  const key = texts.join("\u0000");
  if (!pcaCache.has(key)) pcaCache.set(key, pca3(vectors));
  const { coords, variance } = pcaCache.get(key);
  const mine = vectors[0];
  const scores = people
    .map((p, i) => ({ id: p.id, embed: cosine(mine, vectors[i + 1]), dims: vectors[i + 1].slice(0, SHOW_DIMS), xyz: coords[i + 1] }))
    .sort((a, b) => b.embed - a.embed);
  return {
    scores, model: EMBED_MODEL, computed: missing.length,
    me: { dims: mine.slice(0, SHOW_DIMS), xyz: coords[0] }, dim: mine.length, pcaVariance: variance,
  };
}
