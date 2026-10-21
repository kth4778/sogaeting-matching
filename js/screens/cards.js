// 카드 탭: 카드 넘기기
import { PROFILES } from "../data/profiles.js";
import { $, byId, photo, esc } from "../core/util.js";
import { state, save } from "../core/store.js";
import { registerScreen, registerActions, render, deferRender, flushRender } from "../core/runtime.js";
import { RULES, groupOf } from "../core/engine.js";
import { scoreFor, react } from "../core/social.js";
import { debug } from "../core/log.js";
import { isBlocked } from "../features/safety.js";
import { DUR, EASE, REDUCE } from "../ui/motion.js";
import { icon } from "../ui/icons.js";
import { toast } from "../ui/toast.js";
import { openSheet } from "../ui/sheet.js";

const FLY_MS = 320;
const UNDO_MS = 380;
const SNAP_MS = 420;
const HEART_MS = 400;
const UNDO_TOAST_MS = 4000;

// ---------- 하루 1번 슈퍼 좋아요 ----------
const today = () => new Date().toLocaleDateString("sv-SE"); // YYYY-MM-DD (기기 시간대)
function supersLeft() {
  if (state.daily.date !== today()) { state.daily = { date: today(), supers: 1 }; save("daily"); }
  return state.daily.supers;
}

// 아이콘 + 글자 (아이콘만으로는 뜻이 헷갈린다)
export function actionButtons(id) {
  const left = supersLeft();
  const canUndo = !!state.lastSwipe && !state.matches.includes(state.lastSwipe.id);
  return `
    <button class="act act-undo" data-act="undo" aria-label="되돌리기"${canUndo ? "" : " aria-disabled=\"true\""}><span class="circle">${icon("undo", 20)}</span></button>
    <button class="act" data-act="pass:${id}"><span class="circle pass">${icon("x", 26)}</span><small>넘기기</small></button>
    <button class="act" data-act="like:${id}"><span class="circle like">${icon("heart-fill", 30)}</span><small>좋아요</small></button>
    <button class="act${left ? "" : " is-empty"}" data-act="super:${id}" aria-label="슈퍼 좋아요 · 상대 카드 맨 앞에 보여요 · 오늘 ${left}번 남음"><span class="circle super">${icon("star-fill", 24)}</span><small>슈퍼 좋아요 ${left}</small></button>`;
}

export function deckPeople() {
  const order = (state.result?.ranked ?? []).map(r => r.id);
  return PROFILES
    .filter(p => !state.swiped[p.id] && !isBlocked(p.id) && RULES.filter(r => r.side === "me").every(r => r.test(state.me, p)))
    .sort((a, b) => (order.includes(a.id) ? order.indexOf(a.id) : 99) - (order.includes(b.id) ? order.indexOf(b.id) : 99));
}

const isShared = (mine, t) => mine.includes(t) || mine.some(m => groupOf(m) >= 0 && groupOf(m) === groupOf(t));

// 카드 1장. depth는 덱에서 뒤로 겹친 정도(맨 위 0). 내 정보 미리보기도 이 함수를 쓴다(점수 없음 → 알약 생략)
export function cardHtml(p, depth = 0) {
  const s = scoreFor(p.id);
  const ranked = state.result?.ranked?.find(r => r.id === p.id);
  const mine = p.id === "me" ? [] : state.me?.interests ?? [];
  const tags = [...p.interests].sort((a, b) => isShared(mine, b) - isShared(mine, a));
  const isNew = p.id !== "me" && !ranked;
  return `<div class="card" data-id="${p.id}" data-act="detail:${p.id}" style="transform:translateY(${depth * 8}px) scale(${1 - depth * 0.04})">
          <div class="photo" style="background-image:url(${p.photoData ?? photo(p)})"></div>
          <div class="card-tint"></div>
          <span class="stamp yes">좋아요</span><span class="stamp no">다음에</span><span class="stamp sup">슈퍼 좋아요</span>
          <div class="shade" aria-hidden="true" tabindex="-1">
            <div class="card-name"><h3>${esc(p.name)} <span>${p.age}</span>${p.verified?.face ? `<span class="vbadge">${icon("check", 12)}</span>` : ""}</h3>${s !== null ? `<span class="card-score">♥ ${s}점</span>` : ""}</div>
            ${ranked?.oneLine ? `<p class="card-quote">${esc(ranked.oneLine)}</p>` : ""}
            <p class="card-meta">${icon("map-pin", 14)}${esc(p.region)} · ${esc(p.job)}</p>
            <div class="card-chips">${isNew ? `<span class="card-chip new">새로운 사람</span>` : ""}${tags.map(t => isShared(mine, t)
              ? `<span class="card-chip hit">${icon("heart-fill", 12)}${esc(t)}</span>`
              : `<span class="card-chip">${esc(t)}</span>`).join("")}</div>
          </div>
          <button class="card-more" data-act="detail:${p.id}" aria-label="프로필 자세히">${icon("chevron-up", 20)}</button>
        </div>`;
}

export function cardsHtml() {
  const people = deckPeople();
  if (!people.length) {
    const n = state.matches.filter(id => !isBlocked(id)).length;
    return `<div class="appbar"><span>카드</span></div>
      <div class="deck-empty">
        <img class="deck-empty-art" src="art/empty-deck.jpg" alt="">
        <h3>오늘 카드는 여기까지예요</h3>
        <p>내일 오전 10시에 새로운 사람이 도착해요</p>
        ${n ? `<button class="btn" data-act="tab:chats">매칭된 ${n}명과 대화하기</button>`
            : `<button class="btn" data-act="tab:home">오늘의 매칭 다시 보기</button>`}
        <button class="deck-reset" data-act="reset-swipes">(데모) 넘긴 기록 지우기</button>
      </div>`;
  }
  const visible = people.slice(0, 3).reverse(); // 맨 위 카드가 마지막에 그려지도록
  return `<div class="cards-page">
    <div class="appbar"><span>카드</span><span class="muted cards-count">${people.length}명 남음</span></div>
    <div class="deck" id="deck">
      ${visible.map((p, i) => cardHtml(p, visible.length - 1 - i)).join("")}
    </div>
    <div class="deck-actions">
      ${actionButtons(people[0].id)}
    </div></div>`;
}

// ---------- 들어오는 움직임 (다음 그리기 때 1번) ----------
let enter = null; // "promote" | { undo: kind }

function playEnter() {
  const top = $("#deck")?.lastElementChild;
  const e = enter;
  enter = null;
  if (!top || !e || REDUCE) return;
  if (e === "promote") {
    top.animate([{ transform: "translateY(8px) scale(.96)" }, { transform: "none" }], { duration: DUR.base, easing: EASE.out });
  } else {
    const sx = e.undo === "pass" ? -1 : 1;
    const from = e.undo === "super" ? "translate(0,-130%) scale(.9)" : `translateX(${sx * 150}%) rotate(${sx * 18}deg)`;
    top.animate([{ transform: from }, { transform: "none" }], { duration: UNDO_MS, easing: "cubic-bezier(.2,.9,.3,1.1)" });
  }
}

// ---------- 날려 보내기 (버튼·드래그·상세 공용) ----------
const FLY = {
  like: "translate(150%,-30px) rotate(18deg)",
  pass: "translate(-150%,-30px) rotate(-18deg)",
  super: "translate(0,-130%) scale(.9)",
};
let flying = false;

function lock(on) {
  document.querySelectorAll("#deck, .deck-actions").forEach(el => (el.style.pointerEvents = on ? "none" : ""));
}

function floatHeart(deck) {
  if (REDUCE) return;
  const h = Object.assign(document.createElement("span"), { className: "cards-heart", innerHTML: icon("heart-fill", 24) });
  deck.append(h);
  h.addEventListener("animationend", () => h.remove());
}

function done(id, kind) {
  react(id, kind);
  if (kind === "pass") {
    toast(`${byId(id).name}님을 넘겼어요`, { action: { label: "되돌리기", onTap: undo }, duration: UNDO_TOAST_MS });
  }
  enter = "promote";
  render();
}

export async function flyOut(kind, id) {
  const card = $("#deck")?.lastElementChild;
  if (flying) return;
  if (!card || (id && card.dataset.id !== id)) { react(id, kind); render(); return; }
  flying = true;
  lock(true);
  const stamp = card.querySelector(kind === "like" ? ".stamp.yes" : kind === "pass" ? ".stamp.no" : ".stamp.sup");
  if (kind === "like") floatHeart(card.parentElement);
  if (!REDUCE) {
    stamp?.animate([{ opacity: 1 }, { opacity: 1 }], { duration: FLY_MS, fill: "forwards" });
    const base = getComputedStyle(card).transform;
    await card.animate([{ transform: base === "none" ? "none" : base }, { transform: FLY[kind] }],
      { duration: FLY_MS, easing: EASE.fling, fill: "forwards" }).finished.catch(() => {});
  }
  flying = false;
  lock(false);
  done(card.dataset.id, kind);
}

function undo() {
  const last = state.lastSwipe;
  if (!last || state.matches.includes(last.id) || !state.swiped[last.id]) return;
  delete state.swiped[last.id];
  save("swiped", state.swiped);
  state.lastSwipe = null;
  enter = { undo: last.kind };
  if (last.kind === "super") { state.daily.supers = Math.min(1, state.daily.supers + 1); save("daily"); }
  render();
}

function sendSuper(id) {
  state.daily.supers = 0;
  save("daily");
  flyOut("super", id);
}

export function trySuper(id) {
  if (!supersLeft()) {
    openSheet({ title: "슈퍼 좋아요", body: "슈퍼 좋아요는 하루 한 번이에요 · 자정에 다시 생겨요", actions: [], cancel: "확인" });
    return;
  }
  if (!state.coach.super) {
    openSheet({
      title: "슈퍼 좋아요",
      body: "상대 카드 맨 앞에 보여요 · 하루 한 번 보낼 수 있어요",
      actions: [{ label: "보내기", onTap: () => { state.coach.super = true; save("coach"); sendSuper(id); } }],
    });
    return;
  }
  sendSuper(id);
}

// ---------- 카드 드래그 ----------
export function bindSwipe() {
  const deck = $("#deck");
  playEnter();
  if (!deck) return;
  const card = deck.lastElementChild;
  const below = [...deck.children].slice(0, -1).reverse(); // [둘째, 셋째]
  const yes = card.querySelector(".stamp.yes"), no = card.querySelector(".stamp.no"), sup = card.querySelector(".stamp.sup");
  let sx = 0, sy = 0, dx = 0, dy = 0, s = 1, w = 1, sign = 1, dragging = false, crossed = false, trail = [];

  const paint = () => {
    const th = 0.28 * w;
    const p = Math.min(1, Math.abs(dx) / th);
    card.style.transform = `translate(${dx}px, ${dy * 0.35}px) rotate(${(dx / w) * 14 * sign}deg)`;
    const pr = Math.max(0, Math.min(1, dx / th)), pl = Math.max(0, Math.min(1, -dx / th)), pu = dy < -80 ? Math.min(1, (-dy - 80) / 80) : 0;
    [[yes, pr], [no, pl], [sup, pu]].forEach(([el, v]) => { el.style.opacity = v; el.style.transform = `${el === sup ? "translateX(-50%) " : ""}rotate(${el === yes ? -12 : el === no ? 12 : 0}deg) scale(${0.8 + 0.2 * v})`; });
    card.style.setProperty("--p", pr);
    if (below[0]) below[0].style.transform = `translateY(${12 - 12 * p}px) scale(${0.94 + 0.06 * p})`;
    if (below[1]) below[1].style.transform = `translateY(16px) scale(${0.88 + 0.06 * p})`;
    if (p >= 1 && !crossed) navigator.vibrate?.(8);
    crossed = p >= 1;
  };
  const reset = () => {
    [yes, no, sup].forEach(el => { el.style.opacity = 0; el.style.transform = ""; });
    card.style.setProperty("--p", 0);
    below.forEach((b, i) => (b.style.transform = `translateY(${(i + 1) * 8}px) scale(${1 - (i + 1) * 0.04})`));
  };
  const snapBack = () => {
    const from = card.style.transform;
    card.style.transform = "";
    reset();
    if (!REDUCE && from) card.animate([{ transform: from }, { transform: "none" }], { duration: SNAP_MS, easing: EASE.pop });
    deferRender.on = false;
    flushRender();
  };
  const end = cancelled => {
    if (!dragging) return;
    dragging = false;
    card.classList.remove("dragging");
    const now = performance.now();
    const t = trail.filter(r => now - r.t <= 80);
    const vx = t.length > 1 ? (t[t.length - 1].x - t[0].x) / Math.max(1, t[t.length - 1].t - t[0].t) : 0;
    const go = !cancelled && (Math.abs(dx) > 0.28 * w || (Math.abs(vx) > 0.5 && Math.abs(dx) > 32));
    const up = !cancelled && dy < -80 && Math.abs(dx) < 0.28 * w && supersLeft() && state.coach.super;
    if (!go && !up) { snapBack(); return; }
    const kind = up ? "super" : dx > 0 ? "like" : "pass";
    if (up) state.daily.supers = 0, save("daily");
    const dir = Math.sign(dx) || 1;
    const ms = Math.max(180, Math.min(360, 360 - Math.abs(vx) * 100));
    const to = up ? FLY.super : `translate(${dir * w * 1.5}px, ${dy * 0.35}px) rotate(${(dx / w) * 14 * sign + dir * 10}deg)`;
    lock(true);
    if (kind === "like") floatHeart(deck);
    const finish = () => { lock(false); deferRender.on = false; done(card.dataset.id, kind); };
    if (REDUCE) { finish(); return; }
    card.animate([{ transform: card.style.transform }, { transform: to }], { duration: ms, easing: EASE.fling, fill: "forwards" })
      .finished.then(finish, finish);
  };

  // 끌었다 놓은 경우엔 카드 클릭(상세 열기)이 같이 일어나지 않게 막는다
  card.addEventListener("click", e => { if (Math.abs(dx) >= 5 || Math.abs(dy) >= 5) e.stopPropagation(); }, true);
  card.addEventListener("pointerdown", e => {
    if (e.button !== 0 || flying) return;
    dragging = true; crossed = false; dx = dy = 0; trail = [];
    sx = e.clientX; sy = e.clientY;
    s = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--s")) || 1;
    const r = card.getBoundingClientRect();
    w = r.width / s;
    sign = e.clientY - r.top > r.height / 2 ? -1 : 1; // 아래 절반을 잡으면 반대로 기운다
    card.classList.add("dragging");
    card.setPointerCapture(e.pointerId);
    deferRender.on = true;
  });
  card.addEventListener("pointermove", e => {
    if (!dragging) return;
    dx = (e.clientX - sx) / s;
    dy = (e.clientY - sy) / s;
    trail.push({ x: dx, t: performance.now() });
    if (trail.length > 12) trail.shift();
    paint();
  });
  card.addEventListener("pointerup", () => end(false));
  card.addEventListener("pointercancel", () => end(true));
  card.addEventListener("lostpointercapture", () => end(true));
}

// ---------- 키보드 (데스크톱) ----------
document.addEventListener("keydown", e => {
  if (state.tab !== "cards" || state.detail || state.ob || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target.closest?.("input, textarea, [contenteditable]") || document.querySelector(".sheet, .mm")) return;
  const id = $("#deck")?.lastElementChild?.dataset.id;
  const keys = { ArrowLeft: () => flyOut("pass", id), ArrowRight: () => flyOut("like", id), ArrowUp: () => trySuper(id), Backspace: undo };
  if (!keys[e.key] || (!id && e.key !== "Backspace")) return;
  e.preventDefault();
  keys[e.key]();
});

registerScreen("cards", {
  html: cardsHtml,
  mount(root) { root.classList.add("no-scroll"); bindSwipe(); },
  unmount(root) { root.classList.remove("no-scroll"); },
});

registerActions({
  like(arg) { flyOut("like", arg); return false; },
  super(arg) { trySuper(arg); return false; },
  pass(arg) { flyOut("pass", arg); return false; },
  undo() { undo(); return false; },
  "reset-swipes"() { state.swiped = {}; state.lastSwipe = null; save("swiped", {}); debug("넘긴 기록 지움"); },
});
