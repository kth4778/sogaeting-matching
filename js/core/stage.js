// 매칭 과정 무대 (매칭 탭 진행 화면). 정해진 영상이 아니라 이번 실행의 실제 값만 그린다:
//   1단계 ruleFilter 결과 · 2단계 /api/embed 응답(코사인, 앞 16차원, 3차원 PCA 좌표) · 3단계 /api/rerank 응답 · 4단계 /api/explain 응답
// 기다리는 동안은 0.5초마다 무언가 움직이고, 시계는 실제 요청을 보낸 때부터 잰다. 응답이 오면 그 값으로 바뀐다.
// 움직임은 닫힌 해 감쇠 스프링(질량 1). 동작 줄이기 설정이면 바로 제자리로 간다.
// (매칭 로그와 같이 기술 용어 예외 파일: tools/check-terms.mjs)
import { esc, photo, meSrc, sleep } from "./util.js";
import { REDUCE } from "../ui/motion.js";

export const MIN_STAGE_MS = 1200; // 단계 그림의 최소 길이. 실제 응답이 더 오래 걸리면 응답이 올 때까지
const BEAT = 500;                 // 기다리는 동안 무언가 바뀌는 간격
const RULE_BEAT = 260;            // 규칙 하나가 적용되는 간격 (계산은 이미 끝나 있어 짧게)
const H = 420;                    // 무대 높이
const CANVAS_H = 268;
const D0 = 64;                    // 원판 기본 지름. 줄여서만 쓴다(키우면 사진이 흐려진다)
const HERO = 120;
const CARD_TOP = 40, CARD_STEP = 64, AV_X = 58;
const CHIP_Y = 372;
const SPR = { move: { k: 170, c: 22 }, pop: { k: 300, c: 20 }, soft: { k: 110, c: 19 } };
const RULES = ["성별", "나이", "흡연", "종교"];

// 임베딩에 넣은 글과 같은 모양 (local-llm/embed-rank.js의 profileText)
const textOf = p => `관심사: ${p.interests.join(", ")}\n소개: ${p.intro}\n성격: ${p.personality}`;
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

// 막대 하나 (0선 위아래로 자란다)
class Bar {
  constructor(el, mid, amp) { this.el = el; this.mid = mid; this.amp = amp; this.val = new Val(0); items.add(this); }
  apply(now) {
    const h = this.val.at(now) * this.amp;
    this.el.style.height = `${Math.abs(h).toFixed(1)}px`;
    this.el.style.top = `${(h >= 0 ? this.mid - h : this.mid).toFixed(1)}px`;
    return this.val.rest;
  }
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
// embP는 { ok, value: embeddingRank 결과, ms } 로 끝나는 약속
export async function stageEmbed(embP, startedAt, passed) {
  measure();
  const t0 = performance.now();
  const me = S.me;
  const order = [me, ...passed];
  const passedIds = new Set(passed.map(p => p.id));

  // 빠진 사람은 아래로 떨어지며 사라지고, 칸도 접힌다
  S.people.filter(p => !passedIds.has(p.id)).forEach((p, i) => {
    const d = S.discs.get(p.id);
    d.to({ y: d.v.y.to + 40, o: 0, s: 10 / D0 }, SPR.soft, i * 12);
  });
  S.bins.to({ o: 0, y: 320 }, SPR.soft);

  // 한 줄로: 나 + 통과한 사람
  const pitch = Math.min(34, (W - 64) / Math.max(1, passed.length));
  const size = Math.min(28, pitch - 3);
  S.meDisc.to({ x: 24, y: 22, s: 34 / D0 }, SPR.move);
  passed.forEach((p, i) => S.discs.get(p.id).to({ x: 56 + pitch * (i + 0.5), y: 22, s: size / D0, o: 1 }, SPR.move, i * 18));
  S.rowPos = new Map(passed.map((p, i) => [p.id, 56 + pitch * (i + 0.5)]));
  S.rowSize = size;

  // 글 → 숫자 막대
  const vec = mk("st-vec", `
    <div class="st-text"><small>임베딩에 넣는 글</small><p></p></div>
    <div class="st-bars"><small>벡터 · 앞 16칸</small><div class="st-barbox">${Array.from({ length: 16 }, (_, n) => `<span style="--n:${n}"><i></i><u></u></span>`).join("")}</div><span class="st-barcap">숫자로 바꾸는 중</span></div>`);
  S.body.append(vec);
  S.vec = new Node(vec, { y: 66, o: 0 }).to({ y: 50, o: 1 }, SPR.soft, 120);
  const BOX_H = 64;
  const mine = [...vec.querySelectorAll(".st-barbox i")].map(el => new Bar(el, BOX_H / 2, BOX_H / 2 - 2));
  const theirs = [...vec.querySelectorAll(".st-barbox u")].map(el => new Bar(el, BOX_H / 2, BOX_H / 2 - 2));
  vec.querySelector(".st-barbox").classList.add("wait");

  // 3차원 공간
  const wrap = mk("st-space");
  const canvas = document.createElement("canvas");
  wrap.append(canvas);
  S.body.append(wrap);
  S.space = new Node(wrap, { y: 160, o: 0, s: 0.96 }).to({ y: 146, o: 1, s: 1 }, SPR.soft, 200);
  const sp = makeSpace(canvas, me);
  hooks.add(sp.draw);

  const textEl = vec.querySelector(".st-text p");
  const stopClock = startClock(startedAt);
  const stopBeat = every(BEAT, n => {
    const p = order[n % order.length];
    textEl.textContent = textOf(p);
    const d = p === me ? S.meDisc : S.discs.get(p.id);
    const base = p === me ? 34 : size;
    d.to({ s: (base * 1.3) / D0 }, SPR.pop);
    setTimeout(() => d.to({ s: base / D0 }, SPR.move), REDUCE ? 0 : 200);
    msg(`${order.length}명의 글을 한 번에 보냈어요 · 벡터를 기다리는 중`);
  });

  const r = await embP;
  stopBeat();
  stopClock(r.ms);
  const emb = r.value;
  const top = emb.ranked.slice(0, 5);
  // 막대 높이 기준: 화면에 나오는 값 중 가장 큰 절댓값
  const amp = emb.fallback ? 1 : Math.max(...[emb.me.dims, ...top.map(c => c.dims)].flat().map(Math.abs)) || 1;
  S.meDisc.to({ s: 34 / D0 }, SPR.move);
  passed.forEach(p => S.discs.get(p.id).to({ s: size / D0 }, SPR.move));

  if (emb.fallback) {
    // 실패를 숨기지 않는다: 벡터 없이 뜻 묶음 점수로 줄 세운 값을 그대로 보여 준다
    msg("로컬 임베딩 서버(Ollama)에 연결하지 못해 관심사 뜻 묶음 점수로 대신해요");
    vec.querySelector(".st-barbox").classList.replace("wait", "none");
    vec.querySelector(".st-barcap").textContent = "벡터를 받지 못했어요";
    textEl.textContent = emb.fallback;
    sp.setFallback(emb.ranked);
  } else {
    msg(`${emb.model} · ${emb.dim}차원 벡터를 ${secs(r.ms)}초 만에 받았어요`);
    const meVals = emb.me.dims;
    vec.querySelector(".st-barbox").classList.remove("wait");
    textEl.textContent = textOf(me);
    mine.forEach((b, i) => b.val.set(meVals[i] / amp, SPR.pop, i * 22));
    vec.querySelector(".st-barcap").textContent = `나: ${meVals.slice(0, 3).map(v => v.toFixed(4)).join(", ")} …`;
    sp.setPca(emb);
  }
  await sleep(REDUCE ? 0 : 600);

  // 상위 5명을 한 명씩 짚는다 (값은 응답 그대로)
  for (const [i, c] of top.entries()) {
    const d = S.discs.get(c.profile.id);
    d.el.dataset.rank = i + 1;
    d.el.classList.add("top");
    d.to({ y: 22, s: (size * 1.25) / D0 }, SPR.pop);
    sp.highlight(c.profile.id);
    textEl.textContent = textOf(c.profile);
    if (!emb.fallback) {
      theirs.forEach((b, j) => b.val.set(c.dims[j] / amp, SPR.pop, j * 12));
      vec.querySelector(".st-barcap").textContent = `${c.profile.name}: ${c.dims.slice(0, 3).map(v => v.toFixed(4)).join(", ")} …`;
      msg(`${i + 1}위 ${c.profile.name} · 코사인 유사도 ${c.embed.toFixed(3)}`);
    } else {
      msg(`${i + 1}위 ${c.profile.name} · 뜻 묶음 점수 ${c.embed.toFixed(3)}`);
    }
    await sleep(REDUCE ? 0 : 380);
  }
  const topIds = new Set(top.map(c => c.profile.id));
  passed.filter(p => !topIds.has(p.id)).forEach(p => S.discs.get(p.id).to({ o: 0.25 }, SPR.soft));
  sp.highlight(null);
  msg(`${emb.fallback ? "뜻 묶음 점수" : "코사인 유사도"} 상위 ${top.length}명이 다음 단계로 가요`);
  S.top = top;
  S.fallback = !!emb.fallback;
  await until(t0 + MIN_STAGE_MS);
}

// 캔버스 2D 원근 투영. 카메라가 천천히 돈다
function makeSpace(canvas, me) {
  const dpr = Math.min(2, devicePixelRatio || 1);
  const cw = W, ch = CANVAS_H;
  canvas.width = cw * dpr; canvas.height = ch * dpr;
  canvas.style.width = `${cw}px`; canvas.style.height = `${ch}px`;
  const ctx = canvas.getContext("2d");
  const imgs = new Map();
  const img = src => {
    if (!src) return null;
    if (!imgs.has(src)) { const im = new Image(); im.src = src; imgs.set(src, im); }
    return imgs.get(src);
  };
  const st = { mode: "wait", pts: [], hi: null, yaw: 0.6, last: 0, variance: null, dim: 0 };

  function proj([x, y, z], cx, cy, sc) {
    const cY = Math.cos(st.yaw), sY = Math.sin(st.yaw), P = 0.42, cP = Math.cos(P), sP = Math.sin(P);
    const x1 = x * cY + z * sY, z1 = -x * sY + z * cY;
    const y2 = y * cP - z1 * sP, z2 = y * sP + z1 * cP;
    const f = 3.2 / (3.2 + z2);
    return { X: cx + x1 * sc * f, Y: cy - y2 * sc * f, z: z2, f };
  }
  function photoDot(im, x, y, r, ring, letter) {
    ctx.save();
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.closePath();
    ctx.fillStyle = "#ffe3e8"; ctx.fill();
    if (im?.complete && im.naturalWidth) {
      ctx.clip();
      const s = Math.min(im.naturalWidth, im.naturalHeight);
      ctx.drawImage(im, (im.naturalWidth - s) / 2, (im.naturalHeight - s) * 0.3, s, s, x - r, y - r, r * 2, r * 2);
    } else if (letter) {
      ctx.fillStyle = "#cf3a5a"; ctx.font = `700 ${Math.round(r)}px sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(letter, x, y);
    }
    ctx.restore();
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.lineWidth = ring ? 2.5 : 1.5; ctx.strokeStyle = ring ?? "#ffffff"; ctx.stroke();
  }

  function draw(now) {
    if (!canvas.isConnected || document.hidden) { st.last = 0; return false; }
    const dt = st.last ? Math.min(50, now - st.last) : 16;
    st.last = now;
    if (!REDUCE) st.yaw += dt * 0.00032;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    const cx = cw / 2, cy = ch / 2 + 4, sc = Math.min(cw, ch) * 0.37;
    let moving = false;

    if (st.mode === "fallback") return drawFallback(now);

    // 축 3개
    ctx.lineWidth = 1;
    ["PC1", "PC2", "PC3"].forEach((label, a) => {
      const e = [0, 0, 0]; e[a] = 1;
      const n = [0, 0, 0]; n[a] = -1;
      const A = proj(n, cx, cy, sc), B = proj(e, cx, cy, sc);
      ctx.strokeStyle = "rgba(29,29,31,.14)"; ctx.beginPath(); ctx.moveTo(A.X, A.Y); ctx.lineTo(B.X, B.Y); ctx.stroke();
      ctx.fillStyle = "rgba(29,29,31,.38)"; ctx.font = "600 9px sans-serif"; ctx.textAlign = "center";
      ctx.fillText(st.variance ? `${label} ${(st.variance[a] * 100).toFixed(0)}%` : label, B.X, B.Y - 4);
    });

    if (st.mode === "wait") {
      // 레이더처럼 도는 훑기 (응답을 기다리는 중)
      const a = now * 0.0035;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, sc * 1.05);
      g.addColorStop(0, "rgba(224,67,94,.22)"); g.addColorStop(1, "rgba(224,67,94,0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, sc * 1.05, a, a + 0.7); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "rgba(29,29,31,.45)"; ctx.font = "600 11px sans-serif"; ctx.textAlign = "center";
      ctx.fillText("벡터를 기다리는 중", cx, ch - 10);
      return !REDUCE;
    }

    // 점: 원점에서 화살표로, 먼 것부터 그린다
    const pts = st.pts.map(p => {
      const g = p.grow.at(now);
      if (!p.grow.rest) moving = true;
      return { p, g, ...proj(p.xyz.map(v => v * g), cx, cy, sc) };
    }).sort((a, b) => b.z - a.z);
    const O = proj([0, 0, 0], cx, cy, sc);
    for (const { p, g, X, Y, f } of pts) {
      if (g <= 0.01) continue;
      const focus = st.hi === p.id;
      const color = p.me ? "#e0435e" : p.rank ? "rgba(29,29,31,.62)" : "rgba(29,29,31,.22)";
      ctx.strokeStyle = focus ? "#e0435e" : color; ctx.lineWidth = p.me || focus ? 2.2 : 1.2;
      ctx.beginPath(); ctx.moveTo(O.X, O.Y); ctx.lineTo(X, Y); ctx.stroke();
      const r = (p.me ? 13 : p.rank ? 12 : 9) * f * (focus ? 1.25 : 1);
      photoDot(img(p.src), X, Y, r, p.me || focus ? "#e0435e" : p.rank ? "#1d1d1f" : null, p.letter);
      ctx.font = `${p.me || p.rank ? 700 : 500} 10px sans-serif`; ctx.textAlign = "left"; ctx.textBaseline = "middle";
      ctx.fillStyle = p.me ? "#cf3a5a" : focus ? "#cf3a5a" : p.rank ? "#1d1d1f" : "rgba(29,29,31,.5)";
      ctx.fillText(p.me ? "나" : `${p.rank ? `${p.rank}위 ` : ""}${p.cos.toFixed(3)}`, X + r + 3, Y);
    }
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "rgba(29,29,31,.45)"; ctx.font = "500 10px sans-serif"; ctx.textAlign = "center";
    ctx.fillText(`${st.dim}차원을 3차원으로 줄인 그림 · 숫자는 실제 코사인 값`, cx, ch - 8);
    return !REDUCE || moving;
  }

  function drawFallback(now) {
    const list = st.pts;
    const rowH = Math.min(24, (ch - 40) / Math.max(1, list.length));
    const max = Math.max(...list.map(p => p.cos)) || 1;
    let moving = false;
    ctx.fillStyle = "#d92d20"; ctx.font = "600 11px sans-serif"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.fillText("임베딩 서버 연결 실패 · 관심사 뜻 묶음 점수로 대신 계산", 12, 12);
    list.forEach((p, i) => {
      const g = p.grow.at(now);
      if (!p.grow.rest) moving = true;
      const y = 28 + i * rowH + rowH / 2;
      photoDot(img(p.src), 22, y, Math.min(9, rowH / 2 - 1), p.rank ? "#e0435e" : null);
      const w = (cw - 110) * (p.cos / max) * g;
      ctx.fillStyle = p.rank ? "#e0435e" : "rgba(29,29,31,.2)";
      ctx.fillRect(40, y - 4, w, 8);
      ctx.fillStyle = "#1d1d1f"; ctx.font = "600 10px sans-serif"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
      ctx.fillText(p.cos.toFixed(3), 46 + w, y);
    });
    ctx.textBaseline = "alphabetic";
    return moving;
  }

  return {
    draw,
    setPca(emb) {
      const raw = [{ me: true, id: "me", xyz: emb.me.xyz, src: meSrc(me), letter: me.name.slice(0, 1), cos: 1 },
        ...emb.ranked.map((c, i) => ({ id: c.profile.id, xyz: c.xyz, src: photo(c.profile), cos: c.embed, rank: i < 5 ? i + 1 : 0 }))];
      const R = Math.max(...raw.map(p => Math.hypot(...p.xyz))) || 1;
      st.pts = raw.map((p, i) => {
        const grow = new Val(0);
        grow.set(1, SPR.soft, i * 50);
        return { ...p, xyz: p.xyz.map(v => v / R), grow };
      });
      st.variance = emb.pcaVariance;
      st.dim = emb.dim;
      st.mode = "pca";
      hooks.add(draw);
      wake();
    },
    setFallback(ranked) {
      st.pts = ranked.map((c, i) => {
        const grow = new Val(0);
        grow.set(1, SPR.soft, i * 40);
        return { id: c.profile.id, src: photo(c.profile), cos: c.embed, rank: i < 5 ? i + 1 : 0, grow };
      });
      st.mode = "fallback";
      wake();
    },
    highlight(id) { st.hi = id; wake(); },
  };
}

// ---------- 3단계: LLM 재순위 ----------
// rrP는 { ok, ms, model, final, error } 로 끝나는 약속. final은 점수 순으로 정렬된 후보
export async function stageRerank(rrP, startedAt) {
  measure();
  const t0 = performance.now();
  const top = S.top;
  S.space.to({ o: 0, s: 0.92, y: 170 }, SPR.soft);
  S.vec.to({ o: 0, y: 30 }, SPR.soft);
  setTimeout(() => hooks.clear(), REDUCE ? 0 : 500);
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

  // 1위 사진이 가운데 위로 커지고, 나머지 카드는 아래 칩으로 접힌다
  const hero = document.createElement("span");
  hero.className = "st-hero";
  hero.style.backgroundImage = `url(${photo(win)})`;
  S.body.append(hero);
  const heroNode = new Node(hero, { x: AV_X, y: CARD_TOP + 28, s: 40 / HERO, o: 1 }).to({ x: W / 2, y: 62, s: 100 / HERO }, SPR.move, 60);
  const chips = mk("st-chips", final.map((c, i) => `
    <span class="st-chip ${i === 0 ? "win" : ""}" style="left:${(W * (i + 0.5)) / final.length}px">
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
