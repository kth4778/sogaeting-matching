// 작은 공용 도구 (WP0 작성, 동결)
import { PROFILES } from "../data/profiles.js";

// 임베딩 단계에서 LLM에게 넘길 후보 수
export const TOP_K = 5;
// 좋아요를 받았을 때 상대도 좋아요를 누를 궁합 점수 기준
export const MUTUAL_MIN = 60;

export const $ = sel => document.querySelector(sel);
export const byId = id => PROFILES.find(p => p.id === id);
export const PHOTO_V = 4; // 사진을 새로 만들면 올려서 브라우저에 남은 옛 사진을 쓰지 않게 한다
export const photo = p => `photos/${p.id}.jpg?v=${PHOTO_V}`;
export const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
export const sleep = ms => new Promise(r => setTimeout(r, ms));
// 내 사진 주소: 직접 올린 사진(photoData) → 예시 프로필 사진(photo) → 없으면 null
export const meSrc = me => me.photoData ? me.photoData : me.photo ? `${me.photo.replace(".png", ".jpg")}?v=${PHOTO_V}` : null;
// 내 사진이 있으면(예시 프로필) 사진, 없으면 이름 첫 글자로 동그라미를 그린다
export const meAvatar = (me, cls) => meSrc(me)
  ? `<div class="${cls} photo" style="background-image:url(${meSrc(me)})"></div>`
  : `<div class="${cls}">${esc(me.name.slice(0, 1))}</div>`;
// 마지막 글자 받침에 따라 을/를을 고른다
export const eulReul = name => ((name.charCodeAt(name.length - 1) - 0xac00) % 28 ? `${name}을` : `${name}를`);
export const time = () => new Date().toTimeString().slice(0, 8);
