// 폰 브라우저로 열었을 때 「홈 화면에 추가」를 안내하고, 웹페이지 특유의 확대 동작을 막는다.
// 홈 화면 아이콘으로 열린 상태(주소창 없음)에서는 안내를 띄우지 않는다. 가입 흐름 중에는 절대 띄우지 않는다.
// 띄우는 때: 첫 매칭 결과(app:aha) 3초 뒤, 또는 두 번째 방문. 내 정보의 상시 진입점은 window.openInstallHint().

const DISMISS_KEY = "install-hint-dismissed-at";
const VISIT_KEY = "install-visits";
const AHA_DELAY_MS = 3000;
const AUTO_CLOSE_MS = 8000;
const OUT_MS = 160;
const SNOOZE_MS = 7 * 864e5;

const isMobile = window.matchMedia("(max-width: 760px), (hover: none) and (pointer: coarse)").matches;
const isApp = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const ua = navigator.userAgent;
const isIOS = /iPhone|iPad|iPod/.test(ua);
const isKakao = /KAKAOTALK/i.test(ua);
const isOtherInApp = /Instagram|NAVER\(inapp/.test(ua);

// iOS 사파리는 확대 금지 설정을 무시하므로 두 손가락 확대 동작을 직접 막는다
document.addEventListener("gesturestart", e => e.preventDefault());

function snoozed() {
  try { return Date.now() - Number(localStorage.getItem(DISMISS_KEY) || 0) < SNOOZE_MS; } catch { return false; }
}
function visits() {
  try {
    const n = Number(localStorage.getItem(VISIT_KEY) || 0) + 1;
    localStorage.setItem(VISIT_KEY, String(n));
    return n;
  } catch { return 1; }
}

let deferredPrompt = null;
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); deferredPrompt = e; });

function content() {
  if (isKakao) {
    const where = isIOS ? "Safari로 열기" : "Chrome으로 열기";
    return { html: `<b>카카오톡에서는 설치가 안 돼요</b><span>브라우저로 열면 앱처럼 쓸 수 있어요</span>`, label: where,
      go: () => { location.href = "kakaotalk://web/openExternal?url=" + encodeURIComponent(location.href); } };
  }
  if (isOtherInApp) return { html: `<b>브라우저로 열어 주세요</b><span>오른쪽 위 메뉴에서 「다른 브라우저로 열기」</span>` };
  if (isIOS) return { html: `<b>앱으로 쓰기</b><span>Safari 아래 ··· → 공유 <i class="share-ic"></i> → 「홈 화면에 추가」</span>` };
  if (deferredPrompt) {
    const p = deferredPrompt;
    return { html: `<b>앱으로 쓰기</b><span>홈 화면에 아이콘을 만들어요</span>`, label: "설치",
      go: async () => { p.prompt(); await p.userChoice; deferredPrompt = null; } };
  }
  return { html: `<b>앱으로 쓰기</b><span>브라우저 메뉴에서 「홈 화면에 추가」</span>` };
}

function showHint({ manual = false } = {}) {
  if (document.querySelector(".overlay.ob-mode")) return false; // 가입 흐름 중: 이번 기회는 건너뛴다
  if (document.querySelector(".install-hint")) return true;
  const { html, label, go } = content();
  const hint = document.createElement("div");
  hint.className = "install-hint";
  hint.setAttribute("role", "status");
  hint.innerHTML = `<img src="icon-192.png" alt=""><div class="install-text">${html}</div>
    ${go ? `<button class="install-go">${label}</button>` : ""}<button class="install-x" aria-label="닫기"><svg class="i" width="13" height="13" aria-hidden="true"><use href="#i-x"/></svg></button>`;
  let timer = 0;
  const leave = () => {
    clearTimeout(timer);
    hint.classList.add("out");
    setTimeout(() => hint.remove(), OUT_MS);
  };
  hint.querySelector(".install-x").onclick = () => {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch {}
    leave();
  };
  if (go) hint.querySelector(".install-go").onclick = () => { Promise.resolve(go()).finally(leave); };
  document.querySelector(".phone-screen").append(hint);
  if (!manual) timer = setTimeout(leave, AUTO_CLOSE_MS);
  return true;
}

window.openInstallHint = () => showHint({ manual: true });

if (isMobile && !isApp) {
  const second = visits() >= 2;
  const auto = () => { if (!snoozed()) showHint(); };
  if (second && !document.body.classList.contains("booting")) setTimeout(auto, AHA_DELAY_MS);
  else if (second) window.addEventListener("splash:done", () => setTimeout(auto, AHA_DELAY_MS), { once: true });
  window.addEventListener("app:aha", () => setTimeout(auto, AHA_DELAY_MS));
}
