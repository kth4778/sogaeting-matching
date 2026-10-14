// 앱이 자주 쓰는 문장(가상 인물 20명, 예시 프로필 6명, 관심사 단어)의 임베딩을 미리 계산해 public/vectors.json에 저장한다.
// 앱은 이 파일에 있는 문장은 모델 없이 바로 쓰므로, 예시 프로필로 들어오면 모델을 내려받지 않는다.
// 실행: node scripts/precompute-vectors.mjs
import { writeFileSync } from "node:fs";
import { pipeline } from "@huggingface/transformers";
import { PROFILES, SAMPLE_PROFILES, profileText } from "../public/profiles.js";
import { INTEREST_OPTIONS } from "../public/onboarding.js";

const EMBED_MODEL = "Xenova/multilingual-e5-small"; // 앱(public/app.js)과 같은 모델이어야 한다
const people = [...PROFILES, ...SAMPLE_PROFILES];
const texts = [...new Set([
  ...people.map(profileText),
  ...people.flatMap(p => p.interests),
  ...INTEREST_OPTIONS,
])];

const extractor = await pipeline("feature-extraction", EMBED_MODEL);
const out = await extractor(texts.map(t => `query: ${t}`), { pooling: "mean", normalize: true });
const vectors = Object.fromEntries(out.tolist().map((v, i) => [texts[i], v.map(x => Math.round(x * 1e4) / 1e4)]));
writeFileSync(new URL("../public/vectors.json", import.meta.url), JSON.stringify(vectors));
console.log(`${texts.length}개 문장 저장`);
