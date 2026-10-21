// 폰 브라우저로 열었을 때 「홈 화면에 추가」를 안내하고, 웹페이지 특유의 확대 동작을 막는다.
// 홈 화면 아이콘으로 열린 상태(주소창 없음)에서는 안내를 띄우지 않는다.

const DISMISS_KEY = "install-hint-dismissed";
const SPLASH_MS = 2200; // 로고 화면이 사라진 뒤에 띄운다

const isMobile = window.matchMedia("(max-width: 760px)").matches;
const isApp = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);

// iOS 사파리는 확대 금지 설정을 무시하므로 두 손가락 확대 동작을 직접 막는다
document.addEventListener("gesturestart", e => e.preventDefault());

function dismissed() {
  try { return localStorage.getItem(DISMISS_KEY) === "1"; } catch { return false; }
}

function showHint(html, onInstall) {
  const hint = document.createElement("div");
  hint.className = "install-hint";
  hint.innerHTML = `<img src="icon-192.png" alt=""><div class="install-text">${html}</div>
    ${onInstall ? `<button class="install-go">설치</button>` : ""}<button class="install-x" aria-label="닫기">✕</button>`;
  const close = () => {
    try { localStorage.setItem(DISMISS_KEY, "1"); } catch {}
    hint.classList.add("out");
    setTimeout(() => hint.remove(), 400);
  };
  hint.querySelector(".install-x").onclick = close;
  if (onInstall) hint.querySelector(".install-go").onclick = () => onInstall().finally(close);
  document.querySelector(".phone-screen").append(hint);
}

if (isMobile && !isApp && !dismissed()) {
  if (isIOS) {
    // 아이폰은 설치 버튼을 만들 수 없어서 공유 메뉴를 쓰는 방법을 알려준다
    setTimeout(() => showHint(`<b>앱으로 쓰기</b><span>아래 공유 버튼 <i class="share-ic"></i> → 「홈 화면에 추가」</span>`), SPLASH_MS);
  } else {
    // 안드로이드 크롬은 설치할 수 있을 때 이 이벤트를 보내 준다
    window.addEventListener("beforeinstallprompt", e => {
      e.preventDefault();
      setTimeout(() => showHint(`<b>앱으로 쓰기</b><span>홈 화면에 아이콘을 만들어요</span>`, async () => {
        e.prompt();
        await e.userChoice;
      }), SPLASH_MS);
    });
  }
}
