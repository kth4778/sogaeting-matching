// 폰 화면 글자의 기술 용어 검사 (명세 §4.13, WP0 작성, 동결)
//   읽는 파일: public/js/**/*.js, public/index.html, public/install.js, public/manifest.webmanifest
//   ① core/log.js·core/matching.js는 건너뜀(매칭 로그 카드 안만 예외, U6)
//   ② 주석만 지움: JS /* … */ 와 「://」가 아닌 // 뒤, HTML <!-- … --> (그래서 https:// 문자열 줄도 검사된다)
//   ③ debug( 가 있는 줄(콘솔 전용)은 건너뜀  ④ 금지 단어가 남은 줄을 파일:줄로 출력, 1건이라도 있으면 exit 1
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";

const WORDS = ["LLM", "임베딩", "Claude", "토큰", "목데이터", "자카드", "코사인"];
const SKIP = new Set(["public/js/core/log.js", "public/js/core/matching.js"]);

const files = [];
const walk = dir => readdirSync(dir).forEach(n => {
  const f = path.join(dir, n);
  if (statSync(f).isDirectory()) walk(f);
  else if (f.endsWith(".js")) files.push(f);
});
walk("public/js");
files.push("public/index.html", "public/install.js", "public/manifest.webmanifest");

// 주석을 같은 수의 줄바꿈으로 바꿔 줄 번호를 지킨다
const blank = m => m.replace(/[^\n]/g, "");
const stripJs = s => s.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/(?<!:)\/\/.*$/gm, "");
const stripHtml = s => s.replace(/<!--[\s\S]*?-->/g, blank);

const hits = [];
for (const f of files) {
  const file = f.split(path.sep).join("/");
  if (SKIP.has(file) || !existsSync(f)) continue;
  const raw = readFileSync(f, "utf8");
  const text = file.endsWith(".html") ? stripHtml(raw) : stripJs(raw);
  text.split("\n").forEach((line, i) => {
    if (line.includes("debug(")) return;
    const found = WORDS.filter(w => line.includes(w));
    if (found.length) hits.push(`${file}:${i + 1}: [${found.join(", ")}] ${line.trim().slice(0, 140)}`);
  });
}
hits.forEach(h => console.log(h));
console.log(hits.length ? `금지 용어 ${hits.length}줄` : "금지 용어 0건");
process.exit(hits.length ? 1 : 0);
