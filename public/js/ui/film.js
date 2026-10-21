// 시간 하나(t)로 장면을 그리는 모션 도구 — 웰컴 히어로와 사용 안내가 같이 쓴다
// 타이머·CSS 애니메이션 대신 매 프레임 render(t)가 모든 스타일을 정한다. 그래서 어느 시점으로 건너뛰어도 같은 화면이 나온다.

export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const prog = (t, a, b) => clamp((t - a) / (b - a));
export const lerp = (a, b, k) => a + (b - a) * k;
export const Ease = {
  out: x => 1 - Math.pow(1 - x, 4),          // 빨리 도착하고 부드럽게 멈춘다
  inOut: x => (x < .5 ? 8 * x ** 4 : 1 - Math.pow(-2 * x + 2, 4) / 2),
  in: x => x ** 3,
  sine: x => -(Math.cos(Math.PI * x) - 1) / 2,
};
export const tw = (t, a, b, ease = Ease.out) => ease(prog(t, a, b));
// 감쇠를 크게 둔 스프링(거의 튀지 않는다). s = 시작 뒤 지난 초
export function spring(s, zeta = .82, w = 16) {
  if (s <= 0) return 0;
  const wd = w * Math.sqrt(1 - zeta * zeta);
  return 1 - Math.exp(-zeta * w * s) * (Math.cos(wd * s) + (zeta * w / wd) * Math.sin(wd * s));
}

export const css = (e, o) => { for (const k in o) e.style[k] = o[k]; };
// 가림막 선에서 글자가 올라오고(rise) 위로 빠진다(fall). 바깥 .mask가 넘치는 부분을 가린다
export const rise = (inner, k) => { inner.style.transform = `translate3d(0, ${(1 - k) * 125}%, 0)`; };
export const fall = (inner, k) => { inner.style.transform = `translate3d(0, ${-k * 125}%, 0)`; };
export const maskHtml = (text, cls = "") => `<span class="mask ${cls}"><span class="mask-in">${text}</span></span>`;

// t를 흘려보내는 시계. render(t)를 매 프레임 부르고, 멈춤 조건(paused())이면 시간을 세지 않는다.
// end에 닿으면 마지막 장면을 유지한다(그 뒤에도 render는 계속 불러 대기 화면이 숨 쉴 수 있게 한다).
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
