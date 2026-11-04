// 상대 대사를 소리 내어 읽는다(브라우저 내장 음성). 한국어 음성이 없는 기기에서는 자막만 보인다.
import { load, save } from "../core/store.js";

const synth = window.speechSynthesis;
export const canSpeak = !!synth;
let muted = load("practice-muted", false);

export const isMuted = () => muted;
export function setMuted(on) {
  muted = on;
  save("practice-muted", on);
  if (on) stopSpeech();
}
export function stopSpeech() { synth?.cancel(); }

// 아이폰은 사용자가 누른 직후에 한 번 말해 둬야 그 뒤 비동기 재생을 허용한다
export function unlockSpeech() {
  if (synth) synth.speak(new SpeechSynthesisUtterance(""));
}

export function speak(text, gender) {
  if (!synth || muted) return;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "ko-KR";
  const voice = synth.getVoices().find(v => v.lang.replace("_", "-").startsWith("ko"));
  if (voice) u.voice = voice;
  u.pitch = gender === "여" ? 1.15 : .8;   // 기기 음성은 대개 한 가지라 높낮이로 구분한다
  u.rate = 1.05;
  synth.speak(u);
}
