// 위에서 내려오는 알림 배너. title·text는 HTML(부르는 쪽이 esc)
// 4초 유지, 누르고 있는 동안 정지, 위로 24px 이상 끌면 닫힘, 새 알림은 이전 것을 짧게 페이드시키고 교체
import { $ } from "../core/util.js";

const NOTICE_HOLD_MS = 4000;
const NOTICE_OUT_MS = 200;
const NOTICE_SWAP_MS = 160;

export function showNotice({ avatar, title, text, act }) {
  const prev = document.querySelector(".notice:not(.out)");
  if (prev) {
    prev.classList.add("swap");
    setTimeout(() => prev.remove(), NOTICE_SWAP_MS);
  }
  const n = document.createElement("button");
  n.className = "notice";
  if (act) n.dataset.act = act;
  n.innerHTML = `
    <div class="notice-av photo" style="background-image:url(${avatar})"></div>
    <div class="notice-text"><b>${title}</b><span>${text}</span></div>
    <span class="notice-time">지금</span>`;

  let timer = 0;
  const leave = () => {
    clearTimeout(timer);
    if (n.classList.contains("out")) return;
    n.classList.add("out");
    setTimeout(() => n.remove(), NOTICE_OUT_MS);
  };
  const hold = ms => { clearTimeout(timer); timer = setTimeout(leave, ms); };

  // 끌어 올려 닫기
  let startY = null;
  n.addEventListener("pointerdown", e => { startY = e.clientY; clearTimeout(timer); n.setPointerCapture?.(e.pointerId); });
  n.addEventListener("pointermove", e => {
    if (startY === null) return;
    const dy = Math.min(0, e.clientY - startY);
    n.style.transform = dy ? `translateY(${dy}px)` : "";
  });
  const release = e => {
    if (startY === null) return;
    const dy = e.clientY - startY;
    startY = null;
    if (dy <= -24) {
      n.style.transform = "";
      n.addEventListener("click", ev => ev.stopPropagation(), { capture: true, once: true });
      leave();
    } else {
      n.style.transform = "";
      hold(NOTICE_HOLD_MS / 2);
    }
  };
  n.addEventListener("pointerup", release);
  n.addEventListener("pointercancel", release);
  n.addEventListener("click", () => setTimeout(leave, 0));

  $(".phone-screen").append(n);
  hold(NOTICE_HOLD_MS);
}
