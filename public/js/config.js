// GitHub Pages 배포판이 Claude를 부를 때 쓰는 서버 주소 (Vercel 배포 주소, 예: https://sogaeting-matching.vercel.app).
// 비어 있으면 Pages에서는 Claude 단계가 안내 문구로 대신된다. Vercel 주소에서 열면 이 값은 쓰지 않는다.
export const PAGES_API_BASE = "https://sogaeting-matching.vercel.app";

// 매칭 단계별 대기(ms). 합 9500 = 약 10초(U2). 매칭 대기는 이 값만 쓴다 — 숫자 리터럴 sleep 금지.
export const STAGE_MS = { s1Intro: 900, s1Out: 700, s2Intro: 800, s2Embed: 1400, s2Out: 700, s3Api: 1600, s3Board: 800, s3Settle: 1000, s4Api: 1600 };
