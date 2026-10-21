// 앱 상태와 저장 (WP0 작성, 동결). 패키지는 state 값을 바꾸고 save(key)만 한다.
import { blankDraft } from "../screens/onboarding-view.js";

// ---------- 저장 (새로고침해도 유지) ----------
export function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
export function save(key, value = state[key]) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 저장 못 해도 화면은 동작 */ }
}

const savedMe = load("me", null);
export const state = {
  tab: "home",
  me: savedMe,
  // 저장된 프로필이 없으면 가입 흐름부터 보여 준다
  ob: savedMe ? null : { stepIndex: 0, draft: blankDraft(), editing: false, dir: "fwd" },
  running: false,
  step: 0,              // 진행 중인 단계 (1~4), 0이면 대기
  result: load("result", null),
  swiped: load("swiped", {}),   // id -> like | super | pass
  matches: load("matches", []), // 서로 좋아요가 된 id
  chats: load("chats", {}),     // id -> [{ from, text }]
  chatWith: null,
  detail: null,
  ended: load("ended", {}),     // id -> 상대가 나간 이유 (로그용)
  confirmLeave: false,          // 「대화방 나가기」 확인 창
  // ---- WP0이 미리 넣은 필드 (병렬 단계는 값만 바꾸고 save(key)) ----
  blocked: load("blocked", {}),            // id -> true (차단·신고)
  unread: load("unread", {}),              // id -> 안 읽은 답장 수
  daily: load("daily", { date: "", supers: 1 }), // 하루 단위 카운터
  lastSwipe: null,                         // 되돌리기 대상 (비영속)
  justFinished: false,                     // 결과 첫 공개 중 (비영속)
  coach: load("coach", {}),                // 한 번만 보여 주는 안내 기록
};

// 「데모 초기화」: 앱 키를 지우고 상태를 처음으로 되돌린 뒤 등록된 초기화를 실행한다
const APP_KEYS = ["me", "result", "swiped", "matches", "chats", "ended", "blocked", "unread", "daily", "coach", "guide-seen"];
const resets = [];
export function registerReset(fn) { resets.push(fn); }
export function resetAll() {
  APP_KEYS.forEach(k => { try { localStorage.removeItem(k); } catch {} });
  Object.assign(state, {
    tab: "home", me: null, result: null, swiped: {}, matches: [], chats: {}, ended: {}, chatWith: null, detail: null, confirmLeave: false,
    blocked: {}, unread: {}, daily: { date: "", supers: 1 }, lastSwipe: null, justFinished: false, coach: {},
  });
  resets.forEach(fn => fn());
}
