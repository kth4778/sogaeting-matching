// 매칭 과정 로그 카드의 내용 (로그 카드 안 문자열은 이 파일과 matching.js에서만 만든다)
import { $, esc, photo } from "./util.js";
import { registerReset } from "./store.js";
import { PROFILES } from "../data/profiles.js";
import { icon } from "../ui/icons.js";
import { REDUCE, easeOutExpo, DUR } from "../ui/motion.js";

// 콘솔 전용 활동 기록: 주소에 ?debug가 있을 때만 남긴다
const DEBUG = new URLSearchParams(location.search).has("debug");
export const debug = (...a) => DEBUG && console.debug(...a);

// ---------- 로그 본문 ----------
// 화면을 다시 그려도 내용이 남도록 한 번만 만들고, 매칭 탭이 그릴 때마다 제자리에 끼운다
export const logEl = Object.assign(document.createElement("div"), { className: "inlog-body" });
logEl.setAttribute("aria-live", "polite");
// 진행 헤더(진행 막대·단계 문구·인원 카운터) — 매칭 탭 앱바 아래 sticky
export const pipelineEl = Object.assign(document.createElement("div"), { className: "match-progress" });

// ---------- 따라가기 스크롤 (§4.5) ----------
let follow = true;
let lastInput = 0;
let unfollow = null;
const STOP_KEYS = ["PageUp", "PageDown", "ArrowUp", "ArrowDown", " ", "Home", "End"];
const FOLLOW_GAP = 24;   // 탭바 위 여유
const FOLLOW_EXTRA = 12; // 한 번에 조금 더 내려 준다
const REFOLLOW_NEAR = 80; // 바닥에서 이만큼 안이면 다시 따라간다
const INPUT_QUIET_MS = 150;

// 로그에 새 줄이 붙으면 그 줄이 탭바 위에 보이도록 화면을 내린다(사용자가 직접 스크롤했으면 멈춤)
export function scrollLog() {
  const screen = $("#screen");
  const last = logEl.lastElementChild;
  if (!follow || !unfollow || !screen || !last || !screen.contains(logEl)) return;
  const tabbar = $("#tabbar");
  const floor = (tabbar && !tabbar.hidden ? tabbar.getBoundingClientRect().top : screen.getBoundingClientRect().bottom) - FOLLOW_GAP;
  const over = last.getBoundingClientRect().bottom - floor;
  if (over > 0) screen.scrollBy({ top: over + FOLLOW_EXTRA, behavior: REDUCE ? "auto" : "smooth" });
}

// 진행 중에만 사용자 입력을 지켜본다. 해제는 stopFollow()
export function startFollow(screen) {
  stopFollow();
  follow = true;
  const stop = () => { follow = false; lastInput = performance.now(); };
  const onKey = e => { if (STOP_KEYS.includes(e.key)) stop(); };
  const onScroll = () => {
    if (follow || performance.now() - lastInput < INPUT_QUIET_MS) return;
    if (screen.scrollHeight - screen.scrollTop - screen.clientHeight < REFOLLOW_NEAR) follow = true;
  };
  screen.addEventListener("wheel", stop, { passive: true });
  screen.addEventListener("touchmove", stop, { passive: true });
  window.addEventListener("keydown", onKey);
  screen.addEventListener("scroll", onScroll, { passive: true });
  unfollow = () => {
    screen.removeEventListener("wheel", stop);
    screen.removeEventListener("touchmove", stop);
    window.removeEventListener("keydown", onKey);
    screen.removeEventListener("scroll", onScroll);
  };
}
export function stopFollow() { unfollow?.(); unfollow = null; }

// 매칭을 누른 직후 1번: 무대 위끝을 진행 헤더 바로 아래로
export function showLogCard() {
  const screen = $("#screen");
  const stage = document.querySelector(".match-stage");
  if (!screen || !stage || !screen.contains(pipelineEl)) return;
  const top = stage.getBoundingClientRect().top - pipelineEl.getBoundingClientRect().bottom - 8;
  if (top > 0) screen.scrollBy({ top, behavior: REDUCE ? "auto" : "smooth" });
}

// ---------- 줄 만들기 ----------
function add(row) {
  logEl.append(row);
  scrollLog();
  return row;
}
export function logLine(tag, text, kind) {
  const row = document.createElement("div");
  row.className = `line ${kind ?? ""}`;
  row.innerHTML = `<span class="tag">${esc(tag)}</span><span>${esc(text)}</span>`;
  return add(row);
}
export function logSub(text, cls = "") {
  const row = document.createElement("div");
  row.className = `sub ${cls}`;
  row.textContent = text;
  return add(row);
}
export function logCmd(html) {
  const row = document.createElement("div");
  row.className = "cmd";
  row.innerHTML = html;
  return add(row);
}
export function logGap() { logEl.append(Object.assign(document.createElement("div"), { className: "gap" })); }
// 하위 줄 묶음 (옛 트리 모양 대신 들여쓴 줄)
export function logTree(lines, cls = "") { lines.forEach(l => logSub(l, cls)); }

// 후보 행: 아바타 + 이름 + 겹친 관심사 칩 + 오른쪽 점수
export function logPeople(rows) {
  const box = document.createElement("div");
  box.className = "lp";
  box.innerHTML = rows.map(r => `
    <div class="lp-row">
      <span class="lp-av" style="background-image:url(${photo(r.profile)})"></span>
      <b class="lp-name">${esc(r.profile.name)}</b>
      <span class="lp-chips">${r.chips.map(c => `<span class="lp-chip">${esc(c)}</span>`).join("")}</span>
      <span class="lp-score">${esc(r.score)}</span>
    </div>`).join("");
  return add(box);
}

export function bootLog() {
  logEl.innerHTML = "";
}

// ---------- 진행 헤더 ----------
export const PIPE = [
  ["조건 확인", "서로 조건이 맞는 분을 찾고 있어요"],
  ["취향 비교", "취향이 비슷한 분을 고르는 중"],
  ["궁합 점수", "궁합 점수를 매기는 중"],
  ["추천 이유", "가장 잘 맞는 분을 소개할게요"],
];
export const pipe = { status: ["wait", "wait", "wait", "wait"], note: ["", "", "", ""], counts: [PROFILES.length] };

export function renderPipeline() {
  const cur = Math.max(0, pipe.status.findLastIndex(s => s !== "wait"));
  pipelineEl.innerHTML = `
    <div class="mp-bar">${PIPE.map((_, i) => `<span class="mp-seg ${pipe.status[i]}"><i></i></span>`).join("")}</div>
    <div class="mp-row">
      <div class="mp-text"><span>${esc(PIPE[cur][1])}</span></div>
      <div class="mp-count">${pipe.counts.map(n => `${n}명`).join(" → ")}</div>
    </div>`;
}

// 단계 문구를 세로 롤로 바꾼다 (옛 값은 위로, 새 값은 아래에서)
function rollText(text) {
  const box = pipelineEl.querySelector(".mp-text");
  const old = box?.firstElementChild;
  if (!box || old?.textContent === text) return;
  const next = Object.assign(document.createElement("span"), { textContent: text, className: "in" });
  if (old) old.className = "out";
  box.append(next);
  setTimeout(() => old?.remove(), DUR.slow);
}

export function setPipe(i, status, note) {
  pipe.status[i] = status;
  if (note !== undefined) pipe.note[i] = note;
  if (!pipelineEl.firstElementChild) renderPipeline();
  const seg = pipelineEl.querySelectorAll(".mp-seg")[i];
  // 진행 중인 칸은 걸릴 시간을 모르므로 빛이 흐르기만 하고, 끝나면 채운다
  if (seg) seg.className = `mp-seg ${status}`;
  if (status === "run") rollText(PIPE[i][1]);
}
export function setCount(n) {
  pipe.counts.push(n);
  const el = pipelineEl.querySelector(".mp-count");
  if (el) el.textContent = pipe.counts.map(c => `${c}명`).join(" → ");
}
export function resetPipe() {
  pipe.status = ["wait", "wait", "wait", "wait"];
  pipe.note = ["", "", "", ""];
  pipe.counts = [PROFILES.length];
  renderPipeline();
}

// ---------- 단계 상자 ----------
export function logStage(n, title, what, why) {
  const box = document.createElement("div");
  box.className = "stage-box";
  box.innerHTML = `
    <div class="stage-title"><span class="tag">${n}/4</span>${esc(title)}</div>
    <div class="stage-what">${esc(what)}</div>
    <div class="stage-why">${esc(why)}</div>`;
  add(box);
}

// 기다리는 동안 초가 올라가는 줄. 끝나면 결과 문장으로 바뀐다.
// t0: 실제 요청을 보낸 때, done의 ms: 실제로 걸린 시간 (그림이 늦게 따라와도 실제 값을 적는다)
const TICK_MS = 100;
export function logWorking(text, t0 = performance.now()) {
  const row = logSub("", "working");
  const secs = ms => ((ms ?? performance.now() - t0) / 1000).toFixed(1);
  const tick = () => { row.innerHTML = `<span class="spin"></span>${esc(text)} <b>${secs()}초</b>`; };
  tick();
  const timer = setInterval(tick, TICK_MS);
  return {
    done(msg, ms) { clearInterval(timer); row.className = "sub dim"; row.innerHTML = `${icon("check", 14)} ${esc(msg)} (${secs(ms)}초)`; },
    fail(msg) { clearInterval(timer); row.className = "sub err"; row.innerHTML = `${icon("x", 14)} ${esc(msg)}`; },
  };
}

// 재순위 전후를 같은 판에서 보여 준다: 취향 순서로 놓았다가 궁합 점수 순서로 줄이 움직여 자리를 바꾼다
export const ROW_H = 38;
const ROW_STAGGER_MS = 60;
export function logRankBoard(before, after) {
  const board = document.createElement("div");
  board.className = "rank-board";
  board.style.height = `${before.length * ROW_H + 40}px`;
  board.innerHTML = `<div class="rb-head"><span class="rb-title">임베딩 순위</span><span class="rb-state">궁합 점수로 다시 줄 세우는 중</span></div>` +
    before.map((c, i) => `
      <div class="rb-row" data-id="${c.profile.id}" style="transform:translateY(${i * ROW_H}px)">
        <span class="rb-rank">${i + 1}</span>
        <span class="rb-av" style="background-image:url(${photo(c.profile)})"></span>
        <span class="rb-name">${esc(c.profile.name)}</span>
        <span class="rb-move"></span>
        <span class="rb-score">${Math.round(c.embed * 100)}</span>
      </div>`).join("");
  add(board);
  void board.offsetWidth; // 놓인 자리에서부터 움직이도록
  after.forEach((c, i) => {
    const row = board.querySelector(`[data-id="${c.profile.id}"]`);
    const from = before.findIndex(b => b.profile.id === c.profile.id);
    const diff = from - i;
    row.style.transitionDelay = `${i * ROW_STAGGER_MS}ms`;
    row.style.transform = `translateY(${i * ROW_H}px)`;
    row.classList.add(diff > 0 ? "up" : diff < 0 ? "down" : "same");
    if (i === 0) row.classList.add("first");
    row.querySelector(".rb-rank").textContent = i + 1;
    row.querySelector(".rb-move").textContent = diff > 0 ? `▲ ${diff}` : diff < 0 ? `▼ ${-diff}` : "–";
    countUp(row.querySelector(".rb-score"), c.llmScore, "점", Math.round(before[from].embed * 100));
  });
  board.querySelector(".rb-title").textContent = "궁합 점수 순위";
  board.querySelector(".rb-state").textContent = "순위 확정";
}

// 숫자를 시작값에서 목표값까지 올라가며 보여 준다 (easeOutExpo)
export function countUp(el, to, unit, from = 0) {
  if (REDUCE) { el.textContent = `${to}${unit}`; return; }
  const t0 = performance.now();
  const step = now => {
    const k = Math.min(1, (now - t0) / DUR.count);
    el.textContent = `${Math.round(from + (to - from) * easeOutExpo(k))}${unit}`;
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// 「데모 초기화」 때 로그와 진행 헤더를 비운다
registerReset(() => { bootLog(); resetPipe(); });
