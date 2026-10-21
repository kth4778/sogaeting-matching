// 상세 오버레이: 카드에서 열면 아래에서 올라오는 큰 시트, 결과에서 열면 옆에서 밀려 들어오는 화면
import { byId, photo, esc } from "../core/util.js";
import { state, save } from "../core/store.js";
import { registerOverlay, registerActions, render, pushRoute, backRoute } from "../core/runtime.js";
import { josa } from "../core/engine.js";
import { flyOut, trySuper } from "./cards.js";
import { isBlocked, openSafety } from "../features/safety.js";
import { DUR, EASE, REDUCE } from "../ui/motion.js";
import { icon } from "../ui/icons.js";
import { openSheet } from "../ui/sheet.js";

const PULL_CLOSE_PX = 90;
let from = "result";   // "cards" | "result"
let lastDetail = null; // 새로 열릴 때만 들어오는 움직임
let closing = false;

const ENTER = {
  cards: [{ transform: "translateY(100%)" }, { transform: "none" }],
  result: [{ transform: "translateX(100%)" }, { transform: "none" }],
};

// 닫는 움직임이 끝난 뒤 상태를 바꾼다. after는 닫힌 다음 할 일(덱에서 날려 보내기 등)
function closeDetail(after) {
  const el = document.getElementById("overlay");
  if (closing || !state.detail) return;
  const finish = anim => {
    closing = false;
    state.detail = null;
    render();
    anim?.cancel();
    after?.();
  };
  if (REDUCE || !el) { finish(); return; }
  closing = true;
  const anim = el.animate([...ENTER[from]].reverse(), { duration: DUR.pop, easing: EASE.in, fill: "forwards" });
  anim.finished.then(() => finish(anim), () => finish(anim));
}

function verifyChips(p) {
  const v = p.verified ?? {};
  return [
    v.face && `<span class="vchip face">${icon("check", 14)}본인 인증</span>`,
    v.school && `<span class="vchip org">${icon("check", 14)}학교 인증 · 교통대</span>`,
    v.work && `<span class="vchip org">${icon("check", 14)}직장 인증</span>`,
  ].filter(Boolean).join("");
}

function pairLine(p, m) {
  const pr = m.pair;
  if (!pr || pr.sim < 0.9) return "";
  return pr.a === pr.b
    ? `둘 다 ${josa(pr.a, "을/를")} 좋아해요`
    : `나는 ${pr.a} · ${p.name}님은 ${pr.b} — 같은 결의 취미예요`;
}

function actionsHtml(id) {
  if (state.matches.includes(id)) {
    return `<button class="btn detail-talk" data-act="chat:${id}">${icon("message", 20)}대화하기</button>`;
  }
  if (from === "result") {
    return `<button class="btn detail-talk" data-act="detail-talk:${id}">${icon("message", 20)}대화하기</button>
      ${state.swiped[id] ? "" : `<button class="act" data-act="detail-like:${id}" aria-label="좋아요"><span class="circle like">${icon("heart-fill", 26)}</span></button>`}`;
  }
  return `
    <button class="act" data-act="detail-pass:${id}"><span class="circle pass">${icon("x", 26)}</span><small>넘기기</small></button>
    <button class="act" data-act="detail-like:${id}"><span class="circle like">${icon("heart-fill", 30)}</span><small>좋아요</small></button>
    <button class="act" data-act="detail-super:${id}"><span class="circle super">${icon("star-fill", 24)}</span><small>슈퍼 좋아요</small></button>`;
}

export function detailHtml(id) {
  const p = byId(id);
  const ranked = state.result?.ranked ?? [];
  const m = ranked.find(r => r.id === id);
  const isTop = ranked[0]?.id === id;
  const ex = isTop ? state.result.explain : null;
  const reasons = ex?.reasons ?? m?.reasons?.slice(0, 2) ?? [];
  const shared = new Set(state.me.interests);
  const hits = p.interests.filter(t => shared.has(t)).length;
  const pl = m ? pairLine(p, m) : "";
  return `
    <div class="detail">
      <div class="detail-photo photo" style="background-image:url(${photo(p)})">
        <button class="detail-btn detail-back" data-act="close" aria-label="뒤로">${icon("arrow-left", 20)}</button>
        <button class="detail-btn detail-more" data-act="detail-more:${id}" aria-label="더 보기">${icon("more", 20)}</button>
        <div class="detail-hero">
          <h2>${esc(p.name)} <span>${p.age}</span>${p.verified?.face ? `<button class="vbadge" data-act="detail-verified" aria-label="사진 인증 완료">${icon("check", 12)}</button>` : ""}</h2>
          ${m ? `<span class="card-score">♥ ${m.llmScore}점</span>` : ""}
        </div>
      </div>
      <div class="detail-body">
        <p class="detail-meta">${icon("map-pin", 14)}${esc(p.region)} · ${esc(p.job)}</p>
        ${verifyChips(p) ? `<div class="vchips">${verifyChips(p)}</div>` : ""}
        ${m ? `
          <div class="match-card">
            <div class="match-score"><span>궁합</span><b>${m.llmScore}</b><span>점</span></div>
            <p>${esc(m.oneLine)}</p>
            ${pl ? `<small>${esc(pl)}</small>` : ""}
          </div>` : ""}
        ${reasons.length ? `
          <h4>이런 점이 잘 맞아요</h4>
          ${reasons.map(r => `<div class="reason"><b>${esc(r.title)}</b>${esc(r.detail)}</div>`).join("")}` : ""}
        ${ex ? `
          <div class="reason soft"><b>살짝 다를 수 있는 점</b>${esc(ex.caution)}</div>
          <div class="reason brand"><b>추천 첫 데이트</b>${esc(ex.firstDate)}</div>` : ""}
        <div class="prompt"><span>주말의 나는</span><p>${esc(p.intro)}</p></div>
        <div class="prompt"><span>나를 한마디로</span><p>${esc(p.personality)}</p></div>
        <h4>관심사${hits ? ` · 나와 겹치는 ${hits}개` : ""}</h4>
        <div class="detail-chips">${p.interests.map(t => `<span class="chip ${shared.has(t) ? "hit" : ""}">${esc(t)}</span>`).join("")}</div>
        <h4>기본 정보</h4>
        <div class="facts">
          <div><span>키</span>${p.height}cm</div><div><span>MBTI</span>${p.mbti}</div>
          <div><span>흡연</span>${p.smoking}</div><div><span>음주</span>${p.drinking}</div>
          <div><span>종교</span>${p.religion}</div><div><span>나이 차</span>${Math.abs(p.age - state.me.age)}살</div>
        </div>
      </div>
    </div>
    <div class="actions">${actionsHtml(id)}</div>`;
}

// 사진 맨 위에서 아래로 90px 넘게 당기면 닫힘
function bindPull(el) {
  const body = el.querySelector(".detail");
  if (!body) return;
  let y0 = null;
  body.addEventListener("pointerdown", e => { y0 = body.scrollTop === 0 && e.target.closest(".detail-photo") ? e.clientY : null; });
  body.addEventListener("pointerup", e => { if (y0 !== null && e.clientY - y0 > PULL_CLOSE_PX) backRoute(); y0 = null; });
  body.addEventListener("pointercancel", () => (y0 = null));
}

registerOverlay("detail", {
  active: () => !!state.detail,
  html: () => detailHtml(state.detail),
  className: () => (from === "cards" ? "as-sheet" : "as-push"),
  mount(el) {
    bindPull(el);
    if (state.detail === lastDetail) return;
    lastDetail = state.detail;
    pushRoute("detail", () => closeDetail());
    if (!REDUCE) el.animate(ENTER[from], { duration: DUR.slow, easing: EASE.nav });
  },
  unmount() { lastDetail = null; },
});

// 상세에서 고른 반응: 상세를 닫은 뒤 덱에서 날려 보낸다
const reactFromDetail = kind => id => {
  closeDetail(() => (kind === "super" ? trySuper(id) : flyOut(kind, id)));
  return false;
};

registerActions({
  detail(arg, el) {
    if (!byId(arg) || isBlocked(arg)) return false;
    from = el?.closest(".deck") ? "cards" : "result";
    state.detail = arg;
  },
  close() { backRoute(); return false; },
  "detail-like": reactFromDetail("like"),
  "detail-pass": reactFromDetail("pass"),
  "detail-super": reactFromDetail("super"),
  // 「대화하기」: 넘긴 사람이어도 좋아요로 덮어쓰고, 매칭 전이면 축하 없이 바로 대화방
  "detail-talk"(id) {
    state.swiped[id] = "like";
    save("swiped", state.swiped);
    if (!state.matches.includes(id)) { state.matches.push(id); save("matches", state.matches); }
    state.detail = null; state.tab = "chats"; state.chatWith = id;
  },
  "detail-more"(id) { openSafety(id); return false; },
  "detail-verified"() {
    openSheet({ title: "사진 인증 완료", body: "실시간 셀카로 본인 확인됐어요", actions: [], cancel: "확인" });
    return false;
  },
});
