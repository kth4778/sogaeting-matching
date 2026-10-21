// 로컬 LLM 임베딩 순위 테스트 — node --test tools/local-llm.test.mjs
// Ollama 없이 돌도록 임베딩 함수를 가짜로 바꿔 넣는다
import { test } from "node:test";
import assert from "node:assert/strict";
import { cosine, profileText, embedRank, pca3 } from "../local-llm/embed-rank.js";

test("cosine: 같은 방향 1, 직각 0", () => {
  assert.equal(cosine([1, 0], [2, 0]), 1);
  assert.equal(cosine([1, 0], [0, 3]), 0);
});

test("profileText: 관심사·소개·성격을 담는다", () => {
  const t = profileText({ interests: ["등산", "커피"], intro: "주말엔 산", personality: "조용함" });
  assert.match(t, /등산, 커피/);
  assert.match(t, /주말엔 산/);
  assert.match(t, /조용함/);
});

test("embedRank: 나와 가까운 사람이 먼저, 같은 문장은 다시 계산하지 않는다", async () => {
  const vec = { "나": [1, 0], "가까움": [0.9, 0.1], "멂": [0, 1] };
  const calls = [];
  const fakeEmbed = async texts => { calls.push(...texts); return texts.map(t => vec[t.split("\n")[1].slice(4)]); };
  const p = (id, intro) => ({ id, interests: ["x"], intro, personality: "y" });
  const me = p("me", "나");
  const people = [p("a", "멂"), p("b", "가까움")];

  const res = await embedRank({ me, people }, fakeEmbed);
  assert.deepEqual(res.scores.map(s => s.id), ["b", "a"]);
  assert.ok(res.scores[0].embed > 0.9);

  calls.length = 0;
  await embedRank({ me, people }, fakeEmbed);
  assert.equal(calls.length, 0);
});

// ---------- 화면용 벡터 값: 앞 16차원 + 3차원 PCA 좌표 ----------
test("pca3: 퍼짐이 큰 축이 첫째 성분, 퍼짐 비율 합은 1 이하", () => {
  const { coords, variance } = pca3([[0, 0, 0], [2, 0, 0], [-2, 0, 0], [0, 1, 0], [0, -1, 0]]);
  assert.equal(coords.length, 5);
  assert.ok(Math.abs(Math.abs(coords[1][0]) - 2) < 1e-6);
  assert.ok(Math.abs(coords[1][1]) < 1e-6);
  assert.ok(Math.abs(Math.abs(coords[3][1]) - 1) < 1e-6);
  assert.ok(coords.every(c => Math.abs(c[2]) < 1e-6));
  assert.ok(Math.abs(variance[0] - 0.8) < 1e-6 && Math.abs(variance[1] - 0.2) < 1e-6 && variance[2] < 1e-6);
});

test("embedRank: 나와 각 사람에게 앞 16차원과 3차원 좌표를 같이 주고, 같은 묶음이면 다시 계산하지 않는다", async () => {
  const base = { "벡터나": 0, "벡터가": 1, "벡터라": 2, "벡터다": 3 };
  const vecOf = key => Array.from({ length: 20 }, (_, j) => (j === base[key] ? 1 : 0) + j / 100);
  const fakeEmbed = async texts => texts.map(t => vecOf(t.split("\n")[1].slice(4)));
  const p = (id, intro) => ({ id, interests: ["x"], intro, personality: "y" });
  const input = { me: p("me", "벡터나"), people: [p("a", "벡터가"), p("b", "벡터라"), p("c", "벡터다")] };

  const res = await embedRank(input, fakeEmbed);
  assert.equal(res.me.dims.length, 16);
  assert.deepEqual(res.me.dims, vecOf("벡터나").slice(0, 16));
  assert.equal(res.dim, 20);
  assert.equal(res.me.xyz.length, 3);
  for (const s of res.scores) {
    assert.equal(s.dims.length, 16);
    assert.equal(s.xyz.length, 3);
    assert.ok(s.xyz.every(Number.isFinite));
  }
  assert.equal(res.pcaVariance.length, 3);

  const again = await embedRank(input, fakeEmbed);
  assert.equal(again.me.xyz, res.me.xyz); // 같은 배열 = 캐시에서 꺼냄
});

// ---------- LLM 연결 갈아끼우기 ----------
import { ROUTES } from "../llm.js";
import { ollamaRunner } from "../local-llm/ollama.js";

const person = id => ({ id, name: id, gender: "여", age: 24, region: "충주", job: "학생", smoking: "비흡연", drinking: "가끔", religion: "무교", mbti: "INFP", interests: ["등산"], intro: "산", personality: "조용" });

test("재순위는 어떤 LLM 연결이든 같은 질문지(스키마)를 넘긴다", async () => {
  let asked;
  const fakeRun = async req => { asked = req; return { output: { ranking: [{ id: "a", score: 80, oneLine: "잘 맞아요" }] }, usage: null }; };
  const res = await ROUTES["/api/rerank"](fakeRun, { me: person("me"), candidates: [{ profile: person("a"), embed: 0.8 }] });
  assert.equal(res.ranking[0].id, "a");
  assert.ok(asked.system && asked.messages.length && asked.schema);
});

test("ollamaRunner: Ollama JSON 답을 스키마로 검사해 돌려준다", async () => {
  const fakeFetch = async (url, init) => {
    const body = JSON.parse(init.body);
    assert.equal(body.think, false);
    assert.ok(body.format.properties.ranking);
    return { ok: true, json: async () => ({ message: { content: JSON.stringify({ ranking: [{ id: "a", score: 70, oneLine: "좋아요" }] }) } }) };
  };
  const res = await ROUTES["/api/rerank"](ollamaRunner("qwen-test", fakeFetch), { me: person("me"), candidates: [{ profile: person("a"), embed: 0.8 }] });
  assert.equal(res.ranking[0].score, 70);
});
