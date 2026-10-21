// 매칭 과정 무대 (매칭 탭 진행 화면). 정해진 영상이 아니라 이번 실행의 실제 값만 그린다:
//   1단계 ruleFilter 결과 · 2단계 /api/embed 응답(코사인) · 3단계 /api/rerank 응답 · 4단계 /api/explain 응답
// 기다리는 동안은 0.5초마다 무언가 움직이고, 시계는 실제 요청을 보낸 때부터 잰다. 응답이 오면 그 값으로 바뀐다.
// 움직임은 닫힌 해 감쇠 스프링(질량 1). 동작 줄이기 설정이면 바로 제자리로 간다.
// (매칭 로그와 같이 기술 용어 예외 파일: tools/check-terms.mjs)
import { esc, photo, meSrc, sleep } from "./util.js";
import { REDUCE } from "../ui/motion.js";

export const MIN_STAGE_MS = 1200; // 단계 그림의 최소 길이. 실제 응답이 더 오래 걸리면 응답이 올 때까지
const BEAT = 500;                 // 기다리는 동안 무언가 바뀌는 간격
const RULE_BEAT = 260;            // 규칙 하나가 적용되는 간격 (계산은 이미 끝나 있어 짧게)
const H = 420;                    // 무대 높이
const D0 = 64;                    // 원판 기본 지름. 줄여서만 쓴다(키우면 사진이 흐려진다)
const HERO = 120;
const CARD_TOP = 40, CARD_STEP = 64, AV_X = 58;
const CHIP_Y = 372;
const SPR = { move: { k: 170, c: 22 }, pop: { k: 300, c: 20 }, soft: { k: 110, c: 19 } };
const RULES = ["성별", "나이", "흡연", "종교"];

const secs = ms => (ms / 1000).toFixed(ms < 1000 ? 2 : 1); // 1초 안쪽은 0.0초로 보이지 않게
const until = async t => { const left = t - performance.now(); if (left > 0) await sleep(left); };

// ---------- 스프링 ----------
function springAt(x0, v0, t, { k, c }) {
  const w = Math.sqrt(k), z = c / (2 * w);
  if (z < 1) {
    const wd = w * Math.sqrt(1 - z * z);
    return Math.exp(-z * w * t) * (x0 * Math.cos(wd * t) + ((v0 + z * w * x0) / wd) * Math.sin(wd * t));
  }
  return (x0 + (v0 + w * x0) * t) * Math.exp(-w * t);
}

// 값 하나. set(목표)하면 지금 위치·속도에서 목표로 스프링으로 간다
class Val {
  constructor(v) { this.to = v; this.rest = true; }
  at(now) {
    if (this.rest) return this.to;
    const t = Math.max(0, (now - this.t0) / 1000);
    const x = springAt(this.x0, this.v0, t, this.cfg);
    if (t > 0.05 && Math.abs(x) < this.eps && Math.abs(springAt(this.x0, this.v0, t + 0.016, this.cfg) - x) < this.eps) {
      this.rest = true;
      return this.to;
    }
    return this.to + x;
  }
  set(to, cfg = SPR.move, delay = 0) {
    const now = performance.now();
    if (REDUCE) { this.to = to; this.rest = true; wake(); return; }
    const cur = this.at(now);
    let vel = 0;
    if (!this.rest) {
      const t = Math.max(0, (now - this.t0) / 1000);
      vel = (springAt(this.x0, this.v0, t + 0.001, this.cfg) - springAt(this.x0, this.v0, t, this.cfg)) / 0.001;
    }
    Object.assign(this, { x0: cur - to, v0: vel, to, cfg, t0: now + delay, rest: false });
    this.eps = Math.max(Math.abs(this.x0) * 0.002, 0.001);
    wake();
  }
}

// 요소 하나의 위치(x, y)·크기(s)·투명도(o)
class Node {
  constructor(el, { x = 0, y = 0, s = 1, o = 1 } = {}) {
    this.el = el;
    this.v = { x: new Val(x), y: new Val(y), s: new Val(s), o: new Val(o) };
    items.add(this);
    this.apply(performance.now());
  }
  to(props, cfg, delay) { for (const [k, val] of Object.entries(props)) this.v[k].set(val, cfg, delay); return this; }
  apply(now) {
    const { x, y, s, o } = this.v;
    this.el.style.transform = `translate3d(${x.at(now).toFixed(2)}px,${y.at(now).toFixed(2)}px,0) scale(${s.at(now).toFixed(4)})`;
    this.el.style.opacity = Math.max(0, Math.min(1, o.at(now))).toFixed(3);
    return x.rest && y.rest && s.rest && o.rest;
  }
}

// 굴러가는 숫자
class Num {
  constructor(el, v, fmt) { this.el = el; this.val = new Val(v); this.fmt = fmt; items.add(this); this.apply(performance.now()); }
  apply(now) { this.el.textContent = this.fmt(this.val.at(now)); return this.val.rest; }
}

// ---------- 프레임 루프 (움직이는 것이 있을 때만 돈다) ----------
const items = new Set();
const hooks = new Set();
let raf = 0;
function wake() { if (!raf) raf = requestAnimationFrame(tick); }
function tick(now) {
  raf = 0;
  let busy = false;
  for (const it of items) if (!it.apply(now)) busy = true;
  for (const h of hooks) if (h(now)) busy = true;
  if (busy) wake();
}
// 매칭 탭에 다시 붙었을 때 (다른 탭에 다녀오면 캔버스 루프가 쉬고 있다)
export function stageWake() { wake(); }

// 0.5초마다 fn(박자 번호). 정지 함수를 돌려준다
function every(ms, fn) {
  let n = 0;
  fn(n++);
  const id = setInterval(() => fn(n++), ms);
  return () => clearInterval(id);
}

// ---------- 무대 DOM ----------
export const stageEl = Object.assign(document.createElement("div"), { className: "st" });
let W = 358;
let S = null; // 이번 회차: { me, people, discs, meDisc, body, … }

const q = sel => stageEl.querySelector(sel);
const mk = (cls, html = "") => Object.assign(document.createElement("div"), { className: cls, innerHTML: html });

function measure() {
  const w = q(".st-body")?.clientWidth;
  if (w) W = w;
}
// 단계마다 무대 높이를 내용에 맞춘다 (빈 칸이 남지 않게)
function setHeight(h) { const b = q(".st-body"); if (b) b.style.height = `${h}px`; }
function msg(text) {
  const el = q(".st-msg");
  if (!el || el.textContent === text) return;
  el.textContent = text;
  if (!REDUCE) { el.classList.remove("st-new"); void el.offsetWidth; el.classList.add("st-new"); }
}
// 실제 요청 시작부터 재는 시계. 멈출 때 실제 걸린 시간(ms)을 넘기면 그 값으로 고정한다
function startClock(startedAt) {
  const el = q(".st-clock");
  const show = () => { el.textContent = `${secs(performance.now() - startedAt)}초`; };
  show();
  const id = setInterval(show, 100);
  return ms => { clearInterval(id); el.textContent = ms == null ? "" : `${secs(ms)}초`; };
}

function discEl(p, isMe) {
  const el = document.createElement("span");
  el.className = `st-d${isMe ? " me" : ""}`;
  const src = isMe ? meSrc(p) : photo(p);
  if (src) el.style.backgroundImage = `url(${src})`;
  else el.textContent = p.name.slice(0, 1);
  S.body.append(el);
  return el;
}

export function stageReset(me, people) {
  items.clear();
  hooks.clear();
  stageEl.innerHTML = `
    <div class="st-cap"><span class="st-msg"></span><b class="st-clock"></b></div>
    <div class="st-body" style="height:${H}px"></div>`;
  const body = q(".st-body");
  S = { me, people, body, discs: new Map() };
  S.meDisc = new Node(discEl(me, true), { x: W / 2, y: 28, s: 0, o: 0 });
  people.forEach(p => S.discs.set(p.id, new Node(discEl(p, false), { x: W / 2, y: 28, s: 0, o: 0 })));
}

// 격자 자리: n개를 cols열로, 마지막 줄은 가운데 맞춤
function gridPos(n, { cols = 5, px = 54, py = 52, top = 84 } = {}) {
  return Array.from({ length: n }, (_, i) => {
    const row = Math.floor(i / cols);
    const inRow = Math.min(cols, n - row * cols);
    const col = i % cols;
    return { x: W / 2 + (col - (inRow - 1) / 2) * px, y: top + row * py };
  });
}

// ---------- 1단계: 규칙 거르기 ----------
export async function stageRules({ passed, excluded }) {
  measure();
  const t0 = performance.now();
  const total = S.people.length;
  msg(`${total}명의 조건을 나와 상대 양쪽에서 확인해요`);
  S.meDisc.to({ x: W / 2, y: 30, s: 46 / D0, o: 1 }, SPR.pop);
  // 20명이 넘으면 6열로 촘촘하게 (아래 규칙 칸과 겹치지 않게)
  const dense = total > 20;
  const grid = dense ? { cols: 6, px: 48, py: 44, top: 80 } : {};
  const dsize = dense ? 34 : 40;
  gridPos(total, grid).forEach((pos, i) => S.discs.get(S.people[i].id).to({ ...pos, s: dsize / D0, o: 1 }, SPR.move, i * 12));

  const bw = W / RULES.length;
  const bins = mk("st-bins", RULES.map(n => `<div class="st-bin"><b>${n}</b><span><i>0</i>명</span></div>`).join(""));
  S.body.append(bins);
  S.bins = new Node(bins, { y: 290, o: 0 }).to({ o: 1 }, SPR.soft, 200);
  const counts = [...bins.querySelectorAll(".st-bin i")].map(el => new Num(el, 0, v => Math.round(v)));
  await sleep(REDUCE ? 0 : 420);

  for (const [k, name] of RULES.entries()) {
    const out = excluded.filter(x => x.rule.name === name);
    bins.children[k].classList.add("on");
    counts[k].val.set(out.length, SPR.pop);
    out.forEach((x, j) => {
      const col = j % 4, row = Math.floor(j / 4);
      S.discs.get(x.p.id).to({ x: bw * k + bw / 2 + (col - 1.5) * 19, y: 346 + row * 19, s: 17 / D0, o: 0.55 }, SPR.move, j * 26);
    });
    msg(out.length ? `${name} 조건에 걸린 ${out.length}명을 뺐어요` : `${name} 조건은 모두 통과했어요`);
    await sleep(REDUCE ? 0 : RULE_BEAT);
  }
  gridPos(passed.length, grid).forEach((pos, i) => S.discs.get(passed[i].id).to({ ...pos, s: dsize / D0 }, SPR.move, i * 20));
  msg(`${total}명 → ${passed.length}명이 조건을 통과했어요`);
  await until(t0 + MIN_STAGE_MS);
}

// ---------- 2단계: 임베딩 ----------
// 한 사람 = 한 줄. 사진 · 이름 · 나와 비슷한 정도 막대 · 실제 코사인 값. 응답이 오면 막대가 실제 값까지 자라고 순서대로 다시 선다
const ROW_TOP = 64, ROW_H = 38, ROW_MAX = 8, PH_X = 30, PH = 28;
const rowY = i => ROW_TOP + i * ROW_H + ROW_H / 2;

// embP는 { ok, value: embeddingRank 결과, ms } 로 끝나는 약속
export async function stageEmbed(embP, startedAt, passed) {
  measure();
  const t0 = performance.now();
  const passedIds = new Set(passed.map(p => p.id));
  const shown = passed.slice(0, ROW_MAX);

  // 빠진 사람은 아래로 떨어지며 사라지고, 칸도 접힌다
  S.people.filter(p => !passedIds.has(p.id)).forEach((p, i) => {
    const d = S.discs.get(p.id);
    d.to({ y: d.v.y.to + 40, o: 0, s: 10 / D0 }, SPR.soft, i * 12);
  });
  S.bins.to({ o: 0, y: 320 }, SPR.pop);
  setHeight(ROW_TOP + shown.length * ROW_H + 40);

  // 맨 위: 나와 내 글. 이 글과 각 사람의 글을 숫자로 바꿔 비교한다
  S.meDisc.to({ x: PH_X, y: 30, s: 36 / D0 }, SPR.move);
  const head = mk("st-mine", `<b>내 관심사·소개 글</b><p>${esc(S.me.interests.join(", "))}</p>`);
  S.body.append(head);
  S.mine = new Node(head, { y: 12, o: 0 }).to({ y: 10, o: 1 }, SPR.soft, 120);

  // 사람마다 한 줄. 사진(원판)은 줄 왼쪽에 앉는다
  const list = mk("st-list", `<div class="st-axis"><span>덜 비슷</span><span>비슷</span></div>`);
  S.body.append(list);
  S.list = new Node(list, { o: 0 }).to({ o: 1 }, SPR.soft, 160);
  const rows = new Map();
  shown.forEach((p, i) => {
    const el = mk("st-row", `<b>${esc(p.name)}</b><span class="st-track wait"><i></i></span><em>–</em>`);
    list.append(el);
    rows.set(p.id, { el, node: new Node(el, { y: rowY(i) - ROW_H / 2, o: 0 }).to({ o: 1 }, SPR.soft, 250 + i * 30) });
    S.discs.get(p.id).to({ x: PH_X, y: rowY(i), s: PH / D0, o: 1 }, SPR.move, 150 + i * 30);
  });
  passed.slice(ROW_MAX).forEach(p => S.discs.get(p.id).to({ o: 0 }, SPR.soft));
  const foot = mk("st-foot", passed.length > ROW_MAX ? `외 ${passed.length - ROW_MAX}명도 같이 비교해요` : "");
  S.body.append(foot);
  S.foot = new Node(foot, { y: ROW_TOP + shown.length * ROW_H + 10, o: 1 });

  const stopClock = startClock(startedAt);
  const stopBeat = every(BEAT, n => {
    rows.forEach(({ el }, id) => el.classList.toggle("look", id === shown[n % shown.length].id));
    msg("글을 숫자로 바꿔 나와 얼마나 비슷한지 재는 중");
  });

  const r = await embP;
  stopBeat();
  stopClock(r.ms);
  const emb = r.value;
  const top = emb.ranked.slice(0, 5);
  const rank = new Map(emb.ranked.map((c, i) => [c.profile.id, { c, i }]));

  // 막대가 실제 값까지 자란다 (가로 끝 = 1.0, 완전히 같은 글)
  rows.forEach(({ el }, id) => {
    const { c } = rank.get(id);
    el.classList.remove("look");
    el.querySelector(".st-track").classList.remove("wait");
    el.querySelector(".st-track i").style.width = `${(Math.max(0, c.embed) * 100).toFixed(1)}%`;
    new Num(el.querySelector("em"), 0, v => v.toFixed(3)).val.set(c.embed, SPR.soft);
  });
  foot.textContent = emb.fallback
    ? "임베딩 서버에 연결하지 못해 관심사 뜻 묶음 점수로 대신 계산했어요"
    : `${emb.model} 임베딩 · ${secs(r.ms)}초 · 1에 가까울수록 비슷해요`;
  foot.classList.toggle("fail", !!emb.fallback);
  msg(emb.fallback ? "관심사 뜻 묶음 점수로 비교했어요" : "비슷한 순서로 다시 줄 세워요");
  await sleep(REDUCE ? 0 : 700);

  // 비슷한 순서로 다시 선다. 상위 5명만 색이 남는다
  const order = shown.map(p => rank.get(p.id)).sort((a, b) => a.i - b.i);
  order.forEach(({ c }, i) => {
    const row = rows.get(c.profile.id);
    const isTop = top.includes(c);
    row.node.to({ y: rowY(i) - ROW_H / 2, o: isTop ? 1 : 0.45 }, SPR.move, i * 40);
    row.el.classList.toggle("top", isTop);
    row.el.querySelector("b").innerHTML = `${isTop ? `<span class="st-n">${top.indexOf(c) + 1}</span>` : ""}${esc(c.profile.name)}`;
    S.discs.get(c.profile.id).to({ y: rowY(i), o: isTop ? 1 : 0.45 }, SPR.move, i * 40);
  });
  msg(`가장 비슷한 ${top.length}명이 다음 단계로 가요`);
  S.top = top;
  S.fallback = !!emb.fallback;
  await sleep(REDUCE ? 0 : 900);
  await until(t0 + MIN_STAGE_MS);
}

// ---------- 3단계: LLM 재순위 ----------
// rrP는 { ok, ms, model, final, error } 로 끝나는 약속. final은 점수 순으로 정렬된 후보
export async function stageRerank(rrP, startedAt) {
  measure();
  const t0 = performance.now();
  const top = S.top;
  [S.list, S.mine, S.foot].forEach(n => n.to({ o: 0 }, SPR.soft));
  setHeight(CARD_TOP + top.length * CARD_STEP + 8);
  const topIds = new Set(top.map(c => c.profile.id));
  S.people.filter(p => !topIds.has(p.id)).forEach(p => S.discs.get(p.id).to({ o: 0 }, SPR.soft));
  S.meDisc.to({ o: 0, s: 20 / D0 }, SPR.soft);

  const head = mk("st-head3", `<span class="st-dot"></span><span class="st-h3t">5명의 프로필과 임베딩 점수를 LLM에 한 번에 보냈어요</span>`);
  S.body.append(head);
  S.head = new Node(head, { y: 6, o: 0 }).to({ y: 0, o: 1 }, SPR.soft);

  // 원판이 카드 자리로 날아가고, 그 자리에서 카드가 피어난다
  S.cards = new Map();
  top.forEach((c, i) => {
    const y = CARD_TOP + i * CARD_STEP;
    S.discs.get(c.profile.id).to({ x: AV_X, y: y + 28, s: 40 / D0, o: 1 }, SPR.move, i * 40);
    const el = mk("st-card", `
      <span class="st-rk">${i + 1}</span><span class="st-av" style="background-image:url(${photo(c.profile)})"></span>
      <span class="st-who"><b>${esc(c.profile.name)} <i>${c.profile.age}</i></b><small>${S.fallback ? "뜻 묶음" : "임베딩"} ${c.embed.toFixed(3)}</small></span>
      <span class="st-mv"></span><span class="st-pts"><b>–</b><small>점</small></span>`);
    S.body.append(el);
    const node = new Node(el, { y, o: 0 });
    S.cards.set(c.profile.id, { el, node, c });
  });
  await sleep(REDUCE ? 0 : 420);
  S.cards.forEach(({ node, c }, id) => { node.to({ o: 1 }, SPR.soft); S.discs.get(id).to({ o: 0 }, SPR.soft, 120); });

  const stopClock = startClock(startedAt);
  const cards = [...S.cards.values()];
  const stopBeat = every(BEAT, n => {
    cards.forEach((k, i) => k.el.classList.toggle("reading", i === n % cards.length));
    msg(n % 2 ? "성격·대화 스타일·생활 리듬까지 읽고 다시 줄 세우는 중" : "LLM 응답을 기다리는 중");
  });
  const r = await rrP;
  stopBeat();
  stopClock(r.ms);
  cards.forEach(k => k.el.classList.remove("reading"));
  const h3 = head.querySelector(".st-h3t");
  head.classList.add(r.ok ? "ok" : "fail");
  h3.textContent = r.ok ? `${r.model} · ${secs(r.ms)}초 만에 응답` : `LLM 연결 실패 · 임베딩 순서를 그대로 써요`;
  msg(r.ok ? "궁합 점수가 나왔어요" : r.error);

  // 점수가 굴러가 실제 값에 멈추고, 실제 순서로 자리를 바꾼다
  r.final.forEach((c, i) => {
    const k = S.cards.get(c.profile.id);
    const num = new Num(k.el.querySelector(".st-pts b"), 0, v => Math.round(v));
    num.val.set(c.llmScore, SPR.soft, i * 110);
  });
  S.cards.forEach((k, id) => { if (!r.final.some(c => c.profile.id === id)) k.node.to({ o: 0 }, SPR.soft); });
  await sleep(REDUCE ? 0 : 700);
  r.final.forEach((c, i) => {
    const k = S.cards.get(c.profile.id);
    const from = top.findIndex(t => t.profile.id === c.profile.id);
    const diff = from - i;
    k.node.to({ y: CARD_TOP + i * CARD_STEP }, SPR.move, i * 60);
    k.el.querySelector(".st-rk").textContent = i + 1;
    const mv = k.el.querySelector(".st-mv");
    mv.textContent = diff > 0 ? `▲${diff}` : diff < 0 ? `▼${-diff}` : "–";
    mv.className = `st-mv ${diff > 0 ? "up" : diff < 0 ? "down" : ""}`;
    if (r.ok) k.el.querySelector(".st-who small").textContent = c.oneLine;
    k.el.classList.toggle("first", i === 0);
  });
  if (r.ok) msg(`1위 ${r.final[0].profile.name} ${r.final[0].llmScore}점 · 한 줄 이유도 받았어요`);
  S.final = r.final;
  await sleep(REDUCE ? 0 : 500);
  await until(t0 + MIN_STAGE_MS);
}

// ---------- 4단계: LLM 이유 설명 ----------
// exPs[i]는 final[i]의 { ok, value, ms, error } 로 끝나는 약속 (동시에 보낸 5개)
let heroRect = null;
export async function stageExplain(exPs, startedAt) {
  measure();
  const t0 = performance.now();
  const final = S.final;
  const win = final[0].profile;
  S.head.to({ o: 0, y: -8 }, SPR.soft);
  setHeight(H);

  // 1위 사진이 가운데 위로 커지고, 나머지 카드는 아래 칩으로 접힌다
  const hero = document.createElement("span");
  hero.className = "st-hero";
  hero.style.backgroundImage = `url(${photo(win)})`;
  S.body.append(hero);
  const heroNode = new Node(hero, { x: AV_X, y: CARD_TOP + 28, s: 40 / HERO, o: 1 }).to({ x: W / 2, y: 62, s: 100 / HERO }, SPR.move, 60);
  const chips = mk("st-chips", final.map((c, i) => `
    <span class="st-chip ${i === 0 ? "st-win" : ""}" style="left:${(W * (i + 0.5)) / final.length}px">
      <i style="background-image:url(${photo(c.profile)})"></i><small><span class="spin"></span></small></span>`).join(""));
  S.body.append(chips);
  final.forEach((c, i) => {
    const k = S.cards.get(c.profile.id);
    k.node.to({ x: (W * (i + 0.5)) / final.length - W / 2, y: CHIP_Y - 28, s: 0.18, o: 0 }, SPR.move, i * 40);
  });
  new Node(chips, { y: CHIP_Y - 6, o: 0 }).to({ y: CHIP_Y - 16, o: 1 }, SPR.soft, 200);
  const say = mk("st-say", `
    <p class="st-name"><b>${esc(win.name)}</b> ${win.age} · ${esc(win.region)}</p>
    <div class="st-said"><p class="st-typing">LLM이 두 프로필에 적힌 내용만으로 이유를 쓰는 중<i>.</i><i>.</i><i>.</i></p></div>`);
  S.body.append(say);
  new Node(say, { y: 136, o: 0 }).to({ y: 122, o: 1 }, SPR.soft, 160);

  const stopClock = startClock(startedAt);
  const chipEls = [...chips.children];
  const stopBeat = every(BEAT, n => {
    say.querySelectorAll(".st-typing i").forEach((d, j) => d.classList.toggle("on", j <= n % 3));
    const left = chipEls.filter(el => !el.classList.contains("done")).length;
    msg(`${final.length}명의 이유를 동시에 요청했어요 · ${left}명 남음`);
  });
  // 칩마다 실제 응답이 온 순간 체크로 바뀐다
  exPs.forEach((p, i) => p.then(r => {
    const el = chipEls[i];
    el.classList.add("done", r.ok ? "ok" : "fail");
    el.querySelector("small").textContent = r.ok ? `✓ ${secs(r.ms)}초` : "× 실패";
    if (!REDUCE) el.animate([{ transform: "translateX(-50%) scale(1.25)" }, { transform: "translateX(-50%) scale(1)" }], { duration: 320, easing: "cubic-bezier(.34,1.56,.64,1)" });
  }));

  const first = await exPs[0];
  const said = say.querySelector(".st-said");
  if (first.ok) {
    const ex = first.value;
    said.innerHTML = `<p class="st-hl">“${esc(ex.headline)}”</p><ol>${ex.reasons.slice(0, 3).map(x => `<li><b>${esc(x.title)}</b> ${esc(x.detail)}</li>`).join("")}</ol>`;
    said.querySelectorAll(".st-hl, li").forEach((el, i) => new Node(el, { y: 8, o: 0 }).to({ y: 0, o: 1 }, SPR.soft, i * 140));
  } else {
    said.innerHTML = `<p class="st-err">1위 이유를 받지 못했어요 · ${esc(first.error)}</p>`;
  }
  const all = await Promise.all(exPs);
  stopBeat();
  stopClock(Math.max(...all.map(r => r.ms)));
  const okN = all.filter(r => r.ok).length;
  msg(okN === all.length ? `${all.length}명 모두 이유를 받았어요` : `${all.length}명 중 ${okN}명 이유를 받았어요`);
  await sleep(REDUCE ? 0 : 900);
  await until(t0 + MIN_STAGE_MS);
  heroNode.apply(performance.now());
  heroRect = hero.getBoundingClientRect();
}

// 결과 화면이 1위 사진을 무대의 원판 자리에서부터 키워 오도록 (한 번만)
export function takeHeroRect() {
  const r = heroRect;
  heroRect = null;
  return r?.width ? r : null;
}
