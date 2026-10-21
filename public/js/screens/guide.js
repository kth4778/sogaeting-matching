// 사용 안내(21초): 처음 가입을 마치면 한 번, 내 정보에서 다시 볼 수 있다
// 스토리처럼 위에 진행 막대 네 칸. 손가락이 직접 눌러 가며 프로필 → 매칭 → 카드 넘기기 → 대화를 보여 준다.
// 장면 사이는 버튼 하나가 잇는다: 「다음」이 화면만큼 커졌다가 「매칭 시작」이 되고, 그 버튼이 다시 3단계 막대로 펼쳐진다.
// 화면 왼쪽·오른쪽을 누르면 이전·다음 단계로, ✕나 마지막 「시작하기」로 닫는다.
import { PHOTO_V } from "../core/util.js";
import { registerOverlay, registerActions, render, pushRoute, backRoute } from "../core/runtime.js";
import { REDUCE } from "../ui/motion.js";
import { icon } from "../ui/icons.js";
import { markSvg } from "../ui/brand.js";
import { clamp, prog, lerp, tw, spring, Ease, css, rise, fall, maskHtml, playClock } from "../ui/film.js";

const CH = [[0, 4.6], [4.6, 9.2], [9.2, 13.8], [13.8, 18.6]];
const END = 21;
const TITLES = ["프로필부터 만들어요", "매칭 시작을 누르면", "카드를 넘겨 보세요", "마음이 맞으면 대화가 열려요"];
const HINTS = ["관심사는 2개 이상 골라 주세요", "조건 · 취향 · 궁합, 세 번 걸러 골라요", "왼쪽은 넘기기, 오른쪽은 좋아요", "서로 좋아요를 누르면 바로 대화해요"];
const DECK = [["p20", "임재원", 27], ["p13", "박서준", 29], ["p11", "이준호", 27]];
const MESSAGE = "요즘 어떤 필름 쓰세요?";
const SEEN_KEY = "guide-seen";
const photo = id => `photos/${id}.jpg?v=${PHOTO_V}`;

let open = false;
let clock = null;
let savedT = 0;   // 다른 화면이 다시 그려도 보던 장면에서 이어 간다

export function openGuide() {
  open = true; savedT = 0;
  pushRoute("guide", () => { open = false; render(); });
  render();
}
// 가입을 처음 마쳤을 때 한 번만 (이 기기 기준)
export function openGuideOnce() {
  try { if (localStorage.getItem(SEEN_KEY)) return; localStorage.setItem(SEEN_KEY, "1"); } catch {}
  openGuide();
}

// [시각, x, y] 사이를 부드럽게 잇는다 (손가락 위치)
function keyPath(t, keys) {
  if (t <= keys[0][0]) return keys[0].slice(1);
  for (let i = 1; i < keys.length; i++) if (t <= keys[i][0]) {
    const [a, ...p] = keys[i - 1], [b, ...q] = keys[i], k = Ease.inOut(prog(t, a, b));
    return p.map((v, j) => lerp(v, q[j], k));
  }
  return keys[keys.length - 1].slice(1);
}
const box = (e, x, y, w, h, r) => css(e, { left: x + "cqw", top: y + "cqw", width: w + "cqw", height: h + "cqw", borderRadius: r + "cqw" });
const mix = (a, b, k) => `rgb(${a.map((v, i) => Math.round(lerp(v, b[i], k))).join(",")})`;
const INK = [29, 29, 31], PINK = [232, 84, 107], WHITE = [255, 255, 255];

function html() {
  const chips = ["등산", "필름카메라", "커피", "러닝", "전시회", "요리", "여행", "독서", "캠핑"];
  return `
    <div class="gd" aria-label="사용 안내">
      <div class="gd-stage">
        ${CH.map((_, i) => `<span class="gd-bar" style="left:${6 + i * 22.4}cqw"><i></i></span>`).join("")}
        <span class="gd-step"></span>
        ${TITLES.map(t => maskHtml(t, "gd-ttl")).join("")}
        ${HINTS.map(t => maskHtml(t, "gd-hint")).join("")}
        <div class="gd-panel"><b class="q">관심사를 골라 주세요</b><span class="cnt">7 / 10</span><span class="track"><i></i></span>
          ${chips.map((c, i) => `<span class="gd-chip" style="left:${4 + (i % 3) * 27.6}cqw;top:${30 + Math.floor(i / 3) * 14}cqw">${c}</span>`).join("")}</div>
        <div class="gd-morph">${maskHtml("다음", "gd-mlab")}${maskHtml("매칭 시작", "gd-mlab")}</div>
        ${["조건", "취향", "궁합"].map((n, i) => `<div class="gd-st" style="left:${17 + i * 33}cqw"><i></i><b>${n}</b></div>`).join("")}
        ${[0, 1].map(i => `<div class="gd-ln" style="left:${21 + i * 33}cqw"><i></i></div>`).join("")}
        <div class="gd-big"><b>20</b><small>명 남음</small></div>
        <div class="gd-res"><i style="background-image:url(${photo("p20")})"></i><span class="who"><b>임재원 · 27</b><small>둘 다 필름카메라로 계절을 기록해요</small></span><span class="sc">92<small>점</small></span></div>
        ${DECK.map(([id, n, a]) => `<div class="gd-card"><i style="background-image:url(${photo(id)})"></i><b>${n} <small>${a}</small></b><span class="stamp no">넘기기</span><span class="stamp yes">좋아요</span><span class="stamp sup">슈퍼 좋아요</span></div>`).join("")}
        ${["x", "star-fill", "heart-fill"].map((n, i) => `<div class="gd-act" style="left:${24 + i * 26}cqw"><span>${icon(n, 20)}</span><small>${["넘기기", "슈퍼 좋아요", "좋아요"][i]}</small></div>`).join("")}
        <div class="gd-banner"><span class="pair"><i style="background-image:url(${photo("me-f")})"></i><i style="background-image:url(${photo("p20")})"></i></span><span><b>임재원님과 매칭됐어요</b><small>서로 좋아요를 눌렀어요</small></span></div>
        <div class="gd-bub them typing"><i></i><i></i><i></i></div>
        <div class="gd-bub them">안녕하세요! 필름카메라 쓰신다고 봤어요</div>
        <div class="gd-comp"><span class="txt">메시지 보내기</span><span class="send">${icon("arrow-up", 18)}</span></div>
        <div class="gd-bub me">${MESSAGE}</div>
        <div class="gd-end"></div>
        <div class="gd-endmark">${markSvg()}</div>
        ${maskHtml("이제 시작해 볼까요?", "gd-endl")}
        <span class="gd-finger"></span>
        <button class="gd-zone prev" data-act="guide-seek:-1" aria-label="이전 단계"></button>
        <button class="gd-zone next" data-act="guide-seek:1" aria-label="다음 단계"></button>
        <button class="gd-close" data-act="guide-close" aria-label="안내 닫기">${icon("x", 18)}</button>
        <button class="gd-start" data-act="guide-close">시작하기</button>
      </div>
    </div>`;
}

function grab(root) {
  const q = s => root.querySelector(s), qa = s => [...root.querySelectorAll(s)];
  return {
    bars: qa(".gd-bar i"), step: q(".gd-step"), titles: qa(".gd-ttl .mask-in"), hints: qa(".gd-hint .mask-in"),
    p1: q(".gd-panel"), chips: qa(".gd-chip"),
    morph: q(".gd-morph"), mlab: qa(".gd-mlab .mask-in"),
    steps: qa(".gd-st"), lines: qa(".gd-ln i"), big: q(".gd-big"), bigN: q(".gd-big b"), res: q(".gd-res"),
    deck: qa(".gd-card"), acts: qa(".gd-act"),
    banner: q(".gd-banner"), typing: q(".gd-bub.typing"), b1: q(".gd-bub.them:not(.typing)"), comp: q(".gd-comp"), compTxt: q(".gd-comp .txt"), b2: q(".gd-bub.me"),
    root: q(".gd"), end: q(".gd-end"), endMark: q(".gd-endmark"), endL: q(".gd-endl .mask-in"), start: q(".gd-start"), finger: q(".gd-finger"),
  };
}

function paint(t, R) {
  savedT = t;
  // 진행 막대·단계 번호·제목
  CH.forEach(([a, b], i) => { R.bars[i].style.transform = `scaleX(${prog(t, a, b)})`; });
  const ci = CH.findIndex(([, b]) => t < b);
  R.step.textContent = ci < 0 ? "" : `${ci + 1} / 4`;
  CH.forEach(([a, b], i) => {
    t > b - .35 ? fall(R.titles[i], tw(t, b - .35, b, Ease.in)) : rise(R.titles[i], tw(t, a + .1, a + .55));
    t > b - .3 ? fall(R.hints[i], tw(t, b - .3, b, Ease.in)) : rise(R.hints[i], tw(t, a + .3, a + .75));
  });

  // ---- 1 프로필: 관심사 칩 세 개를 박자에 맞춰 누른다
  css(R.p1, { transform: `translateY(${(1 - spring(t - .15, .9, 13)) * 30}cqw)`, visibility: t < 4.05 ? "visible" : "hidden" });
  [0, 1, 2].forEach(i => {
    const at = 1 + i * .5;
    R.chips[i].classList.toggle("on", t >= at + .05);
    R.chips[i].style.transform = `scale(${1 - .08 * Math.sin(Math.PI * prog(t, at - .05, at + .2))})`;
  });

  // ---- 장면을 잇는 버튼: 다음 → 화면 → 매칭 시작 → 3단계 막대
  const grow = tw(t, 3.55, 4, Ease.inOut), shrink = tw(t, 4.15, 4.75, Ease.inOut), widen = tw(t, 5.45, 5.95, Ease.inOut);
  const NEXT = [10, 132, 80, 13, 6.5], FULL = [5, 40, 90, 120, 6], GO = [18, 92, 64, 15, 7.5], BAR = [6, 52, 88, 30, 6];
  let rect = NEXT.map((v, i) => lerp(v, FULL[i], grow));
  if (shrink > 0) rect = FULL.map((v, i) => lerp(v, GO[i], shrink));
  if (widen > 0) rect = GO.map((v, i) => lerp(v, BAR[i], widen));
  const press = Math.sin(Math.PI * prog(t, 3.25, 3.45)) + Math.sin(Math.PI * prog(t, 5.25, 5.45));
  box(R.morph, ...rect);
  const leave = prog(t, 8.7, 9.05);
  css(R.morph, {
    background: t < 4.15 ? mix(INK, PINK, grow) : mix(PINK, WHITE, widen),
    transform: `scale(${1 - .04 * press})`, opacity: 1 - leave,
    visibility: t > .4 && t < 9.1 ? "visible" : "hidden",
    boxShadow: widen > .5 ? "0 2cqw 8cqw rgba(29,29,31,.08), inset 0 0 0 .35cqw var(--border)" : "none",
  });
  t > 3.55 ? fall(R.mlab[0], tw(t, 3.55, 3.8, Ease.in)) : rise(R.mlab[0], tw(t, .5, .9));
  t > 5.45 ? fall(R.mlab[1], tw(t, 5.45, 5.65, Ease.in)) : rise(R.mlab[1], tw(t, 4.55, 4.95));

  // ---- 2 세 단계와 남은 사람 수 → 결과 카드
  const vis2 = t > 5.8 && t < 9.1;
  R.steps.forEach((e, i) => { e.classList.toggle("on", t >= 6 + i * .7); css(e, { visibility: vis2 ? "visible" : "hidden", opacity: tw(t, 5.8 + i * .06, 6.1 + i * .06) * (1 - leave) }); });
  R.lines.forEach((e, i) => { e.style.transform = `scaleX(${tw(t, 6.3 + i * .7, 6.7 + i * .7, Ease.inOut)})`; e.parentNode.style.visibility = vis2 ? "visible" : "hidden"; });
  const n = t < 6.7 ? lerp(20, 10, tw(t, 6, 6.4)) : t < 7.4 ? lerp(10, 5, tw(t, 6.7, 7.1)) : lerp(5, 1, tw(t, 7.4, 7.8));
  R.bigN.textContent = Math.round(n);
  const bigIn = tw(t, 5.9, 6.3), bigOut = tw(t, 8.7, 9.05, Ease.in);
  css(R.big, { transform: `translate(-50%, ${(1 - bigIn) * 8 - bigOut * 8}cqw)`, opacity: bigIn * (1 - bigOut), visibility: vis2 ? "visible" : "hidden" });
  css(R.res, { transform: `translateY(${(1 - spring(t - 7.85, .88, 13)) * 50 + tw(t, 8.75, 9.15, Ease.in) * 70}cqw)`, visibility: t > 7.8 && t < 9.2 ? "visible" : "hidden" });

  // ---- 3 카드 넘기기: 왼쪽 넘기기, 오른쪽 좋아요, ★ 슈퍼 좋아요 (맨 위 카드부터)
  const deckIn = spring(t - 9.25, .88, 12);
  const SW = [[9.9, -1, "no"], [11.1, 1, "yes"], [12.3, 0, "sup"]];
  R.deck.slice().reverse().forEach((c, i) => {
    const [at, dir, st] = SW[i];
    const drag = tw(t, at, at + .45, Ease.inOut), fly = tw(t, at + .45, at + .8, Ease.in);
    const depth = Math.max(0, i - SW.filter(([a]) => t > a + .6).length);
    const dx = dir * (drag * 26 + fly * 90), dy = dir === 0 ? -(drag * 6 + fly * 140) : 0;
    css(c, { transform: `translate(${dx}cqw, ${dy + depth * 3.4 + (1 - deckIn) * 80}cqw) rotate(${dir * (drag * 9 + fly * 18)}deg) scale(${1 - depth * .05})`, visibility: t > 9.2 && t < 13.9 ? "visible" : "hidden", zIndex: 30 - i });
    c.querySelector("." + st).style.opacity = tw(t, at + .1, at + .35);
  });
  R.acts.forEach((e, i) => {
    const at = [9.9, 12.3, 11.1][i], k = Math.sin(Math.PI * prog(t, at, at + .7));
    e.classList.toggle("hot", k > .15);
    css(e, { transform: `translate(-50%, ${(1 - spring(t - (9.35 + i * .08), .9, 13)) * 40}cqw) scale(${1 + .12 * k})`, visibility: t > 9.2 && t < 13.9 ? "visible" : "hidden" });
  });

  // ---- 4 매칭 알림 → 상대의 인사 → 직접 써서 보내기
  const live4 = t < 18.7;
  css(R.banner, { transform: `translate(-50%, ${(1 - spring(t - 13.95, .86, 12)) * -60}cqw)`, visibility: t > 13.9 && live4 ? "visible" : "hidden" });
  R.typing.style.visibility = t > 14.5 && t < 15.1 ? "visible" : "hidden";
  R.typing.querySelectorAll("i").forEach((d, i) => { d.style.transform = `translateY(${-1.2 * Math.max(0, Math.sin(t * 7 - i * .8))}cqw)`; });
  const pop = (e, at) => { const k = spring(t - at, .85, 15); css(e, { transform: `translateY(${(1 - k) * 8}cqw) scale(${lerp(.9, 1, k)})`, visibility: t > at && live4 ? "visible" : "hidden" }); };
  pop(R.b1, 15.1);
  css(R.comp, { transform: `translateY(${(1 - spring(t - 14.2, .9, 13)) * 30}cqw)`, visibility: t > 14.1 && live4 ? "visible" : "hidden" });
  const typed = Math.round(MESSAGE.length * tw(t, 16.1, 16.9, x => x));
  R.compTxt.textContent = t > 16.1 && t < 17.45 ? MESSAGE.slice(0, typed) : "메시지 보내기";
  R.compTxt.classList.toggle("filled", t > 16.1 && t < 17.45);
  pop(R.b2, 17.5);

  // ---- 마지막: 보내기 버튼에서 분홍이 번지고, 로고의 실이 다시 이어진다
  R.end.style.clipPath = `circle(${lerp(0, 220, tw(t, 18.55, 19.15, Ease.inOut))}cqw at 87.5cqw 157.5cqw)`;
  R.end.style.visibility = t > 18.5 ? "visible" : "hidden";
  R.root.style.background = t > 19.15 ? "var(--pink-500)" : ""; // 무대 밖 위아래 여백도 같은 색으로
  R.endMark.style.visibility = t > 19 ? "visible" : "hidden";
  R.endMark.querySelector("path").style.strokeDashoffset = 1 - tw(t, 19.1, 19.8, Ease.inOut);
  R.endMark.querySelectorAll("circle").forEach((c, i) => c.setAttribute("r", 3.4 * spring(t - (19.05 + i * .25), .7, 18)));
  rise(R.endL, tw(t, 19.5, 19.95));
  css(R.start, { transform: `translate(-50%, ${(1 - spring(t - 19.95, .9, 14)) * 40}cqw)`, visibility: t > 19.9 ? "visible" : "hidden" });

  // ---- 손가락 (누르는 순간마다 한 박)
  const F = [[0, 50, 190], [.7, 50, 190], [.95, 21.5, 75.3], [1.45, 49.1, 75.3], [1.95, 76.7, 75.3], [2.6, 76.7, 75.3], [3.1, 50, 138.5], [3.6, 50, 140], [4.6, 50, 190],
             [5, 50, 99.5], [5.6, 50, 99.5], [5.9, 60, 190], [9.4, 60, 190], [9.75, 50, 100], [10.35, 20, 100], [10.6, 50, 100], [10.95, 50, 100], [11.55, 80, 100],
             [11.85, 50, 160], [12.2, 50, 153], [12.6, 50, 153], [13, 60, 190], [15.6, 60, 190], [15.95, 40, 157.5], [16.4, 40, 157.5], [17.15, 87.5, 157.5], [17.6, 87.5, 157.5], [18, 70, 190]];
  const [fx, fy] = keyPath(t, F);
  const taps = [1, 1.5, 2, 3.3, 5.3, 12.3, 16, 17.3];
  const p = Math.max(...taps.map(a => Math.sin(Math.PI * prog(t, a - .08, a + .14))));
  const dragging = (t > 9.9 && t < 10.35) || (t > 11.1 && t < 11.55);
  css(R.finger, { left: fx + "cqw", top: fy + "cqw", transform: `translate(-50%, -50%) scale(${1 - .22 * p - (dragging ? .1 : 0)})`, opacity: fy > 175 ? 0 : 1 });
}

registerOverlay("guide", {
  active: () => open,
  html,
  className: () => "guide-mode",
  mount(el) {
    // 다른 화면 때문에 다시 그려져도 보던 시점에서 이어 간다
    clock?.stop();
    const R = grab(el);
    if (REDUCE) { paint(END, R); clock = null; return; }
    clock = playClock(t => paint(t, R), { start: savedT, end: END });
  },
  unmount() { clock?.stop(); clock = null; savedT = 0; },
});

registerActions({
  "guide-open"() { openGuide(); return false; },
  "guide-close"() { backRoute(); return false; },
  "guide-seek"(arg) {
    if (!clock) return false;
    const i = CH.findIndex(([, b]) => clock.t < b);
    const cur = i < 0 ? CH.length : i;
    const next = clamp(cur + Number(arg), 0, CH.length);
    clock.seek(next >= CH.length ? END : CH[next][0]);
    return false;
  },
});
