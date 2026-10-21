// 아래쪽 짧은 안내. 한 번에 하나만 뜬다. 누르고 있는 동안은 사라지지 않는다.
// toast(text, { action?: { label, onTap }, duration?: 2000 })
import { $ } from "../core/util.js";

let current = null;

export function toast(text, { action, duration = 2000 } = {}) {
  current?.remove();
  const t = Object.assign(document.createElement("div"), { className: "toast" });
  t.setAttribute("role", "status");
  t.append(Object.assign(document.createElement("span"), { textContent: text }));
  if (action) {
    const b = Object.assign(document.createElement("button"), { className: "toast-action", textContent: action.label });
    b.addEventListener("click", () => { leave(); action.onTap?.(); });
    t.append(b);
  }
  let timer = setTimeout(leave, duration);
  t.addEventListener("pointerdown", () => clearTimeout(timer));
  const resume = () => { clearTimeout(timer); timer = setTimeout(leave, duration / 2); };
  t.addEventListener("pointerup", resume);
  t.addEventListener("pointercancel", resume);
  function leave() {
    clearTimeout(timer);
    if (t.classList.contains("out")) return;
    t.classList.add("out");
    t.addEventListener("animationend", () => t.remove(), { once: true });
    setTimeout(() => t.remove(), 400); // 애니메이션이 꺼진 환경 대비
  }
  $(".phone-screen").append(t);
  current = t;
}
