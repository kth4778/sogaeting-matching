// 아래에서 올라오는 확인 시트
// openSheet({ title, body, actions: [{ label, act | onTap, danger }], cancel: "취소" }) — body는 HTML(부르는 쪽이 esc)
// act가 있는 버튼은 main의 클릭 위임이 그 액션을 실행한다. 어느 버튼이든 누르면 시트가 닫힌다.
// 뒤로가기: 열 때 pushRoute("sheet"), 취소·dim·Esc는 backRoute(), 액션 버튼은 closeSheet() 안에서 dropRoute("sheet")
import { $, esc } from "../core/util.js";
import { pushRoute, backRoute, dropRoute } from "../core/runtime.js";
import { REDUCE, DUR } from "./motion.js";

let current = null; // { dim, sheet, opener, onKey }
let seq = 0;

export function openSheet({ title, body = "", actions = [], cancel = "취소" }) {
  if (current) { dropRoute("sheet"); removeNow(); }
  const opener = document.activeElement;
  const id = `sheet-t${++seq}`;
  const dim = Object.assign(document.createElement("div"), { className: "sheet-dim" });
  dim.setAttribute("aria-hidden", "true");
  const sheet = Object.assign(document.createElement("div"), { className: "sheet" });
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  sheet.setAttribute("aria-labelledby", id);
  sheet.innerHTML = `<b class="sheet-title" id="${id}">${esc(title)}</b>${body ? `<p class="sheet-body">${body}</p>` : ""}` +
    actions.map((a, i) => `<button class="sheet-btn${a.danger ? " danger" : ""}" data-i="${i}"${a.act ? ` data-act="${esc(a.act)}"` : ""}>${esc(a.label)}</button>`).join("") +
    `<button class="sheet-cancel">${esc(cancel)}</button>`;
  sheet.querySelectorAll("[data-i]").forEach(b => b.addEventListener("click", () => {
    closeSheet();
    actions[Number(b.dataset.i)].onTap?.();
  }));
  sheet.querySelector(".sheet-cancel").addEventListener("click", backRoute);
  dim.addEventListener("click", backRoute);

  const onKey = e => {
    if (e.key === "Escape") { e.preventDefault(); backRoute(); return; }
    if (e.key !== "Tab") return;
    const items = [...sheet.querySelectorAll("button")];
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    else if (!sheet.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
  };
  document.addEventListener("keydown", onKey);
  setInert(true);
  $(".phone-screen").append(dim, sheet);
  current = { dim, sheet, opener, onKey };
  sheet.querySelector("button").focus({ preventScroll: true });
  const mine = current;
  pushRoute("sheet", () => { if (current === mine) animateOut(); });
}

// 액션 버튼처럼 코드가 직접 닫을 때
export function closeSheet() {
  if (!current) return;
  animateOut();
  dropRoute("sheet");
}

function setInert(on) {
  for (const el of [$("#screen"), $("#tabbar")]) if (el) el.inert = on;
}

function removeNow() {
  const { dim, sheet, opener, onKey } = current;
  document.removeEventListener("keydown", onKey);
  dim.remove();
  sheet.remove();
  setInert(false);
  current = null;
  if (opener?.isConnected) opener.focus({ preventScroll: true });
}

function animateOut() {
  const { dim, sheet } = current;
  const node = current;
  if (REDUCE) { removeNow(); return; }
  sheet.classList.add("out");
  dim.animate([{ opacity: 1 }, { opacity: 0 }], { duration: DUR.base, fill: "forwards" });
  setTimeout(() => { if (current === node) removeNow(); }, DUR.base);
}
