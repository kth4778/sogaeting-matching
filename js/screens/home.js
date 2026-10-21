// 매칭 탭: 시작 화면 · 진행 중 · 결과
import { PROFILES } from "../data/profiles.js";
import { byId, photo, esc, meAvatar } from "../core/util.js";
import { state, save } from "../core/store.js";
import { registerScreen, registerActions } from "../core/runtime.js";
import { runMatching } from "../core/matching.js";
import { signature } from "../core/engine.js";
import { logEl, pipelineEl, startFollow, stopFollow } from "../core/log.js";
import { stageEl, stageWake, takeHeroRect } from "../core/stage.js";
import { reportHtml } from "../core/report.js";
import { icon } from "../ui/icons.js";
import { REDUCE, SPRING, pauseOffscreen, springKeyframes } from "../ui/motion.js";
import { isBlocked } from "../features/safety.js";
import { startOnboarding } from "./onboarding.js";

const REVEAL_MS = 2600;   // 1위 공개 시퀀스 최소 길이 (끝나면 justFinished = false)
const COUNT_DELAY_MS = 300; // 사진이 자리에 닿은 뒤 숫자가 굴러가기 시작할 때까지
const COUNT_MS = 1300;      // 0 → 실제 값 (점점 느려진다)
const RING_GAP_MS = 180;    // 두 번째 물결이 뒤따르는 간격
const SPARKS = 8;
const CLOCK_MS = 1000;
const NEXT_HOUR = 10;     // 새 매칭이 오는 시각(오전 10시)
const ORBIT_N = 6;
const dateFmt = new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric" });

// 로그 카드 열림 상태(기본 접힘): 사용자가 직접 바꾼 값만 sessionStorage에
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

// 매칭 로그는 무대 아래에 접어 둔다 (진행 중·결과 공통)
const logToggle = summary => `
    <details class="inlog" ${logOpen ? "open" : ""}>
      <summary>매칭 로그 자세히 보기${summary ? ` · ${summary}` : ""} ${icon("chevron-down", 16)}</summary>
      ${!state.running && !logEl.childElementCount ? `<p class="inlog-note">로그는 이 화면에서 방금 돌린 매칭만 남아요. 「매칭 과정 다시 보기」로 다시 볼 수 있어요.</p>` : ""}
      <div id="log-slot"></div>
    </details>`;

function runningHtml() {
  return `
    ${appbar()}
    <div id="progress-slot"></div>
    <section class="match-stage">
      <div id="stage-slot"></div>
    </section>
    ${logToggle()}`;
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
  const stale = r.forMe !== signature(state.me);
  const reveal = state.justFinished && !stale;
  const sec = r.totalMs ? ` · ${(r.totalMs / 1000).toFixed(1)}초` : "";
  return `
    ${appbar(`<span class="home-date">${dateFmt.format(new Date())}</span>`)}
    ${stale ? `<button class="home-stale" data-act="run">프로필이 바뀌었어요 · 다시 매칭 ${icon("chevron-right", 16)}</button>` : ""}
    <div class="home-result ${stale ? "is-stale" : ""} ${reveal ? "reveal" : ""}">
      <section class="win">
        <div class="win-pic">
          <div class="win-photo photo" style="background-image:url(${photo(p)})" data-act="detail:${p.id}" aria-hidden="true" tabindex="-1"></div>
          <span class="win-badge">${icon("crown", 16)} 1위</span>
        </div>
        <h3 class="win-name">${esc(p.name)}${p.verified?.face ? `<span class="win-verified" aria-label="얼굴 인증">${icon("check", 14)}</span>` : ""} <span>${p.age}</span></h3>
        <p class="win-sub">${icon("map-pin", 14)} ${esc(p.region)} · ${esc(p.job)}</p>
        <span class="win-score" aria-label="궁합 ${first.llmScore}점">♥ <b class="win-num" data-count="${first.llmScore}">${first.llmScore}</b>점</span>
        <div class="two-btn">
          <button class="btn" data-act="talk:${p.id}">${icon("message", 20)} 대화하기</button>
          <button class="btn line" data-act="detail:${p.id}">자세히 보기</button>
        </div>
      </section>
      ${reportHtml(r, first)}
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
    ${logToggle(`${r.total ?? PROFILES.length}명 → ${r.passed ?? "-"}명 → ${r.ranked.length}명 → 1명${sec}`)}`;
}

// 무대의 1위 원판 자리에서 결과 사진 자리로 커져 온다 (스프링, 한 번)
function flipFrom(el, from) {
  const to = el.getBoundingClientRect();
  const k = to.width / el.offsetWidth || 1; // 데스크톱 가상 폰 배율
  const dx = (from.left + from.width / 2 - (to.left + to.width / 2)) / k;
  const dy = (from.top + from.height / 2 - (to.top + to.height / 2)) / k;
  const s0 = from.width / to.width;
  const { keyframes, duration } = springKeyframes(1, 0, SPRING.card, "transform",
    t => `translate(${(dx * t).toFixed(2)}px, ${(dy * t).toFixed(2)}px) scale(${(1 + (s0 - 1) * t).toFixed(4)})`);
  el.animate(keyframes, { duration, easing: "linear" });
  return duration;
}

// 1위가 뽑히는 순간: 사진 테두리 모양 물결 2겹 + 작은 반짝이 8개 (번쩍임·흔들림 없음)
function ripple(pic) {
  const colors = ["#ffffff", "var(--pink-200)", "#ffd9c7"];
  const fx = document.createElement("span");
  fx.className = "win-fx";
  fx.setAttribute("aria-hidden", "true");
  fx.innerHTML = `<i class="win-ring"></i><i class="win-ring" style="animation-delay:${RING_GAP_MS}ms"></i>` +
    Array.from({ length: SPARKS }, (_, i) =>
      `<b style="--a:${i * (360 / SPARKS) + (i % 2 ? 12 : -8)}deg;--c:${colors[i % colors.length]};animation-delay:${(i % 4) * 40}ms"></b>`).join("");
  pic.append(fx);
  setTimeout(() => fx.remove(), 1400);
}

// 실제 값까지 0부터 굴려 올린다(감속). 끝 숫자는 늘 실제 값 그대로, 마지막에 90% → 100%
function countTo(el, delay) {
  const to = Number(el.dataset.count);
  const dec = Number(el.dataset.dec ?? 0);
  const fmt = v => v.toFixed(dec);
  el.textContent = fmt(0);
  setTimeout(() => {
    const t0 = performance.now();
    const step = now => {
      const k = Math.min(1, (now - t0) / COUNT_MS);
      el.textContent = k === 1 ? el.dataset.count : fmt(to * (1 - (1 - k) ** 3));
      if (k < 1) requestAnimationFrame(step);
      else el.animate([{ transform: "scale(.9)" }, { transform: "scale(1)" }], { duration: 260, easing: "cubic-bezier(.34,1.56,.64,1)" });
    };
    requestAnimationFrame(step);
  }, delay);
  // 화면이 숨겨져 프레임이 멈춰도 끝에는 반드시 실제 값이 남는다
  setTimeout(() => { el.textContent = el.dataset.count; }, delay + COUNT_MS + 100);
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
  root.querySelector("#stage-slot")?.replaceWith(stageEl);
  root.querySelector("#log-slot")?.replaceWith(logEl);

  const details = root.querySelector("details.inlog");
  if (details) {
    details.querySelector("summary").addEventListener("click", () => { userToggled = true; });
    details.addEventListener("toggle", () => {
      logOpen = details.open;
      if (userToggled) { try { sessionStorage.setItem("inlog-open", logOpen ? "1" : "0"); } catch {} }
      userToggled = false;
    });
  }

  if (state.running) { stageWake(); startFollow(root); return; }
  stopFollow();

  const orbit = root.querySelector(".home-orbit");
  if (orbit) releaseOrbit = pauseOffscreen(orbit);

  const clockEl = root.querySelector(".home-clock");
  if (clockEl) clock = setInterval(() => { if (state.tab === "home") clockEl.textContent = nextText(); else stopClock(); }, CLOCK_MS);

  // 1위 공개 시퀀스: 사진이 무대에서 커져 오고, 점수 0 → 최종값, 끝나면 정지 상태로
  if (root.querySelector(".home-result.reveal")) {
    const from = takeHeroRect();
    const pic = root.querySelector(".win-photo");
    let land = 0;
    if (!REDUCE) {
      if (from && pic) land = flipFrom(pic, from);
      ripple(root.querySelector(".win-pic"));
      root.querySelectorAll("[data-count]").forEach(el => countTo(el, land + COUNT_DELAY_MS));
    }
    setTimeout(() => { state.justFinished = false; }, Math.max(REVEAL_MS, land + COUNT_DELAY_MS + COUNT_MS));
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
