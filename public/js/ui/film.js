// 시간 하나(t, 초)로 장면을 그리는 모션 도구 — 첫 화면 영상과 사용 안내가 같이 쓴다
// 타이머·CSS 애니메이션 대신 매 프레임 render(t)가 모든 스타일을 정한다. 어느 시점으로 건너뛰어도 같은 화면이 나온다.
// 값은 모션 스킬 cinetic·product-film의 토큰을 따른다(120 BPM: 1박 0.5초 = 30프레임).

export const F = 1 / 60;                       // 1프레임(초)
export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const prog = (t, a, b) => clamp((t - a) / (b - a));
export const lerp = (a, b, k) => a + (b - a) * k;
export const lerpLog = (a, b, k) => Math.exp(lerp(Math.log(a), Math.log(b), k)); // 확대·축소는 로그 공간에서

// ---------- 움직임 곡선 ----------
function bezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const x = s => ((ax * s + bx) * s + cx) * s, y = s => ((ay * s + by) * s + cy) * s, dx = s => (3 * ax * s + 2 * bx) * s + cx;
  return p => {
    if (p <= 0) return 0;
    if (p >= 1) return 1;
    let s = p;
    for (let i = 0; i < 8; i++) { const d = dx(s); if (Math.abs(d) < 1e-6) break; s -= (x(s) - p) / d; }
    return y(clamp(s));
  };
}
export const E = {
  out: bezier(.16, 1, .3, 1),        // 등장
  soft: bezier(.22, 1, .36, 1),      // 부드러운 안착, 글자
  in: bezier(.7, 0, .84, 0),         // 빨려 들어가는 퇴장
  inOut: bezier(.87, 0, .13, 1),     // 모프·휩
  ui: bezier(.4, 0, .2, 1),          // 작은 UI 변화
  cam: bezier(.48, .1, 0, .9),       // 카메라
  glide: bezier(.47, .2, .15, 1),    // 중간 거리 이동
  contact: bezier(.55, 0, .9, .55),  // 속도를 유지한 채 부딪치며 도착
  linear: p => p,
};
// BIBER MOTION KIT 프리셋(속도 0 + 영향력 → cubic-bezier). 등장 expo-out, 퇴장 expo-in, 전환 expo-inout
export const K = {
  expoOut: bezier(.06, 0, .08, 1),
  expoIn: bezier(.92, 0, .94, 1),
  expoInOut: bezier(.88, 0, .12, 1),
  smooth: bezier(.6, 0, .4, 1),
  snap: bezier(.03, 0, .02, 1),
  stagger: bezier(.6, 0, .15, 1),
  zoomOut: bezier(.4, 0, .92, 1),    // 블러 줌 컷: 나가는 장면
  zoomIn: bezier(.1, 0, .08, 1),     // 블러 줌 컷: 들어오는 장면
  slam: bezier(.03, 0, .05, 1),
  iris: bezier(.55, 0, .2, 1),
};
export const tw = (t, a, b, ease = E.out) => ease(prog(t, a, b));
// 관성: 마지막 키 뒤 감쇠하는 사인파. v = 평균 속도(변화량/시간), amp·freq·decay는 키트 기본값(0.05, 2.4, 6)
export function inertia(t, end, v, amp = .05, freq = 2.4, decay = 6) {
  const tau = t - end;
  if (tau <= 0 || tau > 1.2) return 0;
  return v * amp * Math.sin(2 * Math.PI * freq * tau) / Math.exp(decay * tau);
}
// 도착 + 관성: from→to를 [a, a+dur] 동안 expo-out으로, 도착 뒤 관성으로 살짝 넘쳤다 돌아온다
export function arrive(t, a, dur, from, to, amp = .05, freq = 2.4, decay = 6) {
  return lerp(from, to, tw(t, a, a + dur, K.expoOut)) + inertia(t, a + dur, (to - from) / dur, amp, freq, decay);
}

// ---------- 스프링 (닫힌 해, s = 시작 뒤 지난 초) ----------
// damping/stiffness/mass. 기본은 임계 감쇠(튀지 않음). 튀는 건 진짜로 닿는 순간에만 쓴다.
export function springAt(s, { d = 24, k = 140, m = 1 } = {}) {
  if (s <= 0) return 0;
  const w0 = Math.sqrt(k / m), z = d / (2 * Math.sqrt(k * m));
  if (z < 1) { const wd = w0 * Math.sqrt(1 - z * z); return 1 - Math.exp(-z * w0 * s) * (Math.cos(wd * s) + (z * w0 / wd) * Math.sin(wd * s)); }
  if (z === 1) return 1 - Math.exp(-w0 * s) * (1 + w0 * s);
  const r1 = -w0 * (z - Math.sqrt(z * z - 1)), r2 = -w0 * (z + Math.sqrt(z * z - 1));
  return 1 - (r2 * Math.exp(r1 * s) - r1 * Math.exp(r2 * s)) / (r2 - r1);
}
export const S = {
  firm: { d: 24, k: 140, m: 1 },     // 기본 착지(튀지 않음)
  calm: { d: 16, k: 64, m: 1 },      // 느린 안착
  snap: { d: 18, k: 260, m: .7 },    // 6% 튐 — 진짜로 닿는 순간
  move: { d: 20, k: 150, m: 1 },     // 같은 물체가 자리를 옮길 때(magic move)
};
// 누름·부딪힘 강조: 빠르게 올라갔다 천천히 내려온다(반사인 펄스 대신)
export function hitPulse(t, at, up = 2 * F, down = 5 * F) {
  if (t < at || t > at + up + down) return 0;
  return t < at + up ? (t - at) / up : 1 - E.soft((t - at - up) / down);
}

// ---------- DOM ----------
export const css = (e, o) => { for (const k in o) e.style[k] = o[k]; };
export const vis = (e, on) => { e.style.visibility = on ? "visible" : "hidden"; };
// 가림막 선 안에서 단어가 올라온다. 단어마다 span을 나눠 하나씩 올린다(글자 단위 효과는 쓰지 않는다)
export const wordsHtml = (text, cls = "") => `<span class="words ${cls}">${text.split("\n").map(line =>
  `<span class="line">${line.split(" ").map(w => `<span class="mask"><span class="mask-in">${w}</span></span>`).join(" ")}</span>`).join("")}</span>`;
// 단어 등장: 36프레임 soft, 11프레임 간격. 퇴장: 24프레임 동안 한꺼번에 위로
export function words(els, t, at, { exitAt = Infinity, stagger = 11 * F, dur = 36 * F, exitDur = 24 * F } = {}) {
  els.forEach((e, i) => {
    const k = tw(t, at + i * stagger, at + i * stagger + dur, E.soft);
    const out = Number.isFinite(exitAt) ? tw(t, exitAt, exitAt + exitDur, E.in) : 0;
    e.style.transform = `translate3d(0, ${(1 - k) * 110 - out * 110}%, 0)`;
  });
}
// 굴러가는 숫자: 원인이 닿는 순간(at)부터 7프레임 동안 이전 값이 위로 빠지고 새 값이 아래에서 올라온다
export const rollHtml = (cls = "") => `<span class="roll ${cls}"><span class="r-old"></span><span class="r-new"></span></span>`;
export function roll(el, steps, t, dur = 7 * F) {
  // steps: [[시각, 값], ...] 시간순
  let i = 0;
  while (i + 1 < steps.length && t >= steps[i + 1][0]) i++;
  const [at, val] = steps[i], prev = i > 0 ? steps[i - 1][1] : val;
  const k = i > 0 ? tw(t, at, at + dur, E.ui) : 1;
  const [o, n] = el.children;
  if (o.textContent !== String(prev)) o.textContent = prev;
  if (n.textContent !== String(val)) n.textContent = val;
  o.style.transform = `translateY(${-k * 100}%)`;
  n.style.transform = `translateY(${(1 - k) * 100}%)`;
}

// ---------- 손가락 ----------
// keys: [[시각, x, y], ...]. 구간마다 옆으로 15~25% 휘는 이차 곡선으로 18프레임 동안 이동하고, 나머지 시간은 머문다
export function fingerPath(t, keys, bend = .2) {
  if (t <= keys[0][0]) return keys[0].slice(1);
  for (let i = 1; i < keys.length; i++) {
    if (t > keys[i][0]) continue;
    const [a, x0, y0] = keys[i - 1], [b, x1, y1] = keys[i];
    const move = Math.min(b - a, 18 * F * Math.max(1, Math.hypot(x1 - x0, y1 - y0) / 40));
    const k = E.out(prog(t, b - move, b));
    const mx = (x0 + x1) / 2 - (y1 - y0) * bend, my = (y0 + y1) / 2 + (x1 - x0) * bend;
    const u = 1 - k;
    return [u * u * x0 + 2 * u * k * mx + k * k * x1, u * u * y0 + 2 * u * k * my + k * k * y1];
  }
  return keys[keys.length - 1].slice(1);
}
// 누름: 6프레임 전부터 살짝 커졌다가(hover) 0.88로 4프레임 눌리고 8프레임에 되돌아온다
export function pressScale(t, taps) {
  let s = 1;
  for (const a of taps) {
    if (t > a - 6 * F && t < a) s = Math.max(s, 1 + .06 * prog(t, a - 6 * F, a));
    if (t >= a && t < a + 4 * F) s = lerp(1, .88, E.ui(prog(t, a, a + 4 * F)));
    if (t >= a + 4 * F && t < a + 12 * F) s = lerp(.88, 1, E.out(prog(t, a + 4 * F, a + 12 * F)));
  }
  return s;
}

// ---------- 시계 ----------
// render(t)를 매 프레임 부른다. paused()이면 시간을 세지 않는다. end에 닿으면 마지막 장면을 유지하되 render는 계속 불러 대기 화면이 숨 쉬게 한다
export function playClock(render, { start = 0, end = Infinity, paused = () => false } = {}) {
  let t = start, last = performance.now(), raf = 0;
  const tick = now => {
    const dt = Math.min(.1, (now - last) / 1000);
    last = now;
    if (!paused() && !document.hidden) t = Math.min(end, t + dt);
    render(t);
    raf = requestAnimationFrame(tick);
  };
  render(t);
  raf = requestAnimationFrame(tick);
  return {
    stop: () => cancelAnimationFrame(raf),
    seek: v => { t = clamp(v, 0, end); render(t); },
    get t() { return t; },
  };
}
