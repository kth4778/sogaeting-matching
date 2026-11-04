// 연애 연습 게임 규칙: 누가 상대인지, 기분·미션, 등급, 언제 끝나는지. 브라우저와 서버(llm.js)가 함께 쓴다.
import { SITUATIONS, CHARACTERS } from "../data/practice.js";

export const MAX_ANSWERS = 10;
const MIN_ANSWERS_FOR_S = 3;   // 대화 흐름을 보려면 답이 쌓여야 한다: 첫 답 한 번으로 S가 나와 끝나지 않게

// 남자 프로필이면 여성, 여자 프로필이면 남성 캐릭터가 상황마다 돌아가며 상대가 된다
export function slidesFor(myGender) {
  const partners = CHARACTERS.filter(c => c.gender === (myGender === "남" ? "여" : "남"));
  return SITUATIONS.map((situation, i) => ({ situation, character: partners[i % partners.length] }));
}

export const moodLabel = score => (score < 20 ? "바닥" : score < 40 ? "나쁨" : score < 60 ? "보통" : score < 80 ? "좋음" : "최고");
export const requiredDone = (missions, done) => missions.every((m, i) => !m.required || done.includes(i));

export const settleGrade = (grade, answers, missionsOk) => (grade === "S" && (answers < MIN_ANSWERS_FOR_S || !missionsOk) ? "A" : grade);

// 끝나면 clear(S) · fail(F) · limit(기회를 다 씀), 아직이면 null
export function outcomeOf(grade, answers) {
  if (grade === "S") return "clear";
  if (grade === "F") return "fail";
  return answers >= MAX_ANSWERS ? "limit" : null;
}
