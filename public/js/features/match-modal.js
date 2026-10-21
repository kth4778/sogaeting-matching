// 매칭 성사 화면: 카드 탭에서는 전체 화면 축하, 다른 탭에서는 위 알림 배너
import { $, photo, esc, meSrc } from "../core/util.js";
import { state } from "../core/store.js";
import { render } from "../core/runtime.js";
import { josa, groupOf } from "../core/engine.js";
import { showNotice } from "../ui/notice.js";
import { icon } from "../ui/icons.js";
import { queueMessage } from "../screens/chat.js";

const queue = [];
let open = null;

export function showMatchModal(p) {
  if (state.tab !== "cards" || state.ob) {
    showNotice({ avatar: photo(p), title: "서로 마음이 통했어요", text: `${esc(p.name)}님도 좋아요를 눌렀어요`, act: `chat:${p.id}` });
    return;
  }
  queue.push(p);
  if (!open) next();
}

// 첫인사 추천 2개: 겹치는 관심사 → 사는 곳
function openers(p) {
  const mine = state.me?.interests ?? [];
  const shared = p.interests.find(t => mine.includes(t) || mine.some(m => groupOf(m) >= 0 && groupOf(m) === groupOf(t)));
  const first = shared ?? p.interests[0];
  return [
    `${josa(first, "을/를")} 좋아하신다고 봤어요! 요즘도 자주 하세요?`,
    shared ? `다음에 ${josa(shared, "을/를")} 같이 해 봐요` : `${p.region}에서 자주 가는 곳 있으세요?`,
  ];
}

function next() {
  const p = queue.shift();
  if (!p) { open = null; return; }
  const me = state.me ? meSrc(state.me) : null;
  const el = document.createElement("div");
  el.className = "mm";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  el.setAttribute("aria-label", "서로 마음이 통했어요");
  el.innerHTML = `
    <div class="mm-bg photo" style="background-image:url(${photo(p)})"></div>
    <div class="mm-tint"></div>
    <div class="mm-body">
      <div class="mm-pair">
        ${me ? `<div class="mm-av mm-me photo" style="background-image:url(${me})"></div>`
             : `<div class="mm-av mm-me mm-initial">${esc(state.me?.name?.slice(0, 1) ?? "나")}</div>`}
        <div class="mm-av mm-them photo" style="background-image:url(${photo(p)})"></div>
        <span class="mm-heart">${icon("heart-fill", 26)}</span>
        ${Array.from({ length: 8 }, (_, i) => {
          const a = (i / 8) * Math.PI * 2;
          return `<span class="mm-particle" style="--dx:${Math.round(Math.cos(a) * 90)}px;--dy:${Math.round(Math.sin(a) * 90)}px">${icon("heart-fill", 12)}</span>`;
        }).join("")}
      </div>
      <h2 class="mm-title">서로 마음이 통했어요</h2>
      <p class="mm-sub">${esc(p.name)}님도 좋아요를 눌렀어요</p>
      <div class="mm-chips">${openers(p).map((t, i) => `<button class="mm-chip" data-i="${i}">${esc(t)}</button>`).join("")}</div>
      <button class="mm-send">메시지 보내기</button>
      <button class="mm-later">계속 둘러보기</button>
    </div>`;
  const texts = openers(p);
  const go = () => { state.detail = null; state.tab = "chats"; state.chatWith = p.id; close(); render(); };
  el.querySelectorAll(".mm-chip").forEach(b => b.addEventListener("click", () => { queueMessage(p.id, texts[Number(b.dataset.i)]); go(); }));
  el.querySelector(".mm-send").addEventListener("click", go);
  el.querySelector(".mm-later").addEventListener("click", () => { close(); next(); });
  $(".phone-screen").append(el);
  open = el;
  navigator.vibrate?.([20, 60, 30]);
  el.querySelector(".mm-send").focus({ preventScroll: true });
}

function close() {
  open?.remove();
  open = null;
  if (state.tab !== "cards") queue.length = 0; // 대화방으로 갔으면 남은 축하는 접는다
}
