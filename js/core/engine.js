// 매칭 계산 (화면·대기 없음 — node 테스트에서 그대로 import한다)
import { PROFILES } from "../data/profiles.js";

// ---------- 1단계: 규칙 거르기 ----------
// 양쪽 조건을 다 본다. 내가 원하는 조건 + 상대가 원하는 조건.
export const RULES = [
  { name: "성별", side: "me", test: (me, p) => p.gender === me.wants.gender },
  { name: "성별", side: "them", test: (me, p) => p.wants.gender === me.gender },
  { name: "나이", side: "me", test: (me, p) => p.age >= me.wants.ageMin && p.age <= me.wants.ageMax,
    why: (me, p) => `나이 ${p.age}살 (내 조건 ${me.wants.ageMin}~${me.wants.ageMax}살)` },
  { name: "나이", side: "them", test: (me, p) => me.age >= p.wants.ageMin && me.age <= p.wants.ageMax,
    why: (me, p) => `상대 조건 ${p.wants.ageMin}~${p.wants.ageMax}살인데 나는 ${me.age}살` },
  { name: "흡연", side: "me", test: (me, p) => !me.wants.nonSmokerOnly || p.smoking === "비흡연",
    why: () => "흡연자 (나는 비흡연자만 원함)" },
  { name: "흡연", side: "them", test: (me, p) => !p.wants.nonSmokerOnly || me.smoking === "비흡연",
    why: () => "상대가 비흡연자만 원함" },
  { name: "종교", side: "me", test: (me, p) => me.wants.religion === "상관없음" || p.religion === me.wants.religion,
    why: (me, p) => `종교 ${p.religion} (내 조건 ${me.wants.religion})` },
  { name: "종교", side: "them", test: (me, p) => p.wants.religion === "상관없음" || me.religion === p.wants.religion,
    why: (me, p) => `상대가 ${p.wants.religion} 신자만 원함 (나는 ${me.religion})` },
];

export function ruleFilter(me) {
  const passed = [];
  const excluded = [];
  for (const p of PROFILES) {
    if (p.id === me.id) continue; // 나 자신은 후보에서 뺀다
    const failed = RULES.find(r => !r.test(me, p));
    if (failed) excluded.push({ p, rule: failed });
    else passed.push(p);
  }
  return { passed, excluded };
}

// 상대 쪽 조건만 다시 확인 (좋아요를 받은 상대가 나를 받아줄 수 있는지)
export const theyAccept = (me, p) => RULES.filter(r => r.side === "them").every(r => r.test(me, p));

// ---------- 2단계: 임베딩 (목데이터) ----------
// 실제 모델 대신 「같은 뜻 묶음」 표로 즉시 계산한다. 표기가 달라도 같은 묶음이면 가깝다고 본다 (등산 ≈ 산 타기).
export const MEANING_GROUPS = [
  ["등산", "산 타기", "트레킹", "캠핑", "클라이밍"],
  ["러닝", "헬스", "요가", "자전거", "축구"],
  ["카페 투어", "카페 탐방", "커피", "커피 마시기"],
  ["맛집 탐방", "요리", "베이킹", "술자리"],
  ["여행", "페스티벌"],
  ["전시회", "미술관", "그림 그리기", "사진", "필름 카메라", "필름카메라"],
  ["영화 보기", "넷플릭스", "넷플릭스 보기"],
  ["독서", "책 읽기"],
  ["음악 감상", "기타 연주", "밴드 공연", "교회 찬양팀"],
  ["게임", "보드게임", "코딩", "코딩 공부"],
  ["반려견 산책"],
  ["교회 봉사"],
];
export const groupOf = word => MEANING_GROUPS.findIndex(g => g.includes(word));

// 관심사 묶음이 얼마나 겹치는지 (0~1)
export function meaningSimilarity(a, b) {
  const ga = new Set(a.map(groupOf).filter(i => i >= 0));
  const gb = new Set(b.map(groupOf).filter(i => i >= 0));
  if (!ga.size || !gb.size) return 0;
  const shared = [...ga].filter(g => gb.has(g)).length;
  return shared / Math.sqrt(ga.size * gb.size);
}

// 단어가 똑같아야만 겹친다고 보는 공식 (임베딩과 비교용)
export function jaccard(a, b) {
  const A = new Set(a), B = new Set(b);
  const inter = [...A].filter(x => B.has(x)).length;
  return inter / new Set([...A, ...B]).size;
}

// embeddingRank의 계산부 (대기는 matching.js의 embeddingRank가 한다)
export function embedScores(me, people) {
  return people.map(p => {
    // 표기는 다르지만 같은 묶음인 관심사 한 쌍 (없으면 아무 쌍)
    let pair = null;
    for (const a of me.interests) for (const b of p.interests) {
      if (a !== b && groupOf(a) >= 0 && groupOf(a) === groupOf(b)) pair ??= { a, b, sim: 0.9 };
    }
    pair ??= { a: me.interests[0], b: p.interests[0], sim: 0.5 };
    const embed = 0.6 + 0.35 * meaningSimilarity(me.interests, p.interests) + (me.mbti[0] === p.mbti[0] ? 0.03 : 0);
    return { profile: p, embed, jaccard: jaccard(me.interests, p.interests), pair };
  }).sort((x, y) => y.embed - x.embed);
}

// ---------- 3·4단계: LLM 재순위·이유 설명 (목데이터) ----------
// 실제 API 대신 점수표로 바로 만든다. 무엇에 몇 점을 줬는지 그대로 이유가 된다.
export function mockScore(me, p, embed) {
  const parts = [
    ["취향", Math.round(embed * 50)],
    ["같은 지역", me.region === p.region ? 12 : 0],
    ["성향(E/I)", me.mbti[0] === p.mbti[0] ? 8 : 0],
    ["생활 리듬(J/P)", me.mbti[3] === p.mbti[3] ? 6 : 0],
    ["술 습관", me.drinking === p.drinking ? 6 : 0],
    ["나이 차", Math.abs(me.age - p.age) <= 3 ? 8 : 3],
  ];
  return { score: Math.min(98, parts.reduce((s, [, v]) => s + v, 0)), parts };
}

// 결과·카드·상세·대화방이 같이 쓰는 한 줄 설명 (§4.6 표 순서로 최대 2개)
export function oneLine(me, p) {
  const out = [];
  if (me.region === p.region) out.push(`같은 ${p.region}`);
  const same = me.interests.find(a => p.interests.includes(a));
  const near = !same && me.interests.flatMap(a => p.interests.filter(b => groupOf(a) >= 0 && groupOf(a) === groupOf(b)).map(b => [a, b]))[0];
  if (same) out.push(`${same} 취향이 같아요`);
  else if (near) out.push(`${near[0]} ≈ ${near[1]}`);
  if (me.mbti[0] === p.mbti[0]) out.push(me.mbti[0] === "I" ? "둘 다 조용한 편" : "둘 다 활발한 편");
  if (me.mbti[3] === p.mbti[3]) out.push("계획 스타일이 같아요");
  if (Math.abs(me.age - p.age) <= 3) out.push("나이 차가 적어요");
  return out.slice(0, 2).join(" · ") || "새로운 취향을 알아가기 좋아요";
}

// "/api/rerank" 목 응답 (대기는 matching.js api()가 한다)
export function mockRerank({ me, candidates }) {
  return {
    ranking: candidates.map(c => ({ id: c.profile.id, score: mockScore(me, c.profile, c.embed).score, oneLine: oneLine(me, c.profile) })),
  };
}

// "/api/explain" 목 응답
export function mockExplain({ me, partner }) {
  const shared = partner.interests.filter(t => me.interests.some(m => groupOf(m) >= 0 && groupOf(m) === groupOf(t)));
  const likes = (shared.length ? shared : partner.interests).slice(0, 2);
  return {
    headline: shared.length ? `${josa(shared[0], "을/를")} 함께 즐길 수 있는 사람이에요` : "생활 리듬이 비슷한 사람이에요",
    reasons: [
      { title: "비슷한 취향", detail: `${partner.name}님도 ${[...likes.slice(0, -1), josa(likes[likes.length - 1], "을/를")].join(", ")} 좋아해요.` },
      { title: "가까운 거리", detail: me.region === partner.region ? `둘 다 ${me.region}에 있어서 만나기 편해요.` : `${partner.region}에 있어서 중간에서 만나면 좋아요.` },
      { title: "대화 스타일", detail: `${partner.personality}` },
    ],
    caution: me.mbti[0] === "I" && partner.mbti[0] === "I" ? "둘 다 조용한 편이라 처음엔 먼저 말을 걸어 보세요." : "대화 속도가 다를 수 있으니 천천히 알아가 보세요.",
    firstDate: shared.length ? `${shared[0]} 후에 근처 카페에서 이야기 나눠 보세요.` : "가볍게 카페에서 만나 보세요.",
  };
}

// ---------- 조사·서명 ----------
// 끝 글자 받침에 따라 조사를 붙인다. pair는 "을/를" | "이/가" | "은/는" | "과/와" (앞이 받침 있을 때)
// 괄호로 끝나면 괄호 앞 글자로 판정, 한글이 아니면 「을(를)」처럼 둘 다 쓴다
export function josa(word, pair) {
  const [withFinal, withoutFinal] = pair.split("/");
  const base = word.endsWith(")") && word.includes("(") ? word.slice(0, word.lastIndexOf("(")) : word;
  const code = base.charCodeAt(base.length - 1) - 0xac00;
  if (!(code >= 0 && code <= 11171)) return `${word}${withFinal}(${withoutFinal})`;
  return word + (code % 28 ? withFinal : withoutFinal);
}

// 매칭 입력 칸 서명: 결과의 forMe와 다르면 프로필이 바뀐 것(§4.6)
export function signature(me) {
  return JSON.stringify([me.gender, me.age, me.region, me.mbti, me.smoking, me.religion, me.drinking, me.interests, me.wants]);
}
