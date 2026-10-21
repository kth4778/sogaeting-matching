// 내 정보 탭
import { esc, meAvatar, meSrc, byId } from "../core/util.js";
import { state, save, resetAll } from "../core/store.js";
import { registerScreen, registerActions, registerOverlay, render, pushRoute, backRoute } from "../core/runtime.js";
import { icon } from "../ui/icons.js";
import { openSheet } from "../ui/sheet.js";
import { toast } from "../ui/toast.js";
import { REDUCE } from "../ui/motion.js";
import { cardHtml } from "./cards.js";
import { startOnboarding } from "./onboarding.js";

const RING_R = 46;
const RING_LEN = 2 * Math.PI * RING_R;

// 완성도: [채워졌나, 비었을 때 힌트, 고칠 단계]
function completeness(m) {
  const items = [
    [!!meSrc(m), "사진을 넣으면 먼저 눈에 띄어요", "photos"],
    [(m.intro ?? "").trim().length >= 20, "소개를 조금 더 써 보세요", "about"],
    [(m.personality ?? "").trim().length >= 10, "성격을 조금 더 알려 주세요", "about"],
    [m.interests.length >= 4, "관심사를 4개 이상 고르면 더 잘 맞춰요", "interests"],
    [!!m.mbti && m.mbti !== "모름", "MBTI를 알려 주면 이유가 더 풍부해져요", "mbti"],
    [!!m.job?.trim(), "하는 일을 알려 주세요", "place"],
  ];
  const done = items.filter(x => x[0]).length;
  return { pct: Math.round((done / items.length) * 100), hint: items.find(x => !x[0]) };
}

const row = (label, value) => `<div class="me-row"><span>${label}</span><b>${value}</b></div>`;
const section = (title, step, body, sub = "") => `
  <section class="me-card">
    <div class="me-card-head"><h4>${title}</h4><button class="me-edit" data-act="me-edit:${step}">수정${icon("chevron-right", 14)}</button></div>
    ${sub ? `<p class="me-card-sub">${sub}</p>` : ""}
    ${body}
  </section>`;

export function profileHtml() {
  const m = state.me;
  const w = m.wants;
  const { pct, hint } = completeness(m);
  const blocked = Object.keys(state.blocked ?? {}).filter(id => state.blocked[id]).length;
  const canInstall = typeof window.openInstallHint === "function" && !matchMedia("(display-mode: standalone)").matches;
  return `
    <div class="appbar"><span>내 정보</span><button class="me-appbar-edit" data-act="edit-profile">편집</button></div>
    <div class="me-top">
      <div class="me-photo">
        <svg class="me-ring" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="${RING_R}" class="me-ring-bg"/><circle cx="50" cy="50" r="${RING_R}" class="me-ring-fg" data-pct="${pct}" stroke-dasharray="${RING_LEN}" stroke-dashoffset="${RING_LEN * (1 - pct / 100)}"/></svg>
        ${meAvatar(m, "me-av big")}
      </div>
      <h3>${esc(m.name)}</h3>
      <p class="me-sub">${esc(m.region)} · ${esc(m.job)}</p>
      <p class="me-pct">프로필 완성도 ${pct}%</p>
      ${hint ? `<p class="me-hint">${hint[1]}</p>` : ""}
      <div class="me-actions">
        <button class="btn line me-btn" data-act="edit-profile">프로필 수정</button>
        <button class="btn line me-btn" data-act="me-preview">미리보기</button>
      </div>
    </div>
    ${section("소개", "about", `<p class="me-text">${esc(m.intro)}</p><p class="me-text sub">${esc(m.personality)}</p>`)}
    ${section("관심사", "interests", `<div class="me-chips">${m.interests.map(t => `<span class="chip">${esc(t)}</span>`).join("")}</div>`)}
    ${section("기본 정보", "body", `
      ${row("성별", m.gender === "남" ? "남자" : "여자")}${row("나이", `${m.age}살`)}${row("키", `${m.height}cm`)}
      ${row("MBTI", m.mbti === "모름" ? "잘 모르겠어요" : m.mbti)}${row("종교", m.religion)}${row("흡연", m.smoking)}${row("음주", m.drinking)}`)}
    ${section("이상형 조건", "wants", `
      ${row("성별", w.gender === "남" ? "남자" : "여자")}${row("나이", `${w.ageMin}~${w.ageMax}살`)}
      ${row("흡연", w.nonSmokerOnly ? "비흡연자만" : "상관없음")}${row("종교", w.religion)}`, "이 조건에 맞는 사람만 추천해요")}
    <section class="me-card me-list">
      ${canInstall ? `<button class="list-row" data-act="me-install"><span>앱으로 설치하기</span>${icon("chevron-right", 16)}</button>` : ""}
      <button class="list-row" data-act="guide-open"><span>사용 방법 보기</span>${icon("chevron-right", 16)}</button>
      <button class="list-row" data-act="me-blocked"><span>차단한 사람</span><em>${blocked}명</em>${icon("chevron-right", 16)}</button>
      <button class="list-row" data-act="me-safety"><span>안전 수칙</span>${icon("chevron-right", 16)}</button>
      <button class="list-row" data-act="me-terms"><span>약관·개인정보 처리방침</span>${icon("chevron-right", 16)}</button>
      <button class="list-row danger" data-act="reset"><span>체험 기록 지우기</span></button>
    </section>
    <p class="me-foot">체험용 데모예요 · 입력한 정보는 이 기기에만 저장돼요</p>`;
}

registerScreen("me", {
  html: profileHtml,
  mount(root) {
    // 완성도 링을 0에서 채운다
    const fg = root.querySelector(".me-ring-fg");
    if (!fg || REDUCE) return;
    fg.animate([{ strokeDashoffset: RING_LEN }, { strokeDashoffset: fg.getAttribute("stroke-dashoffset") }], { duration: 600, easing: "cubic-bezier(.22,1,.36,1)" });
  },
});

// ---------- 미리보기 (상대에게 보이는 카드) ----------
let previewOpen = false;
registerOverlay("me-preview", {
  active: () => previewOpen && !!state.me,
  className: () => "me-preview-mode",
  html: () => `
    <div class="me-preview">
      <div class="me-preview-top"><span>상대에게 이렇게 보여요</span><button class="icon-btn" data-act="me-preview-close" aria-label="닫기">${icon("x")}</button></div>
      <div class="me-preview-card">${cardHtml({ ...state.me, id: "me", photoData: meSrc(state.me) })}</div>
    </div>`,
});

const SAFETY = "처음 만날 때는 사람이 많은 곳에서 낮에 만나요. 연락처·주소·금융 정보는 충분히 알기 전까지 알려 주지 마세요. 불편한 말을 들으면 대화방에서 바로 신고·차단할 수 있어요.";
const TERMS = "체험용 데모 서비스예요. 등장인물과 사진은 모두 AI로 만든 가상 인물이에요. 입력한 프로필·사진·대화는 이 기기의 브라우저에만 저장되고, 「체험 기록 지우기」로 언제든 모두 지울 수 있어요.";

registerActions({
  "edit-profile"() { startOnboarding(true); },
  "me-edit"(step) { startOnboarding(true, step); },
  "me-preview"() {
    if (!meSrc(state.me)) {
      openSheet({
        title: "사진을 넣으면 상대에게 이렇게 보여요",
        actions: [{ label: "사진 추가하기", onTap: () => { startOnboarding(true, "photos"); render(); } }],
      });
      return false;
    }
    previewOpen = true;
    pushRoute("me-preview", () => { previewOpen = false; render(); });
  },
  "me-preview-close"() { backRoute(); return false; },
  "me-install"() { window.openInstallHint?.(); return false; },
  "me-blocked"() {
    const ids = Object.keys(state.blocked ?? {}).filter(id => state.blocked[id]);
    openSheet({
      title: "차단한 사람",
      body: ids.length ? "누르면 차단을 풀어요." : "차단한 사람이 없어요.",
      actions: ids.map(id => ({ label: `${byId(id)?.name ?? id} 차단 풀기`, onTap: () => {
        delete state.blocked[id]; save("blocked"); toast("차단을 풀었어요"); render();
      } })),
      cancel: "닫기",
    });
    return false;
  },
  "me-safety"() { openSheet({ title: "안전 수칙", body: SAFETY, cancel: "닫기" }); return false; },
  "me-terms"() { openSheet({ title: "약관·개인정보 처리방침", body: TERMS, cancel: "닫기" }); return false; },
  reset() {
    openSheet({
      title: "체험 기록을 모두 지울까요?",
      body: "프로필·좋아요·매칭·대화가 모두 사라지고 처음 화면으로 돌아가요.",
      actions: [{ label: "모두 지우기", danger: true, onTap: () => { previewOpen = false; resetAll(); toast("처음부터 다시 시작해요"); render(); } }],
    });
    return false;
  },
});
