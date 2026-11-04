// 연애 연습 탭: 쇼츠 피드(위아래로 넘겨 상황 고르기) → 대화 전 안내(할 일·상황·미션) → 대화(턴·기분·미션, 최대 10번) → 연애 대화 보고서
// 피드는 탭 화면, 나머지는 탭바를 가리는 오버레이다. 오버레이는 game 값만으로 다시 그릴 수 있다.
import { esc } from "../core/util.js";
import { state, load, save, registerReset } from "../core/store.js";
import { registerScreen, registerOverlay, registerActions, render, pushRoute, backRoute } from "../core/runtime.js";
import { api } from "../core/matching.js";
import { MAX_ANSWERS, slidesFor, outcomeOf, moodLabel } from "../core/practice.js";
import { MOODS } from "../data/practice.js";
import { icon } from "../ui/icons.js";
import { toast } from "../ui/toast.js";
import { openSheet } from "../ui/sheet.js";
import { canSpeak, isMuted, setMuted, speak, stopSpeech, unlockSpeech } from "../ui/speech.js";

const OUTCOME = {
  clear: ["마음이 풀렸어요", "대화로 마음을 돌렸어요"],
  fail: ["대화가 끊겼어요", "상대가 더 이야기하고 싶지 않대요"],
  limit: ["기회를 다 썼어요", "여기까지의 대화를 정리했어요"],
};
const MOOD_NAME = { calm: "평온", happy: "기쁨", hurt: "서운함", angry: "화남", moved: "감동" };
const face = (c, mood) => `photos/practice/${c.id}-${mood}.jpg`;
const scene = (s, c) => `photos/practice/scenes/${s.id}-${c.id}.jpg`;

let game = null;       // { situation, character, view, turns, mood, score, done, grade, suggestions, showTips, sending, outcome, report, reportError, draft }
let topic = "전체";
let feedTop = 0;       // 다른 탭에 다녀와도 보던 상황에서 이어 간다
let saved = load("practice-saved", []);
const SAVED = "저장";

const answers = () => game.turns.filter(t => t.from === "me").length;
const lastLine = () => game.turns.findLast(t => t.from === "them").text;
const lastAnswer = () => game.turns.findLast(t => t.from === "me")?.text;
const slides = () => slidesFor(state.me.gender);
const slideOf = id => slides().find(x => x.situation.id === id);

// ---------- 쇼츠 피드 ----------
const visible = () => slides().filter(({ situation: s }) => (topic === "전체" ? true : topic === SAVED ? saved.includes(s.id) : s.topic === topic));

function slideHtml({ situation: s, character: c }) {
  const on = saved.includes(s.id);
  return `
    <section class="pr-slide">
      <i class="pr-photo" style="background-image:url(${scene(s, c)})"></i>
      <div class="pr-bubble">
        <b>${esc(c.name)}</b>
        <p>${esc(s.opening)}</p>
        ${canSpeak ? `<button class="pr-listen" data-act="practice-listen:${s.id}">${icon("volume", 14)}탭해서 듣기</button>` : ""}
      </div>
      <div class="pr-info">
        <h2>${esc(s.title)}</h2>
        <p class="pr-tag">#${esc(s.topic)}</p>
        <p class="pr-mission">${icon("target", 20)}<span>${esc(s.goal)}</span></p>
        <div class="pr-cta">
          <button class="pr-heart${on ? " on" : ""}" data-act="practice-save:${s.id}" aria-pressed="${on}" aria-label="상황 저장">${icon(on ? "heart-fill" : "heart", 24)}</button>
          <button class="pr-yellow" data-act="practice-open:${s.id}">플레이하기 ${icon("play", 18)}</button>
        </div>
      </div>
    </section>`;
}

const feedHtml = () => visible().map(slideHtml).join("") || `<section class="pr-slide pr-none"><p>저장한 상황이 없어요<br>마음에 드는 상황에서 하트를 눌러 보세요</p></section>`;
const soundIcon = () => icon(isMuted() ? "volume-off" : "volume", 20);

function shellHtml() {
  const topics = ["전체", ...new Set(slides().map(x => x.situation.topic)), SAVED];
  return `
    <div class="pr-shell">
      <div class="pr-feedtop">
        <h1>연애 연습</h1>
        ${canSpeak ? `<button class="pr-round pr-feedsound" data-act="practice-mute" aria-label="상대 음성 끄기" aria-pressed="${isMuted()}">${soundIcon()}</button>` : ""}
        <div class="pr-topics" role="tablist">${topics.map(t => `<button role="tab" aria-selected="${t === topic}" class="${t === topic ? "on" : ""}" data-act="practice-topic:${esc(t)}">${esc(t)}</button>`).join("")}</div>
      </div>
      <div class="pr-feed">${feedHtml()}</div>
    </div>`;
}

registerScreen("practice", {
  html: shellHtml,
  mount(root) {
    root.classList.add("no-scroll", "pr-screen");
    const feed = root.querySelector(".pr-feed");
    feed.scrollTop = feedTop;
    let slide = Math.round(feedTop / (feed.clientHeight || 1));
    feed.addEventListener("scroll", () => {
      feedTop = feed.scrollTop;
      const now = Math.round(feedTop / (feed.clientHeight || 1));
      if (now !== slide) { slide = now; stopSpeech(); }   // 다음 상황으로 넘기면 읽던 대사를 멈춘다
    }, { passive: true });
  },
  unmount() { stopSpeech(); },
  patch: () => true,   // 다른 화면 때문에 다시 그려도 피드 위치를 그대로 둔다
});

// ---------- 대화 전 안내 ----------
function missionRows(done = []) {
  return game.situation.missions.map((m, i) => `
    <li class="${done.includes(i) ? "done" : ""}"><span class="pr-check">${done.includes(i) ? icon("check", 14) : ""}</span>${esc(m.text)}${m.required ? " <em>필수</em>" : ""}</li>`).join("");
}

function briefHtml() {
  const { situation: s, character: c } = game;
  const row = (ic, label, text) => `<div class="pr-fact"><span>${icon(ic, 18)}${label}</span><p>${esc(text)}</p></div>`;
  return `
    <div class="pr-brief">
      <div class="pr-hero" style="background-image:url(${scene(s, c)})">
        <button class="pr-round" data-act="practice-close" aria-label="뒤로">${icon("arrow-left", 20)}</button>
        <div class="pr-nametag"><b>${esc(c.name)}</b><small>연인 · ${c.age}살</small></div>
        <p class="pr-herosay">${esc(s.opening)}</p>
      </div>
      <div class="pr-briefbody">
        <h3>이번에 할 일</h3>
        <p class="pr-goal">${esc(s.goal)}</p>
        <h3>지금 상황</h3>
        ${row("message", "상황", s.scene)}
        ${row("user", "내 역할", s.role)}
        ${row("heart", "상대", `${c.name}, ${c.age}살 연인 · 지금 기분: ${MOOD_NAME[s.mood]}`)}
        ${row("map-pin", "장소", s.place)}
        <h3>이번 미션</h3>
        <ul class="pr-missions">${missionRows()}</ul>
      </div>
      <div class="pr-briefcta"><button class="pr-yellow" data-act="practice-go">시작하기 ${icon("play", 18)}</button></div>
    </div>`;
}

// ---------- 대화 ----------
function talkHtml() {
  const c = game.character, mine = lastAnswer(), over = !!game.outcome;
  const turn = over ? answers() : answers() + 1;   // 끝난 뒤에는 실제로 답한 횟수
  return `
    <div class="pr-faces">${MOODS.map(m => `<i class="${m === game.mood ? "on" : ""}" style="background-image:url(${face(c, m)})"></i>`).join("")}</div>
    <div class="pr-hud">
      <button class="pr-round" data-act="practice-exit" aria-label="대화 끝내기">${icon("x", 20)}</button>
      <span class="pr-pill" aria-label="턴 ${turn} / ${MAX_ANSWERS}">턴 <b>${turn}</b> <small>/ ${MAX_ANSWERS}</small></span>
      <span class="pr-pill pr-moodpill" aria-label="기분 ${moodLabel(game.score)}">기분 <span class="pr-gauge"><i style="width:${game.score}%"></i></span><b>${moodLabel(game.score)}</b></span>
    </div>
    <div class="pr-talk">
      ${mine ? `<p class="pr-mine">${esc(mine)}</p>` : ""}
      <div class="pr-dialog">
        <b>${esc(c.name)}</b>
        ${game.sending
          ? `<p role="status" aria-label="${esc(c.name)}의 답을 기다리는 중"><span class="pr-typing"><i></i><i></i><i></i></span></p>`
          : `<p aria-live="polite">${esc(lastLine())}</p>`}
        ${canSpeak ? `<div class="pr-dialogtools">
          <button data-act="practice-replay"${game.sending ? " disabled" : ""}>${icon("volume", 16)}듣기</button>
          <button data-act="practice-mute" aria-pressed="${isMuted()}">${icon(isMuted() ? "volume-off" : "volume", 16)}${isMuted() ? "음성 꺼짐" : "음성 켜짐"}</button>
        </div>` : ""}
      </div>
      ${over ? `
        <div class="pr-over"><span class="pr-stamp g-${game.grade}">${game.grade}</span><div><b>${OUTCOME[game.outcome][0]}</b><small>${OUTCOME[game.outcome][1]}</small></div></div>
        <button class="pr-yellow" data-act="practice-report">연애 대화 보고서 보기</button>`
      : `
        <button class="pr-missionchip" data-act="practice-missions">미션 ${game.done.length}/${game.situation.missions.length}, 목표와 조건 보기</button>
        ${game.showTips ? `<div class="pr-chips">${game.suggestions.map((s, i) => `<button class="pr-chip" data-act="practice-suggest:${i}"${game.sending ? " disabled" : ""}>${esc(s)}</button>`).join("")}</div>` : ""}
        <div class="pr-compose">
          <button class="pr-tool${game.showTips ? " on" : ""}" data-act="practice-tips" aria-expanded="${game.showTips}" aria-label="추천 답 보기">${icon("sparkle", 22)}</button>
          <input class="pr-input" aria-label="내 답 쓰기" placeholder="내 답을 입력하세요" maxlength="200" enterkeyhint="send" value="${esc(game.draft)}"${game.sending ? " disabled" : ""}>
          <button class="pr-send" data-act="practice-send" aria-label="보내기"${game.sending ? " disabled" : ""}>${icon("arrow-up", 22)}</button>
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
    </div>
    <section class="pr-card"><h3>미션 ${game.done.length}/${game.situation.missions.length}</h3><ul class="pr-missions">${missionRows(game.done)}</ul></section>`;
  if (game.reportError) return `${head}<div class="pr-rstate"><p>보고서를 만들지 못했어요</p><button class="pr-yellow" data-act="practice-report">다시 시도</button></div>`;
  if (!r) return `${head}<div class="pr-rstate" role="status"><span class="pr-typing"><i></i><i></i><i></i></span><p>대화를 돌아보는 중이에요</p></div>`;
  return `${head}
    <section class="pr-card"><h3>왜 이 등급일까요</h3><p>${esc(r.summary)}</p></section>
    ${r.good.length ? `<section class="pr-card"><h3>좋은 답</h3>${r.good.map(g => `<blockquote>${esc(g.quote)}</blockquote><p>${esc(g.why)}</p>`).join("")}</section>` : ""}
    ${r.bad.length ? `<section class="pr-card"><h3>아쉬운 답과 더 나은 답</h3>${r.bad.map(b => `<blockquote>${esc(b.quote)}</blockquote><p>${esc(b.why)}</p><p class="pr-better"><b>이렇게 말해 보세요</b>${esc(b.better)}</p>`).join("")}</section>` : ""}
    <div class="pr-actions">
      <button class="pr-yellow" data-act="practice-again">같은 상황 다시 하기</button>
      <button class="pr-plain" data-act="practice-close">다른 상황 보기</button>
    </div>`;
}

const VIEWS = { brief: briefHtml, talk: talkHtml, report: () => `<div class="pr-report">${reportHtml()}</div>` };

registerOverlay("practice", {
  active: () => !!game,
  className: () => `pr-mode v-${game.view}`,
  html: () => VIEWS[game.view](),
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

function setup(situation, character) {
  game = { situation, character, view: "brief", turns: [{ from: "them", text: situation.opening }], mood: situation.mood, score: situation.startScore, done: [],
    grade: null, suggestions: situation.suggestions, showTips: false, sending: false, outcome: null, report: null, reportError: false, draft: "" };
}

async function send(raw) {
  const text = raw.trim();
  if (!text || !game || game.sending || game.outcome) return;
  const g = game;
  g.turns.push({ from: "me", text });
  g.draft = ""; g.sending = true; g.showTips = false;
  stopSpeech();
  render();
  try {
    const res = await api("/api/practice", { situationId: g.situation.id, characterId: g.character.id, me: { name: state.me.name }, turns: g.turns, done: g.done });
    if (game !== g) return;    // 기다리는 사이 나갔다
    g.turns.push({ from: "them", text: res.reply });
    Object.assign(g, { mood: res.mood, score: res.moodScore, done: res.missionsDone, grade: res.grade, suggestions: res.suggestions.slice(0, 3), outcome: outcomeOf(res.grade, answers()) });
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

function paintFeedSound() {
  const b = document.querySelector(".pr-feedsound");
  if (!b) return;
  b.innerHTML = soundIcon();
  b.setAttribute("aria-pressed", isMuted());
}

registerActions({
  "practice-open"(id) {
    const { situation, character } = slideOf(id);
    stopSpeech();
    setup(situation, character);
    pushRoute("practice", close);
  },
  "practice-topic"(arg) {
    topic = arg; feedTop = 0;
    stopSpeech();
    const root = document.querySelector("#screen");
    root.querySelectorAll(".pr-topics button").forEach(b => {
      const on = b.textContent === topic;
      b.classList.toggle("on", on);
      b.setAttribute("aria-selected", on);
    });
    const feed = root.querySelector(".pr-feed");
    feed.innerHTML = feedHtml();
    feed.scrollTop = 0;
    return false;
  },
  "practice-listen"(id) {
    const { situation, character } = slideOf(id);
    if (isMuted()) { setMuted(false); paintFeedSound(); }
    unlockSpeech();
    speak(situation.opening, character.gender);
    return false;
  },
  "practice-save"(id, el) {
    saved = saved.includes(id) ? saved.filter(x => x !== id) : [...saved, id];
    save("practice-saved", saved);
    const on = saved.includes(id);
    el.classList.toggle("on", on);
    el.setAttribute("aria-pressed", on);
    el.innerHTML = icon(on ? "heart-fill" : "heart", 24);
    return false;
  },
  "practice-go"() {
    game.view = "talk";
    unlockSpeech();
    speak(game.situation.opening, game.character.gender);
  },
  "practice-send"() {
    send(document.querySelector(".pr-input")?.value ?? "");
    return false;
  },
  "practice-suggest"(arg) {
    send(game.suggestions[+arg]);
    return false;
  },
  "practice-tips"() { game.showTips = !game.showTips; },
  "practice-replay"() {
    if (isMuted()) setMuted(false);
    speak(lastLine(), game.character.gender);
  },
  "practice-mute"() {
    setMuted(!isMuted());
    paintFeedSound();
    return !game ? false : undefined;   // 피드는 다시 그리지 않고, 대화 화면만 다시 그린다
  },
  "practice-missions"() {
    openSheet({
      title: "목표와 미션",
      body: `<p class="pr-sheetgoal">${esc(game.situation.goal)}</p><ul class="pr-missions">${missionRows(game.done)}</ul>`,
      actions: [], cancel: "확인",
    });
    return false;
  },
  "practice-report"() {
    game.view = "report";
    stopSpeech();
    if (!game.report && !game.loading) loadReport(game);
  },
  "practice-again"() {
    setup(game.situation, game.character);
  },
  "practice-close"() { backRoute(); return false; },
  "practice-exit"() {
    if (game.outcome || !answers()) { backRoute(); return false; }
    openSheet({
      title: "대화를 끝낼까요?", body: "지금까지의 대화는 저장되지 않아요",
      actions: [{ label: "끝내기", danger: true, onTap: () => close() }], cancel: "계속하기",
    });
    return false;
  },
});

registerReset(() => { game = null; topic = "전체"; feedTop = 0; saved = []; });
