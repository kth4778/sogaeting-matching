import { PROFILES, SAMPLE_PROFILES } from "./profiles.js";
import { PAGES_API_BASE } from "./config.js";
import { STEPS as OB_STEPS, INTEREST_MAX, blankDraft, onboardingHtml, setField, getField } from "./onboarding.js";

// 임베딩: 키 없이 브라우저에서 도는 다국어 문장 임베딩 모델
const TRANSFORMERS_URL = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.2";
const EMBED_MODEL = "Xenova/multilingual-e5-small";
const TOP_K = 5;            // 임베딩 단계에서 LLM에게 넘길 후보 수
const MUTUAL_MIN = 60;      // 좋아요를 받았을 때 상대도 좋아요를 누를 궁합 점수 기준

const $ = sel => document.querySelector(sel);
const byId = id => PROFILES.find(p => p.id === id);
const PHOTO_V = 3; // 사진을 새로 만들면 올려서 브라우저에 남은 옛 사진을 쓰지 않게 한다
const photo = p => `photos/${p.id}.png?v=${PHOTO_V}`;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
// 내 사진이 있으면(예시 프로필) 사진, 없으면 이름 첫 글자로 동그라미를 그린다
const meAvatar = (me, cls) => me.photo
  ? `<div class="${cls} photo" style="background-image:url(${me.photo}?v=${PHOTO_V})"></div>`
  : `<div class="${cls}">${esc(me.name.slice(0, 1))}</div>`;
// 마지막 글자 받침에 따라 을/를을 고른다
const eulReul = name => ((name.charCodeAt(name.length - 1) - 0xac00) % 28 ? `${name}을` : `${name}를`);

// ---------- 저장 (새로고침해도 유지) ----------
function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 저장 못 해도 화면은 동작 */ }
}

const savedMe = load("me", null);
const state = {
  tab: "home",
  me: savedMe,
  // 저장된 프로필이 없으면 가입 흐름부터 보여 준다
  ob: savedMe ? null : { stepIndex: 0, draft: blankDraft(), editing: false, dir: "fwd" },
  running: false,
  step: 0,              // 진행 중인 단계 (1~4), 0이면 대기
  result: load("result", null),
  swiped: load("swiped", {}),   // id -> like | super | pass
  matches: load("matches", []), // 서로 좋아요가 된 id
  chats: load("chats", {}),     // id -> [{ from, text }]
  chatWith: null,
  detail: null,
  ended: load("ended", {}),     // id -> 상대가 나간 이유 (로그용)
  confirmLeave: false,          // 「대화방 나가기」 확인 창
};

// ---------- 오른쪽 실시간 로그 ----------
const logEl = $("#log");
const time = () => new Date().toTimeString().slice(0, 8);

function scrollLog() { logEl.scrollTop = logEl.scrollHeight; }
function logLine(tag, text, kind) {
  const row = document.createElement("div");
  row.className = "line";
  row.innerHTML = `<span class="ts">[${time()}]</span><span class="tag t-${kind}">${esc(tag)}</span><span>${esc(text)}</span>`;
  logEl.append(row);
  scrollLog();
  return row;
}
function logSub(text, cls = "") {
  const row = document.createElement("div");
  row.className = `sub ${cls}`;
  row.textContent = text;
  logEl.append(row);
  scrollLog();
  return row;
}
function logCmd(html) {
  const row = document.createElement("div");
  row.className = "cmd";
  row.innerHTML = html;
  logEl.append(row);
  scrollLog();
}
function logGap() { logEl.append(Object.assign(document.createElement("div"), { className: "gap" })); }
// 트리 모양 하위 줄: 마지막 줄만 └─
function logTree(lines, cls = "") {
  lines.forEach((l, i) => logSub(`${i === lines.length - 1 ? "└─" : "├─"} ${l}`, cls));
}

function bootLog() {
  logEl.innerHTML = "";
  logCmd(`<b>$</b> node server.js`);
  logCmd(`> 매칭 로그 대기 중... 아이폰에서 「매칭 시작」을 누르세요 <span class="cursor"></span>`);
  logGap();
}

// ---------- 1단계: 규칙 거르기 ----------
// 양쪽 조건을 다 본다. 내가 원하는 조건 + 상대가 원하는 조건.
const RULES = [
  { name: "성별", side: "me", test: (me, p) => p.gender === me.wants.gender },
  { name: "성별", side: "them", test: (me, p) => p.wants.gender === me.gender },
  { name: "나이", side: "me", test: (me, p) => p.age >= me.wants.ageMin && p.age <= me.wants.ageMax,
    why: (me, p) => `나이 ${p.age}살 (내 조건 ${me.wants.ageMin}~${me.wants.ageMax}살)` },
  { name: "나이", side: "them", test: (me, p) => me.age >= p.wants.ageMin && me.age <= p.wants.ageMax,
    why: (me, p) => `상대 조건 ${p.wants.ageMin}~${p.wants.ageMax}살인데 나는 ${me.age}살` },
  { name: "흡연", side: "me", test: (me, p) => !me.wants.nonSmokerOnly || p.smoking === "비흡연",
    why: () => "흡연자 (나는 비흡연자만 원함)" },
  { name: "흡연", side: "them", test: (me, p) => !p.wants.nonSmokerOnly || me.smoking === "비흡연",
    why: () => "상대가 비흡연자만 원함" },
  { name: "종교", side: "me", test: (me, p) => me.wants.religion === "상관없음" || p.religion === me.wants.religion,
    why: (me, p) => `종교 ${p.religion} (내 조건 ${me.wants.religion})` },
  { name: "종교", side: "them", test: (me, p) => p.wants.religion === "상관없음" || me.religion === p.wants.religion,
    why: (me, p) => `상대가 ${p.wants.religion} 신자만 원함 (나는 ${me.religion})` },
];

function ruleFilter(me) {
  const passed = [];
  const excluded = [];
  for (const p of PROFILES) {
    if (p.id === me.id) continue; // 나 자신은 후보에서 뺀다
    const failed = RULES.find(r => !r.test(me, p));
    if (failed) excluded.push({ p, rule: failed });
    else passed.push(p);
  }
  return { passed, excluded };
}

// 상대 쪽 조건만 다시 확인 (좋아요를 받은 상대가 나를 받아줄 수 있는지)
const theyAccept = (me, p) => RULES.filter(r => r.side === "them").every(r => r.test(me, p));

// ---------- 2단계: 임베딩 ----------
let extractor = null;
const vectors = new Map(); // 문장 -> 벡터 (한 번 계산한 건 다시 안 함)

async function getExtractor() {
  if (extractor) return extractor;
  const row = logSub(`├─ 임베딩 모델 불러오는 중 (${EMBED_MODEL}, 처음 한 번만)`, "dim");
  const { pipeline } = await import(TRANSFORMERS_URL);
  extractor = await pipeline("feature-extraction", EMBED_MODEL, {
    progress_callback: e => {
      if (e.status === "progress" && e.file?.endsWith(".onnx")) {
        row.textContent = `├─ 임베딩 모델 내려받는 중 ${Math.round(e.progress)}%`;
      }
    },
  });
  row.textContent = "├─ 임베딩 모델 준비 완료";
  return extractor;
}

async function embed(texts) {
  const todo = [...new Set(texts.filter(t => !vectors.has(t)))];
  if (todo.length) {
    const ex = await getExtractor();
    // e5 계열은 앞에 "query: "를 붙여야 성능이 나온다
    const out = await ex(todo.map(t => `query: ${t}`), { pooling: "mean", normalize: true });
    out.tolist().forEach((v, i) => vectors.set(todo[i], v));
  }
  return texts.map(t => vectors.get(t));
}

const cosine = (a, b) => a.reduce((sum, x, i) => sum + x * b[i], 0); // 정규화돼 있어 내적 = 코사인
const profileText = p => `관심사: ${p.interests.join(", ")}. ${p.intro} ${p.personality}`;

// 단어가 똑같아야만 겹친다고 보는 공식 (임베딩과 비교용)
function jaccard(a, b) {
  const A = new Set(a), B = new Set(b);
  const inter = [...A].filter(x => B.has(x)).length;
  return inter / new Set([...A, ...B]).size;
}

async function embeddingRank(me, people) {
  const [meVec, ...vecs] = await embed([profileText(me), ...people.map(profileText)]);
  const words = [...new Set([...me.interests, ...people.flatMap(p => p.interests)])];
  const wordVecs = new Map();
  (await embed(words)).forEach((v, i) => wordVecs.set(words[i], v));

  return people.map((p, i) => {
    // 표기는 다르지만 뜻이 가장 가까운 관심사 한 쌍 (예: 등산 ≈ 산 타기).
    // 똑같은 단어는 자카드도 잡아내므로, 임베딩만 찾을 수 있는 쌍을 보여 준다.
    let pair = null;
    for (const a of me.interests) for (const b of p.interests) {
      if (a === b) continue;
      const sim = cosine(wordVecs.get(a), wordVecs.get(b));
      if (!pair || sim > pair.sim) pair = { a, b, sim };
    }
    return { profile: p, embed: cosine(meVec, vecs[i]), jaccard: jaccard(me.interests, p.interests), pair };
  }).sort((x, y) => y.embed - x.embed);
}

// ---------- 3·4단계: 서버를 거쳐 Claude 호출 ----------
async function api(path, body) {
  // GitHub Pages에서는 중계 서버(Worker)로, 로컬에서는 같은 서버의 /api로 보낸다
  const base = location.hostname.endsWith("github.io") ? PAGES_API_BASE : "";
  const res = await fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  // GitHub Pages 같은 정적 배포에는 API 서버가 없어 HTML 404가 돌아온다
  if (!(res.headers.get("content-type") ?? "").includes("application/json")) {
    throw new Error("서버 없는 배포판이라 Claude를 부를 수 없어요 (로컬에서 npm start로 실행하면 동작)");
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

// ---------- 로그 위 4단계 진행 막대 ----------
const PIPE = [
  ["규칙 거르기", "조건 안 맞는 사람 빼기"],
  ["임베딩", "뜻이 가까운 5명 고르기"],
  ["LLM 재순위", "글을 읽고 다시 줄 세우기"],
  ["LLM 이유", "1위를 고른 이유 쓰기"],
];
const pipe = { status: ["wait", "wait", "wait", "wait"], note: ["", "", "", ""] };

function renderPipeline() {
  $("#pipeline").innerHTML = PIPE.map(([title, desc], i) => {
    const s = pipe.status[i];
    const mark = s === "done" ? "✓" : s === "fail" ? "!" : i + 1;
    return `<div class="pstep ${s}"><span class="pnum">${mark}</span><div><b>${title}</b><small>${esc(pipe.note[i] || desc)}</small></div></div>${i < PIPE.length - 1 ? `<span class="parrow">›</span>` : ""}`;
  }).join("");
}
function setPipe(i, status, note) {
  pipe.status[i] = status;
  if (note !== undefined) pipe.note[i] = note;
  renderPipeline();
}
function resetPipe() {
  pipe.status = ["wait", "wait", "wait", "wait"];
  pipe.note = ["", "", "", ""];
  renderPipeline();
}

// 단계 시작: 지금 무엇을 하는지, 왜 하는지를 크게 보여 준다
function logStage(n, title, what, why) {
  const box = document.createElement("div");
  box.className = `stage-box s${n}`;
  box.innerHTML = `
    <div class="stage-title"><span class="tag t-s${n}">${n}/4</span>${esc(title)}<span class="ts">${time()}</span></div>
    <div class="stage-what">${esc(what)}</div>
    <div class="stage-why">왜? ${esc(why)}</div>`;
  logEl.append(box);
  scrollLog();
}

// 기다리는 동안 초가 올라가는 줄. 끝나면 결과 문장으로 바뀐다.
function logWorking(text) {
  const row = logSub("", "working");
  const t0 = performance.now();
  const secs = () => ((performance.now() - t0) / 1000).toFixed(1);
  const tick = () => { row.innerHTML = `<span class="spin"></span>${esc(text)} <b>${secs()}초</b>`; };
  tick();
  const timer = setInterval(tick, 100);
  return {
    done(msg) { clearInterval(timer); row.className = "sub dim"; row.textContent = `✓ ${msg} (${secs()}초)`; },
    fail(msg) { clearInterval(timer); row.className = "sub err"; row.textContent = `✕ ${msg}`; },
  };
}

// 재순위 전후를 같은 판에서 보여 준다: 임베딩 순서로 놓았다가 Claude 점수 순서로 줄이 움직여 자리를 바꾼다
const ROW_H = 38;
async function logRankBoard(before, after) {
  const board = document.createElement("div");
  board.className = "rank-board";
  board.style.height = `${before.length * ROW_H + 40}px`;
  board.innerHTML = `<div class="rb-head"><span class="rb-title">임베딩 순위</span><span class="rb-state">Claude 점수로 다시 줄 세우는 중…</span></div>` +
    before.map((c, i) => `
      <div class="rb-row" data-id="${c.profile.id}" style="transform:translateY(${i * ROW_H}px)">
        <span class="rb-rank">${i + 1}</span>
        <span class="rb-av" style="background-image:url(${photo(c.profile)})"></span>
        <span class="rb-name">${esc(c.profile.name)}</span>
        <span class="rb-move"></span>
        <span class="rb-score">${c.embed.toFixed(3)}</span>
      </div>`).join("");
  logEl.append(board);
  scrollLog();
  await sleep(800);
  after.forEach((c, i) => {
    const row = board.querySelector(`[data-id="${c.profile.id}"]`);
    const diff = before.findIndex(b => b.profile.id === c.profile.id) - i;
    row.style.transform = `translateY(${i * ROW_H}px)`;
    row.classList.add(diff > 0 ? "up" : diff < 0 ? "down" : "same");
    if (i === 0) row.classList.add("first");
    row.querySelector(".rb-rank").textContent = i + 1;
    row.querySelector(".rb-move").textContent = diff > 0 ? `▲ ${diff}` : diff < 0 ? `▼ ${-diff}` : "–";
    countUp(row.querySelector(".rb-score"), c.llmScore, "점");
  });
  board.querySelector(".rb-title").textContent = "Claude 재순위";
  board.querySelector(".rb-state").textContent = "순위 확정";
  await sleep(1000);
}

// 숫자를 0부터 목표값까지 올라가며 보여 준다
function countUp(el, to, unit) {
  const t0 = performance.now();
  const step = now => {
    const k = Math.min(1, (now - t0) / 800);
    el.textContent = `${Math.round(to * k)}${unit}`;
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ---------- 전체 매칭 흐름 ----------
async function runMatching() {
  if (state.running) return;
  const me = state.me;
  state.running = true;
  state.result = null;
  state.step = 1;
  render();
  resetPipe();
  const startedAt = performance.now();

  logGap();
  logCmd(`<b>$</b> match --me "${esc(me.name)}" --pool ${PROFILES.length}`);
  logCmd(`> 후보 ${PROFILES.length}명 중에서 ${esc(me.name)}님과 가장 잘 맞는 1명을 찾습니다`);

  // 1단계
  setPipe(0, "run");
  await sleep(400);
  logStage(1, "규칙 거르기", "절대 안 되는 조건에 걸리는 사람을 먼저 뺍니다.",
    "조건이 안 맞는 사람은 점수를 매길 필요가 없어요. 내 조건과 상대 조건을 둘 다 봅니다.");
  const { passed, excluded } = ruleFilter(me);
  const byGender = excluded.filter(x => x.rule.name === "성별");
  const others = excluded.filter(x => x.rule.name !== "성별");
  logSub(`├─ 나 자신 제외 ✓`);
  logSub(`├─ 성별 조건으로 ${byGender.length}명 제외`);
  others.forEach(x => logSub(`├─ ✕ ${x.p.name} — ${x.rule.why(me, x.p)}`, "dim"));
  logSub(`└─ ${PROFILES.length}명 → ${passed.length}명 통과`, "hl");

  if (passed.length === 0) {
    setPipe(0, "fail", "0명 남음");
    logLine("결과 없음", "조건에 맞는 사람이 0명입니다. 이상형 조건을 넓혀 보세요.", "err");
    finish({ empty: true, excludedCount: excluded.length });
    return;
  }
  setPipe(0, "done", `${PROFILES.length}명 → ${passed.length}명`);

  // 2단계
  state.step = 2; render();
  setPipe(1, "run");
  await sleep(300);
  logStage(2, "임베딩 후보 추리기", "관심사·소개·성격 문장을 숫자 좌표로 바꾸고, 내 좌표와 가까운 사람을 찾습니다.",
    "표기가 달라도(등산 ≈ 산 타기) 뜻이 비슷하면 가깝게 잡혀요. Claude에게 넘길 후보를 5명으로 줄입니다.");
  const w2 = logWorking(`${passed.length + 1}명의 문장을 좌표로 바꾸는 중`);
  let ranked;
  try {
    ranked = await embeddingRank(me, passed);
    w2.done("좌표 계산 완료");
  } catch (err) {
    w2.fail(`임베딩 실패: ${err.message}`);
    setPipe(1, "fail", "실패");
    finish({ error: true });
    return;
  }
  const top = ranked.slice(0, TOP_K);
  logSub(`├─ 코사인 유사도 상위 ${top.length}명 (단어 일치율 자카드와 비교)`);
  top.forEach((c, i) => logSub(
    `${i === top.length - 1 ? "└─" : "├─"} ${i + 1}. ${c.profile.name.padEnd(4, "　")} 임베딩 ${c.embed.toFixed(3)} · 자카드 ${c.jaccard.toFixed(2)} · ${c.pair.a} ≈ ${c.pair.b} (${c.pair.sim.toFixed(2)})`));
  const cut = ranked.slice(TOP_K);
  if (cut.length) logSub(`   (탈락: ${cut.map(c => `${c.profile.name} ${c.embed.toFixed(3)}`).join(", ")})`, "dim");
  setPipe(1, "done", `${passed.length}명 → ${top.length}명`);

  // 3단계
  state.step = 3; render();
  setPipe(2, "run");
  logStage(3, "LLM 재순위", `Claude가 ${top.length}명의 프로필 글을 직접 읽고 다시 줄 세웁니다.`,
    "임베딩은 단어가 비슷한지만 봐요. 성격, 대화 속도, 생활 리듬이 맞는지는 글을 읽어야 알 수 있어요.");
  const w3 = logWorking(`Claude가 ${top.length}명의 프로필을 읽는 중`);
  let final;
  try {
    const res = await api("/api/rerank", { me, candidates: top.map(c => ({ profile: c.profile, embed: c.embed })) });
    w3.done(`${res.model} 응답 · 입력 ${res.usage.input_tokens} / 출력 ${res.usage.output_tokens} 토큰`);
    const scoreOf = new Map(res.ranking.map(r => [r.id, r]));
    final = top
      .filter(c => scoreOf.has(c.profile.id))
      .map(c => ({ ...c, llmScore: scoreOf.get(c.profile.id).score, oneLine: scoreOf.get(c.profile.id).oneLine }))
      .sort((a, b) => b.llmScore - a.llmScore);
    await logRankBoard(top, final);
    final.forEach((c, i) => logSub(`${i === final.length - 1 ? "└─" : "├─"} ${i + 1}위 ${c.profile.name}: ${c.oneLine}`, i === 0 ? "hl" : ""));
    setPipe(2, "done", `1위 ${final[0].profile.name} ${final[0].llmScore}점`);
  } catch (err) {
    w3.fail(`실패: ${err.message}`);
    logSub("   → 임베딩 순서를 그대로 씁니다", "dim");
    final = top.map(c => ({ ...c, llmScore: Math.round(c.embed * 100), oneLine: "관심사와 소개가 비슷해요" }));
    setPipe(2, "fail", "LLM 미연결");
  }

  // 4단계
  state.step = 4; render();
  setPipe(3, "run");
  logStage(4, "LLM 이유 설명", `1위 ${eulReul(final[0].profile.name)} 고른 이유를 두 사람 프로필에 적힌 내용만으로 씁니다.`,
    "점수만 보여 주면 왜 1위인지 알 수 없어요. 사람이 읽을 수 있는 이유로 바꿔 화면에 보여 줍니다.");
  const w4 = logWorking("Claude가 이유를 쓰는 중");
  let explain = null;
  try {
    const res = await api("/api/explain", { me, partner: final[0].profile, embed: final[0].embed, llmScore: final[0].llmScore });
    w4.done(`${res.model} 응답`);
    explain = res;
    logSub(`├─ "${res.headline}"`, "hl");
    res.reasons.forEach(r => logSub(`├─ ${r.title}: ${r.detail}`));
    logSub(`├─ 주의: ${res.caution}`, "dim");
    logSub(`└─ 첫 만남 제안: ${res.firstDate}`);
    setPipe(3, "done", `이유 ${res.reasons.length}개 완성`);
  } catch (err) {
    w4.fail(`실패: ${err.message}`);
    setPipe(3, "fail", "실패");
  }

  logGap();
  logLine("완료", `총 ${((performance.now() - startedAt) / 1000).toFixed(1)}초 · ${PROFILES.length}명 → ${passed.length}명 → ${top.length}명 → 1위 ${final[0].profile.name} (${final[0].llmScore}점)`, "ok");
  finish({ ranked: final.map(c => ({ id: c.profile.id, embed: c.embed, jaccard: c.jaccard, pair: c.pair, llmScore: c.llmScore, oneLine: c.oneLine, before: top.findIndex(t => t.profile.id === c.profile.id) + 1 })), explain, passed: passed.length });
}

function finish(result) {
  state.running = false;
  state.step = 0;
  state.result = result;
  save("result", result);
  render();
}

// ---------- 좋아요 / 매칭 성사 ----------
function scoreFor(id) {
  return state.result?.ranked?.find(r => r.id === id)?.llmScore ?? null;
}

function react(id, kind) {
  const p = byId(id);
  state.swiped[id] = kind;
  save("swiped", state.swiped);

  if (kind === "pass") {
    logLine("넘기기", `${p.name}`, "sys");
    return;
  }
  logLine(kind === "super" ? "슈퍼 좋아요" : "좋아요", `${p.name}에게 보냈습니다 — 상대 반응 계산`, "like");

  // 상대도 나를 좋아할지: 상대 조건 → 궁합 점수 순서로 판단
  let mutual, why;
  const score = scoreFor(id);
  if (!theyAccept(state.me, p)) { mutual = false; why = "상대 조건(나이·흡연·종교·성별)에 내가 맞지 않음"; }
  else if (kind === "super") { mutual = true; why = "상대 조건 통과 + 슈퍼 좋아요"; }
  else if (score !== null) { mutual = score >= MUTUAL_MIN; why = `궁합 ${score}점 ${mutual ? "≥" : "<"} 기준 ${MUTUAL_MIN}점`; }
  else { mutual = Math.random() < 0.5; why = "궁합 점수 없음 (매칭 전) → 50% 확률"; }

  logSub(`└─ ${mutual ? "서로 좋아요 성사 ♥" : "상대가 아직 응답하지 않음"} (${why})`, mutual ? "hl" : "dim");
  if (mutual && !state.matches.includes(id)) {
    state.matches.push(id);
    save("matches", state.matches);
    showMatch(p);
  } else if (!mutual) {
    toast("좋아요를 보냈어요");
  }
}

// 매칭 성사: 화면을 가리지 않고 아이폰 알림처럼 위에서 내려왔다가 사라진다. 누르면 대화방으로 간다.
function showMatch(p) {
  document.querySelector(".notice")?.remove();
  const n = document.createElement("button");
  n.className = "notice";
  n.dataset.act = `chat:${p.id}`;
  n.innerHTML = `
    <div class="notice-av photo" style="background-image:url(${photo(p)})"></div>
    <div class="notice-text"><b>매칭 성공 ♥</b><span>${esc(p.name)}님도 좋아요를 눌렀어요 · 눌러서 대화하기</span></div>
    <span class="notice-time">지금</span>`;
  $(".phone-screen").append(n);
  setTimeout(() => n.classList.add("out"), 4200);
  setTimeout(() => n.remove(), 4700);
}

// ---------- 채팅 ----------
// 내가 보낸 메시지는 바로 화면에 쌓고, 5초 동안 더 보내지 않으면 그동안 보낸 것을 묶어서 상대에게 넘긴다.
// 상대가 답장을 쓰는 중에도 계속 보낼 수 있다.
const CHAT_IDLE_MS = 5000;
const chatRuntime = {}; // 대화방 id -> { timer, inflight, lastSentAt }

function queueMessage(text) {
  const id = state.chatWith;
  const history = (state.chats[id] ??= []);
  history.push({ from: "me", text });
  save("chats", state.chats);
  logLine("채팅", `나 → ${byId(id).name}: ${text}`, "chat");
  const rt = (chatRuntime[id] ??= {});
  rt.lastSentAt = Date.now();
  scheduleFlush(id);
  render();
}

function scheduleFlush(id) {
  const rt = chatRuntime[id];
  clearTimeout(rt.timer);
  if (rt.inflight) return; // 답장이 오고 나서 다시 잡는다
  const wait = Math.max(0, CHAT_IDLE_MS - (Date.now() - rt.lastSentAt));
  rt.timer = setTimeout(() => flushChat(id), wait);
}

// 맨 끝에 이어진 「내 메시지」 개수 = 아직 답장을 못 받은 메시지
function unanswered(history) {
  let n = 0;
  for (let i = history.length - 1; i >= 0 && history[i].from === "me"; i--) n++;
  return n;
}

async function flushChat(id) {
  const rt = chatRuntime[id];
  const p = byId(id);
  const history = state.chats[id];
  const count = unanswered(history);
  if (!count || state.ended[id]) return;

  rt.inflight = true;
  render();
  logSub(`├─ ${CHAT_IDLE_MS / 1000}초 동안 추가 입력이 없어 메시지 ${count}개를 묶어서 보냄`, "dim");
  const answeredUpTo = history.length;
  try {
    const res = await api("/api/chat", { me: state.me, partner: p, history: history.slice(0, answeredUpTo) });
    // 답장은 그 답이 가리키는 묶음 바로 뒤에 넣는다 (기다리는 동안 더 보낸 메시지는 답장 뒤로)
    history.splice(answeredUpTo, 0, { from: "them", text: res.reply });
    logSub(`├─ Claude가 ${p.name} 역할로 답장 (${(res.ms / 1000).toFixed(1)}초): ${res.reply}`);
    if (res.leave) {
      state.ended[id] = res.reason;
      save("ended", state.ended);
      history.splice(answeredUpTo + 1, 0, { from: "sys", text: `${p.name}님이 대화방을 나갔어요` });
      logSub(`└─ LLM 판단: 대화 종료 — ${res.reason}`, "err");
    } else {
      logSub(`└─ LLM 판단: 대화 계속 — ${res.reason}`, "dim");
    }
  } catch (err) {
    history.splice(answeredUpTo, 0, { from: "sys", text: "지금은 답장을 받을 수 없어요" });
    logSub(`└─ 실패: ${err.message}`, "err");
  }
  rt.inflight = false;
  save("chats", state.chats);
  render();
  // 답장을 기다리는 동안 더 보낸 메시지가 있으면 다시 5초를 기다렸다 보낸다
  if (!state.ended[id] && unanswered(history)) scheduleFlush(id);
}

// ---------- 화면 그리기 ----------
// 폰 화면에는 기술 이름 대신 사용자가 이해하는 말로 보여 준다 (기술 이름은 오른쪽 로그에만)
const STEPS = [
  ["조건 확인", "나이·흡연·종교, 서로의 조건을 맞춰 봐요"],
  ["취향 비교", "관심사와 소개가 비슷한 사람을 찾아요"],
  ["성격 궁합", "대화 스타일까지 보고 순서를 정해요"],
  ["추천 이유", "왜 잘 맞는지 알려드려요"],
];

function stepsHtml() {
  return `<div class="steps">${STEPS.map(([t, d], i) => {
    const n = i + 1;
    const cls = state.step === n ? "doing" : state.step > n ? "done" : "";
    return `<div class="step ${cls}"><b>${state.step > n ? "✓" : n}</b><div>${t}<small>${d}</small></div></div>`;
  }).join("")}</div>`;
}

function homeHtml() {
  const r = state.result;
  if (state.running || !r) {
    return `
      <div class="appbar"><span>오늘의 매칭</span><span class="muted">후보 ${PROFILES.length}명</span></div>
      <div class="intro-hero">
        <h2>${state.running ? "가장 잘 맞는 사람을<br>찾고 있어요" : "오늘 가장 잘 맞는<br>한 사람을 찾아드려요"}</h2>
        <p>취향과 성격, 생활 습관까지 살펴보고<br>왜 잘 맞는지도 함께 알려드려요.</p>
      </div>
      ${stepsHtml()}
      <div class="pad"><button class="btn" data-act="run" ${state.running ? "disabled" : ""}>${state.running ? "매칭 중..." : "매칭 시작 →"}</button></div>`;
  }
  if (r.empty || r.error) {
    return `
      <div class="appbar"><span>오늘의 매칭</span></div>
      <div class="empty">
        <div style="font-size:42px">🫥</div>
        <h3>${r.empty ? "조건에 맞는 사람이 없어요" : "매칭 중 문제가 생겼어요"}</h3>
        <p>${r.empty ? "나이 범위나 흡연·종교 조건을<br>조금 넓혀 보세요." : "잠시 후 다시 시도해 주세요."}</p>
        <button class="btn" data-act="tab:me">이상형 조건 바꾸기</button>
        <div style="height:10px"></div>
        <button class="btn line" data-act="run">다시 매칭</button>
      </div>`;
  }
  const [first, ...rest] = r.ranked;
  const p = byId(first.id);
  const headline = r.explain?.headline ?? first.oneLine;
  const confetti = ["#f7b500 12% 18% -20", "#4a7bd8 80% 14% 25", "#e8546b 22% 64% 35", "#2bbf74 76% 60% -30", "#8b5cf6 8% 40% 15", "#f7b500 90% 40% -15"]
    .map(c => { const [color, x, y, rot] = c.split(" "); return `<i style="background:${color};left:${x};top:${y};transform:rotate(${rot}deg)"></i>`; }).join("");
  return `
    <div class="appbar"><span>오늘의 매칭</span><span class="muted">1 / ${r.ranked.length}</span></div>
    <div class="rank1"><div class="confetti">${confetti}</div><div class="crown">👑</div><h2>1위</h2><p>가장 잘 맞는 상대예요!</p></div>
    <div class="top-photo photo" style="background-image:url(${photo(p)})" data-act="detail:${p.id}"></div>
    <div class="top-meta"><h3>${esc(p.name)} <span>${p.age}</span></h3><span class="score">♥ ${first.llmScore}점</span></div>
    <div class="top-sub">📍 ${p.region} · ${esc(p.job)}</div>
    <div class="quote">${esc(headline)}</div>
    <div class="pad"><button class="btn" data-act="detail:${p.id}">왜 이 사람인지 자세히 보기</button></div>
    <div class="rank-list">
      ${rest.map((c, i) => {
        const q = byId(c.id);
        const moved = c.before - (i + 2);
        const move = moved > 0 ? `<span class="move up">▲${moved}</span>` : moved < 0 ? `<span class="move down">▼${-moved}</span>` : "";
        return `<div class="rank-row" data-act="detail:${q.id}"><span class="n">${i + 2}</span><div class="av photo" style="background-image:url(${photo(q)})"></div><div class="who"><b>${esc(q.name)}</b> <span class="muted">${q.age}</span>${move}<small>${esc(c.oneLine)}</small></div><span class="pts">${c.llmScore}</span></div>`;
      }).join("")}
    </div>
    <div class="pad"><button class="btn line" data-act="run">다시 매칭</button></div>`;
}

function detailHtml(id) {
  const p = byId(id);
  const m = state.result?.ranked?.find(r => r.id === id);
  const isTop = state.result?.ranked?.[0]?.id === id;
  const ex = isTop ? state.result.explain : null;
  const shared = new Set(state.me.interests);
  const done = state.swiped[id];
  return `
    <div class="detail">
      <div class="detail-photo photo" style="background-image:url(${photo(p)})"><button class="back" data-act="close">←</button></div>
      <div class="detail-body">
        <h2>${esc(p.name)} <span>${p.age}</span></h2>
        <p class="muted" style="font-size:14px">📍 ${p.region} · ${esc(p.job)}</p>
        ${m ? `
          <div class="match-card">
            <div class="match-score"><b>${m.llmScore}</b><span>점 궁합</span></div>
            <p>${esc(m.oneLine)}</p>
            <small>비슷한 취향 · ${esc(m.pair.a)} & ${esc(m.pair.b)}</small>
          </div>` : ""}
        ${ex ? `
          <h4>이런 점이 잘 맞아요</h4>
          ${ex.reasons.map(r => `<div class="reason"><b>${esc(r.title)}</b>${esc(r.detail)}</div>`).join("")}
          <div class="reason" style="background:#fafafa"><b>살짝 다를 수 있는 점</b>${esc(ex.caution)}</div>
          <div class="reason" style="background:var(--pink-soft)"><b>첫 만남 제안</b>${esc(ex.firstDate)}</div>` : ""}
        <h4>소개</h4><p>${esc(p.intro)}</p>
        <h4>성격</h4><p>${esc(p.personality)}</p>
        <h4>관심사</h4><div>${p.interests.map(t => `<span class="chip ${shared.has(t) ? "hit" : ""}">${esc(t)}</span>`).join("")}</div>
        <h4>기본 정보</h4>
        <div class="facts">
          <div><span>키</span>${p.height}cm</div><div><span>MBTI</span>${p.mbti}</div>
          <div><span>흡연</span>${p.smoking}</div><div><span>음주</span>${p.drinking}</div>
          <div><span>종교</span>${p.religion}</div><div><span>지역</span>${p.region}</div>
        </div>
      </div>
    </div>
    <div class="actions">
      ${state.matches.includes(id)
        ? `<button class="btn" style="width:260px" data-act="chat:${id}">💬 대화하기</button>`
        : done ? `<span class="muted" style="background:#fff;padding:10px 16px;border-radius:999px">${done === "pass" ? "넘긴 사람이에요" : "좋아요를 보냈어요"}</span>`
        : actionButtons(id)}
    </div>`;
}

// 아이콘만으로는 뜻이 헷갈리므로 아래에 글자를 함께 둔다
function actionButtons(id) {
  return `
    <button class="act" data-act="pass:${id}"><span class="circle pass">✕</span><small>넘기기</small></button>
    <button class="act" data-act="like:${id}"><span class="circle like">♥</span><small>좋아요</small></button>
    <button class="act" data-act="super:${id}"><span class="circle super">★</span><small>슈퍼 좋아요</small></button>`;
}

function deckPeople() {
  const order = (state.result?.ranked ?? []).map(r => r.id);
  return PROFILES
    .filter(p => !state.swiped[p.id] && RULES.filter(r => r.side === "me").every(r => r.test(state.me, p)))
    .sort((a, b) => (order.includes(a.id) ? order.indexOf(a.id) : 99) - (order.includes(b.id) ? order.indexOf(b.id) : 99));
}

function cardsHtml() {
  const people = deckPeople();
  if (!people.length) {
    return `<div class="appbar"><span>카드 넘기기</span></div>
      <div class="empty"><div style="font-size:42px">🃏</div><h3>오늘 볼 카드를 다 봤어요</h3><p>내 조건에 맞는 사람을 모두 넘겼어요.</p>
      <button class="btn line" data-act="reset-swipes">넘긴 기록 지우고 다시 보기</button></div>`;
  }
  const visible = people.slice(0, 3).reverse(); // 맨 위 카드가 마지막에 그려지도록
  return `
    <div class="appbar"><span>카드 넘기기</span><span class="muted">${people.length}명 남음</span></div>
    <p class="swipe-hint"><span>← 넘기기</span>카드를 옆으로 밀어도 돼요<span>좋아요 →</span></p>
    <div class="deck" id="deck">
      ${visible.map((p, i) => {
        const s = scoreFor(p.id);
        const depth = visible.length - 1 - i;
        return `<div class="card" data-id="${p.id}" style="transform:translateY(${depth * 8}px) scale(${1 - depth * 0.04})">
          <div class="photo" style="background-image:url(${photo(p)})"></div>
          ${s !== null ? `<span class="card-tag">궁합 ${s}점</span>` : ""}
          <span class="stamp yes">LIKE</span><span class="stamp no">NOPE</span>
          <div class="shade" data-act="detail:${p.id}"><h3>${esc(p.name)} <span>${p.age}</span></h3><p>📍 ${p.region} · ${esc(p.job)}</p>${p.interests.map(t => `<span class="chip">${esc(t)}</span>`).join("")}</div>
        </div>`;
      }).join("")}
    </div>
    <div class="deck-actions">
      ${actionButtons(people[0].id)}
    </div>`;
}

function chatsHtml() {
  if (state.chatWith) return roomHtml();
  if (!state.matches.length) {
    return `<div class="appbar"><span>메시지</span></div>
      <div class="empty"><div style="font-size:42px">💌</div><h3>아직 매칭된 사람이 없어요</h3><p>서로 좋아요를 누르면 대화방이 열려요.</p>
      <button class="btn" data-act="tab:cards">카드 넘기러 가기</button></div>`;
  }
  return `<div class="appbar"><span>메시지</span><span class="muted">${state.matches.length}명</span></div>
    <div class="chat-list">${state.matches.map(id => {
      const p = byId(id);
      const last = (state.chats[id] ?? []).at(-1);
      const sub = state.ended[id] ? "대화가 끝났어요" : last ? esc(last.text) : "매칭됐어요! 먼저 인사해 보세요";
      return `<div class="row ${state.ended[id] ? "ended" : ""}" data-act="chat:${id}"><div class="av photo" style="background-image:url(${photo(p)})"></div><div><b>${esc(p.name)}</b><small>${sub}</small></div></div>`;
    }).join("")}</div>`;
}

function roomHtml() {
  const p = byId(state.chatWith);
  const msgs = state.chats[p.id] ?? [];
  return `
    <div class="room">
      <div class="room-head"><button class="icon-btn" data-act="back-chats" aria-label="뒤로">←</button><div class="av photo" style="background-image:url(${photo(p)})"></div><b>${esc(p.name)}</b><button class="leave-btn" data-act="leave-ask">나가기</button></div>
      <div class="msgs" id="msgs">
        <span class="sys-note">${esc(p.name)}님과 매칭됐어요 ♥</span>
        ${msgs.map(m => m.from === "sys" ? `<span class="sys-note">${esc(m.text)}</span>` : `<div class="bubble ${m.from}">${esc(m.text)}</div>`).join("")}
        ${chatRuntime[p.id]?.inflight ? `<div class="bubble them typing"><i></i><i></i><i></i></div>` : ""}
      </div>
      ${state.ended[p.id]
        ? `<div class="ended-bar"><b>${esc(p.name)}님이 대화방을 나갔어요</b><span>더 이상 대화할 수 없어요</span><button class="btn line" data-act="leave-confirm">대화방 지우기</button></div>`
        : `<form class="composer" id="composer"><input name="text" placeholder="메시지를 입력하세요" autocomplete="off"><button aria-label="보내기">↑</button></form>`}
      ${state.confirmLeave ? `
        <div class="sheet-dim" data-act="leave-cancel"></div>
        <div class="sheet">
          <b>대화방을 나갈까요?</b>
          <p>나가면 ${esc(p.name)}님과의 매칭이 끊기고<br>대화 내용도 사라져요.</p>
          <button class="sheet-danger" data-act="leave-confirm">나가기</button>
          <button class="sheet-cancel" data-act="leave-cancel">취소</button>
        </div>` : ""}
    </div>`;
}

function profileHtml() {
  const m = state.me;
  const w = m.wants;
  return `
    <div class="appbar"><span>내 정보</span><span class="muted">매칭 기준이 돼요</span></div>
    <div class="profile-card">
      ${meAvatar(m, "me-av big")}
      <h3>${esc(m.name)} <span>${m.age}</span></h3>
      <p class="muted">${m.region} · ${esc(m.job)}</p>
      <div>${m.interests.map(t => `<span class="chip hit">${esc(t)}</span>`).join("")}</div>
    </div>
    <div class="pad section">
      <h4>소개</h4><p>${esc(m.intro)}</p>
      <h4>성격</h4><p>${esc(m.personality)}</p>
      <h4>기본 정보</h4>
      <div class="facts">
        <div><span>성별</span>${m.gender === "남" ? "남자" : "여자"}</div><div><span>키</span>${m.height}cm</div>
        <div><span>MBTI</span>${m.mbti}</div><div><span>종교</span>${m.religion}</div>
        <div><span>흡연</span>${m.smoking}</div><div><span>음주</span>${m.drinking}</div>
      </div>
      <h4>이상형 조건 · 규칙 거르기에 쓰여요</h4>
      <div class="facts">
        <div><span>성별</span>${w.gender === "남" ? "남자" : "여자"}</div><div><span>나이</span>${w.ageMin}~${w.ageMax}살</div>
        <div><span>흡연</span>${w.nonSmokerOnly ? "비흡연자만" : "상관없음"}</div><div><span>종교</span>${w.religion}</div>
      </div>
      <button class="btn" style="margin-top:20px" data-act="edit-profile">프로필 수정하기</button>
    </div>`;
}

// 탭이나 상세 화면이 새로 열릴 때만 들어오는 움직임을 준다 (매칭 중 다시 그릴 때는 움직이지 않게)
let lastTab = null;
let lastDetail = null;
let lastObStep = null;

function render() {
  const screens = { home: homeHtml, cards: cardsHtml, chats: chatsHtml, me: profileHtml };
  const screen = $("#screen");
  // 답장이 와서 다시 그려도 입력 중인 글과 커서를 지킨다
  const typing = $("#composer input");
  const keep = typing && { value: typing.value, focused: document.activeElement === typing };
  screen.innerHTML = state.me ? screens[state.tab]() : "";
  if (keep) {
    const input = $("#composer input");
    if (input) { input.value = keep.value; if (keep.focused) input.focus(); }
  }
  screen.classList.toggle("in-room", state.tab === "chats" && !!state.chatWith);
  if (lastTab !== `${state.tab}/${state.chatWith}`) {
    screen.classList.remove("tab-enter");
    void screen.offsetWidth; // 애니메이션을 다시 시작시키기 위한 리플로우
    screen.classList.add("tab-enter");
    screen.scrollTop = 0;
    lastTab = `${state.tab}/${state.chatWith}`;
  }
  document.querySelectorAll("[data-act^='tab:']").forEach(b => b.classList.toggle("active", b.dataset.act === `tab:${state.tab}`));
  $("#tabbar").hidden = !!state.ob || (state.tab === "chats" && !!state.chatWith);

  const overlay = $("#overlay");
  if (state.ob) {
    overlay.className = "overlay open ob-mode";
    overlay.innerHTML = onboardingHtml(state.ob);
    // 같은 단계를 다시 그릴 때(칩 선택 등)는 들어오는 움직임을 빼서 깜빡이지 않게 한다
    if (lastObStep === `${state.ob.stepIndex}/${state.ob.picker ?? ""}` || (lastObStep?.endsWith("/남") || lastObStep?.endsWith("/여")) && state.ob.picker) overlay.querySelectorAll("[class*='enter-']").forEach(n => n.classList.remove("enter-fwd", "enter-back"));
    // 새 단계에 글자 입력 칸이 있으면 바로 입력할 수 있게 커서를 둔다
    else overlay.querySelector(".ob-body [data-field]:not([data-field='newInterest'])")?.focus({ preventScroll: true });
    lastObStep = `${state.ob.stepIndex}/${state.ob.picker ?? ""}`;
  } else {
    lastObStep = null;
    overlay.className = `overlay ${state.detail ? "open" : ""} ${state.detail && state.detail !== lastDetail ? "slide-in" : ""}`;
    overlay.innerHTML = state.detail ? detailHtml(state.detail) : "";
  }
  lastDetail = state.detail;


  const msgs = $("#msgs");
  if (msgs) msgs.scrollTop = msgs.scrollHeight;
  bindSwipe();
}

function toast(text) {
  const t = Object.assign(document.createElement("div"), { className: "toast", textContent: text });
  $(".phone-screen").append(t);
  setTimeout(() => t.remove(), 1800);
}

// ---------- 카드 드래그 (틴더식) ----------
function bindSwipe() {
  const deck = $("#deck");
  if (!deck) return;
  const card = deck.lastElementChild;
  let startX = 0, dx = 0, dragging = false;
  // 끌었다 놓은 경우엔 카드 안의 클릭(상세 열기)이 같이 일어나지 않게 막는다
  card.addEventListener("click", e => { if (Math.abs(dx) > 5) e.stopPropagation(); }, true);
  card.addEventListener("pointerdown", e => {
    dragging = true; startX = e.clientX; dx = 0;
    card.classList.add("dragging");
    card.setPointerCapture(e.pointerId);
  });
  card.addEventListener("pointermove", e => {
    if (!dragging) return;
    dx = (e.clientX - startX) / parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--s") || 1);
    card.style.transform = `translateX(${dx}px) rotate(${dx / 18}deg)`;
    card.querySelector(".stamp.yes").style.opacity = Math.max(0, dx / 100);
    card.querySelector(".stamp.no").style.opacity = Math.max(0, -dx / 100);
  });
  card.addEventListener("pointerup", () => {
    if (!dragging) return;
    dragging = false;
    card.classList.remove("dragging");
    if (Math.abs(dx) > 110) {
      card.style.transform = `translateX(${dx > 0 ? 500 : -500}px) rotate(${dx / 10}deg)`;
      setTimeout(() => { react(card.dataset.id, dx > 0 ? "like" : "pass"); render(); }, 200);
    } else {
      card.style.transform = "";
      card.querySelectorAll(".stamp").forEach(s => (s.style.opacity = 0));
    }
  });
}

// ---------- 가입 흐름(온보딩) ----------
const STEP_RANGE = { age: [19, 45], height: [145, 200], "wants.ageMin": [19, 45], "wants.ageMax": [19, 45] };

function startOnboarding(editing) {
  state.ob = { stepIndex: editing ? 1 : 0, draft: structuredClone(editing ? state.me : blankDraft()), editing, dir: "fwd" };
  state.detail = null;
}

function finishOnboarding() {
  const d = state.ob.draft;
  state.me = d;
  save("me", d);
  logGap();
  logLine("[0/4] 내 프로필 올림", `${state.ob.editing ? "수정" : "새로 만듦"} — 매칭에 쓰는 칸 ${Object.keys(d).length - 1}개`, "sys");
  logTree([
    `나: ${d.name}, ${d.gender}, ${d.age}살, ${d.height}cm, ${d.region}, ${d.job}`,
    `생활: ${d.smoking}, 술 ${d.drinking}, ${d.religion}, ${d.mbti}`,
    `관심사: ${d.interests.join(", ")}`,
    `이상형: ${d.wants.gender} ${d.wants.ageMin}~${d.wants.ageMax}살${d.wants.nonSmokerOnly ? ", 비흡연만" : ""}, 종교 ${d.wants.religion}`,
  ]);
  state.ob = null;
  state.result = null;
  state.tab = "home";
  // 매칭은 홈의 「매칭 시작」을 눌렀을 때만 돈다
  logCmd(`> 준비 완료. 아이폰에서 「매칭 시작」을 누르세요 <span class="cursor"></span>`);
  render();
}

// 다음 버튼만 켜고 끈다 (글자 입력 중에 화면 전체를 다시 그리면 입력 칸 포커스가 날아간다)
function refreshNext() {
  const btn = $("#ob-next");
  if (btn) btn.disabled = !OB_STEPS[state.ob.stepIndex].valid(state.ob.draft);
}

function handleOnboarding(act, arg) {
  const ob = state.ob;
  const d = ob.draft;
  if (act === "ob-next") {
    if (ob.stepIndex > 0 && !OB_STEPS[ob.stepIndex].valid(d)) return;
    ob.stepIndex++; ob.dir = "fwd";
  } else if (act === "ob-back") {
    // 예시 프로필 요약에서 뒤로 가면 처음 화면으로 돌아가 다시 고르게 한다
    if (ob.sample) { state.ob = { stepIndex: 0, draft: blankDraft(), editing: false, dir: "back", picker: ob.draft.gender }; render(); return; }
    ob.stepIndex = Math.max(0, ob.stepIndex - 1); ob.dir = "back";
  } else if (act === "ob-cancel") {
    state.ob = null;
  } else if (act === "ob-pick-open") {
    Object.assign(ob, { picker: "남", dir: "fwd" });
  } else if (act === "ob-pick-tab") {
    ob.picker = arg;
  } else if (act === "ob-pick-close") {
    Object.assign(ob, { picker: null, dir: "back" });
  } else if (act === "ob-pick") {
    // 고른 예시 프로필의 요약부터 보여 준다 (바로 매칭하지 않음)
    const sample = SAMPLE_PROFILES[Number(arg)];
    Object.assign(ob, { draft: structuredClone(sample), sample: true, picker: null, stepIndex: OB_STEPS.length - 1, dir: "fwd" });
  } else if (act === "ob-finish") {
    finishOnboarding();
    return;
  } else if (act === "ob-set") {
    const cut = arg.indexOf(":");
    const field = arg.slice(0, cut), value = arg.slice(cut + 1);
    setField(d, field, value);
    // 내 성별을 고르면 만나고 싶은 성별은 반대로 미리 골라 둔다 (바꿀 수 있음)
    if (field === "gender" && !d.wants.gender) d.wants.gender = value === "남" ? "여" : "남";
  } else if (act === "ob-step") {
    const cut = arg.lastIndexOf(":");
    const field = arg.slice(0, cut), delta = Number(arg.slice(cut + 1));
    const [min, max] = STEP_RANGE[field];
    setField(d, field, Math.min(max, Math.max(min, getField(d, field) + delta)));
  } else if (act === "ob-mbti") {
    const [i, letter] = arg.split(":");
    d.mbti = d.mbti.slice(0, +i) + letter + d.mbti.slice(+i + 1);
  } else if (act === "ob-interest") {
    if (d.interests.includes(arg)) d.interests = d.interests.filter(t => t !== arg);
    else if (d.interests.length >= INTEREST_MAX) { toast(`관심사는 ${INTEREST_MAX}개까지 고를 수 있어요`); return; }
    else d.interests.push(arg);
  } else if (act === "ob-add-interest") {
    const input = document.querySelector("[data-field='newInterest']");
    const t = input.value.trim();
    if (!t) return;
    if (d.interests.length >= INTEREST_MAX) { toast(`관심사는 ${INTEREST_MAX}개까지 고를 수 있어요`); return; }
    if (!d.interests.includes(t)) d.interests.push(t);
  } else if (act === "ob-toggle-smoke") {
    d.wants.nonSmokerOnly = !d.wants.nonSmokerOnly;
  }
  render();
}

// ---------- 클릭 처리 ----------
document.addEventListener("click", e => {
  const el = e.target.closest("[data-act]");
  if (!el || el.disabled) return;
  const raw = el.dataset.act;
  const cut = raw.indexOf(":");
  const act = cut < 0 ? raw : raw.slice(0, cut);
  const arg = cut < 0 ? "" : raw.slice(cut + 1);

  if (act.startsWith("ob-")) { handleOnboarding(act, arg); return; }
  if (state.ob) return; // 가입 중에는 바깥 메뉴를 막는다

  if (act === "tab") { state.tab = arg; state.detail = null; if (arg !== "chats") state.chatWith = null; }
  else if (act === "run") { state.tab = "home"; state.detail = null; runMatching(); return; }
  else if (act === "detail") { state.detail = arg; }
  else if (act === "close") { state.detail = null; }
  else if (act === "like" || act === "super" || act === "pass") { state.detail = null; react(arg, act); }
  else if (act === "chat") { document.querySelector(".notice")?.remove(); state.detail = null; state.tab = "chats"; state.chatWith = arg; }
  else if (act === "back-chats") { state.chatWith = null; state.confirmLeave = false; }
  else if (act === "leave-ask") { state.confirmLeave = true; }
  else if (act === "leave-cancel") { state.confirmLeave = false; }
  else if (act === "leave-confirm") {
    // 내가 나가거나, 상대가 나간 방을 지운다: 매칭과 대화 기록을 함께 없앤다
    const id = state.chatWith;
    logLine("채팅", `${byId(id).name}님과의 대화방을 ${state.ended[id] ? "지웠습니다" : "내가 나갔습니다"} — 매칭 해제`, "sys");
    state.matches = state.matches.filter(m => m !== id);
    delete state.chats[id];
    delete state.ended[id];
    ["matches", "chats", "ended"].forEach(k => save(k, state[k]));
    state.chatWith = null;
    state.confirmLeave = false;
    toast("대화방을 나왔어요");
  }
  else if (act === "edit-profile") { startOnboarding(true); }
  else if (act === "reset-swipes") { state.swiped = {}; save("swiped", {}); logLine("초기화", "넘긴 기록을 지웠습니다", "sys"); }
  else if (act === "clear-log") { bootLog(); return; }
  else if (act === "reset") {
    if (!confirm("내 프로필, 좋아요, 매칭, 대화 기록을 모두 지울까요?")) return;
    ["me", "result", "swiped", "matches", "chats", "ended"].forEach(k => { try { localStorage.removeItem(k); } catch {} });
    Object.assign(state, { tab: "home", me: null, result: null, swiped: {}, matches: [], chats: {}, ended: {}, chatWith: null, detail: null, confirmLeave: false });
    startOnboarding(false);
    bootLog();
    resetPipe();
  }
  render();
});

// 가입 화면의 글자 입력은 값만 바꾸고 다시 그리지 않는다
document.addEventListener("input", e => {
  const field = e.target.dataset?.field;
  if (!field || !state.ob || field === "newInterest") return;
  setField(state.ob.draft, field, e.target.value);
  refreshNext();
});

document.addEventListener("keydown", e => {
  if (e.key !== "Enter" || !state.ob || e.isComposing) return;
  if (e.target.dataset?.field === "newInterest") { e.preventDefault(); handleOnboarding("ob-add-interest", ""); }
  else if (e.target.tagName === "INPUT") { e.preventDefault(); $("#ob-next")?.click(); }
});

document.addEventListener("submit", e => {
  e.preventDefault();
  if (e.target.id !== "composer") return;
  const input = e.target.querySelector("input");
  const text = input.value.trim();
  input.value = "";
  if (text) queueMessage(text);
});

// 화면 높이에 맞춰 아이폰 크기 조절
function fitPhone() {
  const s = Math.min(1.35, (window.innerHeight - 32) / 874);
  document.documentElement.style.setProperty("--s", s.toFixed(3));
}
window.addEventListener("resize", fitPhone);
// 앱을 열면 로고가 잠깐 떴다가 사라진다
function showSplash() {
  const splash = document.createElement("div");
  splash.className = "splash";
  splash.innerHTML = `<img src="logo.png?v=${PHOTO_V}" alt=""><h1>오늘, 누구와?</h1><p>마음이 통하는 한 사람</p>`;
  $(".phone-screen").append(splash);
  setTimeout(() => splash.classList.add("out"), 1500);
  setTimeout(() => splash.remove(), 2000);
}

fitPhone();
bootLog();
renderPipeline();
render();
showSplash();
