// 가입 흐름(온보딩) 동작. 화면 마크업은 onboarding-view.js
import { SAMPLE_PROFILES } from "../data/profiles.js";
import { $ } from "../core/util.js";
import { state, save, registerReset } from "../core/store.js";
import { registerOverlay, registerActions, render, pushRoute, backRoute } from "../core/runtime.js";
import { toast } from "../ui/toast.js";
import { openSheet } from "../ui/sheet.js";
import { pauseOffscreen, DUR, EASE, REDUCE } from "../ui/motion.js";
import { playWelcomeHero } from "../ui/brand.js";
import { openGuideOnce } from "./guide.js";
import {
  STEPS as OB_STEPS, INTEREST_MAX, PHOTO_MAX, MBTI_UNKNOWN, CONSENTS, TEXT_RULE,
  blankDraft, onboardingHtml, setField, getField, ctaLabel, helpHtml,
} from "./onboarding-view.js";

const STEP_RANGE = { age: [19, 45], height: [145, 200], "wants.ageMin": [19, 45], "wants.ageMax": [19, 45] };
const DRAFT_KEY = "ob-draft";
const DRAFT_SAVE_MS = 200;
const PHOTO_EDGE = 720;
const SAVED_TOAST_MS = 1600;
const stepAt = key => OB_STEPS.findIndex(s => s.key === key);

// 화면 안 뒤로 버튼은 내가 쌓은 라우트가 있을 때만 history를 되돌린다(복원 직후엔 쌓인 게 없다)
let obDepth = 0;
function forward() {
  obDepth++;
  pushRoute("ob", () => { obDepth = Math.max(0, obDepth - 1); handleOnboarding("ob-back"); });
}

// ---------- 초안 보존 (sessionStorage) ----------
let draftTimer = 0;
function saveDraft() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    const ob = state.ob;
    if (!ob || ob.editing || ob.sample || ob.stepIndex < stepAt("name")) return;
    try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ stepIndex: ob.stepIndex, draft: ob.draft, agree: ob.agree })); } catch { /* 저장 못 해도 진행 */ }
  }, DRAFT_SAVE_MS);
}
function clearDraft() {
  clearTimeout(draftTimer);
  try { sessionStorage.removeItem(DRAFT_KEY); } catch {}
}
function loadDraft() {
  try { return JSON.parse(sessionStorage.getItem(DRAFT_KEY)); } catch { return null; }
}
function freshOb(extra = {}) {
  const saved = loadDraft();
  return { stepIndex: 0, draft: blankDraft(), editing: false, dir: "fwd", resume: saved?.stepIndex ?? 0, ...extra };
}

// stepKey를 주면 그 단계 하나만 고친다(single). 없으면 요약(done)에서 시작
export function startOnboarding(editing, stepKey) {
  if (!editing) {
    state.ob = freshOb();
  } else {
    const draft = structuredClone(state.me);
    draft.photos ??= draft.photoData ? [draft.photoData] : [];
    state.ob = { stepIndex: stepAt(stepKey ?? "done"), draft, editing, single: !!stepKey, dir: "fwd" };
    forward();
  }
  state.detail = null;
}

export function finishOnboarding() {
  const ob = state.ob;
  const d = ob.draft;
  if (d.photos?.length) d.photoData = d.photos[0];
  else delete d.photoData;
  state.me = d;
  try { localStorage.setItem("me", JSON.stringify(d)); } catch {
    toast("사진이 너무 커요");
    d.photos = d.photos?.slice(0, 1) ?? [];
    save("me", d);
  }
  clearDraft();
  const done = () => {
    state.ob = null;
    if (ob.editing) { state.tab = "me"; toast("저장했어요", { duration: SAVED_TOAST_MS }); }
    else state.tab = "home";
    render();
    // 매칭은 매칭 탭의 「매칭 시작」을 눌러야 돈다. 결과는 지우지 않는다(무효화는 서명 비교)
    if (!ob.editing) openGuideOnce();
  };
  const el = $("#overlay");
  if (!ob.editing && el && !REDUCE) {
    el.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(-12px)" }],
      { duration: DUR.pop, easing: EASE.in, fill: "forwards" }).finished.then(() => { done(); el.getAnimations().forEach(a => a.cancel()); });
  } else done();
}

// 다음 버튼과 도움말만 바꾼다 (글자 입력 중에 화면 전체를 다시 그리면 입력 칸 포커스가 날아간다)
export function refreshNext() {
  const btn = $("#ob-next");
  const step = OB_STEPS[state.ob.stepIndex];
  if (!btn || !step.valid) return;
  btn.disabled = !step.valid(state.ob.draft);
  btn.textContent = ctaLabel(step, state.ob.draft, state.ob);
}

let keepScroll = null;
let pendingAddFocus = false;

export function handleOnboarding(act, arg) {
  const ob = state.ob;
  if (!ob) return;
  const d = ob.draft;
  const step = OB_STEPS[ob.stepIndex];
  const before = `${ob.stepIndex}/${ob.picker ?? ""}`;
  if (act === "ob-backroute") {
    if (obDepth > 0) backRoute();
    else handleOnboarding("ob-back");
    return;
  } else if (act === "ob-next") {
    const valid = step.valid ? step.valid(d) : CONSENTS.every(([k]) => ob.agree?.[k]);
    if (ob.stepIndex > 0 && !valid) return;
    if (ob.single) { finishOnboarding(); return; }
    // 요약에서 한 단계만 고치러 왔으면 「저장」은 요약으로 돌아간다
    if (ob.returnTo) { if (obDepth > 0) backRoute(); else handleOnboarding("ob-back"); return; }
    ob.stepIndex++;
    if (ob.editing && OB_STEPS[ob.stepIndex].key === "consent") ob.stepIndex++;
    // 이상형 나이는 손대지 않았으면 내 나이 ±4로
    if (OB_STEPS[ob.stepIndex].key === "wants" && d.wants.ageMin == null) {
      d.wants.ageMin = Math.max(19, d.age - 4); d.wants.ageMax = Math.min(45, d.age + 4);
    }
    ob.dir = "fwd"; forward();
  } else if (act === "ob-back") {
    if (ob.picker) { Object.assign(ob, { picker: null, dir: "back" }); }
    // 예시 프로필 요약에서 뒤로 가면 피커로 돌아가 다시 고르게 한다
    else if (ob.sample) { state.ob = freshOb({ dir: "back", picker: d.gender }); }
    else if (ob.returnTo) { Object.assign(ob, { stepIndex: stepAt(ob.returnTo), returnTo: null, dir: "back" }); }
    else if (ob.single || (ob.editing && step.key === "done")) { state.ob = null; }
    else {
      ob.stepIndex = Math.max(0, ob.stepIndex - 1);
      if (OB_STEPS[ob.stepIndex].key === "welcome") ob.resume = 0;
      ob.dir = "back";
    }
  } else if (act === "ob-resume") {
    const saved = loadDraft();
    if (!saved) return;
    Object.assign(ob, { stepIndex: saved.stepIndex, draft: saved.draft, agree: saved.agree, resume: 0, dir: "fwd" });
    forward();
  } else if (act === "ob-restart") {
    clearDraft();
    Object.assign(ob, { resume: 0 });
  } else if (act === "ob-pick-open") {
    // 예시 프로필 기본 탭은 직전 선택(없으면 여)
    Object.assign(ob, { picker: lastPicker, dir: "fwd" }); forward();
  } else if (act === "ob-pick-tab") {
    ob.picker = lastPicker = arg;
  } else if (act === "ob-pick") {
    // 고른 예시 프로필의 요약부터 보여 준다 (바로 매칭하지 않음)
    const sample = SAMPLE_PROFILES[Number(arg)];
    Object.assign(ob, { draft: structuredClone(sample), sample: true, picker: null, stepIndex: stepAt("done"), dir: "fwd" });
    forward();
  } else if (act === "ob-goto") {
    Object.assign(ob, { stepIndex: stepAt(arg), returnTo: "done", dir: "fwd" });
    forward();
  } else if (act === "ob-finish") {
    finishOnboarding();
    return;
  } else if (act === "ob-agree") {
    ob.agree ??= {};
    if (arg === "all") { const all = !CONSENTS.every(([k]) => ob.agree[k]); CONSENTS.forEach(([k]) => { ob.agree[k] = all; }); }
    else ob.agree[arg] = !ob.agree[arg];
  } else if (act === "ob-terms") {
    openSheet({ title: CONSENTS.find(([k]) => k === arg)?.[1] ?? "", body: TERMS[arg], cancel: "닫기" });
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
    const base = d.mbti && d.mbti !== MBTI_UNKNOWN ? d.mbti : "____";
    d.mbti = base.slice(0, +i) + letter + base.slice(+i + 1);
  } else if (act === "ob-interest") {
    if (d.interests.includes(arg)) d.interests = d.interests.filter(t => t !== arg);
    else if (d.interests.length >= INTEREST_MAX) { toast(`관심사는 ${INTEREST_MAX}개까지 고를 수 있어요`); return; }
    else d.interests.push(arg);
  } else if (act === "ob-add-interest") {
    const input = document.querySelector("[data-field='newInterest']");
    const t = input.value.trim();
    if (!t) return;
    const same = d.interests.find(x => x.replace(/\s/g, "").toLowerCase() === t.replace(/\s/g, "").toLowerCase());
    if (same) {
      input.value = "";
      [...document.querySelectorAll(".ob .pick.on")].find(b => b.textContent === same)?.animate([{ opacity: 1 }, { opacity: .3 }, { opacity: 1 }], DUR.slow);
      return;
    }
    if (d.interests.length >= INTEREST_MAX) { toast(`관심사는 ${INTEREST_MAX}개까지 고를 수 있어요`); return; }
    d.interests.push(t);
    pendingAddFocus = true;
  } else if (act === "ob-toggle-smoke") {
    d.wants.nonSmokerOnly = !d.wants.nonSmokerOnly;
  } else if (act === "ob-photo-add") {
    $("#ob-file")?.click();
    return;
  } else if (act === "ob-photo-del") {
    d.photos.splice(Number(arg), 1);
  }
  const ob2 = state.ob;
  if (ob2 && before === `${ob2.stepIndex}/${ob2.picker ?? ""}`) keepScroll = $(".ob-body")?.scrollTop ?? null;
  if (act !== "ob-back" && act !== "ob-next" && act !== "ob-goto") navigator.vibrate?.(8);
  saveDraft();
  render();
}

let lastPicker = "여";

const TERMS = {
  age: "이 서비스는 만 19세 이상만 쓸 수 있어요.",
  terms: "체험용 데모 서비스예요. 등장인물과 대화 상대는 실제 사람이 아니며, 서비스 내용은 예고 없이 바뀔 수 있어요.",
  privacy: "입력한 프로필·사진·대화는 이 기기의 브라우저에만 저장돼요. 답장을 만들 때 대화 내용이 서버를 거치지만 따로 보관하지 않아요. 내 정보 → 체험 기록 지우기로 언제든 모두 지울 수 있어요.",
};

// 고른 사진을 긴 변 720px JPEG로 줄여 draft.photos에 넣는다
function addPhoto(file) {
  const ob = state.ob;
  if (!ob || !file) return;
  const img = new Image();
  const url = URL.createObjectURL(file);
  img.onload = () => {
    const k = Math.min(1, PHOTO_EDGE / Math.max(img.width, img.height));
    const c = Object.assign(document.createElement("canvas"), { width: Math.round(img.width * k), height: Math.round(img.height * k) });
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url);
    ob.draft.photos ??= [];
    if (ob.draft.photos.length < PHOTO_MAX) ob.draft.photos.push(c.toDataURL("image/jpeg", .82));
    keepScroll = $(".ob-body")?.scrollTop ?? null;
    saveDraft();
    render();
  };
  img.onerror = () => { URL.revokeObjectURL(url); toast("사진을 열 수 없어요"); };
  img.src = url;
}

// ---------- 오버레이 ----------
// 같은 단계를 다시 그릴 때(칩 선택 등)는 들어오는 움직임을 빼서 깜빡이지 않게 한다
let lastObStep = null;
let stopHero = null;
let lastRatio = null;
function startHero(overlay) {
  const hero = overlay.querySelector(".hero");
  if (!hero) return;
  // 스플래시가 로고를 그리고 있었으면 히어로는 그 다음 장면부터 이어 간다
  const drawn = document.body.classList.contains("booting");
  const go = () => {
    stopHero?.();
    const unpause = pauseOffscreen(hero), stopFilm = playWelcomeHero(hero, { drawn });
    stopHero = () => { unpause(); stopFilm(); };
  };
  if (drawn) {
    hero.classList.add("paused");
    window.addEventListener("splash:done", () => { hero.classList.remove("paused"); if (hero.isConnected) go(); }, { once: true });
  } else go();
}
registerOverlay("ob", {
  active: () => !!state.ob,
  html: () => onboardingHtml(state.ob),
  className: () => "ob-mode",
  mount(overlay) {
    const ob = state.ob;
    const key = `${ob.stepIndex}/${ob.picker ?? ""}`;
    const same = lastObStep === key || (lastObStep?.endsWith("/남") || lastObStep?.endsWith("/여")) && ob.picker;
    stopHero?.(); stopHero = null;
    startHero(overlay);
    if (same) {
      overlay.querySelectorAll("[class*='enter-']").forEach(n => n.classList.remove("enter-fwd", "enter-back"));
      if (keepScroll != null) { const b = overlay.querySelector(".ob-body"); if (b) b.scrollTop = keepScroll; }
    }
    // 새 단계에 글자 입력 칸이 있으면 바로 입력할 수 있게 커서를 둔다 (지역 칩이 먼저인 place는 빼고)
    else if (OB_STEPS[ob.stepIndex].key !== "place") overlay.querySelector(".ob-body [data-field]:not([data-field='newInterest'])")?.focus({ preventScroll: true });
    if (pendingAddFocus) { pendingAddFocus = false; overlay.querySelector("[data-field='newInterest']")?.focus({ preventScroll: true }); }
    keepScroll = null;
    // 진행 막대는 이전 비율에서 이어서 채운다
    const bar = overlay.querySelector(".progress i");
    const ratio = bar ? Number(bar.parentElement.getAttribute("aria-valuenow")) / Number(bar.parentElement.getAttribute("aria-valuemax")) : null;
    if (bar && lastRatio != null && lastRatio !== ratio && !REDUCE) bar.animate([{ transform: `scaleX(${lastRatio})` }, { transform: `scaleX(${ratio})` }], { duration: DUR.slow, easing: EASE.out });
    lastRatio = ratio;
    overlay.querySelector("#ob-file")?.addEventListener("change", e => addPhoto(e.target.files?.[0]));
    lastObStep = key;
  },
  unmount() { lastObStep = null; lastRatio = null; obDepth = 0; stopHero?.(); stopHero = null; },
});

// ob-* 액션은 handleOnboarding이 직접 다시 그린다
const OB_ACTS = ["ob-next", "ob-back", "ob-backroute", "ob-resume", "ob-restart", "ob-pick-open", "ob-pick-tab", "ob-pick", "ob-goto", "ob-finish",
  "ob-agree", "ob-terms", "ob-set", "ob-step", "ob-mbti", "ob-interest", "ob-add-interest", "ob-toggle-smoke", "ob-photo-add", "ob-photo-del"];
registerActions(Object.fromEntries(OB_ACTS.map(act => [act, arg => { handleOnboarding(act, arg); return false; }])));

// 「체험 기록 지우기」 뒤에는 가입 흐름부터
registerReset(() => { clearDraft(); startOnboarding(false); });

// 새로고침 전 만들던 초안이 있으면 웰컴에서 「이어서 만들기」를 보여 준다
if (state.ob && !state.me) state.ob.resume = loadDraft()?.stepIndex ?? 0;

// 가입 화면의 글자 입력은 값만 바꾸고 다시 그리지 않는다
document.addEventListener("input", e => {
  const field = e.target.dataset?.field;
  if (!field || !state.ob || field === "newInterest") return;
  setField(state.ob.draft, field, e.target.value);
  if (TEXT_RULE[field]) $(`#help-${field}`)?.replaceWith(Object.assign(document.createElement("div"), { innerHTML: helpHtml(state.ob.draft, field) }).firstElementChild);
  refreshNext();
  saveDraft();
});

document.addEventListener("keydown", e => {
  if (e.key !== "Enter" || !state.ob || e.isComposing) return;
  if (e.target.dataset?.field === "newInterest") { e.preventDefault(); handleOnboarding("ob-add-interest", ""); }
  else if (e.target.tagName === "INPUT") { e.preventDefault(); $("#ob-next")?.click(); }
});
