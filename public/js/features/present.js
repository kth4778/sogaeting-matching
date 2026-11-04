// 발표 모드: 폰 두 대. 왼쪽은 실제로 조작하는 앱, 오른쪽은 서비스를 설명하는 영상이 무한 반복된다.
// 영상은 실제 화면 캡처(public/demo) 위에 카메라·손가락·입력·자막·마스코트를 얹는다. 모든 값은 시간 t 하나로 계산한다.
import { registerActions, render } from "../core/runtime.js";
import { K, E, F, clamp, lerp, tw, arrive, inertia, css, wordsHtml, words, fingerPath, pressScale, playClock } from "../ui/film.js";
import { markSvg, drawMark } from "../ui/brand.js";

const W = 380, H = 852;
const A = "demo/";
export const canPresent = () => !window.matchMedia("(max-width: 760px), (hover: none) and (pointer: coarse)").matches;
export const isPresenting = () => document.body.classList.contains("present");

const div = (parent, cls = "", html = "") => {
  const e = document.createElement("div");
  e.className = cls;
  e.innerHTML = html;
  parent.appendChild(e);
  return e;
};

// ---------- 영상 만들기 ----------
function buildFilm(root) {
  const world = div(root, "dm-world");
  const top = div(root, "dm-top");
  const items = [];
  const assets = [];
  const moves = [];     // 카메라: [시작, 끝, 중심 x, 중심 y, 배율]
  const taps = [];      // 손가락: [시각, x, y]
  const shakes = [];    // [시각, 세기]

  const image = (parent, name) => {
    const src = `${A}${name}.webp`;
    assets.push(src);
    const e = document.createElement("img");
    e.className = "dm-img"; e.src = src; e.alt = ""; e.draggable = false;
    parent.appendChild(e);
    return e;
  };

  // 화면 한 장: a에 들어와 b에 끝난다. 다음 화면이 덮는 동안 조금 더 남는다
  const shot = (name, a, b, how = "fade") => {
    const e = image(world, name);
    items.push(t => {
      const on = t >= a && t < b + .5;
      e.style.display = on ? "" : "none";
      if (!on) return;
      const k = tw(t, a, a + .42, K.expoInOut);
      if (how === "fade") css(e, { opacity: tw(t, a, a + .2, E.ui), transform: "" });
      if (how === "cut") css(e, { opacity: 1, transform: "" });
      if (how === "left") css(e, { opacity: 1, transform: `translateX(${(1 - k) * W}px)` });
      if (how === "up") css(e, { opacity: 1, transform: `translateY(${(1 - k) * H}px)` });
      if (how === "zoom") css(e, { opacity: tw(t, a, a + .18, E.ui), transform: `scale(${lerp(.9, 1, tw(t, a, a + .5, K.expoOut))})` });
    });
    return e;
  };
  const cam = (a, b, cx, cy, z) => moves.push([a, b, cx, cy, z]);
  const tap = (at, x, y) => {
    taps.push([at, x, y]);
    const r = div(world, "dm-ripple");
    items.push(t => {
      const on = t >= at && t < at + .55;
      r.style.display = on ? "" : "none";
      if (!on) return;
      const k = tw(t, at, at + .55, K.expoOut);
      css(r, { left: x + "px", top: y + "px", opacity: .8 * (1 - k), transform: `translate(-50%, -50%) scale(${lerp(.4, 2.1, k)})` });
    });
  };
  // 입력: 글자가 한 자씩 쌓이고, 칸이 좁으면 앞이 밀려난다
  const type = (a, b, until, [x, y, w, h], text, cls = "") => {
    const e = div(world, `dm-type ${cls}`, "<span></span><i></i>");
    css(e, { left: x + "px", top: y + "px", width: w + "px", height: h + "px" });
    const span = e.firstChild, caret = e.lastChild, chars = Array.from(text);
    items.push(t => {
      const on = t >= a && t < until;
      e.style.display = on ? "" : "none";
      if (!on) return;
      const n = Math.round(clamp((t - a) / (b - a)) * chars.length);
      const now = chars.slice(0, n).join("");
      if (span.textContent !== now) {
        span.textContent = now;
        e.classList.toggle("dm-t-over", e.scrollWidth > e.clientWidth);   // 칸을 넘치면 앞이 밀려난다
      }
      caret.style.opacity = Math.sin(t * 12) > -.2 || t < b ? 1 : 0;
    });
  };
  const spot = (a, b, [x, y, w, h], radius = 14) => {
    const e = div(world, "dm-spot");
    css(e, { left: x + "px", top: y + "px", width: w + "px", height: h + "px", borderRadius: radius + "px" });
    items.push(t => {
      const on = t >= a && t < b;
      e.style.display = on ? "" : "none";
      if (on) e.style.opacity = Math.min(tw(t, a, a + .3, K.expoOut), 1 - tw(t, b - .22, b, K.expoIn));
    });
  };
  // 설명 꼬리표: html은 문자열 또는 시간에 따라 바뀌는 함수
  const tag = (a, b, x, y, html) => {
    const e = div(world, "dm-tag");
    css(e, { left: x + "px", top: y + "px" });
    let last = "";
    items.push(t => {
      const on = t >= a && t < b;
      e.style.display = on ? "" : "none";
      if (!on) return;
      const now = typeof html === "function" ? html(t) : html;
      if (now !== last) { e.innerHTML = now; last = now; }
      css(e, { opacity: Math.min(tw(t, a, a + .12, E.ui), 1 - tw(t, b - .2, b, K.expoIn)), transform: `translate(-50%, -50%) scale(${arrive(t, a, .3, .6, 1, .06, 2.6, 6.5)})` });
    });
  };
  // 왼쪽 위 단계 자막: 단어가 차례로 올라온다
  const cap = (a, b, text, y = 56) => {
    const e = div(top, "dm-cap", wordsHtml(text));
    e.style.top = y + "px";
    const w = [...e.querySelectorAll(".mask-in")];
    items.push(t => {
      const on = t >= a && t < b;
      e.style.display = on ? "" : "none";
      if (!on) return;
      css(e, { opacity: Math.min(tw(t, a, a + .1, E.ui), 1 - tw(t, b - .2, b, K.expoIn)), transform: `translateX(-50%) translateY(${(1 - tw(t, a, a + .4, K.expoOut)) * 14}px)` });
      words(w, t, a + .04, { stagger: 4 * F, dur: 22 * F });
    });
  };
  // 마스코트: 관성으로 튀어 올라오고, 말풍선을 달 수 있다
  const mascot = (a, b, pose, { x = 286, y = 640, size = 120, say = "" } = {}, parent = top) => {
    const e = div(parent, "dm-mascot");
    image(e, `mascot-${pose}`);
    const bubble = say ? div(e, "dm-say", say) : null;
    css(e, { left: x + "px", top: y + "px", width: size + "px", height: size + "px" });
    items.push(t => {
      const on = t >= a && t < b;
      e.style.display = on ? "" : "none";
      if (!on) return;
      const out = tw(t, b - .3, b, K.expoIn);
      const bob = Math.sin((t - a) * 3.1) * 3;
      css(e, { transform: `translateY(${arrive(t, a, .45, 220, 0, .07, 2.6, 6) + bob + out * 240}px) rotate(${Math.sin((t - a) * 2.3) * 3}deg)` });
      if (bubble) css(bubble, { opacity: tw(t, a + .35, a + .5, E.ui) * (1 - out), transform: `scale(${arrive(t, a + .35, .25, .7, 1, .05)})` });
    });
  };
  // 입자: 중심에서 흩어져 떨어진다(값은 번호로 정해져 어느 시각이든 같다)
  const burst = (at, x, y, n = 16, cls = "heart") => {
    for (let i = 0; i < n; i++) {
      const p = div(top, `dm-p dm-p-${cls}`);
      const ang = (i / n) * Math.PI * 2 + i * .7, speed = 170 + ((i * 37) % 130), life = .9 + ((i * 13) % 40) / 100;
      items.push(t => {
        const on = t >= at && t < at + life;
        p.style.display = on ? "" : "none";
        if (!on) return;
        const s = t - at, k = s / life;
        const px = x + Math.cos(ang) * speed * (1 - Math.exp(-3 * s)), py = y + Math.sin(ang) * speed * (1 - Math.exp(-3 * s)) + 170 * s * s;
        css(p, { opacity: 1 - k * k, transform: `translate(${px}px, ${py}px) scale(${(1 - k * .6) * (.7 + (i % 3) * .25)}) rotate(${i * 40 + s * 200}deg)` });
      });
    }
  };
  // 단 한 번의 강조: 0.1초에 140→100%로 내리꽂히고 화면이 감쇠하며 흔들린다
  const slam = (a, b, html, cls = "") => {
    const e = div(top, `dm-slam dm-s-${cls}`, html);
    shakes.push([a, 1]);
    items.push(t => {
      const on = t >= a && t < b;
      e.style.display = on ? "" : "none";
      if (!on) return;
      css(e, { opacity: Math.min(1, 1 - tw(t, b - .25, b, K.expoIn)), transform: `translate(-50%, -50%) scale(${lerp(1.5, 1, tw(t, a, a + .11, K.slam)) * (1 + .12 * tw(t, b - .25, b, K.expoIn))})` });
    });
  };
  // 장 표지: 원이 열리며 색이 차고, 번호와 제목 뒤 위로 빠진다
  const title = (a, b, no, text, tone, pose) => {
    const e = div(top, `dm-title dm-t-${tone}`, `<small>${no}</small>${wordsHtml(text)}`);
    const w = [...e.querySelectorAll(".mask-in")];
    mascot(a + .25, b - .02, pose, { x: 214, y: 560, size: 170 }, e);
    items.push(t => {
      const on = t >= a && t < b;
      e.style.display = on ? "" : "none";
      if (!on) return;
      const open = lerp(0, 118, tw(t, a, a + .55, K.iris));
      css(e, { clipPath: `circle(${open}% at 50% 56%)`, transform: `translateY(${-tw(t, b - .36, b, K.expoIn) * H}px)` });
      words(w, t, a + .22, { stagger: 6 * F, dur: 26 * F });
    });
  };
  // 그림 한 장 위에 로고와 문장: 처음과 끝 장면
  const poster = (a, b, name, line) => {
    const e = div(top, `dm-poster dm-p-${name}`);
    image(e, name);
    const logo = div(e, "dm-logo", `${markSvg("mark dm-mark")}${wordsHtml("오늘, 누구와?", "dm-name")}${wordsHtml(line, "dm-line")}`);
    const mark = logo.querySelector(".dm-mark"), nm = [...logo.querySelectorAll(".dm-name .mask-in")], ln = [...logo.querySelectorAll(".dm-line .mask-in")];
    const pic = e.firstChild;
    items.push(t => {
      const on = t >= a && t < b;
      e.style.display = on ? "" : "none";
      if (!on) return;
      e.style.opacity = Math.min(tw(t, a, a + .5, E.ui), 1 - tw(t, b - .5, b, E.ui));
      pic.style.transform = `scale(${lerp(1.09, 1, tw(t, a, b, E.linear))})`;
      drawMark(mark, t, a + .25, { slow: .75 });
      words(nm, t, a + 1.25);
      words(ln, t, a + 1.75, { stagger: 4 * F });
    });
  };

  // ---------- 처음: 서비스 한 문장 ----------
  poster(0, 4.7, "hero", "마음이 통하는 한 사람,\n이유까지 알려드려요");
  mascot(2.5, 4.5, "wave", { x: 268, y: 690, size: 96 });

  // ---------- 1. 프로필 ----------
  title(4.4, 6.1, "01", "내 프로필을\n만들어요", "pink", "point");
  shot("01-welcome", 5.7, 7.5);
  tap(7.1, 190, 712);
  shot("02-ob-08-interests", 7.5, 10.9, "left");
  cam(8, 8.7, 190, 300, 1.42);
  cam(10.2, 10.75, 190, 426, 1);
  cap(8.1, 10.7, "관심사·성격·이상형을 입력해요", 60);
  tap(8.75, 51, 254);
  tap(9.35, 234, 387);
  tap(9.95, 62, 568);

  // ---------- 2. 매칭 ----------
  title(10.7, 12.4, "02", "한 사람을\n이유까지 찾아요", "ink", "think");
  shot("03-home-start", 12.1, 13.6);
  tap(13.25, 190, 538);
  shot("04-run-00", 13.6, 15.1, "zoom");
  cap(13.8, 15.1, "① 조건이 맞는 사람만 남겨요", 116);
  shot("04-run-03", 15.1, 16.9);
  cap(15.2, 16.9, "② 취향이 닮은 정도를 계산해요", 116);
  cam(15.3, 16.1, 190, 430, 1.22);
  cam(16.5, 16.9, 190, 426, 1);
  shot("04-run-06", 16.9, 18.7);
  cap(17, 18.7, "③ AI가 성격까지 읽고 다시 줄 세워요", 116);
  shot("04-run-08", 18.7, 19.9);
  cap(18.8, 19.9, "④ 왜 잘 맞는지 글로 설명해요", 116);
  shot("04-run-10", 19.9, 20.7, "zoom");
  shot("05-result-top", 20.7, 23.7);
  spot(21.3, 23.5, [146, 423, 88, 36], 18);
  tag(21.5, 23.5, 300, 441, t => `궁합 <b>${Math.round(86 * tw(t, 21.5, 22.5, K.expoOut))}</b>점`);
  shot("05-result-mid", 23.7, 26.2, "up");
  cap(24, 26.1, "숫자가 아니라 이유까지 보여 줘요", 60);
  mascot(24.1, 26.0, "point", { x: 278, y: 660, size: 92 });

  // ---------- 3. 카드 ----------
  title(25.9, 27.6, "03", "카드로\n마음을 표현해요", "yellow", "cheer");
  const CARD = [16, 106, 348, 524];
  shot("07-cards", 27.3, 28.9);
  shot("08-like-0", 28.9, 30.4, "cut");
  const fling = (a, name) => {
    const e = image(world, name);
    const [x, y, w, h] = CARD;
    css(e, { clipPath: `inset(${y}px ${W - x - w}px ${H - y - h}px ${x}px round 24px)`, transformOrigin: `${x + w / 2}px ${y + h}px` });
    const stamp = div(world, "dm-stamp", "좋아요");
    items.push(t => {
      const on = t >= a - .05 && t < a + .75;
      e.style.display = stamp.style.display = on ? "" : "none";
      if (!on) return;
      const drag = tw(t, a, a + .34, K.smooth), go = tw(t, a + .36, a + .72, K.expoIn);
      const dx = drag * 92 + go * 420, rot = drag * 8 + go * 18;
      css(e, { opacity: 1, transform: `translate(${dx}px, ${-drag * 6}px) rotate(${rot}deg)` });
      css(stamp, { opacity: tw(t, a + .08, a + .28, E.ui), transform: `translate(${dx}px, 0) rotate(${rot - 12}deg)` });
    });
  };
  fling(28.9, "07-cards");
  taps.push([28.9, 180, 400], [29.22, 272, 392]);
  cap(27.8, 30.3, "오른쪽으로 넘기면 좋아요", 60);
  shot("08-like-1", 30.4, 31.4, "cut");
  fling(30.4, "08-like-0");
  taps.push([30.4, 180, 400], [30.72, 272, 392]);
  shot("09-match", 31.4, 34.0, "zoom");
  slam(31.5, 32.0, "");
  burst(31.5, 190, 230, 20);
  cap(32.2, 33.9, "서로 좋아요면 대화가 열려요", 60);

  // ---------- 4. 메시지 ----------
  title(33.7, 35.4, "04", "매칭되면\n바로 대화해요", "pink", "wave");
  shot("11-room-start", 35.1, 38.7);
  tap(36.1, 190, 824);
  type(36.3, 37.9, 38.7, [12, 804, 356, 40], "안녕하세요! 프로필 보고 반가워서 말 걸어 봐요", "dm-t-room");
  tap(38.25, 348, 824);
  shot("11-room-reply", 38.7, 41.1, "fade");
  cap(39, 41, "상대가 프로필 성격대로 답해요", 104);

  // ---------- 5. 연애 연습 ----------
  title(40.8, 42.5, "05", "연애 대화를\n연습해요", "yellow", "think");
  const feed = [["12-feed-0", 42.2, 44], ["12-feed-2", 44, 45.3], ["12-feed-4", 45.3, 47.2]];
  feed.forEach(([n, a, b], i) => shot(n, a, b, i ? "up" : "fade"));
  const strip = (cls, inset) => { const e = image(world, "12-feed-0"); e.classList.add(cls); e.style.clipPath = inset; items.push(t => { e.style.display = t >= 42.2 && t < 47.2 ? "" : "none"; }); };
  strip("dm-strip", `inset(0 0 ${H - 146}px 0)`);
  strip("dm-strip", `inset(762px 0 0 0)`);
  taps.push([43.72, 300, 520], [44, 300, 300], [45.02, 300, 520], [45.3, 300, 300]);
  cap(42.6, 45.4, "쇼츠처럼 넘기며 상황을 골라요", 262);
  tap(46.85, 224, 722);
  shot("13-brief", 47.2, 50.1, "up");
  cam(47.8, 48.4, 190, 500, 1.2);
  cap(47.8, 49.4, "할 일과 미션을 먼저 봐요", 56);
  cam(49.3, 49.8, 190, 426, 1);
  tap(49.8, 190, 780);
  shot("14-talk-0", 50.1, 52.6, "zoom");
  cap(50.3, 52, "상대가 목소리로 말해요", 110);
  const wave = div(world, "dm-wave", "<i></i><i></i><i></i><i></i>");
  const bars = [...wave.children];
  items.push(t => {
    const on = t >= 50.5 && t < 52;
    wave.style.display = on ? "" : "none";
    if (on) bars.forEach((b, i) => { b.style.transform = `scaleY(${.35 + .65 * Math.abs(Math.sin(t * 9 + i * 1.3))})`; });
  });
  const INPUT = [72, 762, 236, 48];
  const say = (a, text) => {
    tap(a - .1, 190, 786);
    type(a, a + 1.25, a + 1.75, INPUT, text);
    tap(a + 1.5, 340, 786);
  };
  say(51.05, "잊고 있었어, 정말 미안해. 혼자 얼마나 서운했을까");
  shot("15-wait-1", 52.8, 53.6, "cut");
  shot("15-reply-1", 53.6, 56.5);
  spot(53.9, 55.3, [160, 62, 208, 36], 18);
  tag(54, 55.3, 270, 122, "기분이 <b>올라가요</b>");
  say(55.2, "앞으로 기념일은 캘린더에 같이 적어 두자. 약속할게");
  shot("15-wait-2", 56.95, 57.6, "cut");
  shot("15-reply-2", 57.6, 60.2);
  spot(57.9, 58.9, [100, 710, 180, 44], 22);
  tag(58, 58.9, 190, 690, "미션 <b>달성!</b>");
  say(58.9, "이번 주말에 네가 가고 싶던 곳 내가 예약할게");
  shot("15-wait-3", 60.65, 61.2, "cut");
  shot("16-over", 61.2, 64.4);
  slam(61.4, 62.5, "S", "grade");
  burst(61.4, 190, 400, 22, "dot");
  cap(62.6, 64, "S·F가 나오면 바로 끝나요 · 기회 10번", 110);
  tap(64.05, 190, 780);
  shot("17-report-top", 64.4, 66.8, "zoom");
  cap(64.8, 66.7, "연애 대화 보고서가 나와요", 780);
  shot("17-report-low", 66.8, 69.2, "up");
  cap(67, 69.1, "좋은 답과 더 나은 답까지", 780);
  mascot(67.1, 69, "cheer", { x: 276, y: 668, size: 92 });

  // ---------- 끝 ----------
  poster(68.9, 74.2, "ending", "오늘, 마음이 통하는\n한 사람을 만나 보세요");
  mascot(70.8, 73.9, "cheer", { x: 266, y: 680, size: 100 });

  // ---------- 손가락 ----------
  taps.sort((p, q) => p[0] - q[0]);
  const fkeys = [[0, W + 60, H + 60]];
  taps.forEach(([at, x, y], i) => {
    const prev = taps[i - 1];
    if (!prev || at - prev[0] > 1.1) fkeys.push([at - .55, Math.min(W + 40, x + 90), Math.min(H + 50, y + 160)]);
    fkeys.push([at, x, y]);
  });
  const finger = div(world, "dm-finger");
  const tapTimes = taps.map(p => p[0]);

  const camAt = t => {
    let [cx, cy, z] = [W / 2, H / 2, 1];
    for (const [a, b, x, y, k] of moves) {
      if (t < a) break;
      const e = tw(t, a, b, K.expoInOut);
      cx = lerp(cx, x, e); cy = lerp(cy, y, e); z = lerp(z, k, e);
    }
    return [cx, cy, z];
  };

  const DUR = 74.2;
  const paint = time => {
    const t = time % DUR;
    const [cx, cy, z] = camAt(t);
    const tx = Math.min(0, Math.max(W - W * z, W / 2 - cx * z)), ty = Math.min(0, Math.max(H - H * z, H / 2 - cy * z));
    let sx = 0, sy = 0;
    for (const [at, s] of shakes) {
      const u = t - at;
      if (u >= 0 && u < .42) { const a = 7 * s * Math.exp(-13 * u); sx += a * Math.sin(70 * u); sy += a * Math.cos(83 * u); }
    }
    world.style.transform = `translate(${tx + sx}px, ${ty + sy}px) scale(${z})`;
    items.forEach(fn => fn(t));
    const near = tapTimes.some(at => t > at - .6 && t < at + .32);
    finger.style.display = near ? "" : "none";
    if (near) {
      const [fx, fy] = fingerPath(t, fkeys, .16);
      css(finger, { left: fx + "px", top: fy + "px", transform: `translate(-50%, -50%) scale(${pressScale(t, tapTimes) / z})` });
    }
  };
  return { paint, assets, DUR };
}

// ---------- 켜고 끄기 ----------
let phone = null, clock = null, exitBtn = null;

function openPresent() {
  document.body.classList.add("present");
  phone = document.createElement("div");
  phone.className = "phone phone-demo";
  phone.setAttribute("aria-label", "서비스 설명 영상");
  phone.innerHTML = `<span class="hw hw-action"></span><span class="hw hw-vol-up"></span><span class="hw hw-vol-down"></span><span class="hw hw-power"></span>
    <div class="phone-demo-screen"><div class="dm"></div><div class="home-indicator"></div></div>`;
  document.querySelector(".stage").appendChild(phone);
  exitBtn = document.createElement("button");
  exitBtn.className = "present-exit";
  exitBtn.textContent = "발표 모드 끝내기";
  exitBtn.addEventListener("click", closePresent);
  document.body.appendChild(exitBtn);
  window.addEventListener("keydown", onKey);
  window.dispatchEvent(new Event("resize"));
  const { paint, assets } = buildFilm(phone.querySelector(".dm"));
  paint(0);
  // 그림을 미리 풀어 둔다: 처음 나올 때 비어 보이지 않게
  Promise.allSettled(assets.map(src => { const i = new Image(); i.src = src; return i.decode(); })).then(() => {
    if (!phone) return;
    clock = playClock(paint);
  });
}

function closePresent() {
  clock?.stop(); clock = null;
  phone?.remove(); phone = null;
  exitBtn?.remove(); exitBtn = null;
  window.removeEventListener("keydown", onKey);
  document.body.classList.remove("present");
  window.dispatchEvent(new Event("resize"));
  render();
}

const onKey = e => { if (e.key === "Escape" && !document.querySelector(".sheet")) closePresent(); };

registerActions({
  "present-toggle"() {
    if (isPresenting()) closePresent(); else openPresent();
  },
});
