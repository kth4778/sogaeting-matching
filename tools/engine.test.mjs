// 매칭 계산(engine.js) 테스트 — node --test tools/engine.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { josa, signature, ruleFilter, embedScores, oneLine } from "../public/js/core/engine.js";
import { SAMPLE_PROFILES } from "../public/js/data/profiles.js";

const minjun = SAMPLE_PROFILES.find(p => p.name === "김민준");

test("josa: 받침·비한글·괄호", () => {
  assert.equal(josa("산 타기", "을/를"), "산 타기를");
  assert.equal(josa("등산", "을/를"), "등산을");
  assert.equal(josa("K-POP", "을/를"), "K-POP을(를)");
  assert.equal(josa("커피(라떼)", "이/가"), "커피(라떼)가");
});

test("signature: 같으면 같고 관심사가 바뀌면 다름", () => {
  assert.equal(signature(minjun), signature(structuredClone(minjun)));
  const changed = { ...minjun, interests: [...minjun.interests, "독서"] };
  assert.notEqual(signature(minjun), signature(changed));
  assert.equal(signature({ ...minjun, name: "다른 이름" }), signature(minjun));
});

test("oneLine 규칙: LLM이 안 될 때 쓰는 한 줄", () => {
  const { passed } = ruleFilter(minjun);
  const top = embedScores(minjun, passed).slice(0, 5);
  assert.ok(top.length > 0);
  for (const c of top) {
    const line = oneLine(minjun, c.profile);
    assert.ok(!/\(E\/I\)|\(J\/P\)|이 잘 맞아요/.test(line), line);
    assert.ok((line.match(/ · /g) ?? []).length <= 1, line);
    assert.ok(line.length > 0);
  }
});
