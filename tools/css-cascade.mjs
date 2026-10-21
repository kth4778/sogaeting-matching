// CSS 캐스케이드 비교·린트 (WP0 작성, 동결)
//   비교: node tools/css-cascade.mjs _workspace/legacy/style.css public/css/{tokens,base,...,motion}.css
//         첫 파일(옛)과 나머지 파일(새, 링크 순서)의 (media, selector, property) → 최종값 맵 차이를 출력. 화이트리스트(§3.3 삭제·§3.4) 제외.
//   린트: node tools/css-cascade.mjs --lint [public/css/*.css]
//         파일 안 중복 선택자(같은 media), transition: all, !important(motion.css 제외), @keyframes 이름 중복·§3.1 접두사 위반, 토큰 밖 hex 개수(보고만)
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// ---------- 간이 파서 ----------
// 따옴표·괄호 안의 구분자는 무시하고 top-level에서만 자른다
function splitTop(text, sep) {
  const out = [];
  let depth = 0, quote = null, cur = "";
  for (const ch of text) {
    if (quote) { cur += ch; if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === sep && depth === 0) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map(s => s.trim()).filter(Boolean);
}

// prelude { body } 블록 목록 (중괄호 균형, 따옴표 인식)
function blocks(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf("{", i);
    if (open < 0) break;
    let depth = 0, quote = null, j = open;
    for (; j < text.length; j++) {
      const ch = text[j];
      if (quote) { if (ch === quote) quote = null; continue; }
      if (ch === '"' || ch === "'") { quote = ch; continue; }
      if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) break;
    }
    out.push({ prelude: text.slice(i, open).trim(), body: text.slice(open + 1, j), start: i });
    i = j + 1;
  }
  return out;
}

const norm = s => s.replace(/\s+/g, " ").trim();
export const stripComments = text => text.replace(/\/\*[\s\S]*?\*\//g, "");

// 결과: [{ type: "rule", media, selectors, decls: [[prop, value]] } | { type: "keyframes", name, body, media }]
export function parseCss(text) {
  const items = [];
  const walk = (src, media) => {
    for (const b of blocks(src)) {
      const pre = norm(b.prelude);
      if (/^@(media|supports)/.test(pre)) walk(b.body, media ? `${media} && ${pre}` : pre);
      else if (/^@(-webkit-)?keyframes/.test(pre)) items.push({ type: "keyframes", name: pre.split(/\s+/)[1], body: norm(b.body), media });
      else {
        const decls = splitTop(b.body, ";").map(d => {
          const c = d.indexOf(":");
          return [d.slice(0, c).trim().toLowerCase(), norm(d.slice(c + 1))];
        }).filter(([p]) => p);
        items.push({ type: "rule", media, selectors: splitTop(pre, ",").map(norm), decls });
      }
    }
  };
  walk(stripComments(text), "");
  return items;
}

// (media, selector, property) → 최종값. 같은 키는 나중 선언이 이긴다(!important는 값에 남겨 비교)
export function cascadeMap(texts) {
  const map = new Map();
  for (const text of texts) {
    for (const it of parseCss(text)) {
      if (it.type === "keyframes") { map.set(`${it.media}||@keyframes ${it.name}||`, it.body); continue; }
      for (const sel of it.selectors) for (const [p, v] of it.decls) map.set(`${it.media}||${sel}||${p}`, v);
    }
  }
  return map;
}

// :root 변수 값 안의 var(--x)를 같은 맵의 :root 값으로 풀어 비교한다(옛 이름 별칭 확인용)
function resolveRoot(map) {
  const root = new Map([...map].filter(([k]) => k.startsWith("||:root||")).map(([k, v]) => [k.split("||")[2], v]));
  const resolve = (v, depth = 0) => depth > 10 ? v : v.replace(/var\((--[\w-]+)\)/g, (m, n) => root.has(n) ? resolve(root.get(n), depth + 1) : m);
  for (const [k, v] of map) if (k.startsWith("||:root||")) map.set(k, resolve(v));
  return map;
}

// ---------- 화이트리스트: §3.3 삭제 목록 + §3.4 인정 4건 + WP0이 미리 넣는 선택자 ----------
const DEAD = /^(\.log-toggle|\.console|body\.log-open|\.sheet-grip|\.rank1|\.confetti|\.top-photo|\.top-meta|\.top-sub|\.quote|\.steps$|\.step\.doing|\.quick|\.qphoto|\.qicon|\.welcome-art|\.glass$)/;
const MOBILE_CONSOLE = new Set([".pipeline", ".pipeline::-webkit-scrollbar", ".pstep", ".sub", ".rank-board", ".console-body"]);
const ADDED = new Set([".paused", ".paused *", ".screen.no-scroll"]);
function whitelisted(key, inOld) {
  const [media, sel, prop] = key.split("||");
  if (DEAD.test(sel) || ADDED.has(sel)) return true;
  if (media.includes("max-width: 760px") && MOBILE_CONSOLE.has(sel)) return true;
  if (sel === "@keyframes logPulse") return true;
  if (sel === ":root" && (prop === "--console" || prop === "--console-ink")) return true;
  if (sel === ":root" && !inOld) return true; // §2 새 토큰 추가
  if (media.includes("pointer: coarse") && sel === ":root") return true; // §2 모바일 토큰 추가
  if (sel === ".card" && prop === "touch-action") return true;        // §3.4-1
  if (sel === ".hero-match" && prop === "animation") return true;     // §3.4-2
  if (sel === ".btn:disabled" && prop === "opacity") return true;     // §3.4-3
  return false;
}

export function diff(oldText, newTexts) {
  const a = resolveRoot(cascadeMap([oldText]));
  const b = resolveRoot(cascadeMap(newTexts));
  const out = [];
  for (const [k, v] of a) {
    if (!b.has(k)) { if (!whitelisted(k, true)) out.push(`- 사라짐  ${k} = ${v}`); }
    else if (b.get(k) !== v && !whitelisted(k, true)) out.push(`~ 바뀜    ${k}: ${v}  →  ${b.get(k)}`);
  }
  for (const [k, v] of b) if (!a.has(k) && !whitelisted(k, false)) out.push(`+ 생김    ${k} = ${v}`);
  return out;
}

// ---------- 린트 ----------
const PREFIX = {
  "home.css": ["home-"], "cards.css": ["cards-"], "detail.css": ["detail-", "mm-", "safety-"],
  "chat.css": ["chat-"], "onboarding.css": ["ob-"], "profile.css": ["me-"],
};
export function lint(files) {
  const warns = [];
  const report = [];
  const kfSeen = new Map();
  for (const f of files) {
    const base = path.basename(f);
    const text = readFileSync(f, "utf8");
    const items = parseCss(text);
    const seen = new Set();
    const mediaBlocks = new Map();
    for (const b of blocks(stripComments(text))) {
      const pre = norm(b.prelude);
      if (/^@media/.test(pre)) mediaBlocks.set(pre, (mediaBlocks.get(pre) ?? 0) + 1);
    }
    for (const [m, n] of mediaBlocks) if (n > 1) warns.push(`${base}: 같은 @media 블록 ${n}개 — ${m}`);
    for (const it of items) {
      if (it.type === "keyframes") {
        if (kfSeen.has(it.name)) warns.push(`${base}: @keyframes ${it.name} 이름 중복 (${kfSeen.get(it.name)})`);
        kfSeen.set(it.name, base);
        if (base !== "motion.css") {
          const ok = (PREFIX[base] ?? []).some(p => it.name.startsWith(p));
          if (!ok) warns.push(`${base}: @keyframes ${it.name} — 화면 전용은 접두사 ${(PREFIX[base] ?? ["(motion.css로)"]).join("/")} 필요`);
        }
        continue;
      }
      for (const sel of it.selectors) {
        const key = `${it.media}||${sel}`;
        if (seen.has(key)) warns.push(`${base}: 중복 선택자 ${sel}${it.media ? ` (${it.media})` : ""}`);
        seen.add(key);
      }
      for (const [p, v] of it.decls) {
        if (p === "transition" && /(^|,\s*)all\b/.test(v)) warns.push(`${base}: transition: all — ${it.selectors.join(", ")}`);
        if (/!important/.test(v) && base !== "motion.css") warns.push(`${base}: !important — ${it.selectors.join(", ")} { ${p} }`);
      }
    }
    if (base !== "tokens.css") {
      const hex = (stripComments(text).match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).length;
      report.push(`${base}: 토큰 밖 hex ${hex}개`);
    }
  }
  return { warns, report };
}

// ---------- CLI ----------
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args[0] === "--lint") {
    let files = args.slice(1);
    if (!files.length) files = readdirSync("public/css").filter(f => f.endsWith(".css")).map(f => path.join("public/css", f));
    const { warns, report } = lint(files);
    report.forEach(r => console.log(r));
    warns.forEach(w => console.log("경고 " + w));
    console.log(warns.length ? `경고 ${warns.length}건` : "경고 0건");
    process.exit(warns.length ? 1 : 0);
  }
  if (args.length < 2) { console.log("사용법: node tools/css-cascade.mjs <옛.css> <새1.css> ... | --lint [파일...]"); process.exit(2); }
  const [oldFile, ...newFiles] = args;
  const out = diff(readFileSync(oldFile, "utf8"), newFiles.map(f => readFileSync(f, "utf8")));
  out.forEach(l => console.log(l));
  console.log(out.length ? `차이 ${out.length}건` : "차이 0건 (화이트리스트 제외)");
  process.exit(out.length ? 1 : 0);
}
