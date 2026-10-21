import { SAMPLE_PROFILES } from "../data/profiles.js";
import { esc, meSrc } from "../core/util.js";
import { icon } from "../ui/icons.js";
import { heroHtml } from "../ui/brand.js";

// 처음 시작할 때 한 화면에 질문 하나씩 묻는 가입 흐름.
// 여기서 모은 칸이 그대로 매칭 로직의 입력(내 프로필 + 이상형 조건)이 된다.
// (store.js가 이 파일을 import하므로 여기서 store를 import하면 안 된다)

// 4묶음. 같은 뜻 다른 표기(산 타기·미술관)는 빼고, 동의어 시연은 예시 프로필·직접 추가로 한다
export const INTEREST_GROUPS = [
  ["운동·야외", ["등산", "트레킹", "캠핑", "러닝", "헬스", "클라이밍", "요가", "자전거", "반려견 산책"]],
  ["문화·취미", ["전시회", "영화 보기", "넷플릭스", "독서", "사진", "필름 카메라", "음악 감상", "기타 연주", "게임", "보드게임", "페스티벌"]],
  ["먹고 마시기", ["카페 투어", "맛집 탐방", "베이킹", "요리"]],
  ["일상", ["여행", "코딩"]],
];
export const INTEREST_OPTIONS = INTEREST_GROUPS.flatMap(([, list]) => list);
const REGIONS = ["충주", "청주", "대전", "서울", "세종", "원주"];
const RELIGIONS = ["무교", "기독교", "불교", "천주교"];
const MBTI_PAIRS = [["E", "외향"], ["I", "내향"], ["S", "감각"], ["N", "직관"], ["T", "사고"], ["F", "감정"], ["J", "계획"], ["P", "즉흥"]];
export const INTEREST_MIN = 2;
export const INTEREST_MAX = 6;
export const PHOTO_MAX = 6;
export const MBTI_UNKNOWN = "모름";
// 글자 칸의 길이 조건(도움말·통과 조건이 같은 값을 쓴다)
export const TEXT_RULE = { name: [2, 8], intro: [10, 80], personality: [5, 60] };
const textOk = (d, f) => (d[f] ?? "").trim().length >= TEXT_RULE[f][0];

export function blankDraft() {
  return {
    id: "me", name: "", gender: null, age: 24, height: 170, region: "충주", job: "",
    smoking: null, drinking: "가끔", religion: null, mbti: null,
    interests: [], intro: "", personality: "", photos: [],
    wants: { gender: null, ageMin: null, ageMax: null, nonSmokerOnly: false, religion: "상관없음" },
  };
}

// 단계마다 제목, 설명, 통과 조건. input: 진행 막대에 세는 입력 단계
export const STEPS = [
  { key: "welcome" },
  { key: "consent", title: "시작하기 전에\n확인해 주세요", sub: "필수 항목에 모두 동의해야 시작할 수 있어요." },
  { key: "name", input: true, title: "닉네임을 알려주세요", sub: "상대에게 보여질 이름이에요.", valid: d => textOk(d, "name") },
  { key: "gender", input: true, title: "성별을 골라주세요", sub: "만나고 싶은 사람의 성별도 함께요.", valid: d => d.gender && d.wants.gender },
  { key: "body", input: true, title: "나이와 키를 알려주세요", sub: "상대의 이상형 조건과도 맞춰 봐요.", valid: () => true },
  { key: "place", input: true, title: "어디서, 무슨 일을 하며 지내요?", sub: "가까운 사람끼리 만나기 편해요.", valid: d => d.job.trim().length > 0 },
  { key: "life", input: true, title: "생활 습관을 알려주세요", sub: "상대가 원하는 조건과 맞춰 봐요.", valid: d => !!d.smoking && !!d.religion },
  { key: "mbti", input: true, title: "MBTI가 뭐예요?", sub: "모르면 「잘 모르겠어요」를 골라도 괜찮아요.", valid: d => d.mbti === MBTI_UNKNOWN || /^[EI][SN][TF][JP]$/.test(d.mbti ?? "") },
  { key: "interests", input: true, title: "관심사를 골라주세요", sub: `${INTEREST_MIN}~${INTEREST_MAX}개. 취향이 비슷한 사람을 찾는 데 써요.`,
    valid: d => d.interests.length >= INTEREST_MIN && d.interests.length <= INTEREST_MAX },
  { key: "about", input: true, title: "나를 소개해 주세요", sub: "성격이 잘 맞는 사람을 찾는 데 써요.", valid: d => textOk(d, "intro") && textOk(d, "personality") },
  { key: "photos", input: true, title: "사진을 올려 주세요", sub: "첫 번째 사진이 대표 사진이 돼요. 나중에 올려도 괜찮아요.", valid: () => true },
  { key: "wants", input: true, title: "이런 사람이면 좋겠어요", sub: "여기서 정한 조건에 안 맞으면 후보에서 빠져요.", valid: d => d.wants.ageMin <= d.wants.ageMax },
  { key: "done" },
];
export const INPUT_STEPS = STEPS.filter(s => s.input);
export const stepNo = key => INPUT_STEPS.findIndex(s => s.key === key) + 1;

export const CONSENTS = [
  ["age", "만 19세 이상이에요"],
  ["terms", "이용약관"],
  ["privacy", "개인정보 수집·이용(이 기기에만 저장)"],
];

// 다음 버튼 문구(상황형)
export function ctaLabel(step, d, ob) {
  const save = ob.single || ob.returnTo ? "저장" : "다음";
  if (step.key === "interests" && d.interests.length < INTEREST_MIN) return `${INTEREST_MIN - d.interests.length}개 더 골라주세요`;
  if (step.key === "interests") return `${save} (${d.interests.length}/${INTEREST_MAX})`;
  if (step.key === "about" && !textOk(d, "intro")) return `소개를 ${TEXT_RULE.intro[0] - d.intro.trim().length}자 더 써 주세요`;
  if (step.key === "photos" && !(d.photos ?? []).length && !ob.single) return "건너뛰기";
  return save;
}

// 글자 칸 아래 도움말 「10자 이상 · 7/80」
export const helpHtml = (d, f) => {
  const [min, max] = TEXT_RULE[f];
  const ok = textOk(d, f);
  return `<p class="ob-help ${ok ? "ok" : ""}" id="help-${f}">${ok ? icon("check", 14) : ""}${min}자 이상 · ${(d[f] ?? "").length}/${max}</p>`;
};

// labels를 주면 저장값(남)과 다른 글자(남자)로 보여 준다
const seg = (field, options, value, labels = options) => `
  <div class="seg">${options.map((o, i) => `<button class="${o === value ? "on" : ""}" aria-pressed="${o === value}" data-act="ob-set:${field}:${o}">${labels[i]}</button>`).join("")}</div>`;

const pick = (act, label, on) => `<button class="pick ${on ? "on" : ""}" aria-pressed="${on}" data-act="${act}">${label}</button>`;
const chips = (field, options, value) => `
  <div class="chips">${options.map(o => pick(`ob-set:${field}:${o}`, o, o === value)).join("")}</div>`;

const stepper = (field, value, unit, min, max) => `
  <div class="stepper">
    <button data-act="ob-step:${field}:-1" ${value <= min ? "disabled" : ""} aria-label="줄이기">−</button>
    <span><b>${value}</b>${unit}</span>
    <button data-act="ob-step:${field}:1" ${value >= max ? "disabled" : ""} aria-label="늘리기">+</button>
  </div>`;

function bodyHtml(step, d, ob) {
  switch (step.key) {
    case "consent": {
      const a = ob.agree ?? {};
      const all = CONSENTS.every(([k]) => a[k]);
      const box = on => `<span class="ob-box ${on ? "on" : ""}">${icon("check", 14)}</span>`;
      return `
        <button class="ob-agree all" data-act="ob-agree:all" aria-pressed="${all}">${box(all)}<b>전체 동의</b></button>
        ${CONSENTS.map(([k, label]) => `
          <div class="ob-agree-row">
            <button class="ob-agree" data-act="ob-agree:${k}" aria-pressed="${!!a[k]}">${box(a[k])}<span><em>[필수]</em> ${label}</span></button>
            <button class="ob-agree-more" data-act="ob-terms:${k}" aria-label="${label} 전문 보기">${icon("chevron-right", 16)}</button>
          </div>`).join("")}`;
    }
    case "name":
      return `<input class="big-input" data-field="name" value="${esc(d.name)}" placeholder="예: 산책하는 민지" maxlength="${TEXT_RULE.name[1]}" autocomplete="nickname" enterkeyhint="next">
        ${helpHtml(d, "name")}`;
    case "gender":
      return `
        <div class="gender-cards">
          ${["남", "여"].map(g => `<button class="gcard ${d.gender === g ? "on" : ""}" aria-pressed="${d.gender === g}" data-act="ob-set:gender:${g}"><img src="${g === "남" ? "icon-male.png" : "icon-female.png"}" alt="">${g === "남" ? "남자" : "여자"}</button>`).join("")}
        </div>
        <p class="field-label">만나고 싶은 사람</p>
        ${seg("wants.gender", ["남", "여"], d.wants.gender, ["남자", "여자"])}`;
    case "body":
      return `
        <p class="field-label">나이</p>${stepper("age", d.age, "살", 19, 45)}
        <p class="field-label">키</p>${stepper("height", d.height, "cm", 145, 200)}`;
    case "place":
      return `
        <p class="field-label">지역</p>${chips("region", REGIONS, d.region)}
        <p class="field-label">학교·학과 또는 직업</p>
        <input class="big-input small" data-field="job" value="${esc(d.job)}" placeholder="예: 교통대 컴퓨터공학과" maxlength="20" autocomplete="off" enterkeyhint="next">`;
    case "life":
      return `
        <p class="field-label">흡연</p>${seg("smoking", ["비흡연", "흡연"], d.smoking)}
        <p class="field-label">음주</p>${seg("drinking", ["안 마심", "가끔", "자주"], d.drinking)}
        <p class="field-label">종교</p>${chips("religion", RELIGIONS, d.religion)}`;
    case "mbti": {
      const m = d.mbti === MBTI_UNKNOWN ? null : d.mbti;
      return `
        <div class="mbti-result">${d.mbti === MBTI_UNKNOWN ? "?" : [0, 1, 2, 3].map(i => m?.[i] && m[i] !== "_" ? m[i] : "·").join("")}</div>
        ${[0, 1, 2, 3].map(i => `<div class="seg">${MBTI_PAIRS.slice(i * 2, i * 2 + 2).map(([l, word]) =>
          `<button class="${m?.[i] === l ? "on" : ""}" aria-pressed="${m?.[i] === l}" data-act="ob-mbti:${i}:${l}"><b>${l}</b> ${word}</button>`).join("")}</div>`).join("")}
        <div class="chips ob-center">${pick("ob-set:mbti:" + MBTI_UNKNOWN, "잘 모르겠어요", d.mbti === MBTI_UNKNOWN)}</div>`;
    }
    case "interests": {
      const extra = d.interests.filter(t => !INTEREST_OPTIONS.includes(t));
      const groups = extra.length ? [["직접 추가", extra], ...INTEREST_GROUPS] : INTEREST_GROUPS;
      return `
        ${groups.map(([label, list]) => `
          <p class="ob-group">${label}</p>
          <div class="chips">${list.map(t => pick(`ob-interest:${esc(t)}`, esc(t), d.interests.includes(t))).join("")}</div>`).join("")}
        <div class="add-row"><input data-field="newInterest" placeholder="직접 추가" maxlength="10" autocomplete="off" enterkeyhint="done"><button data-act="ob-add-interest">추가</button></div>
        <p class="count">${d.interests.length} / ${INTEREST_MAX}개 선택</p>`;
    }
    case "about":
      return `
        <p class="field-label">한 줄 소개</p>
        <textarea data-field="intro" maxlength="${TEXT_RULE.intro[1]}" placeholder="예: 주말엔 근처 산에 오르고, 평일엔 카페에서 공부해요.">${esc(d.intro)}</textarea>
        ${helpHtml(d, "intro")}
        <p class="field-label">성격</p>
        <textarea data-field="personality" maxlength="${TEXT_RULE.personality[1]}" placeholder="예: 조용한 편이지만 친해지면 말이 많아져요.">${esc(d.personality)}</textarea>
        ${helpHtml(d, "personality")}`;
    case "photos": {
      const list = d.photos ?? [];
      return `
        <div class="ob-photos">${Array.from({ length: PHOTO_MAX }, (_, i) => list[i]
          ? `<button class="ob-photo" data-act="ob-photo-del:${i}" aria-label="${i + 1}번째 사진 빼기" style="background-image:url(${list[i]})">${i === 0 ? `<span class="ob-photo-main">대표</span>` : ""}<span class="ob-photo-x">${icon("x", 14)}</span></button>`
          : `<button class="ob-photo empty" data-act="ob-photo-add" aria-label="사진 추가">${icon("plus", 24)}${i === 0 ? `<span class="ob-photo-main">대표</span>` : ""}</button>`).join("")}
        </div>
        <input type="file" accept="image/*" id="ob-file" hidden>`;
    }
    case "wants":
      return `
        <p class="field-label">나이 범위</p>
        <div class="range-row">${stepper("wants.ageMin", d.wants.ageMin, "살", 19, 45)}<span class="tilde">~</span>${stepper("wants.ageMax", d.wants.ageMax, "살", 19, 45)}</div>
        ${d.wants.ageMin > d.wants.ageMax ? `<p class="warn">최소 나이가 최대 나이보다 커요</p>` : ""}
        <button class="toggle-row" data-act="ob-toggle-smoke">
          <span>비흡연자만 만날래요</span><span class="switch ${d.wants.nonSmokerOnly ? "on" : ""}" role="switch" aria-checked="${d.wants.nonSmokerOnly}"><i></i></span>
        </button>
        <p class="field-label">상대의 종교</p>${chips("wants.religion", ["상관없음", ...RELIGIONS], d.wants.religion)}`;
  }
  return "";
}

// 웰컴 히어로(모션 그래픽은 ui/brand.js) + 서비스 소개 3장
export function welcomeHeroHtml() {
  const STORY = [
    ["intro-1.jpg", "조건부터 서로 맞춰 봐요", "나이·흡연·종교, 서로의 조건이 맞는 사람만 남겨요"],
    ["intro-2.jpg", "취향이 닮은 사람을 찾아요", "등산과 산 타기처럼 말이 달라도 같은 취향을 알아봐요"],
    ["intro-3.jpg", "왜 잘 맞는지 알려드려요", "점수만이 아니라 이유와 첫 만남 제안까지"],
  ];
  return `${heroHtml()}
        <div class="story">
          <div class="story-track">${STORY.map(([img, title, desc]) => `
            <div class="story-card"><img src="${img}" alt=""><div><b>${title}</b><p>${desc}</p></div></div>`).join("")}
          </div>
          <div class="story-dots"><i></i><i></i><i></i></div>
        </div>`;
}

// 완료 화면의 요약 행: [라벨, 값, 단계 key]
function summaryRows(d) {
  const w = d.wants;
  return [
    ["닉네임", esc(d.name), "name"],
    ["성별", `${d.gender === "남" ? "남자" : "여자"} → ${w.gender === "여" ? "여자" : "남자"}`, "gender"],
    ["나이·키", `${d.age}살 · ${d.height}cm`, "body"],
    ["지역·하는 일", `${d.region} · ${esc(d.job)}`, "place"],
    ["생활 습관", `${d.smoking} · 술 ${d.drinking} · ${d.religion}`, "life"],
    ["MBTI", d.mbti === MBTI_UNKNOWN ? "잘 모르겠어요" : d.mbti, "mbti"],
    ["관심사", esc(d.interests.join(", ")), "interests"],
    ["사진", `${(d.photos ?? []).length || (d.photo ? 1 : 0)}장`, "photos"],
    ["이상형", `${w.ageMin}~${w.ageMax}살${w.nonSmokerOnly ? " · 비흡연" : ""}${w.religion !== "상관없음" ? ` · ${w.religion}` : ""}`, "wants"],
  ];
}

export function onboardingHtml(ob) {
  const { stepIndex, draft: d, editing, dir } = ob;
  const step = STEPS[stepIndex];

  // 예시 프로필 피커는 웰컴보다 먼저 판단한다
  if (ob.picker) {
    const list = SAMPLE_PROFILES.map((p, i) => ({ p, i })).filter(x => x.p.gender === ob.picker);
    return `
      <div class="ob">
        <div class="ob-top"><button class="icon-btn" data-act="ob-backroute" aria-label="뒤로">←</button><span class="ob-top-title">예시 프로필</span><span class="icon-btn"></span></div>
        <div class="ob-body enter-${dir}">
          <h2>누구로 체험해 볼까요?</h2>
          <p class="ob-sub">고른 사람의 취향과 이상형으로 매칭이 돌아가요.</p>
          <div class="seg gender-seg">
            <button class="${ob.picker === "남" ? "on" : ""}" aria-pressed="${ob.picker === "남"}" data-act="ob-pick-tab:남"><img src="icon-male.png" alt="">남자</button>
            <button class="${ob.picker === "여" ? "on" : ""}" aria-pressed="${ob.picker === "여"}" data-act="ob-pick-tab:여"><img src="icon-female.png" alt="">여자</button>
          </div>
          <div class="sample-list">${list.map(({ p, i }) => `
            <button class="sample" data-act="ob-pick:${i}">
              <span class="sample-photo" style="background-image:url(${p.photo}?v=4)"></span>
              <div class="sample-info">
                <b>${esc(p.name)} <span>${p.age}</span></b>
                <small>${p.region} · ${esc(p.job)}</small>
                <div>${p.interests.slice(0, 3).map(t => `<span class="chip">${esc(t)}</span>`).join("")}</div>
              </div>
              <span class="chev">›</span>
            </button>`).join("")}
          </div>
        </div>
      </div>`;
  }

  if (step.key === "welcome") {
    const resume = ob.resume;
    return `
      <div class="ob welcome enter-${dir}">
        ${welcomeHeroHtml()}
        <div class="ob-foot">
          ${resume
            ? `<button class="btn" data-act="ob-resume">이어서 만들기 (${stepNo(STEPS[resume].key) || INPUT_STEPS.length}/${INPUT_STEPS.length})</button>`
            : `<button class="btn" data-act="ob-next">내 프로필 만들기</button>`}
          <button class="btn line" data-act="ob-pick-open">예시 프로필로 체험하기</button>
          ${resume ? `<button class="link" data-act="ob-restart">처음부터</button>` : ""}
          <p class="ob-notice">체험용 서비스예요 · 등장인물과 사진은 모두 AI로 만든 가상 인물이에요 · 인증 표시는 예시예요</p>
        </div>
      </div>`;
  }

  if (step.key === "done") {
    const src = meSrc({ ...d, photoData: d.photos?.[0] });
    const avatar = src
      ? `<div class="me-av big photo" style="background-image:url(${src})"></div>`
      : `<div class="me-av big">${esc(d.name.slice(0, 1))}</div>`;
    const title = editing ? "프로필을 확인해 주세요"
      : ob.sample ? `${esc(d.name)}님으로<br>체험해 볼게요` : `${esc(d.name)}님의 프로필이<br>완성됐어요`;
    return `
      <div class="ob done enter-${dir}">
        ${editing ? `<div class="ob-top"><button class="icon-btn" data-act="ob-backroute" aria-label="닫기">${icon("x")}</button><span class="ob-top-title">프로필 수정</span><span class="icon-btn"></span></div>` : ""}
        <div class="ob-body">
          ${ob.sample || editing ? "" : `<svg class="done-check" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="32"/><path d="M19 33 l9 9 l17 -19"/></svg>`}
          <div class="ob-done-head">${avatar}<h2>${title}</h2></div>
          <div class="ob-rows">${summaryRows(d).map(([label, value, key]) => `
            <button class="ob-row" data-act="ob-goto:${key}"><span>${label}</span><b>${value}</b>${icon("chevron-right", 16)}</button>`).join("")}
          </div>
        </div>
        <div class="ob-foot">
          <button class="btn" data-act="ob-finish">${editing ? "저장하기" : "첫 매칭 보러 가기"}</button>
          ${editing ? "" : `<button class="link" data-act="ob-backroute">${ob.sample ? "다른 프로필 고르기" : "다시 확인하기"}</button>`}
        </div>
      </div>`;
  }

  const n = stepNo(step.key);
  const total = INPUT_STEPS.length;
  const closeLeft = ob.single || ob.returnTo;
  const valid = step.valid ? step.valid(d) : CONSENTS.every(([k]) => ob.agree?.[k]);
  return `
    <div class="ob">
      <div class="ob-top">
        <button class="icon-btn" data-act="ob-backroute" aria-label="${closeLeft ? "닫기" : "뒤로"}">${closeLeft ? icon("x") : "←"}</button>
        ${ob.single || !step.input ? `<span class="ob-top-title"></span><span class="icon-btn"></span>` : `
        <div class="progress" role="progressbar" aria-valuemin="1" aria-valuemax="${total}" aria-valuenow="${n}"><i style="transform:scaleX(${n / total})"></i></div>
        <span class="muted small">${n}/${total}</span>`}
      </div>
      <div class="ob-body enter-${dir}">
        <h2>${step.title.replace("\n", "<br>")}</h2>
        <p class="ob-sub">${step.sub}</p>
        ${bodyHtml(step, d, ob)}
      </div>
      <div class="ob-foot">
        <button class="btn" id="ob-next" data-act="ob-next" ${valid ? "" : "disabled"}>${step.valid ? ctaLabel(step, d, ob) : "동의하고 시작하기"}</button>
      </div>
    </div>`;
}

// 점 표기(wants.gender)로 깊은 칸까지 값을 넣는다
export function setField(d, path, value) {
  const keys = path.split(".");
  const last = keys.pop();
  keys.reduce((o, k) => o[k], d)[last] = value;
}
export function getField(d, path) {
  return path.split(".").reduce((o, k) => o[k], d);
}
