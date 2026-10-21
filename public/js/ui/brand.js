// 브랜드: 로고 「인연의 실」(두 점을 고리 한 줄이 잇는다)과 첫 화면 소개 영상
// 로고 아이콘 PNG(icon-*.png, logo.png)도 이 경로로 그렸다. 모양을 바꾸면 아이콘도 다시 만든다.
import { PHOTO_V } from "../core/util.js";
import { REDUCE } from "./motion.js";
import { F, clamp, lerp, lerpLog, tw, E, springAt, S, hitPulse, css, vis, wordsHtml, words, playClock } from "./film.js";

export const MARK_PATH = "M15.7 53.1 C26 59 38 58 47 53.5 C55 49 58 42 55.5 38.5 C52.5 34.5 45 35.5 43.5 41 C41.5 48 46 56.5 55 59.5 C66 62.5 76 58.5 84.5 55.9";
const DOT_A = [15.7, 53.1], DOT_B = [84.5, 55.9];

export const markSvg = (cls = "mark") => `<svg class="${cls}" viewBox="0 0 100 100" aria-hidden="true"><path pathLength="1" d="${MARK_PATH}"/><circle cx="${DOT_A[0]}" cy="${DOT_A[1]}" r="3.4"/><circle cx="${DOT_B[0]}" cy="${DOT_B[1]}" r="3.4"/></svg>`;

// 로고를 그린다: 두 점이 씨앗(20%)에서 커지고 → 실이 이어지고 → 오른쪽 점에 닿는 순간 살짝 찌그러진다.
// 첫 화면의 시작·끝, 사용 안내의 끝에서 같은 동작을 쓴다(영상 전체를 묶는 하나의 동작)
export function drawMark(svg, t, at = 0, { slow = 1 } = {}) {
  const [a, b] = svg.querySelectorAll("circle"), path = svg.querySelector("path");
  const seed = when => lerp(.2, 1, tw(t, when, when + 54 * F * slow, E.out));
  a.setAttribute("r", 3.4 * seed(at));
  b.setAttribute("r", 3.4 * seed(at + .5 * slow));
  const drawEnd = at + 1.6 * slow;
  const drawn = tw(t, at + 1 * slow, drawEnd, E.glide);
  path.style.strokeDashoffset = 1 - drawn;
  path.style.opacity = drawn > 0 ? 1 : 0;   // 그리기 전엔 둥근 끝이 점처럼 찍히지 않게(부모의 숨김을 뚫지 않게 visibility 대신 투명도)
  // 닿는 순간: 가로 1.08 · 세로 0.9로 8프레임
  const sq = t >= drawEnd && t < drawEnd + 8 * F ? 1 - E.soft((t - drawEnd) / (8 * F)) : 0;
  b.style.transform = `scale(${1 + .08 * sq}, ${1 - .1 * sq})`;
  return t >= at; // 보이기 시작했는지
}

// ---------- 첫 화면 소개 영상 (화면 전체) ----------
// 위치 단위: 가로 cqw, 세로 cqh(첫 화면 전체 기준). 로고(3) < 분홍(5) < 카드(6) < 버튼(7) 순서로 겹친다.
const CARDS = [["p01", "이서윤", 24], ["p11", "이준호", 27], ["p20", "임재원", 27]];
const FAN = [[29, 46, -8], [71, 46, 8], [50, 43, 0]];
const REST = [[30, 31, -10, .78], [70, 31, 10, .78], [50, 30, 0, .88]];
const MARK = { x: 50, y: 40, w: 86 };             // 큰 로고: 중심(cqw, cqh)과 너비(cqw)
const BUTTONS_AT = 8.6;     // 버튼이 올라오는 시각(이때부터 누를 수 있다)
const SKIP_TO = 9.2;        // 그 전에 화면을 누르면 건너뛰는 시각
const IDLE_AT = 10.4;       // 같은 창에서 다시 오면 시작하는 시각
const PLAYED_KEY = "intro-played";

export function introHtml() {
  const heart = `<svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-heart-fill"/></svg>`;
  return `
        <div class="intro">
          <div class="it-logo" aria-hidden="true">${markSvg("mark it-mark")}${wordsHtml("오늘, 누구와?", "it-word")}</div>
          <div class="it-hero" aria-hidden="true"></div>
          ${CARDS.map(([id, name, age]) => `
          <div class="it-card" aria-hidden="true"><i style="background-image:url(photos/${id}.jpg?v=${PHOTO_V})"></i><b>${name} <small>${age}</small></b><span class="it-like">${heart}</span></div>`).join("")}
          <div class="it-head" aria-hidden="true">${markSvg("mark it-hmark")}${wordsHtml("오늘, 누구와?", "it-hword")}</div>
          <h1 class="it-title">${wordsHtml("마음이 통하는 한 사람,\n이유까지 알려드릴게요")}</h1>
          <p class="it-desc">${wordsHtml("취향, 성격, 생활 습관까지 살펴보고\n왜 잘 맞는지도 함께 알려드려요.")}</p>
        </div>
        <div class="it-flood" aria-hidden="true">${wordsHtml("마음이 통하는\n한 사람", "it-k")}${wordsHtml("이유까지 알려드려요", "it-cap")}</div>`;
}

// 영상을 돌린다. root = .ob.welcome. 정지 함수를 돌려준다
export function playIntro(root) {
  const q = s => root.querySelector(s), qa = s => [...root.querySelectorAll(s)];
  const R = {
    intro: q(".intro"), logo: q(".it-logo"), mark: q(".it-mark"), word: qa(".it-word .mask-in"),
    hero: q(".it-hero"), cards: qa(".it-card"), head: q(".it-head"), hmark: q(".it-hmark"), hword: qa(".it-hword .mask-in"),
    title: qa(".it-title .mask-in"), desc: qa(".it-desc .mask-in"),
    flood: q(".it-flood"), k: qa(".it-k .mask-in"), cap: qa(".it-cap .mask-in"), foot: q(".ob-foot"),
  };
  R.like = R.cards[2].querySelector(".it-like");
  R.dotB = R.mark.querySelectorAll("circle")[1];
  const center = (el, box) => { const a = el.getBoundingClientRect(), b = box.getBoundingClientRect(); return [a.left + a.width / 2 - b.left, a.top + a.height / 2 - b.top]; };
  // 카메라 기준점 = 큰 로고의 오른쪽 점
  R.logo.style.transformOrigin = `${MARK.x + (DOT_B[0] - 50) / 100 * MARK.w}cqw calc(${MARK.y}cqh + ${(DOT_B[1] - 50) / 100 * MARK.w}cqw)`;

  const render = t => {
    // 1·2마디: 로고 그리기 → 이름(단어별) → 아주 천천히 커지다가(creep) 오른쪽 점으로 파고든다(로그 줌)
    drawMark(R.mark, t, 0);
    words(R.word, t, 2.0);
    const creep = 1 + .04 * tw(t, 2, 3.55, E.linear);
    const push = lerpLog(1, 2.6, tw(t, 3.5, 4.05, E.cam));
    css(R.logo, { transform: `scale(${creep * push})` });
    vis(R.logo, t < 4.1);

    // 분홍: 오른쪽 점에서 18프레임 만에 번지고(3.75), ♥ 안으로 30프레임 동안 로그로 줄어든다(6.7)
    const fr = R.flood.getBoundingClientRect(), far = Math.hypot(fr.width, fr.height);
    const grow = tw(t, 3.75, 3.75 + 18 * F, E.out), back = tw(t, 6.7, 6.7 + 30 * F, E.inOut);
    const [cx, cy] = back > 0 ? center(R.like, R.flood) : center(R.dotB, R.flood);
    const r = back > 0 ? lerpLog(far, .5, back) : lerp(0, far, grow);
    R.flood.style.clipPath = `circle(${r}px at ${cx}px ${cy}px)`;
    vis(R.flood, t > 3.75 && back < 1);
    words(R.k, t, 4.1, { exitAt: 5.2 });
    words(R.cap, t, 5.75, { exitAt: 6.55 });

    // 3·4마디: 카드 세 장이 5프레임 간격으로 아래에서 들어와 부채꼴로 → ♥ 눌림 → 그림 상자로(46프레임)
    const morph = tw(t, 7.0, 7.0 + 46 * F, E.inOut);
    const hold = t > BUTTONS_AT ? 1 + .04 * clamp((t - BUTTONS_AT) / 8) : 1;  // 대기 화면: 아주 천천히 커진다
    R.cards.forEach((c, i) => {
      const inK = springAt(t - (5.5 + i * 5 * F), S.firm);
      const [fx, fy, fr2] = FAN[i], [rx, ry, rr, rs] = REST[i];
      const drift = Math.sin(t * .9 + i * 2.1) * .5 * clamp(t - 8);              // 0.5% 남짓 흐르는 움직임
      const x = lerp(fx, rx, morph), y = lerp(fy + (1 - inK) * 70, ry, morph);
      const rot = lerp(fr2 * inK + (1 - inK) * (i - 1) * 18, rr, morph);
      css(c, { transform: `translate(${(x - 50) * hold + 50}cqw, calc(${(y - 31) * hold + 31}cqh + ${drift}px)) translate(-50%, -50%) rotate(${rot}deg) scale(${lerp(1, rs, morph) * hold})` });
      vis(c, t > 5.45);
    });
    R.like.classList.toggle("on", t >= 6.6);
    R.like.style.transform = `scale(${1 + .3 * hitPulse(t, 6.6, 2 * F, 10 * F)})`;
    const hk = tw(t, 7.0, 7.0 + 46 * F, E.inOut);
    css(R.hero, { transform: `translate(-50%, -50%) scale(${lerp(.5, 1, hk) * hold})`, borderRadius: lerp(14, 7, hk) + "cqw" });
    vis(R.hero, hk > 0);

    // 5마디: 왼쪽 위 작은 로고를 같은 동작으로 다시 그리고 → 제목 → 설명 → 버튼
    vis(R.head, drawMark(R.hmark, t, 7.05, { slow: .6 }));
    words(R.hword, t, 7.6);
    words(R.title, t, 7.75);
    words(R.desc, t, 8.2, { stagger: 4 * F });
    const fk = springAt(t - BUTTONS_AT, S.firm);
    css(R.foot, { transform: `translateY(${(1 - fk) * 120}%)` });
    vis(R.foot, t > BUTTONS_AT);
    if (t > BUTTONS_AT) { try { sessionStorage.setItem(PLAYED_KEY, "1"); } catch {} }
  };

  let played = false;
  try { played = sessionStorage.getItem(PLAYED_KEY) === "1"; } catch {}
  if (REDUCE) { render(IDLE_AT); return () => {}; }
  const clock = playClock(render, { start: played ? IDLE_AT : 0, paused: () => R.intro.classList.contains("paused") });
  // 버튼이 나오기 전에 화면을 누르면 끝 장면으로 건너뛴다
  const skip = e => { if (clock.t < BUTTONS_AT && !e.target.closest("button")) clock.seek(SKIP_TO); };
  root.addEventListener("pointerdown", skip);
  return () => { clock.stop(); root.removeEventListener("pointerdown", skip); };
}
