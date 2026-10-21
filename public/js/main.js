// 앱 시작점: 화면 그리기 규약(render), 클릭 위임, 탭바(배지·스크롤 기억), 가상 폰 크기, 키보드 높이, 스플래시
// 화면 모듈을 불러오면 각자 registerScreen·registerOverlay·registerActions로 등록된다 (오버레이 우선순위 = 불러온 순서)
import "./screens/onboarding.js";
import "./screens/home.js";
import "./screens/cards.js";
import "./screens/detail.js";
import "./screens/chat.js";
import "./screens/profile.js";
import { $, sleep } from "./core/util.js";
import { state } from "./core/store.js";
import { setRenderer, render as rerender, registerActions, dispatch, screens, overlays, dropRoute } from "./core/runtime.js";
import { bootLog, renderPipeline } from "./core/log.js";
import { signature } from "./core/engine.js";
import { unreadTotal } from "./screens/chat.js";
import { REDUCE, DUR, EASE } from "./ui/motion.js";
import { markSvg } from "./ui/brand.js";

const MOBILE_Q = "(max-width: 760px), (hover: none) and (pointer: coarse)";
const SPLASH_MAX_MS = 2200, SPLASH_MIN_MS = 1500, SPLASH_OUT_MS = 300; // 로고 선이 다 그려지고 이름이 올라올 때까지(약 1.2초)

// ---------- 화면 그리기 ----------
// 규약(명세 §6.1): ① 화면 키(탭/대화 상대)가 바뀌면 이전 unmount → className 초기화 → 새로 그림 → mount → 컨테이너 페이드
// ② 키가 같으면 patch가 true일 때 끝, 아니면 페이드 없이 다시 그림 + mount ③ 오버레이는 active인 것 하나 ④ 닫힌 오버레이·대화방 라우트 정리
let lastKey = null;
let lastScreen = null;
let lastOverlay = null;
const scrollByTab = {}; // 탭별 스크롤 위치(대화방 제외)

function render() {
  const screen = $("#screen");
  const mod = state.me ? screens[state.tab] : null;
  const key = `${state.tab}/${state.chatWith ?? ""}`;
  const paint = () => { screen.innerHTML = mod ? mod.html() : ""; };
  if (key !== lastKey) {
    if (lastKey && !lastKey.split("/")[1]) scrollByTab[lastKey.split("/")[0]] = screen.scrollTop;
    lastScreen?.unmount?.(screen);
    screen.className = "screen";
    paint();
    screen.classList.toggle("in-room", state.tab === "chats" && !!state.chatWith);
    screen.scrollTop = state.chatWith ? 0 : (scrollByTab[state.tab] ?? 0);
    mod?.mount?.(screen);
    if (lastKey !== null && !REDUCE) screen.animate([{ opacity: 0 }, { opacity: 1 }], { duration: DUR.fast, easing: EASE.out });
    lastKey = key;
  } else if (mod?.patch?.(screen) !== true) {
    paint();
    mod?.mount?.(screen);
  }
  lastScreen = mod;

  paintTabbar();

  const overlay = $("#overlay");
  const cur = overlays.find(([, o]) => o.active())?.[1] ?? null;
  if (lastOverlay && lastOverlay !== cur) lastOverlay.unmount?.(overlay);
  if (cur) {
    overlay.className = "overlay open " + (cur.className?.() ?? "");
    overlay.innerHTML = cur.html();
    cur.mount?.(overlay);
  } else {
    overlay.className = "overlay";
    overlay.innerHTML = "";
  }
  lastOverlay = cur;
  $(".phone-screen").classList.toggle("on-photo", !!state.detail);

  // 닫힌 오버레이·대화방의 뒤로가기 항목을 뺀다 (스택에 없으면 아무것도 안 한다)
  for (const [name, o] of overlays) if (!o.active()) dropRoute(name);
  if (!state.chatWith) dropRoute("room");
}

// ---------- 탭바: 활성·숨김·배지 ----------
function paintTabbar() {
  const bar = $("#tabbar");
  const hidden = !!state.ob || (state.tab === "chats" && !!state.chatWith);
  bar.hidden = hidden;
  document.body.classList.toggle("no-tabbar", hidden);
  const unread = unreadTotal();
  const freshMatch = state.matches.some(id => !state.chats[id]?.length);
  const staleResult = !!(state.result && state.me && state.result.forMe !== signature(state.me));
  bar.querySelectorAll("[data-act^='tab:']").forEach(b => {
    const tab = b.dataset.act.slice(4);
    const on = tab === state.tab;
    b.classList.toggle("active", on);
    if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
    let mark = "", label = "";
    if (tab === "chats" && unread > 0) { mark = `<span class="tab-badge">${unread > 99 ? 99 : unread}</span>`; label = `안 읽은 메시지 ${unread}개`; }
    else if (tab === "chats" && freshMatch) { mark = `<span class="tab-dot"></span>`; label = "새 매칭"; }
    else if (tab === "home" && staleResult) { mark = `<span class="tab-dot"></span>`; label = "다시 매칭할 수 있어요"; }
    const old = b.querySelector(".tab-badge, .tab-dot");
    if ((old?.outerHTML ?? "") !== mark) {
      old?.remove();
      if (mark) b.insertAdjacentHTML("beforeend", mark);
    }
    if (label) b.setAttribute("aria-description", label); else b.removeAttribute("aria-description");
  });
}

// ---------- 클릭 처리 ----------
document.addEventListener("click", e => {
  const el = e.target.closest("[data-act]");
  if (!el || el.disabled) return;
  const raw = el.dataset.act;
  const cut = raw.indexOf(":");
  const act = cut < 0 ? raw : raw.slice(0, cut);
  const arg = cut < 0 ? "" : raw.slice(cut + 1);

  if (act.startsWith("ob-")) { dispatch(act, arg, el); return; }
  if (state.ob) return; // 가입 중에는 바깥 메뉴를 막는다
  if (dispatch(act, arg, el) === false) return;
  rerender();
});

registerActions({
  tab(arg) {
    // 활성 탭을 다시 누르면 맨 위로
    if (arg === state.tab && !state.chatWith && !state.detail) {
      $("#screen").scrollTo({ top: 0, behavior: REDUCE ? "auto" : "smooth" });
      return false;
    }
    state.tab = arg; state.detail = null;
    if (arg !== "chats") state.chatWith = null;
  },
});

// ---------- 가상 폰 크기·키보드 높이 ----------
const MOBILE = window.matchMedia(MOBILE_Q);
function fitPhone() {
  // 모바일에서는 가상 아이폰 없이 화면 전체를 쓰므로 크기를 맞추지 않는다
  const s = MOBILE.matches ? 1 : Math.min(1.0, (window.innerHeight - 32) / 874);
  document.documentElement.style.setProperty("--s", s.toFixed(3));
}
window.addEventListener("resize", fitPhone);

const vv = window.visualViewport;
if (vv) {
  const onViewport = () => {
    document.documentElement.style.setProperty("--vvh", vv.height + "px");
    document.documentElement.classList.toggle("kb-open", window.innerHeight - vv.height > 120);
    window.scrollTo(0, 0);
  };
  vv.addEventListener("resize", onViewport);
  onViewport();
}
// iOS에서 :active 누름 효과가 켜지게
document.addEventListener("touchstart", () => {}, { passive: true });

// ---------- 스플래시 ----------
function endBoot() {
  document.body.classList.remove("booting");
  window.dispatchEvent(new Event("splash:done"));
}
function standalone() {
  return window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
}
async function showSplash() {
  let booted = false;
  try { booted = sessionStorage.getItem("booted") === "1"; sessionStorage.setItem("booted", "1"); } catch {}
  if (state.me || booted || standalone() || REDUCE) { endBoot(); return; }

  const splash = document.createElement("div");
  splash.className = "splash";
  splash.innerHTML = `${markSvg()}<h1 class="mask"><span class="mask-in">오늘, 누구와?</span></h1>`;
  $(".phone-screen").append(splash);
  const t0 = performance.now();
  let done = false;
  const close = () => {
    if (done) return;
    done = true;
    splash.classList.add("out");
    endBoot();
    setTimeout(() => splash.remove(), SPLASH_OUT_MS);
  };
  splash.addEventListener("pointerdown", close);
  const hero = $("#overlay img");
  await Promise.race([
    Promise.all([document.fonts.ready, hero?.decode?.().catch(() => {})]),
    sleep(SPLASH_MAX_MS),
  ]);
  await sleep(Math.max(0, SPLASH_MIN_MS - (performance.now() - t0)));
  close();
}

// ---------- 오프라인 캐시 (https 배포에서만) ----------
if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

setRenderer(render);
history.replaceState(null, "");
fitPhone();
bootLog();
renderPipeline();
render();
showSplash();
