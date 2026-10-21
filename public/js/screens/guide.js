// 사용 안내(약 22초): 처음 가입을 마치면 한 번, 내 정보에서 다시 볼 수 있다
// 움직임 값은 BIBER MOTION KIT 레시피를 웹으로 옮긴 것이다(등장 expo-out · 퇴장 expo-in · 전환 expo-inout, 도착 뒤 관성).
// 1 관심사 칩(선택 파문) → 「다음」 속으로 줌 스루 → 2 단계 알약 · 브래킷 조준 · 감속 카운트로 20명이 1명
// → 블러 줌 컷 → 3 기울어진 카드 더미 넘기기(넘기기·슈퍼 좋아요·좋아요) → ♥에서 분홍이 번짐
// → 4 「매치!」 슬램과 흔들림, 두 사람이 실로 이어짐 → 어둠 속에서 원이 열리며 로고 → 시작하기
// 화면 왼쪽·오른쪽을 누르면 이전·다음 단계로, ✕나 마지막 「시작하기」로 닫는다. 좌표 단위는 무대 너비 기준 cqw(높이 177.8).
import { PHOTO_V } from "../core/util.js";
import { registerOverlay, registerActions, render, pushRoute, backRoute } from "../core/runtime.js";
import { REDUCE } from "../ui/motion.js";
import { icon } from "../ui/icons.js";
import { markSvg, drawMark, MARK_PATH } from "../ui/brand.js";
import { F, clamp, prog, lerp, lerpLog, tw, E, K, arrive, inertia, hitPulse, css, vis, wordsHtml, words, rollHtml, roll, fingerPath, pressScale, playClock } from "../ui/film.js";

const CH = [[0, 4.3], [4.3, 10.6], [10.6, 15.2], [15.2, 19.2]];
const END = 22.3;
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

// ---------- 장면 데이터 ----------
const STEPS = ["관심사를 고르고", "세 번 거르면", "마음을 남기고", "통하면 대화"];   // 왼쪽 위 단계 캡션(동사형)
const CHIPS = ["등산", "필름카메라", "커피", "러닝", "전시회", "요리", "여행", "독서", "캠핑"];
const chipPos = i => [22.65 + (i % 3) * 27.6, 66 + Math.floor(i / 3) * 14.5];   // 칩 중심(cqw)
const TAPS1 = [1.75, 2.25, 2.85];
const NEXT = { at: 3.6, x: 50, y: 114.5 };             // 「다음」을 누르는 시각과 버튼 중심
const ZOOM1 = [3.75, 4.3];                             // 「다음」 속으로 줌 스루(expo-in) → 컷
// 2장: 20명. 단계마다 떨어지는 사람
const PEOPLE = ["p11", "p01", "p12", "p02", "p13", "p03", "p14", "p04", "p15", "p05", "p16", "p06", "p17", "p07", "p18", "p08", "p19", "p09", "p20", "p10"];
const OUT1 = new Set(["p01", "p02", "p03", "p04", "p05", "p06", "p07", "p08", "p09", "p10"]);   // 조건
const OUT2 = new Set(["p11", "p12", "p14", "p17", "p18"]);                                     // 취향
const ST = [5.5, 6.5, 7.5];                            // 조건 · 취향 · 궁합
const LEFT = [20, 10, 5, 1];
const gridAt = (i, cols, rows) => [50 + ((i % cols) - (cols - 1) / 2) * 16.5, 80 + (Math.floor(i / cols) - (rows - 1) / 2) * 16.5];
const BOX = [[79, 62.5], [79, 29.5], [79, 13], [13, 13]];   // 브래킷이 감싸는 크기(남은 사람들)
const RES = 8.7;                                       // 결과 카드 착지
const CUT2 = [10.3, 10.6, 11.02];                      // 블러 줌 컷: 나가기 → 들어오기
// 3장: 맨 위부터
const DECK = [["p13", "박서준", 29], ["p16", "한지훈", 28], ["p20", "임재원", 27]];
const SW = [11.5, 12.7, 13.7];                         // 넘기기 · 슈퍼 좋아요 · 좋아요
const LEAVE = [SW[0] + .45, SW[1] + .06];              // 카드가 더미를 떠나는 시각
const ACT = { x: [28, 50, 72], y: 138 };               // ✕ ★ ♥ (앱과 같은 순서)
const PEAK = 14.75;                                    // ♥에서 분홍이 번지는 시각
// 4장
const SLAM = 15.45;
const AV = [[24, 92], [76, 94.2]];                     // 두 사람 = 로고의 두 점 자리
const BUB = [17.0, 17.9];
// 끝
const INK = 19.2, IRIS = [19.35, 20.25], LOGO = 19.45, LINE = 20.4, START = 21.0;

const rippleHtml = (cls, x, y, w, h, r) => `<span class="gd-rip ${cls}" style="left:${x - w / 2}cqw;top:${y - h / 2}cqw;width:${w}cqw;height:${h}cqw;border-radius:${r}"><i></i><i></i>${"<b></b>".repeat(8)}</span>`;

function html() {
  return `
    <div class="gd" aria-label="사용 안내">
      <div class="gd-stage">
        <div class="gd-sc s1">
          <div class="gd-panel"><b class="q">관심사를 골라 주세요</b><span class="gd-pick">선택 ${rollHtml("gd-pickn")}개</span></div>
          ${CHIPS.map((c, i) => `<span class="gd-chip" style="left:${chipPos(i)[0]}cqw;top:${chipPos(i)[1]}cqw">${c}</span>`).join("")}
          ${TAPS1.map((_, i) => rippleHtml("rp-chip", ...chipPos(i), 25, 11, "99px")).join("")}
          <div class="gd-next">다음</div>
        </div>
        <div class="gd-sc s2">
          <div class="gd-pills"><span class="hl"></span>${["조건", "취향", "궁합"].map(n => `<span class="pl">${n}</span>`).join("")}</div>
          <div class="gd-count"><span class="n">20</span><small>명</small></div>
          <div class="gd-res"><span class="who"><b>임재원 · 27</b><small>둘 다 필름카메라로 계절을 기록해요</small></span>
            <span class="ring"><svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="17"/><circle class="fg" cx="20" cy="20" r="17" pathLength="1" transform="rotate(-90 20 20)"/></svg><b class="score">0</b></span></div>
          ${rippleHtml("rp-ring", 79, 132, 22, 22, "50%")}
          ${PEOPLE.map(id => `<i class="gd-face" style="background-image:url(photos/thumb/${id}.jpg)"></i>`).join("")}
          <span class="gd-brk"><i></i><i></i><i></i><i></i></span>
        </div>
        <div class="gd-sc s3">
          ${DECK.slice().reverse().map(([id, n, a]) => `<div class="gd-card"><i style="background-image:url(${photo(id)})"></i><b>${n} <small>${a}</small></b><span class="stamp no">넘기기</span><span class="stamp sup">슈퍼 좋아요</span><span class="stamp yes">좋아요</span></div>`).join("")}
          ${[["x", "넘기기"], ["star-fill", "슈퍼 좋아요"], ["heart-fill", "좋아요"]].map(([n, l], i) => `<div class="gd-act a${i}" style="left:${ACT.x[i]}cqw;top:${ACT.y}cqw"><span><em>${icon(n, 20)}</em></span><small>${l}</small></div>`).join("")}
        </div>
        <div class="gd-iris"></div>
        <div class="gd-sc s4">
          <b class="gd-slam">매치!</b>
          <svg class="gd-tie" viewBox="0 0 100 100" style="top:${AV[0][1] - 53.1 * .756}cqw"><path pathLength="1" d="${MARK_PATH}"/></svg>
          <i class="gd-av a" style="background-image:url(${photo("me-f")})"></i><i class="gd-av b" style="background-image:url(${photo("p20")})"></i>
          <div class="gd-bub them">안녕하세요! 필름카메라 쓰신다고 봤어요</div>
          <div class="gd-bub me">요즘 어떤 필름 쓰세요?</div>
        </div>
        <div class="gd-ink"></div>
        <div class="gd-open">${markSvg("mark gd-endmark")}${wordsHtml("이제 시작해 볼까요?", "gd-endl")}</div>
        <div class="gd-thread"><span class="tr"></span><span class="fill"></span>${[1, 2, 3].map(i => `<span class="tick" style="left:${10 + i * 20}cqw"></span>`).join("")}</div>
        ${STEPS.map((s, i) => `<span class="gd-step"><b>0${i + 1}</b>${s}</span>`).join("")}
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
    root: q(".gd"), stage: q(".gd-stage"), s1: q(".s1"), s2: q(".s2"), s3: q(".s3"), s4: q(".s4"),
    panel: q(".gd-panel"), chips: qa(".gd-chip"), pick: q(".gd-pickn"), next: q(".gd-next"), chipRips: qa(".gd-rip.rp-chip"),
    pills: qa(".gd-pills .pl"), hl: q(".gd-pills .hl"), faces: qa(".gd-face"), brk: q(".gd-brk"),
    count: q(".gd-count"), countn: q(".gd-count .n"), res: q(".gd-res"), ring: q(".gd-res .fg"), score: q(".gd-res .score"), ringRip: q(".gd-rip.rp-ring"),
    cards: qa(".gd-card").reverse(), acts: qa(".gd-act"), star: q(".gd-act.a1 em"),
    iris: q(".gd-iris"), slam: q(".gd-slam"), tie: q(".gd-tie path"), avA: q(".gd-av.a"), avB: q(".gd-av.b"), bubs: qa(".gd-bub"),
    ink: q(".gd-ink"), opener: q(".gd-open"), endmark: q(".gd-endmark"), endl: qa(".gd-endl .mask-in"), start: q(".gd-start"),
    fill: q(".gd-thread .fill"), thread: q(".gd-thread"), ticks: qa(".gd-thread .tick"), steps: qa(".gd-step"), finger: q(".gd-finger"),
  };
}

const show = (e, on) => { e.style.display = on ? "" : "none"; };   // 장면 단위 숨김(자식의 visibility가 뚫지 못하게)

// 선택 파문(키트 58): 링 두 겹이 0.18초 간격으로 100→128%, 투명도 0→85→0. 반짝이 8개가 바깥으로 흩어진다
function ripple(g, t, at) {
  const [r1, r2, ...sp] = g.children;
  [r1, r2].forEach((r, j) => {
    const a = at + j * .18, k = tw(t, a, a + .75, K.expoOut);
    css(r, { transform: `scale(${lerp(1, 1.28, k)})`, opacity: .85 * prog(t, a, a + .08) * (1 - k) });
  });
  const k = tw(t, at, at + .6, K.expoOut);
  sp.forEach((s, i) => {
    const ang = i / 8 * 2 * Math.PI + .4, rr = lerp(.9, 1.45, k);
    css(s, { left: 50 + Math.cos(ang) * 50 * rr + "%", top: 50 + Math.sin(ang) * 50 * rr + "%", transform: `translate(-50%, -50%) scale(${1 - k})`, opacity: t >= at ? 1 - k : 0 });
  });
}
// 관성 튀기(키트 03): 1 → 1.12 → 1을 0.3초에, 끝에서 살짝 덜 돌아왔다 안착
const bounce = (t, at, to = .12) => 1 + to * (tw(t, at, at + .15, K.expoOut) - tw(t, at + .15, at + .3, K.smooth)) + inertia(t, at + .3, -to / .15, .06, 2.6, 6.5);

function paint(t, R) {
  savedT = t;
  const W = R.stage.getBoundingClientRect().width / 100 || 1;      // 1cqw = W px
  const kb = n => (n > .05 ? `blur(${(n / 10.8 * W).toFixed(1)}px)` : "none");   // 키트의 px(1080 기준) 흐림을 화면 px로
  R.root.dataset.tone = t < ZOOM1[1] ? "light" : t < CUT2[1] ? "dark" : t < PEAK + .25 ? "light" : t < INK ? "pink" : t < IRIS[0] + .45 ? "dark" : "light";

  // ---- 1장: 패널이 깊이감 있게 착지(53) → 칩 스태거(04) → 칩을 누를 때마다 튀기(03) + 선택 파문(58)
  show(R.s1, t < ZOOM1[1]);
  const zk = K.expoIn(prog(t, ZOOM1[0], ZOOM1[1]));
  css(R.s1, { transformOrigin: `${NEXT.x}cqw ${NEXT.y}cqw`, transform: `scale(${lerpLog(1, 16, zk)})` });
  const away = 1 - tw(t, ZOOM1[0], ZOOM1[1] - .2, K.expoIn);       // 버튼 밖은 컷 0.2초 전에 사라진다
  const land = tw(t, .1, .8, K.expoOut);
  css(R.panel, { transform: `translateY(${arrive(t, .1, .7, -14.8, 0, .06, 2.6, 6.5)}cqw) scale(${lerp(1.04, 1, land)})`,
    opacity: tw(t, .1, .3, K.expoOut) * away, boxShadow: `${1.1 * land}cqw ${2.4 * land}cqw ${2.2 + 3 * land}cqw rgba(29, 29, 31, ${.08 + .1 * land})` });
  R.chips.forEach((c, i) => {
    const a = .5 + i * .06, k = tw(t, a, a + 1.1, K.stagger), at = TAPS1[i];
    c.classList.toggle("on", t >= at);
    const sc = at ? bounce(t, at) * pressScale(t, [at]) : 1;      // 누르지 않는 칩은 튀지 않는다(Infinity를 넣으면 NaN)
    css(c, { transform: `translate(-50%, calc(-50% + ${(1 - k) * 5.5}cqw)) scale(${sc})`, filter: kb(14 * (1 - k)), opacity: k * away });
  });
  R.chipRips.forEach((g, i) => ripple(g, t, TAPS1[i]));
  roll(R.pick, [[0, 0], ...TAPS1.map((a, i) => [a + 4 * F, i + 1])], t);
  const nk = tw(t, 1.0, 2.1, K.stagger), ready = tw(t, TAPS1[2] + .1, TAPS1[2] + .4, K.expoOut);
  css(R.next, { transform: `translate(-50%, calc(-50% + ${(1 - nk) * 5.5}cqw)) scale(${pressScale(t, [NEXT.at])})`, filter: kb(14 * (1 - nk)),
    opacity: nk * lerp(.3, 1, ready), color: t > ZOOM1[0] ? "transparent" : "" });

  // ---- 2장: 줌 스루로 들어와 0.85 → 1(expo-out). 단계 알약(77) · 브래킷 조준(70) · 감속 카운트(57)
  show(R.s2, t >= ZOOM1[1] && t < CUT2[1]);
  const in2 = K.expoOut(prog(t, ZOOM1[1], ZOOM1[1] + .6)), out2 = K.zoomOut(prog(t, CUT2[0], CUT2[1]));
  css(R.s2, { transform: `scale(${lerp(.85, 1, in2) * lerp(1, 1.12, out2)})`, filter: kb(42 * out2) });
  R.pills.forEach((p, i) => {
    const k = tw(t, 4.3 + i * .08, 5.1 + i * .08, K.stagger);
    css(p, { transform: `translateY(${(1 - k) * 4}cqw)`, filter: kb(14 * (1 - k)), opacity: k * lerp(.32, 1, tw(t, ST[i], ST[i] + .2, K.expoOut)) });
  });
  const hx = tw(t, ST[1], ST[1] + .45, K.smooth) + tw(t, ST[2], ST[2] + .45, K.smooth);
  css(R.hl, { transform: `translateX(${hx * 29}cqw) scale(${lerp(.6, 1, tw(t, ST[0], ST[0] + .35, K.expoOut))})`, opacity: tw(t, ST[0], ST[0] + .15, K.expoOut) });

  // 단계마다: 떨어지는 사람은 흐려지고(14·0.4) 접혀 사라지며, 남은 사람은 새 줄로 옮겨 간다(5x4 → 5x2 → 5x1 → 1)
  const s1 = PEOPLE.filter(id => !OUT1.has(id)), s2 = s1.filter(id => !OUT2.has(id));
  R.faces.forEach((f, i) => {
    const id = PEOPLE[i];
    const a = 4.35 + (i % 5) * .04 + Math.floor(i / 5) * .06, k = tw(t, a, a + 1.0, K.stagger);
    let [x, y] = gridAt(i, 5, 4);
    const lay = (list, rows, s) => { const j = list.indexOf(id); if (j < 0) return; const [nx, ny] = list.length === 1 ? [50, 80] : gridAt(j, 5, rows); const e = tw(t, s + .4, s + 1.0, K.expoInOut); x = lerp(x, nx, e); y = lerp(y, ny, e); };
    lay(s1, 2, ST[0]); lay(s2, 1, ST[1]); lay(["p20"], 1, ST[2]);
    const s = OUT1.has(id) ? ST[0] : OUT2.has(id) ? ST[1] : id !== "p20" ? ST[2] : 0;   // 0 = 끝까지 남는 사람
    const d = s ? tw(t, s, s + .4, K.expoInOut) : 0, gone = s ? tw(t, s + .35, s + .6, K.expoIn) : 0;
    let sc = 1 - gone;
    // 마지막 한 사람은 결과 카드의 사진 자리로 옮겨 간다(같은 물체가 자리를 옮김)
    if (id === "p20") { const mv = tw(t, RES + .1, RES + .75, K.expoInOut); x = lerp(x, 20, mv); y = lerp(y, 132, mv); sc *= lerp(1, 1.45, mv); }
    css(f, { transform: `translate(${x}cqw, calc(${y}cqw + ${(1 - k) * 5.5}cqw)) translate(-50%, -50%) scale(${sc})`,
      filter: kb(Math.max(14 * (1 - k), 14 * d)), opacity: k * (1 - .6 * d) });
    vis(f, gone < 1);
  });
  // 브래킷: 남은 사람들을 감싸는 상자가 단계마다 expo-inout으로 조여 든다
  let [bw, bh] = BOX[0];
  ST.forEach((s, i) => { const e = tw(t, s + .4, s + 1.0, K.expoInOut); bw = lerp(bw, BOX[i + 1][0], e); bh = lerp(bh, BOX[i + 1][1], e); });
  const pad = 2.2, bIn = tw(t, ST[0] - .3, ST[0], K.expoOut), bOut = tw(t, RES, RES + .25, K.expoIn);
  css(R.brk, { left: 50 - bw / 2 - pad + "cqw", top: 80 - bh / 2 - pad + "cqw", width: bw + pad * 2 + "cqw", height: bh + pad * 2 + "cqw",
    opacity: bIn * (1 - bOut), transform: `scale(${lerp(1.15, 1, bIn)})` });
  // 남은 사람 수: 단계마다 0.5초 감속 카운트, 88 → 100% 커지며
  let n = LEFT[0], cs = 1;
  ST.forEach((s, i) => { const e = tw(t, s + .1, s + .6, K.expoOut); if (t >= s + .1) { n = Math.round(lerp(LEFT[i], LEFT[i + 1], e)); cs = lerp(.88, 1, e); } });
  R.countn.textContent = n;
  const cIn = tw(t, 4.7, 5.5, K.stagger), cOut = tw(t, RES - .25, RES, K.expoIn);
  css(R.count, { transform: `translate(-50%, ${(1 - cIn) * 5.5 + cOut * 4}cqw) scale(${cs})`, filter: kb(14 * (1 - cIn)), opacity: cIn * (1 - cOut) });
  // 결과 카드: 위에서 떨어져 착지(53), 점수 고리가 그려지며(05) 숫자가 함께 올라가고, 끝에 파문
  const rk = tw(t, RES, RES + .7, K.expoOut);
  css(R.res, { transform: `translateY(${arrive(t, RES, .7, -14.8, 0, .06, 2.6, 6.5)}cqw) scale(${lerp(1.06, 1, rk)})`, opacity: tw(t, RES, RES + .15, K.expoOut),
    boxShadow: `${1.1 * rk}cqw ${2.4 * rk}cqw ${2.2 + 3 * rk}cqw rgba(0, 0, 0, ${.2 + .2 * rk})` });
  const sk = tw(t, 9.3, 10.1, K.expoOut);
  R.ring.style.strokeDashoffset = 1 - .92 * sk;
  R.score.textContent = Math.round(92 * sk);
  ripple(R.ringRip, t, 9.95);

  // ---- 3장: 블러 줌 컷(72)으로 들어온다. 기울어진 카드 더미(44)가 진자처럼 흔들리고, 뒤 카드는 0.055초씩 늦게 따라온다(12)
  show(R.s3, t >= CUT2[1] && t < PEAK + .6);
  const in3 = K.zoomIn(prog(t, CUT2[1], CUT2[2]));
  css(R.s3, { transform: `scale(${lerp(1.08, 1, in3)})`, filter: kb(42 * (1 - in3)) });
  R.cards.forEach((c, i) => {
    let depth = i;
    LEAVE.forEach((L, j) => { if (j < i) { const a = L + .055 * (i - j); depth -= tw(t, a, a + .5, K.expoOut) - inertia(t, a + .5, 1 / .5, .06, 2.6, 6.5); } });
    const at = SW[i];
    let dx = 0, dy = 0, rot = 0, ry = 0, lift = tw(t, at, at + .2, K.expoOut);
    if (i === 1) {                                   // 슈퍼 좋아요: 위로 날아간다
      const fly = tw(t, at + .06, at + .43, K.expoIn);
      dy = -fly * 170;
    } else {                                         // 손가락을 따라 끌었다가 놓는다
      const drag = tw(t, at + .05, at + .42, K.expoInOut), dir = i === 0 ? -1 : 1;
      const fly = i === 0 ? tw(t, at + .45, at + .85, K.expoIn) : 0;
      const settle = i === 2 ? arrive(t, at + .45, .5, 0, 1, .06, 2.6, 6.5) : 0;   // 좋아요한 카드는 기운 채 멈춘다
      dx = dir * (drag * 30 + fly * 120 - settle * 12); dy = -drag * 2 + fly * 10; rot = dir * (drag * 9 + fly * 14 - settle * 3); ry = dir * fly * 25;
    }
    const sway = 3 * Math.sin(2 * Math.PI * (t / 4.6 + i / 3)) * (1 - lift);
    css(c, { transform: `translate(${dx}cqw, ${dy + depth * 3.2}cqw) translateZ(${-depth * 6}cqw) rotateX(4deg) rotateY(${sway + ry}deg) rotate(${rot}deg) scale(${(1 - depth * .05) * (1 + .03 * lift)})`,
      zIndex: 30 - i, boxShadow: `${1.1 + .4 * lift}cqw ${2.4 + 1.2 * lift}cqw ${2.2 + 2 * lift}cqw rgba(29, 29, 31, ${.2 + .12 * lift - depth * .05})` });
    c.querySelector(".stamp." + ["no", "sup", "yes"][i]).style.opacity = tw(t, at + .1, at + .3, K.expoOut);
  });
  const ACT_AT = [LEAVE[0], SW[1], SW[2] + .45];
  R.acts.forEach((a, i) => {
    const k = tw(t, 10.8 + i * .07, 11.6 + i * .07, K.stagger);
    a.classList.toggle("hot", t >= ACT_AT[i] && (i === 2 || t < ACT_AT[i] + .6));
    css(a, { transform: `translate(-50%, calc(-50% + ${(1 - k) * 5.5}cqw)) scale(${(1 + .14 * hitPulse(t, ACT_AT[i], 2 * F, 10 * F)) * (i === 1 ? pressScale(t, [SW[1]]) : 1)})`, opacity: k });
  });
  // ★ 스쿼시(11): 눌리는 순간 132×70 → 92×112 → 100×100
  const q1 = tw(t, SW[1], SW[1] + .08, K.expoOut), q2 = tw(t, SW[1] + .08, SW[1] + .22, K.expoOut), q3 = tw(t, SW[1] + .22, SW[1] + .45, K.expoOut);
  R.star.style.transform = `scale(${lerp(lerp(lerp(1, 1.32, q1), .92, q2), 1, q3)}, ${lerp(lerp(lerp(1, .7, q1), 1.12, q2), 1, q3)})`;

  // ---- 절정: ♥ 버튼에서 분홍이 번진다(expo-inout)
  const ir = tw(t, PEAK, PEAK + .5, K.expoInOut);
  css(R.iris, { clipPath: `circle(${lerpLog(.5, 210, ir)}cqw at ${ACT.x[2]}cqw ${ACT.y}cqw)` });
  show(R.iris, t > PEAK && t < INK);

  // ---- 4장: 「매치!」만 슬램(84) — 0.1초에 140 → 100%, 장면 전체가 0.4초 감쇠 흔들림
  show(R.s4, t >= PEAK + .45 && t < INK);
  const tau = t - SLAM, shake = tau >= 0 && tau < .4 ? 1.48 * Math.exp(-14 * tau) : 0;   // 16px(1080 기준)
  css(R.s4, { transform: `translate(${shake * Math.sin(70 * tau)}cqw, ${shake * Math.cos(83 * tau)}cqw)` });
  css(R.slam, { transform: `translate(-50%, -50%) scale(${lerp(1.4, 1, tw(t, SLAM, SLAM + .1, K.slam))})`, opacity: t >= SLAM ? 1 : 0 });
  // 두 사람이 양옆에서 들어와 관성으로 안착 → 실이 이어지고 → 닿는 순간 살짝 찌그러진다
  const tieEnd = 16.6, sq = t >= tieEnd && t < tieEnd + 8 * F ? 1 - E.soft((t - tieEnd) / (8 * F)) : 0;
  css(R.avA, { transform: `translate(${arrive(t, 15.6, .6, -30, AV[0][0], .06, 2.6, 6.5)}cqw, ${AV[0][1]}cqw) translate(-50%, -50%)` });
  css(R.avB, { transform: `translate(${arrive(t, 15.66, .6, 130, AV[1][0], .06, 2.6, 6.5)}cqw, ${AV[1][1]}cqw) translate(-50%, -50%) scale(${1 + .08 * sq}, ${1 - .1 * sq})` });
  const tied = tw(t, 16.1, tieEnd, E.glide);
  css(R.tie, { strokeDashoffset: 1 - tied, opacity: tied > 0 ? 1 : 0 });   // 그리기 전엔 둥근 끝이 점으로 찍히지 않게
  R.bubs.forEach((b, i) => {
    css(b, { transform: `translateY(${arrive(t, BUB[i], .35, 3, 0, .04)}cqw) scale(${arrive(t, BUB[i], .35, .6, 1, .04)})`, opacity: tw(t, BUB[i], BUB[i] + .12, K.expoOut) });
  });

  // ---- 끝: 어둠으로 컷 → 원이 열리며(85) 밝은 면 안에서 로고가 그려지고(05) → 시작하기(스냅 + 관성)
  show(R.ink, t >= INK);
  const io = K.iris(prog(t, IRIS[0], IRIS[1]));
  css(R.opener, { clipPath: `circle(${lerp(0, 106.5, io)}cqw at 50cqw 88.9cqw)` });
  show(R.opener, t >= IRIS[0]);
  drawMark(R.endmark, Math.max(t, LOGO), LOGO, { slow: .7 });
  words(R.endl, t, LINE);
  const sk2 = tw(t, START, START + .3, K.snap);
  css(R.start, { transform: `translate(-50%, ${(1 - sk2) * 6}cqw) scale(${arrive(t, START, .3, .9, 1)})`, opacity: sk2 });
  vis(R.start, t >= START);

  // ---- 위쪽 진행 실과 왼쪽 위 단계 캡션(59): 24px 왼쪽에서 0.35초 expo-out, 장면 끝 0.2초 전에 빠진다
  R.fill.style.transform = `scaleX(${clamp(t / INK)})`;
  R.ticks.forEach((tk, i) => { const at = CH[i + 1][0]; tk.classList.toggle("on", t >= at); tk.style.transform = `translate(-50%, -50%) scale(${1 + .6 * hitPulse(t, at, 2 * F, 10 * F)})`; });
  show(R.thread, t < INK);
  R.steps.forEach((s, i) => {
    const [a, b] = CH[i], k = tw(t, a + .15, a + .5, K.expoOut), o = tw(t, b - .4, b - .2, K.expoIn);
    css(s, { transform: `translateX(${(1 - k) * -2.2 - o * 1}cqw)`, opacity: k * (1 - o) });
  });

  // ---- 손가락: 휘어서 움직이고, 누르기 직전 커졌다가 눌린다
  const FK = [[0, 86, 190], [1.3, 86, 190], [TAPS1[0], ...chipPos(0)], [TAPS1[1], ...chipPos(1)], [TAPS1[2], ...chipPos(2)], [NEXT.at, NEXT.x, NEXT.y], [ZOOM1[0] + .1, 70, 190],
    [10.9, 80, 190], [SW[0], 52, 80], [SW[0] + .42, 22, 78], [SW[1], ACT.x[1], ACT.y], [SW[2], 50, 80], [SW[2] + .42, 80, 78], [14.5, 84, 190]];
  const [fx, fy] = fingerPath(t, FK);
  css(R.finger, { left: fx + "cqw", top: fy + "cqw", transform: `translate(-50%, -50%) scale(${pressScale(t, [...TAPS1, NEXT.at, ...SW])})` });
  vis(R.finger, (t > 1.3 && t < ZOOM1[0] + .1) || (t > 10.9 && t < 14.5));
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
