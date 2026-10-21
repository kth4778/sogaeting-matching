// 매칭 탭: 시작 화면 · 진행 중 · 결과
import { PROFILES } from "../data/profiles.js";
import { byId, photo, esc, meAvatar } from "../core/util.js";
import { state, save } from "../core/store.js";
import { STAGE_MS } from "../config.js";
import { registerScreen, registerActions } from "../core/runtime.js";
import { runMatching } from "../core/matching.js";
import { signature } from "../core/engine.js";
import { logEl, pipelineEl, gridEl, startFollow, stopFollow, countUp } from "../core/log.js";
import { icon } from "../ui/icons.js";
import { REDUCE, pauseOffscreen } from "../ui/motion.js";
import { isBlocked } from "../features/safety.js";
import { startOnboarding } from "./onboarding.js";

const TOTAL_SEC = (Object.values(STAGE_MS).reduce((a, b) => a + b, 0) / 1000).toFixed(1);
const REVEAL_MS = 2600;   // 1위 공개 시퀀스 길이 (끝나면 justFinished = false)
const SCORE_DELAY_MS = 600;
const CLOCK_MS = 1000;
const NEXT_HOUR = 10;     // 새 매칭이 오는 시각(오전 10시)
const ORBIT_N = 6;
const dateFmt = new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric" });

// 결과 아래 로그 카드 열림 상태: 사용자가 직접 바꾼 값만 sessionStorage에
const readOpen = () => { try { return sessionStorage.getItem("inlog-open") === "1"; } catch { return false; } };
let logOpen = readOpen();
let userToggled = false;
let releaseOrbit = null;
let clock = null;

// ---------- 화면 그리기 ----------
const appbar = right => `<div class="appbar"><span>오늘의 매칭</span>${right ?? ""}</div>`;

function startHtml() {
  const me = state.me;
  const thumbs = PROFILES.filter(p => p.gender === me.wants?.gender).slice(0, ORBIT_N);
  return `
    ${appbar()}
    <section class="home-start">
      <div class="home-orbit" aria-hidden="true">
        <div class="home-ring">${thumbs.map((p, i) => `<span class="home-sat" style="--i:${i}"><i style="background-image:url(${photo(p)})"></i></span>`).join("")}</div>
        ${meAvatar(me, "home-me")}
      </div>
      <h2>오늘 가장 잘 맞는<br>한 사람을 찾아드려요</h2>
      <p>약 10초 걸려요 · 과정을 함께 보여드려요</p>
      <button class="btn home-cta" data-act="run">오늘의 매칭 받기</button>
    </section>`;
}

function runningHtml() {
  return `
    ${appbar()}
    <div id="progress-slot"></div>
    <section class="match-stage">
      <div id="grid-slot"></div>
      <div class="inlog">
        <div class="inlog-head"><b>매칭 과정</b><small>데모: 2~4단계는 규칙 기반 예시 계산이에요</small></div>
        <div id="log-slot"></div>
      </div>
    </section>`;
}

function emptyHtml(r) {
  const chips = Object.entries(r.excluded ?? {}).map(([name, n]) => `<span class="home-chip">${esc(name)} 조건으로 ${n}명</span>`).join("");
  return `
    ${appbar()}
    <section class="home-empty">
      <img src="art/empty-match.jpg" alt="" width="160" height="160">
      <h3>${r.empty ? "조건에 맞는 분이 아직 없어요" : "매칭을 끝내지 못했어요"}</h3>
      <p>${r.empty ? "나이 범위나 흡연·종교 조건을 조금 넓혀 보세요." : "연결이 불안정해요. 잠시 후 다시 시도해 주세요."}</p>
      ${chips ? `<div class="home-chips">${chips}</div>` : ""}
      ${r.empty
        ? `<button class="btn" data-act="home-rewants">조건 넓히기</button>`
        : `<button class="btn" data-act="run">다시 시도</button>`}
    </section>`;
}

// 다음 매칭까지 남은 시간
function nextText() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(NEXT_HOUR, 0, 0, 0);
  const tomorrow = now >= next;
  if (tomorrow) next.setDate(next.getDate() + 1);
  const s = Math.floor((next - now) / 1000);
  const pad = n => String(n).padStart(2, "0");
  return `${tomorrow ? "내일" : "오늘"} 오전 ${NEXT_HOUR}시에 새로운 매칭이 와요 · ${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
}

function resultHtml(r) {
  const list = r.ranked.filter(c => !isBlocked(c.id));
  if (!list.length) return emptyHtml({ empty: true });
  const [first, ...rest] = list;
  const p = byId(first.id);
  const headline = first.id === r.ranked[0].id ? (r.explain?.headline ?? first.oneLine) : (first.headline ?? first.oneLine);
  const stale = r.forMe !== signature(state.me);
  const reveal = state.justFinished && !stale;
  if (reveal && !logOpen) logOpen = true; // 첫 공개는 로그를 열어 둔다
  return `
    ${appbar(`<span class="home-date">${dateFmt.format(new Date())}</span>`)}
    ${stale ? `<button class="home-stale" data-act="run">프로필이 바뀌었어요 · 다시 매칭 ${icon("chevron-right", 16)}</button>` : ""}
    <div class="home-result ${stale ? "is-stale" : ""} ${reveal ? "reveal" : ""}">
      <div class="hero-match">
        <div class="hm-photo photo" style="background-image:url(${photo(p)})" data-act="detail:${p.id}" aria-hidden="true" tabindex="-1"></div>
        <div class="hm-petals"><i></i><i></i><i></i></div>
        <div class="hm-badge"><span class="hm-crown">${icon("crown", 28)}</span><b>1위</b><small>가장 잘 맞는 상대예요</small></div>
        <div class="hm-info">
          <div class="hm-name">
            <h3>${esc(p.name)}${p.verified?.face ? `<span class="hm-verified" aria-label="얼굴 인증">${icon("check", 14)}</span>` : ""} <span>${p.age}</span></h3>
            <span class="hm-score" aria-label="궁합 ${first.llmScore}점">♥ <b class="hm-num" data-to="${first.llmScore}">${reveal && !REDUCE ? 0 : first.llmScore}</b>점</span>
          </div>
          <p class="hm-sub">${icon("map-pin", 14)} ${esc(p.region)} · ${esc(p.job)}</p>
          <div class="hm-quote">${esc(headline)}</div>
          <div class="two-btn">
            <button class="btn" data-act="talk:${p.id}">${icon("message", 20)} 대화하기</button>
            <button class="btn on-photo" data-act="detail:${p.id}">자세히 보기</button>
          </div>
        </div>
      </div>
      ${rest.length ? `<h4 class="home-sec">이런 분도 잘 맞아요</h4>` : ""}
      <div class="rank-list">
        ${rest.map((c, i) => {
          const q = byId(c.id);
          const moved = c.before - (i + 2);
          const move = moved > 0 ? `<span class="move up">▲${moved}</span>` : moved < 0 ? `<span class="move down">▼${-moved}</span>` : "";
          return `<button class="rank-row" style="--i:${i}" data-act="detail:${q.id}"><span class="n">${i + 2}</span><span class="av photo" style="background-image:url(${photo(q)})"></span><span class="who"><b>${esc(q.name)}</b> <span class="age">${q.age}</span>${move}<small>${esc(c.oneLine)}</small></span><span class="pts">${c.llmScore}</span></button>`;
        }).join("")}
      </div>
    </div>
    <div class="home-next">
      <p class="home-clock">${nextText()}</p>
      <div class="home-links"><button data-act="run">매칭 과정 다시 보기</button><button data-act="home-rewants">조건 바꾸고 다시 찾기</button></div>
    </div>
    <details class="inlog" ${logOpen ? "open" : ""}>
      <summary>매칭 과정 보기 · ${PROFILES.length}명 → ${r.passed ?? "-"}명 → ${r.ranked.length}명 → 1명 · ${TOTAL_SEC}초 ${icon("chevron-down", 16)}</summary>
      <p class="inlog-note">데모: 2~4단계는 규칙 기반 예시 계산이에요</p>
      <div id="log-slot"></div>
    </details>`;
}

export function homeHtml() {
  const r = state.result;
  if (state.running) return runningHtml();
  if (!r) return startHtml();
  if (r.empty || r.error) return emptyHtml(r);
  return resultHtml(r);
}

// ---------- 그린 뒤 ----------
function stopClock() { clearInterval(clock); clock = null; }

function mount(root) {
  releaseOrbit?.(); releaseOrbit = null;
  stopClock();
  root.querySelector("#progress-slot")?.replaceWith(pipelineEl);
  root.querySelector("#grid-slot")?.replaceWith(gridEl);
  root.querySelector("#log-slot")?.replaceWith(logEl);

  if (state.running) { startFollow(root); return; }
  stopFollow();

  const orbit = root.querySelector(".home-orbit");
  if (orbit) releaseOrbit = pauseOffscreen(orbit);

  const clockEl = root.querySelector(".home-clock");
  if (clockEl) clock = setInterval(() => { if (state.tab === "home") clockEl.textContent = nextText(); else stopClock(); }, CLOCK_MS);

  const details = root.querySelector("details.inlog");
  if (details) {
    details.querySelector("summary").addEventListener("click", () => { userToggled = true; });
    details.addEventListener("toggle", () => {
      logOpen = details.open;
      if (userToggled) { try { sessionStorage.setItem("inlog-open", logOpen ? "1" : "0"); } catch {} }
      userToggled = false;
    });
  }

  // 1위 공개 시퀀스: 점수 0 → 최종값, 끝나면 정지 상태로
  if (root.querySelector(".home-result.reveal")) {
    const num = root.querySelector(".hm-num");
    if (!REDUCE) setTimeout(() => countUp(num, Number(num.dataset.to), ""), SCORE_DELAY_MS);
    setTimeout(() => { state.justFinished = false; }, REVEAL_MS);
  }
}

// 진행 중에는 헤더·아바타·로그 요소가 스스로 갱신되므로 화면을 갈아엎지 않는다
function patch(root) {
  return !!(state.running && root.contains(pipelineEl));
}

function unmount() {
  releaseOrbit?.(); releaseOrbit = null;
  stopClock();
  stopFollow();
  logOpen = readOpen();
  state.justFinished = false;
}

registerScreen("home", { html: homeHtml, mount, patch, unmount });

registerActions({
  run() { state.tab = "home"; state.detail = null; runMatching(); return false; },
  talk(arg) {
    // 결과 화면에서 바로 대화: 성사 창 없이 대화방을 연다
    if (isBlocked(arg)) return false;
    state.swiped[arg] = "like";
    save("swiped", state.swiped);
    if (state.lastSwipe?.id === arg) state.lastSwipe = null;
    if (!state.matches.includes(arg)) {
      state.matches.push(arg);
      save("matches", state.matches);
    }
    state.tab = "chats"; state.chatWith = arg; state.detail = null;
  },
  "home-rewants"() { startOnboarding(true, "wants"); },
});
