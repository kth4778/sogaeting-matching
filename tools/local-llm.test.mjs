// 로컬 LLM 임베딩 순위 테스트 — node --test tools/local-llm.test.mjs
// Ollama 없이 돌도록 임베딩 함수를 가짜로 바꿔 넣는다
import { test } from "node:test";
import assert from "node:assert/strict";
import { cosine, profileText, embedRank } from "../local-llm/embed-rank.js";

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
