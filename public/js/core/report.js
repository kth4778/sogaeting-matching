// 결과 화면의 「LLM 보고서」: 저장된 매칭 결과(state.result)에 있는 실제 응답만 보여 준다. 받지 못한 칸은 받지 못했다고 쓴다.
// (매칭 로그와 같이 기술 용어 예외 파일: tools/check-terms.mjs)
import { esc } from "./util.js";

export function reportHtml(r, first) {
  // 1위가 차단돼 2위가 올라온 경우엔 그 사람 몫으로 저장된 이유만 있다
  const isTop = first.id === r.ranked[0].id;
  const ex = isTop ? r.explain : first.headline ? { headline: first.headline, reasons: first.reasons ?? [] } : null;
  const embedLabel = r.embedFallback ? "관심사 뜻 묶음 점수 (임베딩 서버 연결 실패로 대신 계산)" : `임베딩 코사인 유사도${r.embedModel ? ` · ${esc(r.embedModel)}` : ""}`;
  const rerankLabel = r.rerankError ? "LLM 재순위 실패 · 규칙 기반 한 줄" : `LLM 재순위 한 줄${r.llmModel ? ` · ${esc(r.llmModel)}` : ""}`;
  return `
    <section class="report" aria-label="LLM 보고서">
      <div class="rp-head"><b>LLM 보고서</b>${r.llmModel ? `<small>${esc(r.llmModel)}</small>` : ""}</div>
      ${ex ? `
        <p class="rp-headline">“${esc(ex.headline)}”</p>
        <ol class="rp-reasons">${ex.reasons.slice(0, 3).map(x => `<li><b>${esc(x.title)}</b><span>${esc(x.detail)}</span></li>`).join("")}</ol>
        ${ex.caution ? `<div class="rp-row"><span class="rp-k">주의할 점</span><p>${esc(ex.caution)}</p></div>` : ""}
        ${ex.firstDate ? `<div class="rp-row"><span class="rp-k">첫 만남 제안</span><p>${esc(ex.firstDate)}</p></div>` : ""}`
      : `<p class="rp-miss">이유 보고서를 받지 못했어요${isTop && r.explainError ? ` · ${esc(r.explainError)}` : ""}</p>`}
      <div class="rp-row"><span class="rp-k">${rerankLabel}</span><p>${esc(first.oneLine)}</p></div>
      <div class="rp-nums">
        <div><small>${embedLabel}</small><b data-count="${first.embed.toFixed(3)}" data-dec="3">${first.embed.toFixed(3)}</b></div>
        <div><small>궁합 점수</small><b><span data-count="${first.llmScore}">${first.llmScore}</span><i>점</i></b></div>
      </div>
    </section>`;
}
