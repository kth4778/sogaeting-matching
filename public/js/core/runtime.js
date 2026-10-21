// 화면·오버레이·액션 레지스트리, render 위임, 뒤로가기 라우트 (WP0 작성, 동결)
// 화면 모듈은 main.js를 import하지 않고 여기의 render()만 부른다(순환 import 금지).

// ---------- render 위임 ----------
let renderer = () => {};
export function setRenderer(fn) { renderer = fn; }

// 드래그 중에는 다시 그리기를 모았다가, 손을 뗄 때 on = false 후 flushRender()로 1번만 그린다
export const deferRender = { on: false };
let pending = false;
export const render = () => {
  if (deferRender.on) { pending = true; return; }
  pending = false;
  renderer();
};
export function flushRender() {
  if (!pending || deferRender.on) return;
  pending = false;
  renderer();
}

// ---------- 화면·오버레이 ----------
// registerScreen(name, { html(), mount?(root), patch?(root) → boolean, unmount?(root) }) — name은 state.tab 값
export const screens = {};
export function registerScreen(name, mod) { screens[name] = mod; }
// registerOverlay(name, { active() → boolean, html(), mount?(el), className?() → string, unmount?(el) })
// 등록 순서가 우선순위다. 동시에 active인 오버레이는 1개(온보딩·상세·내 정보 미리보기는 서로 배타)
export const overlays = [];
export function registerOverlay(name, mod) { overlays.push([name, mod]); }

// ---------- 액션 (data-act) ----------
// 핸들러가 false를 돌려주면 main이 다시 그리지 않는다
export const actions = {};
export function registerActions(obj) {
  for (const [name, fn] of Object.entries(obj)) {
    if (actions[name]) console.error(`[runtime] 액션 이름 중복: ${name}`);
    actions[name] = fn;
  }
}
export function dispatch(act, arg, el) {
  return actions[act]?.(arg, el);
}

// ---------- 뒤로가기 라우트 (history는 이 파일만 만진다) ----------
const stack = [];         // [{ key, onPop }]
let skipPops = 0;         // dropRoute가 부른 history.go로 생기는 popstate (onPop 없이 소비)
const waiting = [];       // 그 popstate를 기다리는 동안 들어온 pushRoute

export function pushRoute(key, onPop) {
  if (skipPops) { waiting.push([key, onPop]); return; }
  history.pushState({ r: key }, "");
  stack.push({ key, onPop });
}
// 앱 안 뒤로 버튼: history.back() → popstate → 맨 위 onPop
export function backRoute() { history.back(); }
// 코드가 직접 닫았을 때: 가장 아래 key 항목부터 위를 모두 빼고 그만큼 history를 되돌린다
export function dropRoute(key) {
  const i = stack.findIndex(r => r.key === key);
  if (i < 0) return;
  const n = stack.length - i;
  stack.splice(i);
  skipPops++;
  history.go(-n);
}
window.addEventListener("popstate", () => {
  if (skipPops) {
    skipPops--;
    if (!skipPops) waiting.splice(0).forEach(([key, onPop]) => pushRoute(key, onPop));
    return;
  }
  // onPop은 history가 이미 돌아간 상태에서 화면만 닫는다
  stack.pop()?.onPop?.();
});
