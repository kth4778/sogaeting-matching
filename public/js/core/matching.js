// 매칭 흐름: 4단계를 차례로 돌리며 로그 카드에 과정을 남긴다
import { PROFILES } from "../data/profiles.js";
import { PAGES_API_BASE, STAGE_MS } from "../config.js";
import { $, sleep, eulReul, TOP_K } from "./util.js";
import { state, save } from "./store.js";
import { render } from "./runtime.js";
import { ruleFilter, embedScores, mockRerank, mockExplain, signature } from "./engine.js";
import { logEl, logLine, logSub, logPeople, logGap, logStage, logWorking, logRankBoard, setPipe, setCount, resetPipe, dimAvatars, showLogCard, stopFollow } from "./log.js";

// 진행이 눈에 보이도록 잠깐 기다린 뒤 계산한다 (계산은 engine.embedScores)
export async function embeddingRank(me, people) {
  await sleep(STAGE_MS.s2Embed); // 진행이 눈에 보이도록 잠깐 기다린다
  return embedScores(me, people);
}

// ---------- 서버 호출 (채팅만 실제 Claude) ----------
const MOCK_API = { "/api/rerank": mockRerank, "/api/explain": mockExplain };

export async function api(path, body) {
  if (MOCK_API[path]) { await sleep(path === "/api/rerank" ? STAGE_MS.s3Api : STAGE_MS.s4Api); return MOCK_API[path](body); }
  // GitHub Pages에서는 중계 서버(Worker)로, 로컬에서는 같은 서버의 /api로 보낸다
  const base = location.hostname.endsWith("github.io") ? PAGES_API_BASE : "";
  const res = await fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  // GitHub Pages 같은 정적 배포에는 API 서버가 없어 HTML 404가 돌아온다
  if (!(res.headers.get("content-type") ?? "").includes("application/json")) {
    throw new Error("지금은 답장 서버에 연결할 수 없어요");
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

// ---------- 전체 매칭 흐름 ----------
export async function runMatching() {
  if (state.running) return;
  const me = state.me;
  state.running = true;
  state.justFinished = false;
  state.step = 1;
  logEl.innerHTML = ""; // 이번 회차 로그만
  resetPipe();
  render();
  const startedAt = performance.now();

  // 1단계
  setPipe(0, "run");
  showLogCard();
  await sleep(STAGE_MS.s1Intro);
  logStage(1, "규칙 거르기", "절대 안 되는 조건에 걸리는 사람을 먼저 뺍니다.",
    "조건이 안 맞는 사람은 점수를 매길 필요가 없어요. 내 조건과 상대 조건을 둘 다 봅니다.");
  const { passed, excluded } = ruleFilter(me);
  const byGender = excluded.filter(x => x.rule.name === "성별");
  const others = excluded.filter(x => x.rule.name !== "성별");
  logSub(`성별 조건으로 ${byGender.length}명 제외`);
  others.forEach(x => logSub(`${x.p.name} — ${x.rule.why(me, x.p)}`, "dim"));
  logSub(`${PROFILES.length}명 → ${passed.length}명 통과`, "hl");
  dimAvatars(excluded.map(x => x.p.id));
  setCount(passed.length);

  if (passed.length === 0) {
    setPipe(0, "fail", "0명 남음");
    logLine("결과 없음", "조건에 맞는 사람이 0명입니다. 이상형 조건을 넓혀 보세요.", "err");
    finish({ empty: true, excludedCount: excluded.length, excluded: countByRule(others) });
    return;
  }
  setPipe(0, "done", `${PROFILES.length}명 → ${passed.length}명`);
  await sleep(STAGE_MS.s1Out);

  // 2단계
  state.step = 2;
  setPipe(1, "run");
  await sleep(STAGE_MS.s2Intro);
  logStage(2, "임베딩 후보 추리기", "관심사를 같은 뜻끼리 묶어 비교하고, 취향이 가까운 사람을 찾습니다.",
    "표기가 달라도(등산 ≈ 산 타기) 뜻이 비슷하면 가깝게 잡혀요. 다음 단계로 넘길 후보를 5명으로 줄입니다.");
  const w2 = logWorking(`${passed.length + 1}명의 관심사를 비교하는 중`);
  let ranked;
  try {
    ranked = await embeddingRank(me, passed);
    w2.done("비교 완료");
  } catch (err) {
    w2.fail(`임베딩 실패: ${err.message}`);
    setPipe(1, "fail", "실패");
    finish({ error: true });
    return;
  }
  const top = ranked.slice(0, TOP_K);
  logSub(`임베딩 코사인 유사도 상위 ${top.length}명`);
  logPeople(top.map(c => ({
    profile: c.profile,
    chips: [c.pair.sim >= 0.9 ? `${c.pair.a} ≈ ${c.pair.b}` : null,
      ...c.profile.interests.filter(t => me.interests.includes(t))].filter(Boolean).slice(0, 2),
    score: `취향 ${c.embed.toFixed(3)}`,
  })));
  const cut = ranked.slice(TOP_K);
  if (cut.length) logSub(`탈락: ${cut.map(c => `${c.profile.name} ${c.embed.toFixed(3)}`).join(", ")}`, "dim");
  dimAvatars(cut.map(c => c.profile.id));
  setCount(top.length);
  setPipe(1, "done", `${passed.length}명 → ${top.length}명`);
  await sleep(STAGE_MS.s2Out);

  // 3단계
  state.step = 3;
  setPipe(2, "run");
  logStage(3, "LLM 재순위 (데모: 점수표 계산)", `${top.length}명을 지역·성향·생활 습관 점수표로 다시 줄 세웁니다.`,
    "지역·성향·생활 리듬·술·나이 차를 점수표로 더해 다시 줄 세워요");
  const w3 = logWorking(`${top.length}명 점수 매기는 중`);
  let final;
  try {
    const res = await api("/api/rerank", { me, candidates: top.map(c => ({ profile: c.profile, embed: c.embed })) });
    w3.done("점수 계산 완료");
    const scoreOf = new Map(res.ranking.map(r => [r.id, r]));
    final = top
      .filter(c => scoreOf.has(c.profile.id))
      .map(c => ({ ...c, llmScore: scoreOf.get(c.profile.id).score, oneLine: scoreOf.get(c.profile.id).oneLine }))
      .sort((a, b) => b.llmScore - a.llmScore);
    await logRankBoard(top, final);
    final.forEach((c, i) => logSub(`${i + 1}위 ${c.profile.name}: ${c.oneLine}`, i === 0 ? "hl" : ""));
    setPipe(2, "done", `1위 ${final[0].profile.name} ${final[0].llmScore}점`);
  } catch (err) {
    w3.fail(`실패: ${err.message}`);
    logSub("임베딩 순서를 그대로 씁니다", "dim");
    final = top.map(c => ({ ...c, llmScore: Math.round(c.embed * 100), oneLine: "관심사와 소개가 비슷해요" }));
    setPipe(2, "fail", "LLM 미연결");
  }
  setCount(1);

  // 4단계
  state.step = 4;
  setPipe(3, "run");
  logStage(4, "LLM 이유 설명", `1위 ${eulReul(final[0].profile.name)} 고른 이유를 두 사람 프로필에 적힌 내용만으로 씁니다.`,
    "점수만 보여 주면 왜 1위인지 알 수 없어요. 사람이 읽을 수 있는 이유로 바꿔 화면에 보여 줍니다.");
  const w4 = logWorking("이유 정리하는 중");
  let explain = null;
  try {
    const res = await api("/api/explain", { me, partner: final[0].profile, embed: final[0].embed, llmScore: final[0].llmScore });
    w4.done("이유 정리 완료");
    explain = res;
    logSub(`“${res.headline}”`, "hl");
    res.reasons.forEach(r => logSub(`${r.title}: ${r.detail}`));
    logSub(`주의: ${res.caution}`, "dim");
    logSub(`첫 만남 제안: ${res.firstDate}`);
    setPipe(3, "done", `이유 ${res.reasons.length}개 완성`);
  } catch (err) {
    w4.fail(`실패: ${err.message}`);
    setPipe(3, "fail", "실패");
  }

  logGap();
  logLine("완료", `총 ${((performance.now() - startedAt) / 1000).toFixed(1)}초 · ${PROFILES.length}명 → ${passed.length}명 → ${top.length}명 → 1위 ${final[0].profile.name} (${final[0].llmScore}점)`, "ok");
  finish({
    ranked: final.map((c, i) => {
      // 2~5위도 이유를 저장한다(목 계산이라 대기 없음). 상세 화면은 표시만 한다
      const ex = i === 0 ? explain : mockExplain({ me, partner: c.profile });
      return { id: c.profile.id, embed: c.embed, jaccard: c.jaccard, pair: c.pair, llmScore: c.llmScore, oneLine: c.oneLine,
        before: top.findIndex(t => t.profile.id === c.profile.id) + 1, headline: ex?.headline, reasons: ex?.reasons.slice(0, 2) };
    }),
    explain, passed: passed.length,
  });
}

// 결과 없음 화면의 제외 칩: 규칙 이름별 인원 (성별 제외)
function countByRule(list) {
  const out = {};
  list.forEach(x => { out[x.rule.name] = (out[x.rule.name] ?? 0) + 1; });
  return out;
}

export function finish(result) {
  stopFollow();
  state.running = false;
  state.step = 0;
  result.forMe = signature(state.me);
  state.result = result;
  save("result", result);
  state.justFinished = !result.empty && !result.error;
  let first = false;
  try { first = !localStorage.getItem("aha"); } catch {}
  if (first) {
    window.dispatchEvent(new Event("app:aha"));
    try { localStorage.setItem("aha", "1"); } catch {}
  }
  render();
  $("#screen")?.scrollTo({ top: 0, behavior: "instant" });
}

// 옛 저장 결과에 서명이 없으면 지금 서명을 채운다 (거짓 「프로필이 바뀌었어요」 방지)
if (state.result && !state.result.forMe && state.me) {
  state.result.forMe = signature(state.me);
  save("result", state.result);
}
