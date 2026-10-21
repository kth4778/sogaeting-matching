// GitHub Pages 배포판이 Claude를 부를 때 쓰는 서버 주소 (Vercel 배포 주소, 예: https://sogaeting-matching.vercel.app).
// 비어 있으면 Pages에서는 Claude 단계가 안내 문구로 대신된다. Vercel 주소에서 열면 이 값은 쓰지 않는다.
export const PAGES_API_BASE = "https://sogaeting-matching.vercel.app";

// 매칭 단계별 시간(ms). s2Embed·s3Api·s4Api는 실제 서버 호출이라 기다리지 않고 진행 막대 예상 시간으로만 쓴다.
export const STAGE_MS = { s1Intro: 900, s1Out: 700, s2Intro: 800, s2Embed: 800, s2Out: 700, s3Api: 6000, s3Board: 800, s3Settle: 1000, s4Api: 7000 };
