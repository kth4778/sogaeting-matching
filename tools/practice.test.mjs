// 연애 연습 게임 규칙·질문지 테스트 — node --test tools/practice.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_ANSWERS, slidesFor, settleGrade, outcomeOf, moodLabel, requiredDone, sceneImage } from "../public/js/core/practice.js";
import { SITUATIONS, CHARACTERS, MOODS } from "../public/js/data/practice.js";
import { ROUTES } from "../llm.js";
import { existsSync } from "node:fs";

test("상대: 남자 프로필이면 여성, 여자 프로필이면 남성 캐릭터만 나온다", () => {
  assert.ok(slidesFor("남").every(s => s.character.gender === "여"));
  assert.ok(slidesFor("여").every(s => s.character.gender === "남"));
  assert.equal(slidesFor("남").length, SITUATIONS.length);
});

test("데이터: 소재 4개에 2개씩, 성별마다 3명, 모두 성인", () => {
  const byTopic = Object.groupBy(SITUATIONS, s => s.topic);
  assert.equal(Object.keys(byTopic).length, 4);
  assert.ok(Object.values(byTopic).every(list => list.length === 2));
  for (const g of ["여", "남"]) assert.equal(CHARACTERS.filter(c => c.gender === g).length, 3);
  assert.ok(CHARACTERS.every(c => c.age >= 20));
  assert.ok(SITUATIONS.every(s => MOODS.includes(s.mood) && s.suggestions.length === 3));
});

test("등급: S는 답 3개가 쌓이고 필수 미션을 이뤄야 받을 수 있다", () => {
  assert.equal(settleGrade("S", 2, true), "A");
  assert.equal(settleGrade("S", 3, false), "A");
  assert.equal(settleGrade("S", 3, true), "S");
  assert.equal(settleGrade("F", 1, false), "F");
  assert.equal(settleGrade("B", 1, false), "B");
});

test("기분: 점수를 구간 이름으로 바꾸고, 미션은 필수 달성 여부를 계산한다", () => {
  assert.equal(moodLabel(10), "바닥");
  assert.equal(moodLabel(30), "나쁨");
  assert.equal(moodLabel(50), "보통");
  assert.equal(moodLabel(70), "좋음");
  assert.equal(moodLabel(95), "최고");
  const missions = [{ text: "가", required: true }, { text: "나", required: false }];
  assert.equal(requiredDone(missions, [1]), false);
  assert.equal(requiredDone(missions, [0]), true);
});

test("데이터: 상황마다 할 일·역할·장소·시작 기분과 필수 미션이 있다", () => {
  for (const s of SITUATIONS) {
    assert.ok(s.goal && s.role && s.place);
    assert.ok(s.startScore >= 0 && s.startScore <= 100);
    assert.ok(s.missions.length === 2 && s.missions.some(m => m.required));
  }
});

test("끝나는 조건: S·F는 바로, 그 밖에는 10번째 답에서", () => {
  assert.equal(outcomeOf("S", 3), "clear");
  assert.equal(outcomeOf("F", 1), "fail");
  assert.equal(outcomeOf("A", MAX_ANSWERS - 1), null);
  assert.equal(outcomeOf("A", MAX_ANSWERS), "limit");
  assert.equal(outcomeOf("D", MAX_ANSWERS), "limit");
});

test("그림: 상황마다 양쪽 상대의 장면 그림이 표정 5종씩 모두 있다", () => {
  const missing = [];
  for (const g of ["남", "여"]) for (const { situation: s, character: c } of slidesFor(g)) for (const m of MOODS) {
    const f = `public/${sceneImage(s, c, m)}`;
    if (!existsSync(f)) missing.push(f);
  }
  assert.deepEqual(missing, []);
});

const fakeRun = output => {
  const calls = [];
  const run = async args => { calls.push(args); return { output, usage: {} }; };
  return { run, calls };
};
const REPLY = { reply: "그래서?", mood: "hurt", moodScore: 40, missionsDone: [], grade: "S", reason: "이유", suggestions: ["가", "나", "다"] };

test("대화 질문지: 서버의 인물·상황을 쓰고 내 답부터 메시지로 보내며 등급을 규칙으로 고친다", async () => {
  const situation = SITUATIONS[0], character = CHARACTERS[0];
  const { run, calls } = fakeRun(REPLY);
  const res = await ROUTES["/api/practice"](run, {
    situationId: situation.id, characterId: character.id, me: { name: "민준" },
    turns: [{ from: "them", text: situation.opening }, { from: "me", text: "미안해" }],
  });
  assert.equal(res.grade, "A");     // 답 1개라 S는 A로
  assert.ok(calls[0].system.includes(character.name));
  assert.ok(calls[0].system.includes(situation.opening));
  assert.deepEqual(calls[0].messages, [{ role: "user", content: "미안해" }]);
  assert.ok(calls[0].system.includes(situation.missions[0].text));
});

test("대화 질문지: 이룬 미션은 누적하고, 있지 않은 번호는 버리며, 필수를 못 이루면 S가 아니다", async () => {
  const situation = SITUATIONS[0], req = situation.missions.findIndex(m => m.required), opt = 1 - req;
  const base = { situationId: situation.id, characterId: CHARACTERS[0].id, turns: [{ from: "me", text: "가" }, { from: "them", text: "나" }, { from: "me", text: "다" }, { from: "them", text: "라" }, { from: "me", text: "마" }] };
  const noReq = await ROUTES["/api/practice"](fakeRun({ ...REPLY, missionsDone: [opt, 9] }).run, { ...base, done: [] });
  assert.deepEqual(noReq.missionsDone, [opt]);
  assert.equal(noReq.grade, "A");
  const kept = await ROUTES["/api/practice"](fakeRun({ ...REPLY, missionsDone: [] }).run, { ...base, done: [req] });
  assert.deepEqual(kept.missionsDone, [req]);
  assert.equal(kept.grade, "S");
});

test("대화 질문지: 없는 인물·상황은 거절하고, 답이 10번을 넘으면 거절한다", async () => {
  const { run } = fakeRun(REPLY);
  await assert.rejects(ROUTES["/api/practice"](run, { situationId: "x", characterId: "y", turns: [] }));
  const turns = Array.from({ length: MAX_ANSWERS + 1 }, () => ({ from: "me", text: "응" }));
  await assert.rejects(ROUTES["/api/practice"](run, { situationId: SITUATIONS[0].id, characterId: CHARACTERS[0].id, turns }));
});

test("보고서 질문지: 내 답을 근거로 넘기고 등급은 게임 결과를 그대로 쓴다", async () => {
  const { run, calls } = fakeRun({ summary: "요약", good: [], bad: [] });
  const res = await ROUTES["/api/practice-report"](run, {
    situationId: SITUATIONS[0].id, characterId: CHARACTERS[0].id, grade: "B",
    turns: [{ from: "them", text: "왜 연락 안 했어?" }, { from: "me", text: "깜빡했어" }],
  });
  assert.equal(res.grade, "B");
  assert.ok(calls[0].messages[0].content.includes("깜빡했어"));
});
