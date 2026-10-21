// 메시지 탭: 목록 · 대화방
import { $, byId, photo, esc, sleep } from "../core/util.js";
import { state, save } from "../core/store.js";
import { registerScreen, registerActions, render, pushRoute, backRoute } from "../core/runtime.js";
import { api } from "../core/matching.js";
import { debug } from "../core/log.js";
import { josa } from "../core/engine.js";
import { toast } from "../ui/toast.js";
import { showNotice } from "../ui/notice.js";
import { openSheet } from "../ui/sheet.js";
import { icon } from "../ui/icons.js";
import { REDUCE, DUR, EASE } from "../ui/motion.js";
import { openSafety, isBlocked } from "../features/safety.js";

// ---------- 채팅 ----------
// 내가 보낸 메시지는 바로 상대에게 넘긴다. 답장을 기다리는 동안 보낸 메시지는 모아 두었다가 답장 직후 한 번에 넘긴다.
// 상대가 답장을 쓰는 중에도 계속 보낼 수 있다.
export const CHAT_IDLE_MS = 0; // 보내면 바로 넘긴다 (답장 대기 중에 보낸 것은 답장 직후 이어서 보냄)
export const chatRuntime = {}; // 대화방 id -> { timer, inflight, lastSentAt }
const TYPING_SHOW_MS = 300;    // 보낸 뒤 입력 중 표시가 뜨기까지 (화면 연출, 요청은 늦추지 않음)
const TYPING_MIN_MS = 600;     // 입력 중 표시가 뜨면 최소 이만큼은 보인다
const GROUP_MS = 60_000;       // 같은 사람이 이 안에 이어 보내면 한 묶음
const NEAR_BOTTOM = 80;

// 옛 기록에는 at이 없다: 순서대로 1분씩 앞선 시각을 채운다
let lastAt = 0;
for (const list of Object.values(state.chats)) {
  list.forEach((m, i) => { m.at ??= Date.now() - (list.length - i) * 60000; lastAt = Math.max(lastAt, m.at); });
}
save("chats", state.chats);
// at은 메시지 식별자로도 쓰므로 겹치지 않게 만든다
const nextAt = () => (lastAt = Math.max(Date.now(), lastAt + 1));

export function queueMessage(id, text) {
  const history = (state.chats[id] ??= []);
  const m = { from: "me", text, at: nextAt(), pending: true };
  history.push(m);
  save("chats", state.chats);
  debug("채팅", `나 → ${byId(id).name}: ${text}`);
  const rt = (chatRuntime[id] ??= {});
  rt.lastSentAt = Date.now();
  scheduleFlush(id);
  if (!appendBubble(id, m)) render();
}

export function scheduleFlush(id) {
  const rt = chatRuntime[id];
  clearTimeout(rt.timer);
  if (rt.inflight) return; // 답장이 오고 나서 다시 잡는다
  const wait = Math.max(0, CHAT_IDLE_MS - (Date.now() - rt.lastSentAt));
  rt.timer = setTimeout(() => flushChat(id), wait);
}

// 맨 끝에 이어진 「내 메시지」 개수 = 아직 답장을 못 받은 메시지
export function unanswered(history) {
  let n = 0;
  for (let i = history.length - 1; i >= 0 && history[i].from === "me"; i--) n++;
  return n;
}

const inRoom = id => state.tab === "chats" && state.chatWith === id && !!$("#msgs");

export async function flushChat(id) {
  const rt = chatRuntime[id];
  const p = byId(id);
  const history = state.chats[id];
  if (!history) return;
  const count = unanswered(history);
  if (!count || state.ended[id]) return;

  rt.inflight = true;
  // 요청을 보내는 순간 읽음 「1」을 지운다
  history.slice(-count).forEach(m => { delete m.pending; delete m.failed; });
  if (inRoom(id)) {
    document.querySelectorAll("#msgs .read, #msgs .m-fail").forEach(n => n.remove());
    document.querySelectorAll("#msgs .m.failed").forEach(n => n.classList.remove("failed"));
  }
  if (count > 1) debug(`답장을 기다리는 동안 보낸 메시지 ${count}개를 묶어서 보냄`);
  let shownAt = 0;
  const typingTimer = setTimeout(() => { if (inRoom(id)) { setTyping(true); shownAt = Date.now(); } }, TYPING_SHOW_MS);
  const answeredUpTo = history.length;
  try {
    const res = await api("/api/chat", { me: state.me, partner: p, history: history.slice(0, answeredUpTo) });
    clearTimeout(typingTimer);
    if (shownAt) await sleep(Math.max(0, TYPING_MIN_MS - (Date.now() - shownAt)));
    if (state.chats[id] !== history) return; // 기다리는 동안 대화방이 지워졌다
    const reply = { from: "them", text: res.reply, at: nextAt() };
    // history는 답장이 가리키는 묶음 바로 뒤에 넣는다(대화 순서). 화면은 at 순서
    history.splice(answeredUpTo, 0, reply);
    debug(`${p.name} 답장 (${(res.ms / 1000).toFixed(1)}초): ${res.reply}`);
    const here = inRoom(id);
    if (here) { setTyping(false); appendBubble(id, reply); }
    else {
      state.unread[id] = (state.unread[id] ?? 0) + 1;
      save("unread", state.unread);
      showNotice({ avatar: photo(p), title: esc(p.name), text: esc(res.reply), act: `chat:${id}` });
    }
    if (res.leave) {
      state.ended[id] = res.reason;
      save("ended", state.ended);
      const note = { from: "sys", text: `${p.name}님이 대화방을 나갔어요`, at: nextAt() };
      history.splice(answeredUpTo + 1, 0, note);
      if (here) { appendBubble(id, note); setEnded(); }
      debug(`대화 종료 — ${res.reason}`);
    } else debug(`대화 계속 — ${res.reason}`);
  } catch (err) {
    clearTimeout(typingTimer);
    if (inRoom(id)) setTyping(false);
    history.slice(answeredUpTo - count, answeredUpTo).forEach(m => { m.failed = true; });
    if (err.message === "rate") toast("너무 빨리 보내고 있어요. 잠시 후 다시 보내 주세요");
    debug(`실패: ${err.message}`);
    rt.inflight = false;
    save("chats", state.chats);
    dirty = true; // 실패 표시는 방을 한 번 다시 그린다(드묾)
    render();
    return;
  }
  rt.inflight = false;
  save("chats", state.chats);
  if (!inRoom(id)) render();
  // 답장을 기다리는 동안 더 보낸 메시지가 있으면 바로 이어서 보낸다
  if (!state.ended[id] && unanswered(history)) scheduleFlush(id);
}

// 안 읽은 답장 수 합
export function unreadTotal() { return Object.values(state.unread).reduce((a, b) => a + (b || 0), 0); }

// ---------- 시간 표시 ----------
const hm = new Intl.DateTimeFormat("ko-KR", { hour: "numeric", minute: "2-digit" });
const md = new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "long" });
const dayKey = t => new Date(t).toDateString();
function listTime(t) {
  const now = Date.now();
  if (now - t < 60_000) return "방금";
  if (dayKey(t) === dayKey(now)) return hm.format(t);
  if (dayKey(t) === dayKey(now - 86_400_000)) return "어제";
  return new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric" }).format(t);
}

// ---------- 목록 ----------
const realMsgs = id => (state.chats[id] ?? []).filter(m => m.from !== "sys");

function emptyHtml() {
  return `<div class="appbar"><span>메시지</span></div>
    <div class="chat-empty">
      <img src="art/empty-chat.jpg" alt="" width="160" height="160">
      <h3>아직 대화가 없어요</h3>
      <p>오늘의 매칭에서 바로 대화하거나<br>카드에서 서로 좋아요를 누르면 대화방이 열려요</p>
      <button class="btn" data-act="tab:home">오늘의 매칭 보기</button>
      <button class="chat-textbtn" data-act="tab:cards">카드 보러 가기</button>
    </div>`;
}

function rowHtml(id) {
  const p = byId(id);
  const msgs = realMsgs(id);
  const last = msgs.at(-1);
  const ended = !!state.ended[id];
  const unread = state.unread[id] ?? 0;
  let sub = ended ? "대화가 종료되었어요" : last.from === "me" ? `나: ${esc(last.text)}` : esc(last.text);
  if (!ended && last.failed) sub = `<span class="fail">전송 실패</span>`;
  return `<button class="crow${ended ? " ended" : ""}" data-act="chat:${id}">
    <span class="crow-av photo" style="background-image:url(${photo(p)})"></span>
    <span class="crow-main"><b>${esc(p.name)}</b><small>${sub}</small></span>
    <span class="crow-side"><time>${listTime(last.at)}</time>
      ${unread ? `<span class="crow-badge">${unread}</span>` : !ended && last.from === "them" ? `<span class="crow-turn">내 차례</span>` : ""}</span>
  </button>`;
}

function listHtml() {
  const ids = state.matches.filter(id => byId(id) && !isBlocked(id));
  if (!ids.length) return emptyHtml();
  const fresh = ids.filter(id => !realMsgs(id).length && !state.ended[id]);
  const talking = ids.filter(id => realMsgs(id).length || state.ended[id])
    .sort((a, b) => (!!state.ended[a] - !!state.ended[b]) || ((realMsgs(b).at(-1)?.at ?? 0) - (realMsgs(a).at(-1)?.at ?? 0)));
  return `<div class="appbar"><span>메시지</span></div>
    ${fresh.length ? `<section class="new-matches"><h4>새로운 매칭</h4><div class="nm-scroll">${fresh.map(id => {
      const p = byId(id);
      return `<button class="nm" data-act="chat:${id}"><span class="nm-av photo" style="background-image:url(${photo(p)})"></span><span>${esc(p.name)}</span></button>`;
    }).join("")}</div></section>` : ""}
    <div class="chat-list">${talking.map(rowHtml).join("")}</div>`;
}

// ---------- 대화방 ----------
const ranked = id => state.result?.ranked?.find(r => r.id === id);
const scoreFor = id => ranked(id)?.llmScore ?? null;

function sharedOf(p) {
  const mine = state.me?.interests ?? [];
  return p.interests.filter(x => mine.includes(x));
}
let chips = [];
function startHtml(p) {
  const shared = sharedOf(p);
  const topic = shared[0] ?? p.interests[0];
  chips = [
    `${josa(topic, "을/를")} 좋아하신다고 봤어요! 요즘도 자주 하세요?`,
    `${p.region}에서 자주 가는 곳 있으세요?`,
    `처음 만나면 ${p.interests[1] ?? p.interests[0]} 얘기부터 해 보고 싶어요`,
  ];
  const score = scoreFor(p.id);
  const line = ranked(p.id)?.oneLine ?? p.intro;
  return `<div class="chat-start" id="chat-start">
    <img class="cs-art" src="art/chat-start.jpg" alt="" width="120" height="120">
    <div class="cs-card">
      <span class="cs-av photo" style="background-image:url(${photo(p)})"></span>
      <b>${esc(p.name)} ${p.age}</b>
      ${score !== null ? `<span class="cs-score">궁합 ${score}점</span>` : ""}
      <q>${esc(line)}</q>
    </div>
    <small>이렇게 시작해 보세요</small>
    <div class="cs-chips">${chips.map((c, i) => `<button class="cs-chip" data-act="chat-chip:${i}">${esc(c)}</button>`).join("")}</div>
  </div>`;
}

// prev/next: 화면 순서로 앞뒤 메시지
function msgHtml(m, prev, next) {
  if (m.from === "sys") return `<span class="sys-note" data-at="${m.at}">${esc(m.text)}</span>`;
  const dateSep = !prev || dayKey(prev.at) !== dayKey(m.at) ? `<span class="date-pill">${md.format(m.at)}</span>` : "";
  const contPrev = prev && prev.from === m.from && m.at - prev.at < GROUP_MS && !dateSep;
  const contNext = next && next.from === m.from && next.at - m.at < GROUP_MS && dayKey(next.at) === dayKey(m.at);
  const p = byId(state.chatWith);
  const av = m.from === "them" ? (contPrev ? `<span class="m-av"></span>` : `<span class="m-av photo" style="background-image:url(${photo(p)})"></span>`) : "";
  const fail = m.failed ? `<button class="m-fail" data-act="chat-fail:${m.at}" aria-label="전송 실패">!</button>` : "";
  return `${dateSep}<div class="m ${m.from}${contPrev ? " cont" : ""}${contNext ? " more" : ""}${m.failed ? " failed" : ""}" data-at="${m.at}">
    ${av}${fail}<div class="bubble ${m.from}">${esc(m.text)}</div>
    <span class="m-meta">${m.pending ? `<i class="read">1</i>` : ""}<time>${hm.format(m.at)}</time></span>
  </div>`;
}

const sorted = id => [...(state.chats[id] ?? [])].sort((a, b) => a.at - b.at);

function composerHtml() {
  return `<form class="composer" id="composer">
    <textarea name="text" rows="1" enterkeyhint="send" maxlength="500" placeholder="메시지 보내기" autocomplete="off"></textarea>
    <span class="cnt" hidden></span>
    <button class="send" aria-label="보내기" disabled>${icon("arrow-up", 18)}</button>
  </form>`;
}
function endedHtml() {
  return `<div class="ended-bar"><span>대화가 종료된 채팅방이에요</span><button data-act="chat-delete">삭제</button></div>`;
}

export function roomHtml() {
  const p = byId(state.chatWith);
  const msgs = [...(state.chats[p.id] ?? [])].sort((a, b) => a.at - b.at);
  const score = scoreFor(p.id);
  const empty = !msgs.some(m => m.from !== "sys");
  return `
    <div class="room">
      <div class="room-head">
        <button class="rh-btn" data-act="back-chats" aria-label="뒤로">${icon("arrow-left")}</button>
        <button class="rh-who" data-act="detail:${p.id}">
          <span class="rh-av photo" style="background-image:url(${photo(p)})"></span>
          <span class="rh-txt"><b>${esc(p.name)} <em class="ai-tag">AI</em></b><small>${score !== null ? `궁합 ${score}점 · ` : ""}${esc(p.region)}</small></span>
        </button>
        <button class="rh-btn" data-act="chat-more" aria-label="더 보기">${icon("more")}</button>
      </div>
      <div class="msgs" id="msgs">
        <span class="sys-note">${esc(p.name)}님과 대화가 열렸어요</span>
        <span class="sys-note">체험용 상대예요 · 답장은 AI가 ${esc(p.name)}님 프로필대로 써요</span>
        <div class="safety-tip">만나기 전 연락처·송금 요구는 거절하세요</div>
        ${empty && !state.ended[p.id] ? startHtml(p) : ""}
        ${msgs.map((m, i) => msgHtml(m, msgs[i - 1], msgs[i + 1])).join("")}
      </div>
      <button class="new-msg" id="new-msg" hidden>새 메시지 ${icon("arrow-down", 16)}</button>
      <div id="composer-slot">${state.ended[p.id] ? endedHtml() : composerHtml()}</div>
    </div>`;
}

export function chatsHtml() {
  return state.chatWith ? roomHtml() : listHtml();
}

// ---------- 방 부분 갱신 ----------
const nearBottom = el => el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM;
function toBottom(smooth) {
  const el = $("#msgs");
  el?.scrollTo({ top: el.scrollHeight, behavior: smooth && !REDUCE ? "smooth" : "auto" });
}

// 대화방이 열려 있으면 말풍선 하나만 붙이고 true
function appendBubble(id, m) {
  const box = $("#msgs");
  if (!box || !inRoom(id)) return false;
  const stick = m.from === "me" || nearBottom(box);
  const list = sorted(id);
  const i = list.indexOf(m);
  const prev = list[i - 1];
  const start = $("#chat-start");
  if (start && m.from !== "sys") {
    start.style.transition = `opacity 200ms`;
    start.style.opacity = "0";
    setTimeout(() => start.remove(), 200);
  }
  // 앞 말풍선이 같은 묶음이면 시간·꼬리를 뗀다
  if (prev && prev.from === m.from && m.at - prev.at < GROUP_MS) box.querySelector(`.m[data-at="${prev.at}"]`)?.classList.add("more");
  const typing = box.querySelector(".typing-row");
  const html = msgHtml(m, prev, null);
  if (typing) typing.insertAdjacentHTML("beforebegin", html); else box.insertAdjacentHTML("beforeend", html);
  box.querySelector(`[data-at="${m.at}"]`)?.classList.add("in");
  if (stick) toBottom(true); else $("#new-msg").hidden = false;
  return true;
}

function setTyping(on) {
  const box = $("#msgs");
  if (!box) return;
  box.querySelector(".typing-row")?.remove();
  if (!on) return;
  const p = byId(state.chatWith);
  box.insertAdjacentHTML("beforeend", `<div class="m them typing-row"><span class="m-av photo" style="background-image:url(${photo(p)})"></span><div class="bubble them typing"><i></i><i></i><i></i></div></div>`);
  if (nearBottom(box)) toBottom(true);
}

function setEnded() {
  const slot = $("#composer-slot");
  if (slot) slot.innerHTML = endedHtml();
}

// 방은 진입 때 한 번 그리고, 이후 render는 부분 갱신으로 끝낸다
let dirty = false;
function patch() {
  return !dirty && !!state.chatWith && !!$("#msgs") && $("#msgs").dataset.room === state.chatWith;
}

// ---------- 진입·이탈 ----------
let listScroll = 0;
let roomRouted = false;

function closeRoom() {
  roomRouted = false;
  const room = $(".room");
  const done = () => { state.chatWith = null; render(); };
  if (!room || REDUCE) return done();
  room.animate([{ transform: "translateX(0)" }, { transform: "translateX(100%)" }], { duration: DUR.pop, easing: EASE.nav, fill: "forwards" }).onfinish = done;
}

function mount(root) {
  dirty = false;
  const box = $("#msgs");
  if (!box) { root.scrollTop = listScroll; return; }
  const id = state.chatWith;
  box.dataset.room = id;
  box.scrollTop = box.scrollHeight;
  if (state.unread[id]) { state.unread[id] = 0; save("unread", state.unread); }
  if (!roomRouted) {
    roomRouted = true;
    pushRoute("room", closeRoom);
    if (!REDUCE) $(".room").animate([{ transform: "translateX(100%)" }, { transform: "translateX(0)" }], { duration: DUR.slow, easing: EASE.nav });
  }
  box.addEventListener("scroll", () => { if (nearBottom(box)) $("#new-msg").hidden = true; }, { passive: true });
  $("#new-msg").addEventListener("click", () => { toBottom(true); $("#new-msg").hidden = true; });
}

function unmount() { if (!state.chatWith) roomRouted = false; }

registerScreen("chats", { html: chatsHtml, mount, patch, unmount });

// 나가기·삭제: 매칭과 대화 기록을 함께 없앤다
function leaveRoom(id, msg) {
  debug("채팅", `${byId(id).name}님과의 대화방 정리 — 매칭 해제`);
  state.matches = state.matches.filter(m => m !== id);
  delete state.chats[id];
  delete state.ended[id];
  delete state.unread[id];
  ["matches", "chats", "ended", "unread"].forEach(k => save(k, state[k]));
  if (state.chatWith === id) state.chatWith = null;
  toast(msg);
  render();
}

function askDelete(id) {
  openSheet({
    title: "대화방을 삭제할까요?", body: "대화 내용이 모두 사라져요",
    actions: [{ label: "삭제", danger: true, onTap: () => leaveRoom(id, "대화방을 삭제했어요") }],
  });
}

registerActions({
  chat(arg) {
    document.querySelector(".notice")?.remove();
    if (!state.chatWith && state.tab === "chats") listScroll = $("#screen")?.scrollTop ?? 0;
    state.detail = null; state.tab = "chats"; state.chatWith = arg;
  },
  "back-chats"() { backRoute(); return false; },
  "chat-more"() {
    const id = state.chatWith;
    if (state.ended[id]) {
      openSheet({ title: byId(id).name, actions: [
        { label: "신고하기", onTap: () => openSafety(id) },
        { label: "대화방 삭제", danger: true, onTap: () => askDelete(id) },
      ] });
      return false;
    }
    openSheet({ title: byId(id).name, actions: [
      { label: "프로필 보기", act: `detail:${id}` },
      { label: "신고하기", onTap: () => openSafety(id) },
      { label: "차단하기", onTap: () => openSafety(id) },
      { label: "대화방 나가기", danger: true, onTap: () => openSheet({
        title: "대화방을 나갈까요?", body: `나가면 ${esc(byId(id).name)}님과의 매칭이 끊기고<br>대화 내용도 사라져요.`,
        actions: [{ label: "나가기", danger: true, onTap: () => leaveRoom(id, "대화방을 나왔어요") }],
      }) },
    ] });
    return false;
  },
  "chat-delete"() { askDelete(state.chatWith); return false; },
  "chat-chip"(arg) {
    const ta = $("#composer textarea");
    if (!ta) return false;
    ta.value = chips[Number(arg)] ?? "";
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    ta.focus();
    return false;
  },
  "chat-fail"(arg) {
    const id = state.chatWith;
    const m = state.chats[id]?.find(x => String(x.at) === arg);
    if (!m) return false;
    openSheet({ title: "메시지를 보내지 못했어요", actions: [
      { label: "다시 보내기", onTap: () => { (chatRuntime[id] ??= {}).lastSentAt = Date.now(); scheduleFlush(id); render(); } },
      { label: "삭제", danger: true, onTap: () => {
        state.chats[id] = state.chats[id].filter(x => x !== m);
        save("chats", state.chats);
        $(`#msgs .m[data-at="${m.at}"]`)?.remove();
      } },
    ] });
    return false;
  },
});

// ---------- 입력창 ----------
function send(form) {
  const ta = form.querySelector("textarea");
  const text = ta.value.trim();
  ta.value = "";
  resize(ta);
  if (text) queueMessage(state.chatWith, text);
}
function resize(ta) {
  ta.style.height = "auto";
  ta.style.height = Math.min(ta.scrollHeight, 112) + "px";
  const form = ta.form;
  form.querySelector(".send").disabled = !ta.value.trim();
  const cnt = form.querySelector(".cnt");
  cnt.hidden = ta.value.length <= 400;
  cnt.textContent = `${ta.value.length}/500`;
}
document.addEventListener("submit", e => {
  if (e.target.id !== "composer") return;
  e.preventDefault();
  send(e.target);
});
document.addEventListener("input", e => { if (e.target.matches?.("#composer textarea")) resize(e.target); });
document.addEventListener("keydown", e => {
  if (!e.target.matches?.("#composer textarea") || e.key !== "Enter" || e.shiftKey || e.isComposing) return;
  e.preventDefault();
  send(e.target.form);
});
// 보내기를 눌러도 입력창 포커스(키보드)가 유지되게
document.addEventListener("pointerdown", e => { if (e.target.closest?.("#composer .send")) e.preventDefault(); });
