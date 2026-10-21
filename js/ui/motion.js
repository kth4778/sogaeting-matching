// 모션 토큰의 JS 미러(tokens.css의 --m-*·--e-*와 같은 값)와 상시 루프 정지
export const REDUCE = matchMedia("(prefers-reduced-motion: reduce)").matches;
export const DUR = { press: 100, fast: 160, base: 240, slow: 360, pop: 300, hero: 520, count: 900, stagger: 40 };
export const EASE = { out: "cubic-bezier(.22,1,.36,1)", in: "cubic-bezier(.4,0,1,1)", move: "cubic-bezier(.65,0,.35,1)",
  nav: "cubic-bezier(.32,.72,0,1)", pop: "cubic-bezier(.34,1.56,.64,1)", fling: "cubic-bezier(.2,.6,.35,1)" };
export const SPRING = { card: { stiffness: 420, damping: 30 }, pop: { stiffness: 260, damping: 18 } }; // 질량 1

// 감쇠 스프링을 닫힌 해로 60fps 샘플링해 WAAPI 키프레임으로 만든다.
// 반환 { keyframes, duration(ms) } — el.animate(keyframes, { duration, easing: "linear" })
export function springKeyframes(from, to, { stiffness, damping }, prop = "transform", fmt = v => `translateX(${v}px)`) {
  const w0 = Math.sqrt(stiffness);
  const zeta = damping / (2 * w0);
  const x0 = from - to;
  const at = t => {
    if (zeta < 1) {
      const wd = w0 * Math.sqrt(1 - zeta * zeta);
      return Math.exp(-zeta * w0 * t) * (x0 * Math.cos(wd * t) + (zeta * w0 * x0 / wd) * Math.sin(wd * t));
    }
    return x0 * (1 + w0 * t) * Math.exp(-w0 * t); // 임계 감쇠 이상은 임계 감쇠로 근사
  };
  const keyframes = [];
  const eps = Math.max(Math.abs(x0) * 0.002, 0.01);
  let t = 0;
  for (let i = 0; i < 300; i++, t += 1 / 60) {
    const x = at(t);
    keyframes.push({ [prop]: fmt(to + x) });
    if (i > 3 && Math.abs(x) < eps && Math.abs(at(t + 1 / 60) - x) < eps) break;
  }
  keyframes.push({ [prop]: fmt(to) });
  return { keyframes, duration: Math.round(t * 1000) };
}

export const easeOutCubic = k => 1 - (1 - k) ** 3;
export const easeOutExpo = k => (k === 1 ? 1 : 1 - 2 ** (-10 * k));

// 상시 루프(웰컴 히어로·매칭 시작 화면 공전)를 화면 밖·앱 숨김일 때 멈춘다(.paused). 해제 함수를 돌려준다(unmount에서 호출)
export function pauseOffscreen(el) {
  let visible = true;
  const update = () => el.classList.toggle("paused", !visible || document.hidden);
  const io = new IntersectionObserver(entries => {
    visible = entries.some(e => e.isIntersecting);
    update();
  }, { threshold: 0 });
  io.observe(el);
  document.addEventListener("visibilitychange", update);
  update();
  return () => {
    io.disconnect();
    document.removeEventListener("visibilitychange", update);
    el.classList.remove("paused");
  };
}
