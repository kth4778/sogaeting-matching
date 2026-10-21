// 좋아요 / 매칭 성사
import { byId, MUTUAL_MIN } from "./util.js";
import { state, save } from "./store.js";
import { theyAccept } from "./engine.js";
import { debug } from "./log.js";
import { toast } from "../ui/toast.js";
import { showMatchModal } from "../features/match-modal.js";

// 성사 연출 지연: 상대가 '잠시 뒤' 답한 것처럼 1200~4000ms (id마다 고정)
const MATCH_DELAY_MIN_MS = 1200;
const MATCH_DELAY_SPAN_MS = 2800;

// 작은 문자열 해시 (무작위 대신, 같은 사람은 늘 같은 결과)
export function hashId(id) {
  let h = 0;
  for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

export function scoreFor(id) {
  return state.result?.ranked?.find(r => r.id === id)?.llmScore ?? null;
}

export function react(id, kind) {
  const p = byId(id);
  state.swiped[id] = kind;
  save("swiped", state.swiped);
  state.lastSwipe = { id, kind, at: Date.now() };

  if (kind === "pass") { debug("넘기기", p.name); return; }

  // 상대도 나를 좋아할지: 상대 조건 → 궁합 점수 순서로 판단
  const score = scoreFor(id);
  let mutual;
  if (!theyAccept(state.me, p)) mutual = false;
  else if (score === null) mutual = hashId(id) % 2 === 0;
  else mutual = score >= (kind === "super" ? MUTUAL_MIN - 15 : MUTUAL_MIN);
  debug(kind, p.name, { score, mutual });

  if (mutual && !state.matches.includes(id)) {
    state.matches.push(id);
    save("matches", state.matches);
    setTimeout(() => showMatchModal(p), MATCH_DELAY_MIN_MS + hashId(id) % MATCH_DELAY_SPAN_MS);
  } else if (!mutual) {
    toast(kind === "super" ? "슈퍼 좋아요를 보냈어요" : "좋아요를 보냈어요");
  }
}
