// 신고·차단: 더 보기 시트 → 신고 사유 또는 차단 확인 → 저장
import { byId, esc } from "../core/util.js";
import { state, save } from "../core/store.js";
import { render } from "../core/runtime.js";
import { openSheet } from "../ui/sheet.js";
import { toast } from "../ui/toast.js";
import { icon } from "../ui/icons.js";

const REASONS = ["부적절한 사진", "욕설·불쾌한 메시지", "스팸·외부 메신저 유도", "금전 요구·사기 의심", "미성년자로 보여요", "기타"];
const ART = `<img class="safety-art" src="art/safety.jpg" alt="">`;

export function isBlocked(id) { return !!state.blocked[id]; }

export function openSafety(id) {
  const p = byId(id);
  if (!p) return;
  openSheet({
    title: `${p.name}님`,
    body: `${ART}<span class="safety-note">불편한 점이 있었다면 알려 주세요</span>`,
    actions: [
      { label: "신고하기", onTap: () => openReport(id) },
      { label: "차단하기", danger: true, onTap: () => confirmBlock(id, "차단") },
    ],
  });
}

function openReport(id) {
  let picked = null;
  openSheet({
    title: "신고 사유를 골라 주세요",
    body: `<span class="safety-list" role="radiogroup" aria-label="신고 사유">${REASONS.map((r, i) =>
      `<span class="safety-row" role="radio" aria-checked="false" tabindex="0" data-r="${i}"><span>${esc(r)}</span><span class="safety-check">${icon("check", 20)}</span></span>`).join("")}</span>`,
    actions: [{ label: "신고하고 차단하기", danger: true, onTap: () => block(id, REASONS[picked]) }],
  });
  const sheet = document.querySelector(".sheet");
  const submit = sheet?.querySelector("[data-i='0']");
  if (!sheet || !submit) return;
  submit.disabled = true;
  const pick = row => {
    picked = Number(row.dataset.r);
    sheet.querySelectorAll(".safety-row").forEach(r => r.setAttribute("aria-checked", String(r === row)));
    submit.disabled = false;
  };
  sheet.querySelectorAll(".safety-row").forEach(row => {
    row.addEventListener("click", () => pick(row));
    row.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(row); } });
  });
}

function confirmBlock(id, reason) {
  openSheet({
    title: `${byId(id).name}님을 차단할까요?`,
    body: `<span class="safety-note">차단하면 서로의 프로필이 보이지 않고 대화도 끊겨요</span>`,
    actions: [{ label: "차단하기", danger: true, onTap: () => block(id, reason) }],
  });
}

function block(id, reason) {
  state.blocked[id] = reason;
  state.matches = state.matches.filter(m => m !== id);
  delete state.chats[id];
  ["blocked", "matches", "chats"].forEach(k => save(k, state[k]));
  if (state.detail === id) state.detail = null;
  if (state.chatWith === id) state.chatWith = null;
  toast("차단했어요. 서로 다시 보이지 않아요");
  render();
}
