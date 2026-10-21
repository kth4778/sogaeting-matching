// 매칭 계산(engine.js) 테스트 — node --test tools/engine.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { josa, signature, ruleFilter, embedScores, mockRerank, mockExplain } from "../public/js/core/engine.js";
import { SAMPLE_PROFILES } from "../public/js/data/profiles.js";
import { STAGE_MS } from "../public/js/config.js";

const minjun = SAMPLE_PROFILES.find(p => p.name === "김민준");

// matching.js runMatching과 같은 순서로 계산한다 (대기 없이)
function run(me) {
  const { passed } = ruleFilter(me);
  const top = embedScores(me, passed).slice(0, 5);
  const { ranking } = mockRerank({ me, candidates: top.map(c => ({ profile: c.profile, embed: c.embed })) });
  const by = new Map(ranking.map(r => [r.id, r]));
  const final = top.map(c => ({ ...c, ...by.get(c.profile.id) })).sort((a, b) => b.score - a.score);
  return { final, explain: mockExplain({ me, partner: final[0].profile }) };
}

test("josa: 받침·비한글·괄호", () => {
  assert.equal(josa("산 타기", "을/를"), "산 타기를");
  assert.equal(josa("등산", "을/를"), "등산을");
  assert.equal(josa("K-POP", "을/를"), "K-POP을(를)");
  assert.equal(josa("커피(라떼)", "이/가"), "커피(라떼)가");
});

test("김민준 1위 headline", () => {
  assert.equal(run(minjun).explain.headline, "산 타기를 함께 즐길 수 있는 사람이에요");
});

test("signature: 같으면 같고 관심사가 바뀌면 다름", () => {
  assert.equal(signature(minjun), signature(structuredClone(minjun)));
  const changed = { ...minjun, interests: [...minjun.interests, "독서"] };
  assert.notEqual(signature(minjun), signature(changed));
  assert.equal(signature({ ...minjun, name: "다른 이름" }), signature(minjun));
});

test("oneLine 규칙: 2~5위", () => {
  const rest = run(minjun).final.slice(1);
  assert.ok(rest.length > 0);
  for (const c of rest) {
    assert.ok(!/\(E\/I\)|\(J\/P\)|이 잘 맞아요/.test(c.oneLine), c.oneLine);
    assert.ok((c.oneLine.match(/ · /g) ?? []).length <= 1, c.oneLine);
    assert.ok(c.oneLine.length > 0);
  }
});

test("STAGE_MS 합 9000~11000", () => {
  const sum = Object.values(STAGE_MS).reduce((a, b) => a + b, 0);
  assert.ok(sum >= 9000 && sum <= 11000, String(sum));
});
