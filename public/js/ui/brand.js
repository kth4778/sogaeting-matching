// 브랜드: 로고 「인연의 실」(두 점을 고리 한 줄이 잇는다)과 첫 화면 소개 영상
// 로고 아이콘 PNG(icon-*.png, logo.png)도 이 경로로 그렸다. 모양을 바꾸면 아이콘도 다시 만든다.
import { PHOTO_V } from "../core/util.js";
import { REDUCE } from "./motion.js";
import { clamp, lerp, tw, spring, Ease, css, rise, fall, maskHtml, playClock } from "./film.js";

export const MARK_PATH = "M15.7 53.1 C26 59 38 58 47 53.5 C55 49 58 42 55.5 38.5 C52.5 34.5 45 35.5 43.5 41 C41.5 48 46 56.5 55 59.5 C66 62.5 76 58.5 84.5 55.9";
const DOT_A = [15.7, 53.1], DOT_B = [84.5, 55.9];

export const markSvg = (cls = "mark") => `<svg class="${cls}" viewBox="0 0 100 100" aria-hidden="true"><path pathLength="1" d="${MARK_PATH}"/><circle cx="${DOT_A[0]}" cy="${DOT_A[1]}" r="3.4"/><circle cx="${DOT_B[0]}" cy="${DOT_B[1]}" r="3.4"/></svg>`;

// ---------- 첫 화면 소개 영상 (11초, 화면 전체) ----------
// 마디 1 로고: 두 점 → 실, 이름이 올라온다
// 마디 2 오른쪽 점에서 분홍이 번져 화면을 덮고 큰 글자 세 박
// 마디 3 사진 카드 세 장이 아래에서 부채꼴로
// 마디 4 분홍이 맨 앞 카드의 ♥ 버튼으로 빨려 들어가고, 카드는 그림 상자로, 로고는 왼쪽 위로
// 마디 5 제목·설명·버튼이 올라오고(버튼은 이때부터 누를 수 있다), 그 뒤로는 카드가 아주 조금 떠다닌다
// 위치 단위: 가로는 cqw, 세로는 cqh(첫 화면 전체 기준). 화면 높이가 달라도 같은 구도가 나온다.
// 로고는 분홍 아래, 카드는 분홍 위에 있어야 해서 모든 조각이 .ob.welcome 한 층에서 z-index로 겹친다.
const CARDS = [["p01", "이서윤", 24], ["p11", "이준호", 27], ["p20", "임재원", 27]];
const FAN = [[29, 45, -9, 1], [71, 45, 9, 1], [50, 42, 0, 1]];
const REST = [[30, 31, -10, .78], [70, 31, 10, .78], [50, 30, 0, .88]];
const BUTTONS_AT = 8;       // 버튼이 올라오는 시각
const SKIP_TO = 8.4;        // 화면을 누르면 건너뛰는 시각
const IDLE_AT = 9.4;        // 다시 볼 때 시작하는 시각(끝 장면)
const PLAYED_KEY = "intro-played";

export function introHtml() {
  const heart = `<svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-heart-fill"/></svg>`;
  return `
        <div class="intro">
          <div class="it-mark">${markSvg()}</div>
          <div class="it-word" aria-hidden="true">${maskHtml("오늘,")}${maskHtml("누구와?")}</div>
          <div class="it-hero" aria-hidden="true"></div>
          ${CARDS.map(([id, name, age]) => `
          <div class="it-card" aria-hidden="true"><i style="background-image:url(photos/${id}.jpg?v=${PHOTO_V})"></i><b>${name} <small>${age}</small></b><span class="it-like">${heart}</span></div>`).join("")}
          <h1 class="it-title">${maskHtml("마음이 통하는 한 사람,", "it-h")}${maskHtml("이유까지 알려드릴게요", "it-h")}</h1>
          <p class="it-desc">${maskHtml("취향, 성격, 생활 습관까지 살펴보고", "it-sub")}${maskHtml("왜 잘 맞는지도 함께 알려드려요.", "it-sub")}</p>
        </div>
        <div class="it-flood" aria-hidden="true">${["마음이", "통하는", "한 사람,"].map(t => maskHtml(t, "it-k")).join("")}${["왜 잘 맞는지", "이유까지 알려드려요"].map(t => maskHtml(t, "it-cap")).join("")}</div>`;
}

// 영상을 돌린다. root = .ob.welcome. 정지 함수를 돌려준다
export function playIntro(root) {
  const q = s => root.querySelector(s), qa = s => [...root.querySelectorAll(s)];
  const R = {
    intro: q(".intro"), mark: q(".it-mark"), path: q(".it-mark path"), dots: qa(".it-mark circle"),
    word: q(".it-word"), w: qa(".it-word .mask-in"), hero: q(".it-hero"), cards: qa(".it-card"),
    flood: q(".it-flood"), k: qa(".it-k .mask-in"), cap: qa(".it-cap .mask-in"),
    h: qa(".it-h .mask-in"), sub: qa(".it-sub .mask-in"), foot: q(".ob-foot"),
  };
  R.like = R.cards[2].querySelector(".it-like");
  const center = (el, box) => { const a = el.getBoundingClientRect(), b = box.getBoundingClientRect(); return [a.left + a.width / 2 - b.left, a.top + a.height / 2 - b.top]; };

  const render = t => {
    // 마디 1: 두 점 → 실, 로고가 조금 올라가고 이름이 올라온다
    R.dots.forEach((c, i) => c.setAttribute("r", 3.4 * spring(t - (.2 + i * .25), .7, 18)));
    R.path.style.strokeDashoffset = 1 - tw(t, .5, 1.25, Ease.inOut);
    const up = tw(t, 1.05, 1.6, Ease.inOut), settle = tw(t, 6.4, 7.2, Ease.inOut);
    const showLogo = t < 3.1 || t > 6.3;
    css(R.mark, {
      transform: `translate(${lerp(50, 12, settle)}cqw, ${lerp(lerp(42, 36, up), 4.5, settle)}cqh) translate(-50%, -50%) scale(${lerp(lerp(1, .82, up), .23, settle)})`,
      visibility: showLogo ? "visible" : "hidden",
    });
    css(R.word, {
      transform: `translate(${lerp(50, 20, settle)}cqw, calc(${lerp(36, 4.5, settle)}cqh + ${lerp(19, 0, settle)}cqw)) translate(${-50 * (1 - settle)}%, -50%) scale(${lerp(1, .5, settle)})`,
      visibility: showLogo ? "visible" : "hidden",
    });
    R.w.forEach((e, i) => rise(e, tw(t, 1.25 + i * .25, 1.7 + i * .25)));

    // 마디 2: 로고 오른쪽 점에서 분홍이 번지고, 마디 4에서 ♥ 버튼으로 줄어든다
    const grow = tw(t, 2.4, 3.05, Ease.inOut), back = tw(t, 6, 6.45, Ease.inOut);
    const fr = R.flood.getBoundingClientRect(), far = Math.hypot(fr.width, fr.height);
    const [cx, cy] = back > 0 ? center(R.like, R.flood) : center(R.dots[1], R.flood);
    R.flood.style.clipPath = `circle(${back > 0 ? lerp(far, 0, back) : lerp(0, far, grow)}px at ${cx}px ${cy}px)`;
    R.flood.style.visibility = t > 2.4 && back < 1 ? "visible" : "hidden";
    R.k.forEach((e, i) => { t > 4 ? fall(e, tw(t, 3.95 + i * .06, 4.35 + i * .06, Ease.in)) : rise(e, tw(t, 2.9 + i * .4, 3.35 + i * .4)); });
    R.cap.forEach((e, i) => { t > 5.8 ? fall(e, tw(t, 5.8, 6.1, Ease.in)) : rise(e, tw(t, 5 + i * .25, 5.45 + i * .25)); });

    // 마디 3·4: 카드가 들어와 부채꼴로 섰다가 그림 상자로
    const move = tw(t, 6.35, 7.25, Ease.inOut);
    R.cards.forEach((c, i) => {
      const inK = spring(t - (4.05 + i * .12), .86, 13);
      const [fx, fy, fr2] = FAN[i], [rx, ry, rr, rs] = REST[i];
      const float = Math.sin((t - 7.3) * 1.6 + i * 1.7) * .8 * tw(t, 7.3, 8.3);
      css(c, {
        transform: `translate(${lerp(fx, rx, move)}cqw, calc(${lerp(fy, ry, move)}cqh + ${(1 - inK) * 120 * (1 - move) + float}cqw)) translate(-50%, -50%) rotate(${lerp(fr2 + (1 - inK) * (i - 1) * 14, rr, move)}deg) scale(${lerp(1, rs, move)})`,
        visibility: t > 4 ? "visible" : "hidden",
      });
    });
    const fill = tw(t, 6.3, 6.55), beat = t > 9 ? Math.sin(Math.PI * clamp(((t - 9) % 4) / .5)) : 0;
    R.like.classList.toggle("on", fill > .5);
    R.like.style.transform = `scale(${1 + .18 * Math.sin(Math.PI * fill) + .14 * beat})`;
    const hk = tw(t, 6.5, 7.3);
    css(R.hero, { transform: `translate(-50%, -50%) scale(${lerp(.6, 1, hk)})`, borderRadius: lerp(40, 7, hk) + "cqw", visibility: hk > 0 ? "visible" : "hidden" });

    // 마디 5: 제목·설명, 그리고 버튼 (올라오기 전에는 누를 수 없다)
    R.h.forEach((e, i) => rise(e, tw(t, 7.2 + i * .25, 7.7 + i * .25)));
    R.sub.forEach((e, i) => rise(e, tw(t, 7.6 + i * .12, 8.1 + i * .12)));
    const fk = spring(t - BUTTONS_AT, .9, 14);
    css(R.foot, { transform: `translateY(${(1 - fk) * 120}%)`, visibility: t > BUTTONS_AT ? "visible" : "hidden" });
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
