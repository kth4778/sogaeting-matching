// 브랜드: 로고 「인연의 실」(두 점을 고리 한 줄이 잇는다)과 웰컴 히어로 모션
// 로고 아이콘 PNG(icon-*.png, logo.png)도 이 경로로 그렸다. 모양을 바꾸면 아이콘도 다시 만든다.
import { PHOTO_V } from "../core/util.js";
import { REDUCE } from "./motion.js";
import { clamp, lerp, tw, spring, Ease, css, rise, fall, maskHtml, playClock } from "./film.js";

export const MARK_PATH = "M15.7 53.1 C26 59 38 58 47 53.5 C55 49 58 42 55.5 38.5 C52.5 34.5 45 35.5 43.5 41 C41.5 48 46 56.5 55 59.5 C66 62.5 76 58.5 84.5 55.9";
const DOT_A = [15.7, 53.1], DOT_B = [84.5, 55.9];

export const markSvg = (cls = "mark") => `<svg class="${cls}" viewBox="0 0 100 100" aria-hidden="true"><path pathLength="1" d="${MARK_PATH}"/><circle cx="${DOT_A[0]}" cy="${DOT_A[1]}" r="3.4"/><circle cx="${DOT_B[0]}" cy="${DOT_B[1]}" r="3.4"/></svg>`;

// ---------- 웰컴 히어로 ----------
// 장면: 로고(두 점 → 실) → 오른쪽 점에서 분홍이 번지고 큰 글자 세 박 → 사진 카드 세 장
//      → 분홍이 맨 앞 카드의 ♥ 버튼으로 빨려 들어간다 → 카드는 제자리, 로고는 왼쪽 위로. 그 뒤로는 카드가 아주 조금 떠다닌다.
// 크기는 히어로 상자 기준(cqw·cqh)이라 화면 높이가 달라도 같은 구도가 나온다.
const CARDS = [["p01", "이서윤", 24], ["p11", "이준호", 27], ["p20", "임재원", 27]];
const MARK_W = 46, MARK_Y = 44;                 // 로고 너비(cqw)·중심 높이(%)
const FAN = [[29, 52, -9, 1], [71, 52, 9, 1], [50, 49, 0, 1]];
const REST = [[31, 58, -10, .82], [69, 58, 10, .82], [50, 56, 0, .9]];
const HEART = [14, 21];                         // 맨 앞 카드 중심에서 ♥ 버튼까지(--u: 히어로 가로·세로 중 좁은 쪽 기준)
const INTRO_END = 5.4;

export function heroHtml() {
  const heart = `<svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-heart-fill"/></svg>`;
  return `
        <div class="hero film-hero" aria-hidden="true">
          <div class="fh-mark">${markSvg()}</div>
          ${maskHtml("오늘, 누구와?", "fh-word")}
          <div class="fh-flood">${["마음이", "통하는", "한 사람,"].map(t => maskHtml(t, "fh-k")).join("")}</div>
          ${CARDS.map(([id, name, age]) => `
          <div class="fh-card"><i style="background-image:url(photos/${id}.jpg?v=${PHOTO_V})"></i><b>${name} <small>${age}</small></b><span class="fh-like">${heart}</span></div>`).join("")}
        </div>`;
}

// 히어로를 움직인다. drawn: 스플래시가 로고를 이미 그렸으면 그리는 장면을 건너뛴다. 정지 함수를 돌려준다
export function playWelcomeHero(hero, { drawn = false } = {}) {
  const q = s => hero.querySelector(s);
  const R = {
    mark: q(".fh-mark"), path: q(".fh-mark path"), dots: hero.querySelectorAll(".fh-mark circle"),
    word: q(".fh-word .mask-in"), flood: q(".fh-flood"), k: [...hero.querySelectorAll(".fh-k .mask-in")],
    cards: [...hero.querySelectorAll(".fh-card")], like: hero.querySelectorAll(".fh-like")[2],
  };
  const bx = (DOT_B[0] - 50) / 100 * MARK_W, by = (DOT_B[1] - 50) / 100 * MARK_W;

  const render = t => {
    // 로고: 두 점 → 실
    R.dots.forEach((c, i) => c.setAttribute("r", 3.4 * spring(t - i * .15, .7, 18)));
    R.path.style.strokeDashoffset = 1 - tw(t, .2, .8, Ease.inOut);
    // 분홍이 오른쪽 점에서 번졌다가 ♥ 버튼으로 줄어든다
    const grow = tw(t, .9, 1.5, Ease.inOut), back = tw(t, 4, 4.45, Ease.inOut);
    R.flood.style.clipPath = back > 0
      ? `circle(${lerp(170, 0, back)}cqw at calc(50% + var(--u) * ${HEART[0]}) calc(${FAN[2][1]}% + var(--u) * ${HEART[1]}))`
      : `circle(${lerp(0, 170, grow)}cqw at calc(50% + ${bx}cqw) calc(${MARK_Y}% + ${by}cqw))`;
    R.flood.style.visibility = t > .9 && back < 1 ? "visible" : "hidden";
    R.k.forEach((e, i) => { const a = 1.5 + i * .4; t > 3 ? fall(e, tw(t, 3 + i * .06, 3.35 + i * .06, Ease.in)) : rise(e, tw(t, a, a + .4)); });

    // 카드: 아래에서 부채꼴로 → 제자리
    const move = tw(t, 4.4, 5.2, Ease.inOut);
    R.cards.forEach((c, i) => {
      const inK = spring(t - (3.05 + i * .12), .86, 13);
      const [fx, fy, fr] = FAN[i], [rx, ry, rr, rs] = REST[i];
      const float = Math.sin((t - 5.2) * 1.6 + i * 1.7) * .8 * tw(t, 5.2, 6.2);
      css(c, {
        transform: `translate(${lerp(fx, rx, move)}cqw, calc(${lerp(fy, ry, move)}cqh + ${(1 - inK) * 110 * (1 - move) + float}cqw)) translate(-50%, -50%) rotate(${lerp(fr + (1 - inK) * (i - 1) * 14, rr, move)}deg) scale(${lerp(1, rs, move)})`,
        visibility: t > 3 ? "visible" : "hidden",
      });
    });
    // ♥: 분홍이 들어올 때 채워지고, 대기 중에는 4초마다 한 번 뛴다
    const fill = tw(t, 4.3, 4.5);
    R.like.classList.toggle("on", fill > .5);
    const beat = t > 6 ? Math.sin(Math.PI * clamp(((t - 6) % 4) / .5)) : 0;
    R.like.style.transform = `scale(${1 + .18 * Math.sin(Math.PI * fill) + .14 * beat})`;

    // 로고는 분홍 아래 있다가 왼쪽 위로, 이름이 그 옆에서 올라온다
    const settle = tw(t, 4.4, 5.2, Ease.inOut);
    css(R.mark, {
      transform: `translate(-50%, -50%) translate(${lerp(0, -38, settle)}cqw, ${lerp(0, 9 - MARK_Y, settle)}cqh) scale(${lerp(1, .28, settle)})`,
      visibility: t < 1.5 || t > 4.2 ? "visible" : "hidden",
    });
    rise(R.word, tw(t, 5, 5.4));
  };

  if (REDUCE) { render(INTRO_END + 1); return () => {}; }
  const clock = playClock(render, { start: drawn ? .85 : 0, paused: () => hero.classList.contains("paused") });
  return clock.stop;
}
