// 매칭 흐름: 4단계 계산은 쉬지 않고 진행하고, 무대(stage.js)는 실제 값을 받아 따라 그린다.
// 단계 그림은 「최소 1.2초」와 「실제 응답 시간」 중 긴 쪽만큼 걸린다. 다음 요청은 앞 그림이 도는 동안 이미 나가 있다.
import { PROFILES } from "../data/profiles.js";
import { PAGES_API_BASE } from "../config.js";
import { $, eulReul, TOP_K } from "./util.js";
import { state, save } from "./store.js";
import { render } from "./runtime.js";
import { ruleFilter, embedScores, oneLine, signature } from "./engine.js";
import { logEl, logLine, logSub, logPeople, logGap, logStage, logWorking, logRankBoard, setPipe, setCount, resetPipe, showLogCard, stopFollow } from "./log.js";
import { stageReset, stageRules, stageEmbed, stageRerank, stageExplain } from "./stage.js";

// 서버로 보낼 프로필. 사진(특히 직접 올린 사진 데이터)은 판단에 안 쓰고 요청만 커지므로 뺀다
const slim = ({ photo, photos, photoData, ...rest }) => rest;

// 약속이 끝나면 { ok, value | error, ms } — ms는 이 함수를 부른 때부터 실제로 걸린 시간
const timed = p => {
  const t0 = performance.now();
  return p.then(value => ({ ok: true, value, ms: performance.now() - t0 }),
    err => ({ ok: false, error: err.message, ms: performance.now() - t0 }));
};

// 로컬 LLM 임베딩으로 줄 세운다. 서버에 Ollama가 없으면(배포판) 관심사 뜻 묶음 계산으로 대신한다
// 성공하면 사람마다 앞 16차원(dims)과 3차원 PCA 좌표(xyz)도 같이 받는다 (무대 그림용)
export async function embeddingRank(me, people) {
  const local = embedScores(me, people); // 같은 뜻 관심사 쌍은 로그 칩에 쓴다
  try {
    const res = await api("/api/embed", { me: slim(me), people: people.map(slim) });
    const byId = new Map(res.scores.map(s => [s.id, s]));
    const ranked = local
      .map(c => { const s = byId.get(c.profile.id); return { ...c, embed: s.embed, dims: s.dims, xyz: s.xyz }; })
      .sort((a, b) => b.embed - a.embed);
    return { ranked, model: res.model, ms: res.ms, me: res.me, dim: res.dim, pcaVariance: res.pcaVariance };
  } catch (err) {
    return { ranked: local, fallback: err.message };
  }
}

// ---------- 서버 호출 ----------
export async function api(path, body) {
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
  const people = PROFILES.filter(p => p.id !== me.id);
  stageReset(me, people);
  render();
  const startedAt = performance.now();

  // 1단계: 계산은 바로 끝난다. 2단계 요청은 1단계 그림이 도는 동안 먼저 보낸다
  setPipe(0, "run");
  showLogCard();
  const { passed, excluded } = ruleFilter(me);
  const embAt = performance.now();
  const embP = passed.length ? timed(embeddingRank(me, passed)) : null;
  logStage(1, "규칙 거르기", "절대 안 되는 조건에 걸리는 사람을 먼저 뺍니다.",
    "조건이 안 맞는 사람은 점수를 매길 필요가 없어요. 내 조건과 상대 조건을 둘 다 봅니다.");
  const byGender = excluded.filter(x => x.rule.name === "성별");
  const others = excluded.filter(x => x.rule.name !== "성별");
  logSub(`성별 조건으로 ${byGender.length}명 제외`);
  others.forEach(x => logSub(`${x.p.name} — ${x.rule.why(me, x.p)}`, "dim"));
  logSub(`${PROFILES.length}명 → ${passed.length}명 통과`, "hl");
  await stageRules({ passed, excluded });
  setCount(passed.length);

  if (passed.length === 0) {
    setPipe(0, "fail", "0명 남음");
    logLine("결과 없음", "조건에 맞는 사람이 0명입니다. 이상형 조건을 넓혀 보세요.", "err");
    finish({ empty: true, excludedCount: excluded.length, excluded: countByRule(others) });
    return;
  }
  setPipe(0, "done", `${PROFILES.length}명 → ${passed.length}명`);

  // 2단계
  state.step = 2;
  setPipe(1, "run");
  logStage(2, "임베딩 후보 추리기", "관심사·소개·성격 글을 로컬 LLM(bge-m3)으로 숫자 벡터로 바꿔 나와 가까운 사람을 찾습니다.",
    "표기가 달라도(등산 ≈ 산 타기) 뜻이 비슷하면 가깝게 잡혀요. 다음 단계로 넘길 후보를 5명으로 줄입니다.");
  const w2 = logWorking(`${passed.length + 1}명의 관심사를 비교하는 중`, embAt);
  const v2 = stageEmbed(embP, embAt, passed);
  const er = await embP;
  const emb = er.value;
  const ranked = emb.ranked;
  const top = ranked.slice(0, TOP_K);

  // 3단계 요청은 2단계 그림이 도는 동안 바로 보낸다
  const rrAt = performance.now();
  const rrP = timed(api("/api/rerank", { me: slim(me), candidates: top.map(c => ({ profile: slim(c.profile), embed: c.embed })) }))
    .then(r => {
      if (!r.ok) return { ...r, final: top.map(c => ({ ...c, llmScore: Math.round(c.embed * 100), oneLine: oneLine(me, c.profile) })) };
      const scoreOf = new Map(r.value.ranking.map(x => [x.id, x]));
      const final = top
        .filter(c => scoreOf.has(c.profile.id))
        .map(c => ({ ...c, llmScore: scoreOf.get(c.profile.id).score, oneLine: scoreOf.get(c.profile.id).oneLine }))
        .sort((a, b) => b.llmScore - a.llmScore);
      if (!final.length) return { ok: false, ms: r.ms, error: "응답에 후보가 없어요", final: top.map(c => ({ ...c, llmScore: Math.round(c.embed * 100), oneLine: oneLine(me, c.profile) })) };
      return { ok: true, ms: r.ms, model: r.value.model, final };
    });

  if (emb.fallback) {
    w2.fail("로컬 임베딩 서버 연결 실패");
    logSub("관심사 뜻 묶음 계산으로 대신합니다", "dim");
  } else {
    w2.done(`비교 완료 · ${emb.model}`, er.ms);
  }
  logSub(`${emb.fallback ? "뜻 묶음" : "임베딩 코사인"} 유사도 상위 ${top.length}명`);
  logPeople(top.map(c => ({
    profile: c.profile,
    chips: [c.pair.sim >= 0.9 ? `${c.pair.a} ≈ ${c.pair.b}` : null,
      ...c.profile.interests.filter(t => me.interests.includes(t))].filter(Boolean).slice(0, 2),
    score: `취향 ${c.embed.toFixed(3)}`,
  })));
  const cut = ranked.slice(TOP_K);
  if (cut.length) logSub(`탈락: ${cut.map(c => `${c.profile.name} ${c.embed.toFixed(3)}`).join(", ")}`, "dim");
  await v2;
  setCount(top.length);
  setPipe(1, "done", `${passed.length}명 → ${top.length}명`);

  // 3단계
  state.step = 3;
  setPipe(2, "run");
  logStage(3, "LLM 재순위", `LLM이 ${top.length}명의 프로필을 읽고 다시 줄 세웁니다.`,
    "임베딩은 글이 비슷한지만 봐요. LLM은 성격·대화 스타일·생활 리듬까지 읽고 실제로 잘 통할 순서로 바꿉니다.");
  const w3 = logWorking(`${top.length}명 프로필 읽는 중`, rrAt);
  const v3 = stageRerank(rrP, rrAt);
  const rr = await rrP;
  const final = rr.final;

  // 4단계 요청 5개도 3단계 그림이 도는 동안 바로 보낸다 (1위는 결과 화면, 2~5위는 상세 화면용)
  const exAt = performance.now();
  const exPs = final.map(c =>
    timed(api("/api/explain", { me: slim(me), partner: slim(c.profile), embed: c.embed, llmScore: c.llmScore })));

  if (rr.ok) {
    w3.done(`재순위 완료 · ${rr.model}`, rr.ms);
    logRankBoard(top, final);
    final.forEach((c, i) => logSub(`${i + 1}위 ${c.profile.name}: ${c.oneLine}`, i === 0 ? "hl" : ""));
  } else {
    w3.fail(`실패: ${rr.error}`);
    logSub("임베딩 순서를 그대로 씁니다", "dim");
  }
  await v3;
  setPipe(2, rr.ok ? "done" : "fail", rr.ok ? `1위 ${final[0].profile.name} ${final[0].llmScore}점` : "LLM 미연결");
  setCount(1);

  // 4단계
  state.step = 4;
  setPipe(3, "run");
  logStage(4, "LLM 이유 설명", `1위 ${eulReul(final[0].profile.name)} 고른 이유를 두 사람 프로필에 적힌 내용만으로 씁니다.`,
    "점수만 보여 주면 왜 1위인지 알 수 없어요. 사람이 읽을 수 있는 이유로 바꿔 화면에 보여 줍니다.");
  const w4 = logWorking(`${final.length}명 이유 쓰는 중`, exAt);
  const v4 = stageExplain(exPs, exAt);
  const explains = await Promise.all(exPs);
  const ex0 = explains[0];
  let explain = null;
  if (ex0.ok) {
    w4.done("이유 정리 완료", Math.max(...explains.map(r => r.ms)));
    explain = ex0.value;
    logSub(`“${explain.headline}”`, "hl");
    explain.reasons.forEach(r => logSub(`${r.title}: ${r.detail}`));
    logSub(`주의: ${explain.caution}`, "dim");
    logSub(`첫 만남 제안: ${explain.firstDate}`);
  } else {
    w4.fail(`실패: ${ex0.error}`);
  }
  await v4;
  setPipe(3, ex0.ok ? "done" : "fail", ex0.ok ? `이유 ${explain.reasons.length}개 완성` : "실패");

  const totalMs = performance.now() - startedAt;
  logGap();
  logLine("완료", `총 ${(totalMs / 1000).toFixed(1)}초 · ${PROFILES.length}명 → ${passed.length}명 → ${top.length}명 → 1위 ${final[0].profile.name} (${final[0].llmScore}점)`, "ok");
  finish({
    ranked: final.map((c, i) => {
      // 2~5위도 이유를 저장한다. 상세 화면은 표시만 한다
      const ex = explains[i].ok ? explains[i].value : null;
      return { id: c.profile.id, embed: c.embed, jaccard: c.jaccard, pair: c.pair, llmScore: c.llmScore, oneLine: c.oneLine,
        before: top.findIndex(t => t.profile.id === c.profile.id) + 1, headline: ex?.headline, reasons: ex?.reasons.slice(0, 2) };
    }),
    explain, explainError: ex0.ok ? null : ex0.error, passed: passed.length, total: PROFILES.length, totalMs: Math.round(totalMs),
    embedModel: emb.fallback ? null : emb.model, embedFallback: emb.fallback ?? null,
    llmModel: rr.ok ? rr.model : null, rerankError: rr.ok ? null : rr.error,
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
  // 먼저 맨 위로 올려 둔 뒤 그린다: 결과 사진이 무대 원판 자리에서 커져 오는 계산이 이 위치를 기준으로 한다
  $("#screen")?.scrollTo({ top: 0, behavior: "instant" });
  render();
}

// 옛 저장 결과에 서명이 없으면 지금 서명을 채운다 (거짓 「프로필이 바뀌었어요」 방지)
if (state.result && !state.result.forMe && state.me) {
  state.result.forMe = signature(state.me);
  save("result", state.result);
}
