// 연애 연습 탭: 위아래로 넘기며 상황을 고르고 → 상대에게 최대 10번 답하고(S·F면 바로 끝) → 연애 대화 보고서
// 피드는 탭 화면, 대화·보고서는 탭바를 가리는 오버레이다. 오버레이는 game 값만으로 다시 그릴 수 있다.
import { esc } from "../core/util.js";
import { state, registerReset } from "../core/store.js";
import { registerScreen, registerOverlay, registerActions, render, pushRoute, backRoute } from "../core/runtime.js";
import { api } from "../core/matching.js";
import { MAX_ANSWERS, slidesFor, outcomeOf } from "../core/practice.js";
import { MOODS } from "../data/practice.js";
import { icon } from "../ui/icons.js";
import { toast } from "../ui/toast.js";
import { openSheet } from "../ui/sheet.js";
import { canSpeak, isMuted, setMuted, speak, stopSpeech, unlockSpeech } from "../ui/speech.js";

const OUTCOME = {
  clear: ["마음이 풀렸어요", "대화 하나로 마음을 돌렸어요"],
  fail: ["대화가 끊겼어요", "상대가 더 이야기하고 싶지 않대요"],
  limit: ["기회를 다 썼어요", "여기까지의 대화를 정리했어요"],
};
const face = (c, mood) => `photos/practice/${c.id}-${mood}.jpg`;

let game = null;       // { situation, character, turns, mood, grade, suggestions, sending, outcome, report, reportError, draft }
let feedTop = 0;       // 다른 탭에 다녀와도 보던 상황에서 이어 간다

const answers = () => game.turns.filter(t => t.from === "me").length;
const lastLine = () => game.turns.findLast(t => t.from === "them").text;
const lastAnswer = () => game.turns.findLast(t => t.from === "me")?.text;

// ---------- 피드 ----------
function slideHtml({ situation: s, character: c }, i) {
  return `
    <section class="pr-slide">
      <div class="pr-photo" style="background-image:url(${face(c, s.mood)})"></div>
      ${i === 0 ? `<span class="pr-hint">${icon("chevron-up", 14)}위로 넘기면 다른 상황</span>` : ""}
      <div class="pr-info">
        <span class="pr-topic">${esc(s.topic)}</span>
        <h2>${esc(s.title)}</h2>
        <p class="pr-scene">${esc(s.scene)}</p>
        <p class="pr-opening"><b>${esc(c.name)} · ${c.age}</b>${esc(s.opening)}</p>
        <button class="btn pr-start" data-act="practice-start:${i}">이 상황 연습하기</button>
      </div>
    </section>`;
}

registerScreen("practice", {
  html: () => `<div class="pr-feed">${slidesFor(state.me.gender).map(slideHtml).join("")}</div>`,
  mount(root) {
    root.classList.add("no-scroll", "pr-screen");
    const feed = root.querySelector(".pr-feed");
    feed.scrollTop = feedTop;
    feed.addEventListener("scroll", () => { feedTop = feed.scrollTop; }, { passive: true });
  },
  patch: () => true,   // 다른 화면 때문에 다시 그려도 피드 위치를 그대로 둔다
});

// ---------- 대화 ----------
function dotsHtml() {
  const used = answers();
  return `<span class="pr-dots" role="img" aria-label="기회 ${MAX_ANSWERS}번 중 ${used}번 사용">${Array.from({ length: MAX_ANSWERS }, (_, i) => `<i class="${i < used ? "on" : ""}"></i>`).join("")}</span>`;
}

function talkHtml() {
  const c = game.character, mine = lastAnswer();
  const over = !!game.outcome;
  return `
    <div class="pr-faces">${MOODS.map(m => `<i class="${m === game.mood ? "on" : ""}" style="background-image:url(${face(c, m)})"></i>`).join("")}</div>
    <div class="pr-top">
      <button class="pr-round" data-act="practice-exit" aria-label="대화 나가기">${icon("x", 20)}</button>
      ${dotsHtml()}
      ${game.grade ? `<span class="pr-grade g-${game.grade}" aria-label="지금 등급 ${game.grade}">${game.grade}</span>` : ""}
      ${canSpeak ? `<button class="pr-round pr-sound${isMuted() ? " off" : ""}" data-act="practice-mute" aria-label="${isMuted() ? "음성 켜기" : "음성 끄기"}">${icon(isMuted() ? "volume-off" : "volume", 20)}</button>` : ""}
    </div>
    <div class="pr-talk">
      ${mine ? `<p class="pr-mine">${esc(mine)}</p>` : ""}
      ${game.sending
        ? `<p class="pr-line pr-wait" role="status" aria-label="${esc(c.name)}의 답을 기다리는 중"><b>${esc(c.name)}</b><span class="pr-typing"><i></i><i></i><i></i></span></p>`
        : `<p class="pr-line" aria-live="polite"><b>${esc(c.name)}</b>${esc(lastLine())}</p>`}
      ${over ? `
        <div class="pr-over">
          <span class="pr-stamp g-${game.grade}">${game.grade}</span>
          <div><b>${OUTCOME[game.outcome][0]}</b><small>${OUTCOME[game.outcome][1]}</small></div>
        </div>
        <button class="btn" data-act="practice-report">연애 대화 보고서 보기</button>`
      : `
        <div class="pr-chips">${game.suggestions.map((s, i) => `<button class="pr-chip" data-act="practice-suggest:${i}"${game.sending ? " disabled" : ""}>${esc(s)}</button>`).join("")}</div>
        <div class="pr-compose">
          <input class="pr-input" aria-label="내 답 쓰기" placeholder="내 답을 직접 써 보세요" maxlength="200" enterkeyhint="send" value="${esc(game.draft)}"${game.sending ? " disabled" : ""}>
          <button class="pr-send" data-act="practice-send" aria-label="보내기"${game.sending ? " disabled" : ""}>${icon("arrow-up", 20)}</button>
        </div>`}
    </div>`;
}

// ---------- 보고서 ----------
function reportHtml() {
  const r = game.report;
  const head = `
    <div class="pr-rhead">
      <span class="pr-stamp big g-${game.grade}">${game.grade}</span>
      <h2>연애 대화 보고서</h2>
      <p>${esc(game.situation.title)} · ${esc(game.character.name)} · 답 ${answers()}번</p>
    </div>`;
  if (game.reportError) return `${head}<div class="pr-rstate"><p>보고서를 만들지 못했어요</p><button class="btn" data-act="practice-report">다시 시도</button></div>`;
  if (!r) return `${head}<div class="pr-rstate" role="status"><span class="pr-typing dark"><i></i><i></i><i></i></span><p>대화를 돌아보는 중이에요</p></div>`;
  return `${head}
    <section class="pr-card"><h3>왜 이 등급일까요</h3><p>${esc(r.summary)}</p></section>
    ${r.good.length ? `<section class="pr-card"><h3>좋은 답</h3>${r.good.map(g => `<blockquote>${esc(g.quote)}</blockquote><p>${esc(g.why)}</p>`).join("")}</section>` : ""}
    ${r.bad.length ? `<section class="pr-card"><h3>아쉬운 답과 더 나은 답</h3>${r.bad.map(b => `<blockquote>${esc(b.quote)}</blockquote><p>${esc(b.why)}</p><p class="pr-better"><b>이렇게 말해 보세요</b>${esc(b.better)}</p>`).join("")}</section>` : ""}
    <div class="pr-actions">
      <button class="btn" data-act="practice-again">같은 상황 다시 하기</button>
      <button class="btn line" data-act="practice-close">다른 상황 보기</button>
    </div>`;
}

registerOverlay("practice", {
  active: () => !!game,
  className: () => `pr-mode ${game.view === "report" ? "report" : "talk"}`,
  html: () => (game.view === "report" ? `<div class="pr-report">${reportHtml()}</div>` : talkHtml()),
  mount(el) {
    const input = el.querySelector(".pr-input");
    if (!input) return;
    input.addEventListener("input", () => { game.draft = input.value; });
    input.addEventListener("keydown", e => {
      if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); send(input.value); }
    });
  },
  unmount() { stopSpeech(); },
});

function begin(situation, character) {
  game = { situation, character, turns: [{ from: "them", text: situation.opening }], mood: situation.mood, grade: null,
    suggestions: situation.suggestions, sending: false, outcome: null, report: null, reportError: false, draft: "", view: "talk" };
  unlockSpeech();
  speak(situation.opening, character.gender);
}

async function send(raw) {
  const text = raw.trim();
  if (!text || !game || game.sending || game.outcome) return;
  const g = game;
  g.turns.push({ from: "me", text });
  g.draft = ""; g.sending = true;
  stopSpeech();
  render();
  try {
    const res = await api("/api/practice", { situationId: g.situation.id, characterId: g.character.id, me: { name: state.me.name }, turns: g.turns });
    if (game !== g) return;    // 기다리는 사이 나갔다
    g.turns.push({ from: "them", text: res.reply });
    Object.assign(g, { mood: res.mood, grade: res.grade, suggestions: res.suggestions.slice(0, 3), outcome: outcomeOf(res.grade, answers()) });
    speak(res.reply, g.character.gender);
    if (g.outcome) loadReport(g);
  } catch {
    if (game !== g) return;
    g.turns.pop();             // 실패한 답은 기회로 치지 않고 입력칸에 돌려준다
    g.draft = text;
    toast("답을 받지 못했어요. 다시 보내 주세요");
  }
  g.sending = false;
  render();
}

// 대화가 끝나는 순간 미리 만들어 둔다. 보고서를 열었을 때 기다림이 짧아진다
async function loadReport(g) {
  g.reportError = false; g.loading = true;
  try {
    const { summary, good, bad } = await api("/api/practice-report", { situationId: g.situation.id, characterId: g.character.id, grade: g.grade, turns: g.turns });
    g.report = { summary, good, bad };
  } catch {
    g.reportError = true;
  }
  g.loading = false;
  if (game === g) render();
}

function close() { game = null; stopSpeech(); render(); }

registerActions({
  "practice-start"(arg) {
    const { situation, character } = slidesFor(state.me.gender)[+arg];
    begin(situation, character);
    pushRoute("practice", close);
  },
  "practice-send"() {
    send(document.querySelector(".pr-input")?.value ?? "");
    return false;
  },
  "practice-suggest"(arg) {
    send(game.suggestions[+arg]);
    return false;
  },
  "practice-mute"() {
    setMuted(!isMuted());
    if (!isMuted() && !game.sending) speak(lastLine(), game.character.gender);
  },
  "practice-report"() {
    game.view = "report";
    stopSpeech();
    if (!game.report && !game.loading) loadReport(game);
  },
  "practice-again"() {
    begin(game.situation, game.character);
  },
  "practice-close"() { backRoute(); return false; },
  "practice-exit"() {
    if (game.outcome || !answers()) { backRoute(); return false; }
    openSheet({
      title: "대화를 그만할까요?", body: "지금까지의 대화는 저장되지 않아요",
      actions: [{ label: "그만하기", danger: true, onTap: () => close() }], cancel: "계속하기",
    });
    return false;
  },
});

registerReset(() => { game = null; feedTop = 0; });
