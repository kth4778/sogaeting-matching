// 사용 안내(약 22초): 처음 가입을 마치면 한 번, 내 정보에서 다시 볼 수 있다
// 위쪽 진행 표시는 두 점 사이를 실이 이어 가는 모양이다(로고와 같은 상징). 마지막에 두 점이 가운데로 와서 로고가 된다.
// 1 관심사 칩 → 「다음」이 커져 어두운 배경이 된다 → 2 「매칭 시작」이 단계 막대로 바뀌고 20명이 1명으로
// → 3 카드 넘기기(넘기기·슈퍼 좋아요·좋아요) → 숨 멈춤 → ♥에서 분홍이 터지는 매칭(절정) → 대화 → 시작하기
// 화면 왼쪽·오른쪽을 누르면 이전·다음 단계로, ✕나 마지막 「시작하기」로 닫는다. 좌표 단위는 무대 너비 기준 cqw(높이 177.8).
import { PHOTO_V } from "../core/util.js";
import { registerOverlay, registerActions, render, pushRoute, backRoute } from "../core/runtime.js";
import { REDUCE } from "../ui/motion.js";
import { icon } from "../ui/icons.js";
import { markSvg, drawMark, MARK_PATH } from "../ui/brand.js";
import { F, clamp, prog, lerp, lerpLog, tw, E, springAt, S, hitPulse, css, vis, wordsHtml, words, rollHtml, roll, fingerPath, pressScale, playClock } from "../ui/film.js";

const CH = [[0, 4.6], [4.6, 9.4], [9.4, 14.3], [14.3, 19]];
const END = 22.2;
const SEEN_KEY = "guide-seen";
const MESSAGE = "요즘 어떤 필름 쓰세요?";
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

// ---------- 장면 데이터 ----------
const CHIPS = ["등산", "필름카메라", "커피", "러닝", "전시회", "요리", "여행", "독서", "캠핑"];
const chipPos = i => [22.65 + (i % 3) * 27.6, 66 + Math.floor(i / 3) * 14.5];   // 칩 중심(cqw)
const TAPS1 = [1.0, 1.45, 2.05];                       // 칩을 누르는 시각: 27·36프레임으로 사람답게 불규칙
const NEXT_AT = 3.4;
// 2장: 20명. 단계마다 떨어지는 사람
const PEOPLE = ["p11", "p01", "p12", "p02", "p13", "p03", "p14", "p04", "p15", "p05", "p16", "p06", "p17", "p07", "p18", "p08", "p19", "p09", "p20", "p10"];
const OUT1 = new Set(["p01", "p02", "p03", "p04", "p05", "p06", "p07", "p08", "p09", "p10"]);   // 조건
const OUT2 = new Set(["p11", "p12", "p14", "p17", "p18"]);                                     // 취향
const STAGES = [6.1, 6.95, 7.5];                       // 단계마다 약 40%씩 빨라진다
const gridAt = (i, cols, rows, y0) => [50 + ((i % cols) - (cols - 1) / 2) * 16.5, y0 + (Math.floor(i / cols) - (rows - 1) / 2) * 16.5];
// 3장: 맨 위부터
const DECK = [["p13", "박서준", 29], ["p16", "한지훈", 28], ["p20", "임재원", 27]];
const SWIPE = [{ at: 9.95, dir: -1, stamp: "no" }, { at: 11.15, dir: 0, stamp: "sup" }, { at: 12.1, dir: 1, stamp: "yes" }];
const ACT = { x: [28, 50, 72], y: 129 };              // ✕ ★ ♥ (앱과 같은 순서)
const PEAK = 13.75;                                    // ♥에서 분홍이 터지는 시각

function html() {
  return `
    <div class="gd" aria-label="사용 안내">
      <div class="gd-stage">
        <div class="gd-cam">
          <div class="gd-panel"><b class="q">관심사를 골라 주세요</b><span class="cnt">7 / 10</span><span class="track"><i></i></span>
            <span class="gd-pick">선택 ${rollHtml("gd-pickn")}개</span></div>
          ${CHIPS.map((c, i) => `<span class="gd-chip" style="left:${chipPos(i)[0]}cqw;top:${chipPos(i)[1]}cqw">${c}</span>`).join("")}
          <div class="gd-morph">${wordsHtml("다음", "gd-mnext")}</div>
          <div class="gd-go">${wordsHtml("매칭 시작", "gd-golab")}</div>
          <div class="gd-steps">${["조건", "취향", "궁합"].map(n => `<span><i></i>${n}</span>`).join("")}</div>
          ${PEOPLE.map(id => `<i class="gd-face" style="background-image:url(photos/thumb/${id}.jpg)"></i>`).join("")}
          <div class="gd-count">${rollHtml("gd-countn")}<small>명</small></div>
          <div class="gd-res"><span class="slot"></span><span class="who"><b>임재원 · 27</b><small>둘 다 필름카메라로 계절을 기록해요</small></span>
            <span class="ring"><svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="17"/><circle class="fg" cx="20" cy="20" r="17" pathLength="1" transform="rotate(-90 20 20)"/></svg>${rollHtml("gd-score")}</span></div>
          ${DECK.slice().reverse().map(([id, n, a]) => `<div class="gd-card"><i style="background-image:url(${photo(id)})"></i><b>${n} <small>${a}</small></b><span class="stamp no">넘기기</span><span class="stamp sup">슈퍼 좋아요</span><span class="stamp yes">좋아요</span></div>`).join("")}
          ${[["x", "넘기기"], ["star-fill", "슈퍼 좋아요"], ["heart-fill", "좋아요"]].map(([n, l], i) => `<div class="gd-act a${i}" style="left:${ACT.x[i]}cqw;top:${ACT.y}cqw"><span>${icon(n, 20)}</span><small>${l}</small></div>`).join("")}
          <span class="gd-finger"></span>
        </div>
        <div class="gd-iris"></div>
        <div class="gd-match">
          <i class="gd-av a" style="background-image:url(${photo("me-f")})"></i><i class="gd-av b" style="background-image:url(${photo("p20")})"></i>
          <svg class="gd-tie" viewBox="0 0 100 100"><path pathLength="1" d="${MARK_PATH}"/></svg>
          ${wordsHtml("서로 좋아요,\n대화가 열려요", "gd-mtxt")}
        </div>
        <div class="gd-chat">
          <div class="gd-chead"><i style="background-image:url(${photo("p20")})"></i><b>임재원</b></div>
          <div class="gd-bub them typing"><i></i><i></i><i></i></div>
          <div class="gd-bub them">안녕하세요! 필름카메라 쓰신다고 봤어요</div>
          <div class="gd-bub me">${MESSAGE}</div>
          <div class="gd-comp"><span class="txt"></span><span class="send">${icon("arrow-up", 18)}</span></div>
          <span class="gd-fly">${MESSAGE}</span>
          <span class="gd-finger gd-finger2"></span>
        </div>
        <div class="gd-end">${markSvg("mark gd-endmark")}${wordsHtml("이제 시작해 볼까요?", "gd-endl")}</div>
        <div class="gd-thread"><span class="tr"></span><span class="fill"></span>${[1, 2, 3].map(i => `<span class="tick" style="left:${10 + i * 20}cqw"></span>`).join("")}<span class="dot a"></span><span class="dot b"></span></div>
        ${wordsHtml("관심사만 골라 주세요", "gd-cap c1")}${wordsHtml("세 번 걸러, 한 사람만", "gd-cap c2")}${wordsHtml("넘기고, 마음을 남겨요", "gd-cap c3")}${wordsHtml("통하면 바로 대화", "gd-cap c4")}
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
    root: q(".gd"), stage: q(".gd-stage"), cam: q(".gd-cam"),
    panel: q(".gd-panel"), chips: qa(".gd-chip"), pick: q(".gd-pickn"), morph: q(".gd-morph"), mnext: qa(".gd-mnext .mask-in"),
    go: q(".gd-go"), golab: qa(".gd-golab .mask-in"), steps: q(".gd-steps"), segs: qa(".gd-steps span"),
    faces: qa(".gd-face"), count: q(".gd-count"), countn: q(".gd-countn"),
    res: q(".gd-res"), ring: q(".gd-res .fg"), score: q(".gd-score"),
    cards: qa(".gd-card").reverse(), acts: qa(".gd-act"), finger: q(".gd-cam .gd-finger"),
    iris: q(".gd-iris"), match: q(".gd-match"), avA: q(".gd-av.a"), avB: q(".gd-av.b"), tie: q(".gd-tie path"), mtxt: qa(".gd-mtxt .mask-in"),
    chat: q(".gd-chat"), typing: q(".gd-bub.typing"), them: q(".gd-bub.them:not(.typing)"), me: q(".gd-bub.me"),
    compTxt: q(".gd-comp .txt"), send: q(".gd-comp .send"), fly: q(".gd-fly"), finger2: q(".gd-finger2"),
    end: q(".gd-end"), endmark: q(".gd-endmark"), endl: qa(".gd-endl .mask-in"), start: q(".gd-start"),
    track: q(".gd-thread .tr"), fill: q(".gd-thread .fill"), ticks: qa(".gd-thread .tick"), dots: qa(".gd-thread .dot"),
    caps: [1, 2, 3, 4].map(i => qa(`.gd-cap.c${i} .mask-in`)),
  };
}

// 카메라: 무대의 (ax, ay)를 화면 (50, 88.9)에 배율 k로 둔다. 앵커는 선형, 배율은 로그로 보간한다
const CAM = [[0, 50, 88.9, 1], [.7, 50, 88.9, 1], [1.3, 50, 74, 1.3], [2.55, 50, 76, 1.3], [3.1, 50, 88.9, 1],
  [9.8, 50, 88.9, 1], [10.3, 50, 78, 1.08], [12.6, 50, 78, 1.08], [13.7, 50, 78, 1.1]];
function camAt(t) {
  let i = 0;
  while (i + 1 < CAM.length && t >= CAM[i + 1][0]) i++;
  if (i + 1 >= CAM.length) return CAM[i].slice(1);
  const [a, ax, ay, k] = CAM[i], [b, bx, by, k2] = CAM[i + 1], e = E.cam(prog(t, a, b));
  return [lerp(ax, bx, e), lerp(ay, by, e), lerpLog(k, k2, e)];
}
// 이번 프레임에 12px 넘게 움직이면 그만큼 흐리게(움직임 흐림)
const blurFor = px => (px > 12 ? `blur(${Math.min(8, (px - 12) / 5).toFixed(1)}px)` : "none");

function paint(t, R) {
  savedT = t;
  const W = R.stage.getBoundingClientRect().width / 100 || 1;     // 1cqw = W px
  // 배경: 밝음 → (「다음」이 커져) 어두움 → 밝음(박자에 맞춘 컷) → 분홍(♥에서 터짐) → 밝음(대화)
  const tone = t < 4.22 ? "light" : t < 9.4 ? "dark" : t < 14.3 ? "light" : t < 16.6 ? "pink" : "light";
  R.root.dataset.tone = t >= 19 ? "light" : tone;

  // ---- 카메라(1·3장)와 숨쉬기
  const [ax, ay, k0] = camAt(t);
  const k = k0 * (1 + .012 * Math.sin(t * 1.3)) * (1 + .012 * hitPulse(t, 15.3, 3 * F, 7 * F));
  css(R.cam, { transform: `translate(${50 - ax * k}cqw, ${88.9 - ay * k}cqw) scale(${k})` });

  // ---- 1장: 관심사 칩
  vis(R.panel, t < 4.22);
  R.chips.forEach((c, i) => {
    const at = TAPS1[i] ?? Infinity;
    c.classList.toggle("on", t >= at + F);
    c.style.transform = `translate(-50%, -50%) scale(${(1 + .08 * hitPulse(t, at + F, 3 * F, 12 * F)) * pressScale(t, [at])})`;
    vis(c, t < 4.22);
  });
  roll(R.pick, [[0, 0], [TAPS1[0] + 4 * F, 1], [TAPS1[1] + 4 * F, 2], [TAPS1[2] + 4 * F, 3]], t);

  // ---- 「다음」 버튼 → 화면 전체(어두운 배경)로 46프레임 모프
  const m = tw(t, NEXT_AT + 3 * F, NEXT_AT + 3 * F + 46 * F, E.inOut);
  const NB = [12, 112, 76, 13, 6.5], FULL = [-10, -10, 120, 200, 0];
  const [mx, my, mw, mh, mr] = NB.map((v, i) => lerp(v, FULL[i], m));
  css(R.morph, { left: mx + "cqw", top: my + "cqw", width: mw + "cqw", height: mh + "cqw", borderRadius: mr + "cqw", transform: `scale(${pressScale(t, [NEXT_AT])})` });
  vis(R.morph, t < 4.6);
  words(R.mnext, t, .2, { exitAt: NEXT_AT + 2 * F, exitDur: 6 * F });

  // ---- 2장: 매칭 시작 → 단계 막대, 20 → 10 → 5 → 1
  const goIn = springAt(t - 4.35, S.firm), toBar = tw(t, 5.08, 5.08 + 46 * F, E.inOut);
  const GO = [20, 52.5, 60, 15, 7.5], BAR = [8, 22, 84, 14, 7];
  const [gx, gy, gw, gh, gr] = GO.map((v, i) => lerp(v, BAR[i], toBar));
  css(R.go, { left: gx + "cqw", top: gy + "cqw", width: gw + "cqw", height: gh + "cqw", borderRadius: gr + "cqw",
    transform: `scale(${lerp(.6, 1, goIn) * pressScale(t, [5.0])})`, background: toBar > .5 ? "#2c2c30" : "" });
  vis(R.go, t > 4.3 && t < 9.4);
  words(R.golab, t, 4.45, { exitAt: 5.06, exitDur: 6 * F });
  vis(R.steps, toBar > .95 && t < 9.4);
  R.segs.forEach((s, i) => { s.classList.toggle("on", t >= STAGES[i]); s.style.transform = `scale(${1 + .08 * hitPulse(t, STAGES[i], 2 * F, 8 * F)})`; });

  // 단계마다 떨어지는 사람은 접히고(10·6·4프레임), 남은 사람은 새 줄로 옮겨 간다(5x4 → 5x2 → 5x1)
  const s1 = PEOPLE.filter(id => !OUT1.has(id)), s2 = s1.filter(id => !OUT2.has(id));
  R.faces.forEach((f, i) => {
    const id = PEOPLE[i];
    const appear = springAt(t - (5.5 + (i % 5) * 4 * F + Math.floor(i / 5) * 6 * F), S.firm);
    let [x, y] = gridAt(i, 5, 4, 77);
    const lay = (list, rows, at, dur) => { const j = list.indexOf(id); if (j < 0) return; const [nx, ny] = gridAt(j, 5, rows, 77); const e = tw(t, at, at + dur, E.glide); x = lerp(x, nx, e); y = lerp(y, ny, e); };
    lay(s1, 2, STAGES[0] + 8 * F, 24 * F);
    lay(s2, 1, STAGES[1] + 5 * F, 15 * F);
    const [dAt, dF] = OUT1.has(id) ? [STAGES[0], 10] : OUT2.has(id) ? [STAGES[1], 6] : [STAGES[2], 4];
    const gone = id === "p20" ? 0 : tw(t, dAt, dAt + dF * F, E.in);   // 마지막 한 사람은 남는다
    let sc = appear * (1 - gone);
    // 마지막 한 사람은 결과 카드의 사진 자리로 옮겨 간다(같은 물체가 자리를 옮김)
    if (id === "p20") { const mv = springAt(t - (STAGES[2] + 4 * F), S.move); x = lerp(x, 20, mv); y = lerp(y, 117, mv); sc *= lerp(1, 1.45, mv); }
    css(f, { transform: `translate(${x}cqw, ${y}cqw) translate(-50%, -50%) scale(${sc})` });
    vis(f, t > 5.45 && t < 9.4 && gone < 1);
  });
  roll(R.countn, [[0, 20], [STAGES[0] + 10 * F, 10], [STAGES[1] + 6 * F, 5], [STAGES[2] + 4 * F, 1]], t);
  const cIn = springAt(t - 5.6, S.firm), cOut = tw(t, 7.55, 7.55 + 14 * F, E.in);
  css(R.count, { transform: `translate(-50%, 0) translateY(${(1 - cIn) * 10 - cOut * 6}cqw)`, opacity: 1 - cOut });
  vis(R.count, t > 5.55 && t < 9.4);
  const rIn = springAt(t - 7.62, S.firm);
  css(R.res, { transform: `translateY(${(1 - rIn) * 30}cqw) scale(${lerp(.94, 1, rIn)})` });
  vis(R.res, t > 7.6 && t < 9.4);
  R.ring.style.strokeDashoffset = 1 - .92 * tw(t, 7.9, 8.6, E.out);
  roll(R.score, [[0, 0], [8.6, 92]], t);

  // ---- 3장: 카드 넘기기 (맨 위부터: 넘기기 → 슈퍼 좋아요 → 좋아요)
  R.cards.forEach((c, i) => {
    const sw = SWIPE[i], depth = Math.max(0, i - SWIPE.filter(s => t > s.at + .55).length);
    let dx = 0, dy = 0, rot = 0, lift, speed;
    if (sw.dir !== 0) {
      // 들기 14프레임 → 손가락을 따라 휘어 끌기 → 놓으면 화면 밖으로
      lift = tw(t, sw.at, sw.at + 14 * F, E.out);
      const drag = tw(t, sw.at + 3 * F, sw.at + .42, E.glide), flyAt = sw.at + .45;
      const keep = sw.dir > 0;   // 좋아요한 카드는 날아가지 않고 기운 채 멈춘다(절정 직전 숨 멈춤의 주인공)
      const fly = keep ? 0 : tw(t, flyAt, flyAt + 24 * F, E.in), flyPrev = keep ? 0 : tw(t - F, flyAt, flyAt + 24 * F, E.in);
      const settle = keep ? tw(t, flyAt, flyAt + 30 * F, E.out) : 0;
      dx = sw.dir * (drag * 32 + fly * 130 - settle * 14); dy = -drag * 3 + fly * 8; rot = sw.dir * (drag * 9 + fly * 16 - settle * 4);
      speed = Math.abs(fly - flyPrev) * 130 * W;
    } else {
      const flyAt = sw.at + 4 * F, fly = tw(t, flyAt, flyAt + 22 * F, E.in), flyPrev = tw(t - F, flyAt, flyAt + 22 * F, E.in);
      dy = -fly * 170; lift = tw(t, sw.at, sw.at + 8 * F, E.out); speed = Math.abs(fly - flyPrev) * 170 * W;
    }
    css(c, { transform: `translate(${dx}cqw, ${dy + depth * 3.2}cqw) rotate(${rot}deg) scale(${(1 - depth * .05) * (1 + .03 * lift)})`,
      filter: blurFor(speed), zIndex: 30 - i, boxShadow: `0 ${3 + lift * 3}cqw ${8 + lift * 6}cqw rgba(29, 29, 31, ${.18 + lift * .08})` });
    c.querySelector("." + sw.stamp).style.opacity = tw(t, sw.at + .1, sw.at + .3, E.ui);
    vis(c, t >= 9.4 && t < 14.3);
  });
  R.acts.forEach((a, i) => {
    const at = [SWIPE[0].at + .45, SWIPE[1].at, SWIPE[2].at + .45][i];
    a.classList.toggle("hot", t >= at && (i === 2 || t < at + .6));
    a.style.transform = `translate(-50%, -50%) scale(${(1 + .14 * hitPulse(t, at, 2 * F, 10 * F)) * (i === 1 ? pressScale(t, [SWIPE[1].at]) : 1)})`;
    vis(a, t >= 9.4 && t < 14.3);
  });

  // ---- 손가락: 휘어서 움직이고, 누르기 6프레임 전 잠깐 커졌다가 눌린다. 제품이 스스로 움직이기 시작하면 사라진다
  const FK = [[0, 86, 190], [.55, 86, 190], [TAPS1[0], ...chipPos(0)], [TAPS1[1], ...chipPos(1)], [TAPS1[2], ...chipPos(2)], [NEXT_AT, 50, 118.5], [3.9, 70, 190],
    [4.55, 70, 190], [5.0, 50, 60], [5.4, 60, 70],
    [9.6, 80, 190], [SWIPE[0].at, 52, 70], [SWIPE[0].at + .42, 22, 68], [SWIPE[1].at, ACT.x[1], ACT.y], [SWIPE[2].at, 50, 70], [SWIPE[2].at + .42, 80, 68], [12.9, 84, 190]];
  const [fx, fy] = fingerPath(t, FK);
  const fFade = t > 5.25 ? 1 - prog(t, 5.25, 5.25 + 10 * F) : 1;
  css(R.finger, { left: fx + "cqw", top: fy + "cqw", opacity: fFade,
    transform: `translate(-50%, -50%) scale(${pressScale(t, [...TAPS1, NEXT_AT, 5.0, SWIPE[0].at, SWIPE[1].at, SWIPE[2].at])})` });
  vis(R.finger, (t > .55 && t < 3.95) || (t > 4.55 && t < 5.25 + 10 * F) || (t > 9.6 && t < 12.95));

  // ---- 절정: 숨 멈춤 뒤 ♥ 버튼에서 분홍이 32프레임 동안 터진다 → 두 사람 사이에 실이 이어진다
  const hb = R.acts[2].getBoundingClientRect(), sb = R.stage.getBoundingClientRect();
  const hx = (hb.left + hb.width / 2 - sb.left) / W, hy = (hb.top + hb.height / 2 - sb.top) / W;
  const ir = tw(t, PEAK, PEAK + 32 * F, E.inOut);
  css(R.iris, { clipPath: `circle(${lerpLog(.5, 210, ir)}cqw at ${hx}cqw ${hy}cqw)` });
  vis(R.iris, t > PEAK && t < 16.6);
  const zOut = tw(t, 16.4, 16.4 + 12 * F, E.in);                 // 확대하며 빠진다(줌스루)
  css(R.match, { transform: `scale(${1 + .2 * zOut})`, filter: zOut > 0 ? `blur(${(zOut * 10).toFixed(1)}px)` : "none" });
  vis(R.match, t > 14.25 && t < 16.6);
  const avIn = tw(t, 14.35, 14.35 + 30 * F, E.glide);
  const sq = t >= 15.3 && t < 15.3 + 8 * F ? 1 - E.soft((t - 15.3) / (8 * F)) : 0;      // 실이 닿는 순간
  css(R.avA, { transform: `translate(${lerp(-40, 24, avIn)}cqw, 70cqw) translate(-50%, -50%)` });
  css(R.avB, { transform: `translate(${lerp(140, 76, avIn)}cqw, 72.1cqw) translate(-50%, -50%) scale(${1 + .08 * sq}, ${1 - .1 * sq})` });
  R.tie.style.strokeDashoffset = 1 - tw(t, 14.8, 15.3, E.glide);
  words(R.mtxt, t, 15.0);

  // ---- 대화: 작게 있다가 30프레임에 걸쳐 들어온다 → 상대 인사 → 직접 입력 → 보낸 글이 말풍선으로 옮겨 간다
  const chatOn = t >= 16.6 && t < 19.1;
  css(R.chat, { transform: `scale(${lerp(.75, 1, tw(t, 16.6, 16.6 + 30 * F, E.out))})`, opacity: chatOn ? 1 : 0 });
  vis(R.chat, chatOn);
  vis(R.typing, chatOn && t > 16.95 && t < 17.3);
  R.typing.querySelectorAll("i").forEach((d, i) => { d.style.transform = `translateY(${-1.2 * Math.max(0, Math.sin(t * 7 - i * .8))}cqw)`; });
  const sThem = springAt(t - 17.3, S.firm);
  css(R.them, { transform: `translateY(${(1 - sThem) * 6}cqw) scale(${lerp(.92, 1, sThem)})` });
  vis(R.them, chatOn && t > 17.3);
  const typed = Math.floor(clamp((t - 17.75) / (2 * F), 0, MESSAGE.length));           // 2프레임에 한 글자
  R.compTxt.textContent = t >= 17.75 && t < 18.5 ? MESSAGE.slice(0, typed) : "메시지 보내기";
  R.compTxt.classList.toggle("filled", t >= 17.75 && t < 18.5);
  R.send.style.transform = `scale(${pressScale(t, [18.5])})`;
  const mv = springAt(t - 18.5, S.move);
  css(R.fly, { transform: `translate(${lerp(0, 42, mv)}cqw, ${lerp(0, -80, mv)}cqw)` });
  vis(R.fly, chatOn && t >= 18.5 && mv < .98);
  vis(R.me, chatOn && t >= 18.5 && mv >= .98);
  const [gx2, gy2] = fingerPath(t, [[17.3, 80, 190], [17.62, 40, 147], [18.5, 87.5, 147], [18.9, 80, 190]]);
  css(R.finger2, { left: gx2 + "cqw", top: gy2 + "cqw", transform: `translate(-50%, -50%) scale(${pressScale(t, [17.62, 18.5])})` });
  vis(R.finger2, t > 17.3 && t < 18.85);

  // ---- 위쪽 실(진행) → 마지막에 두 점이 가운데로 와서 로고를 그린다(첫 화면과 같은 동작)
  R.fill.style.transform = `scaleX(${clamp(t / CH[3][1])})`;
  R.ticks.forEach((tk, i) => { const at = CH[i + 1][0]; tk.classList.toggle("on", t >= at); tk.style.transform = `translate(-50%, -50%) scale(${1 + .6 * hitPulse(t, at, 2 * F, 10 * F)})`; vis(tk, t < 19); });
  vis(R.track, t < 19); vis(R.fill, t < 19);
  const gather = tw(t, 19, 19 + 36 * F, E.inOut);
  R.dots.forEach((d, i) => {
    css(d, { transform: `translate(${lerp(i ? 90 : 10, i ? 70.7 : 29.4, gather)}cqw, ${lerp(9, 72, gather)}cqw) translate(-50%, -50%) scale(${lerp(1, 2.2, gather)})` });
    vis(d, gather < 1);
  });
  vis(R.end, t >= 19.6);
  drawMark(R.endmark, Math.max(t, 19.6), 19.0, { slow: .7 });
  words(R.endl, t, 20.2);
  css(R.start, { transform: `translate(-50%, ${(1 - springAt(t - 20.6, S.firm)) * 40}cqw)` });
  vis(R.start, t > 20.6);

  // ---- 장면 설명(아래쪽, 5단어 이하)
  [[.25, 3.9], [4.75, 9.15], [9.5, 13.55], [17.0, 18.9]].forEach(([a, b], i) => words(R.caps[i], t, a, { exitAt: b }));
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
