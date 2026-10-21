// public/js/**/*.js의 상대 import를 검사한다 (WP0 작성, 동결)
//   없는 파일, 대상 파일 export에 없는 이름, 순환 import를 출력하고 하나라도 있으면 exit 1.
//   사용: node tools/check-imports.mjs
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve("public/js");
const files = [];
const walk = dir => readdirSync(dir).forEach(n => {
  const f = path.join(dir, n);
  if (statSync(f).isDirectory()) walk(f);
  else if (f.endsWith(".js")) files.push(f);
});
walk(ROOT);

const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\])\/\/.*$/gm, "$1");
const rel = f => path.relative(process.cwd(), f);

function exportsOf(src) {
  const names = new Set();
  for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) {
    m[1].split(",").map(s => s.trim()).filter(Boolean).forEach(s => names.add(s.split(/\s+as\s+/).pop().trim()));
  }
  if (/export\s+default\b/.test(src)) names.add("default");
  return names;
}

const problems = [];
const graph = new Map();
const cache = new Map();
const exportsFor = f => {
  if (!cache.has(f)) cache.set(f, exportsOf(strip(readFileSync(f, "utf8"))));
  return cache.get(f);
};

for (const f of files) {
  const src = strip(readFileSync(f, "utf8"));
  const deps = [];
  // import { a, b as c } from "./x.js" · import x from "./x.js" · import * as x from "./x.js" · import "./x.js"
  const re = /import\s+(?:([^"';]*?)\s+from\s+)?["'](\.{1,2}\/[^"']+)["']/g;
  for (const m of src.matchAll(re)) {
    const [, clause, spec] = m;
    const target = path.resolve(path.dirname(f), spec);
    deps.push(target);
    if (!existsSync(target)) { problems.push(`${rel(f)}: 없는 파일 ${spec}`); continue; }
    if (!clause) continue;
    const named = clause.match(/\{([\s\S]*)\}/);
    const exp = exportsFor(target);
    if (named) {
      named[1].split(",").map(s => s.trim()).filter(Boolean).forEach(s => {
        const name = s.split(/\s+as\s+/)[0].trim();
        if (!exp.has(name)) problems.push(`${rel(f)}: ${spec}에 export ${name} 없음`);
      });
    }
    const def = clause.replace(/\{[\s\S]*\}/, "").replace(/\*\s+as\s+\w+/, "").replace(/,/g, "").trim();
    if (def && !exp.has("default")) problems.push(`${rel(f)}: ${spec}에 export default 없음`);
  }
  graph.set(f, deps);
}

// 순환: DFS로 회색 노드를 다시 만나면 그 경로를 출력
const color = new Map();
const stack = [];
const seenCycles = new Set();
function dfs(f) {
  color.set(f, 1);
  stack.push(f);
  for (const d of graph.get(f) ?? []) {
    if (color.get(d) === 1) {
      const cyc = stack.slice(stack.indexOf(d)).concat(d).map(rel).join(" → ");
      if (!seenCycles.has(cyc)) { seenCycles.add(cyc); problems.push(`순환 import: ${cyc}`); }
    } else if (!color.get(d) && graph.has(d)) dfs(d);
  }
  stack.pop();
  color.set(f, 2);
}
files.forEach(f => { if (!color.get(f)) dfs(f); });

problems.forEach(p => console.log(p));
console.log(problems.length ? `문제 ${problems.length}건` : `import 문제 0건 (${files.length}개 파일)`);
process.exit(problems.length ? 1 : 0);
