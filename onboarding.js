import { SAMPLE_PROFILES } from "./profiles.js";

// 처음 시작할 때 한 화면에 질문 하나씩 묻는 가입 흐름.
// 여기서 모은 칸이 그대로 매칭 로직의 입력(내 프로필 + 이상형 조건)이 된다.

const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// 같은 뜻 다른 표기(등산/산 타기)를 일부러 섞어 임베딩 단계의 차이가 보이게 한다
export const INTEREST_OPTIONS = [
  "등산", "산 타기", "트레킹", "캠핑", "러닝", "헬스", "클라이밍", "요가",
  "카페 투어", "맛집 탐방", "베이킹", "요리", "여행", "페스티벌", "전시회", "미술관",
  "영화 보기", "넷플릭스", "독서", "사진", "필름 카메라", "음악 감상", "기타 연주", "게임",
  "보드게임", "코딩", "반려견 산책", "자전거",
];
const REGIONS = ["충주", "청주", "대전", "서울", "세종", "원주"];
const RELIGIONS = ["무교", "기독교", "불교", "천주교"];
const MBTI_PAIRS = [["E", "외향"], ["I", "내향"], ["S", "감각"], ["N", "직관"], ["T", "사고"], ["F", "감정"], ["J", "계획"], ["P", "즉흥"]];
export const INTEREST_MIN = 2;
export const INTEREST_MAX = 6;

export function blankDraft() {
  return {
    id: "me", name: "", gender: null, age: 24, height: 170, region: "충주", job: "",
    smoking: "비흡연", drinking: "가끔", religion: "무교", mbti: "ISTJ",
    interests: [], intro: "", personality: "",
    wants: { gender: null, ageMin: 21, ageMax: 29, nonSmokerOnly: false, religion: "상관없음" },
  };
}

// 단계마다 제목, 설명, 통과 조건, 화면
export const STEPS = [
  { key: "welcome" },
  { key: "name", title: "이름을 알려주세요", sub: "상대에게 보여질 이름이에요.", valid: d => d.name.trim().length > 0 },
  { key: "gender", title: "성별을 골라주세요", sub: "만나고 싶은 사람의 성별도 함께요.", valid: d => d.gender && d.wants.gender },
  { key: "body", title: "나이와 키", sub: "상대의 이상형 조건과도 맞춰 봐요.", valid: () => true },
  { key: "place", title: "어디서 지내요?", sub: "가까운 사람끼리 만나기 편해요.", valid: d => d.job.trim().length > 0 },
  { key: "life", title: "생활 습관", sub: "서로 꼭 맞아야 하는 조건이에요.", valid: () => true },
  { key: "mbti", title: "MBTI", sub: "모르면 가까운 쪽을 골라도 괜찮아요.", valid: () => true },
  { key: "interests", title: "관심사를 골라주세요", sub: `${INTEREST_MIN}~${INTEREST_MAX}개. 취향이 비슷한 사람을 찾는 데 써요.`,
    valid: d => d.interests.length >= INTEREST_MIN && d.interests.length <= INTEREST_MAX },
  { key: "about", title: "나를 소개해 주세요", sub: "성격이 잘 맞는 사람을 찾는 데 써요.", valid: d => d.intro.trim().length >= 10 && d.personality.trim().length >= 5 },
  { key: "wants", title: "이런 사람이면 좋겠어요", sub: "여기서 정한 조건에 안 맞으면 후보에서 빠져요.", valid: d => d.wants.ageMin <= d.wants.ageMax },
  { key: "done" },
];

// labels를 주면 저장값(남)과 다른 글자(남자)로 보여 준다
const seg = (field, options, value, labels = options) => `
  <div class="seg">${options.map((o, i) => `<button class="${o === value ? "on" : ""}" data-act="ob-set:${field}:${o}">${labels[i]}</button>`).join("")}</div>`;

const chips = (field, options, value) => `
  <div class="chips">${options.map(o => `<button class="pick ${o === value ? "on" : ""}" data-act="ob-set:${field}:${o}">${o}</button>`).join("")}</div>`;

const stepper = (field, value, unit, min, max) => `
  <div class="stepper">
    <button data-act="ob-step:${field}:-1" ${value <= min ? "disabled" : ""} aria-label="줄이기">−</button>
    <span><b>${value}</b>${unit}</span>
    <button data-act="ob-step:${field}:1" ${value >= max ? "disabled" : ""} aria-label="늘리기">+</button>
  </div>`;

function bodyHtml(step, d) {
  switch (step.key) {
    case "name":
      return `<input class="big-input" data-field="name" value="${esc(d.name)}" placeholder="예: 김태현" maxlength="10" autocomplete="off">`;
    case "gender":
      return `
        <div class="gender-cards">
          ${["남", "여"].map(g => `<button class="gcard ${d.gender === g ? "on" : ""}" data-act="ob-set:gender:${g}"><span>${g === "남" ? "M" : "W"}</span>${g === "남" ? "남자" : "여자"}</button>`).join("")}
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
        <input class="big-input small" data-field="job" value="${esc(d.job)}" placeholder="예: 교통대 컴퓨터공학과" maxlength="20" autocomplete="off">`;
    case "life":
      return `
        <p class="field-label">흡연</p>${seg("smoking", ["비흡연", "흡연"], d.smoking)}
        <p class="field-label">음주</p>${seg("drinking", ["안 마심", "가끔", "자주"], d.drinking)}
        <p class="field-label">종교</p>${chips("religion", RELIGIONS, d.religion)}`;
    case "mbti":
      return `
        <div class="mbti-result">${d.mbti}</div>
        ${[0, 1, 2, 3].map(i => `<div class="seg">${MBTI_PAIRS.slice(i * 2, i * 2 + 2).map(([l, word]) =>
          `<button class="${d.mbti[i] === l ? "on" : ""}" data-act="ob-mbti:${i}:${l}"><b>${l}</b> ${word}</button>`).join("")}</div>`).join("")}`;
    case "interests":
      return `
        <div class="chips">${[...new Set([...INTEREST_OPTIONS, ...d.interests])].map(t =>
          `<button class="pick ${d.interests.includes(t) ? "on" : ""}" data-act="ob-interest:${esc(t)}">${esc(t)}</button>`).join("")}</div>
        <div class="add-row"><input data-field="newInterest" placeholder="직접 추가" maxlength="10" autocomplete="off"><button data-act="ob-add-interest">추가</button></div>
        <p class="count">${d.interests.length} / ${INTEREST_MAX}개 선택</p>`;
    case "about":
      return `
        <p class="field-label">한 줄 소개</p>
        <textarea data-field="intro" maxlength="80" placeholder="예: 주말엔 근처 산에 오르고, 평일엔 카페에서 공부해요.">${esc(d.intro)}</textarea>
        <p class="field-label">성격</p>
        <textarea data-field="personality" maxlength="60" placeholder="예: 조용한 편이지만 친해지면 말이 많아져요.">${esc(d.personality)}</textarea>`;
    case "wants":
      return `
        <p class="field-label">나이 범위</p>
        <div class="range-row">${stepper("wants.ageMin", d.wants.ageMin, "살", 19, 45)}<span class="tilde">~</span>${stepper("wants.ageMax", d.wants.ageMax, "살", 19, 45)}</div>
        ${d.wants.ageMin > d.wants.ageMax ? `<p class="warn">최소 나이가 최대 나이보다 커요</p>` : ""}
        <button class="toggle-row" data-act="ob-toggle-smoke">
          <span>비흡연자만 만날래요</span><span class="switch ${d.wants.nonSmokerOnly ? "on" : ""}"><i></i></span>
        </button>
        <p class="field-label">상대의 종교</p>${chips("wants.religion", ["상관없음", ...RELIGIONS], d.wants.religion)}`;
  }
  return "";
}

export function onboardingHtml(ob) {
  const { stepIndex, draft: d, editing, dir } = ob;
  const step = STEPS[stepIndex];

  if (ob.picker) {
    const list = SAMPLE_PROFILES.map((p, i) => ({ p, i })).filter(x => x.p.gender === ob.picker);
    return `
      <div class="ob">
        <div class="ob-top"><button class="icon-btn" data-act="ob-pick-close" aria-label="뒤로">←</button><span class="ob-top-title">예시 프로필</span><span class="icon-btn"></span></div>
        <div class="ob-body enter-${dir}">
          <h2>누구로 체험해 볼까요?</h2>
          <p class="ob-sub">고른 사람의 취향과 이상형으로 매칭이 돌아가요.</p>
          <div class="seg gender-seg">
            <button class="${ob.picker === "남" ? "on" : ""}" data-act="ob-pick-tab:남"><img src="icon-male.png" alt="">남자</button>
            <button class="${ob.picker === "여" ? "on" : ""}" data-act="ob-pick-tab:여"><img src="icon-female.png" alt="">여자</button>
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
    // 위: 사람들이 로고 주위를 돌고, 그중 두 사람이 하트로 이어지는 모션 / 아래: 서비스 소개 3장이 자동으로 넘어감
    const ring = (ids, cls) => `<div class="orbit ${cls}">${ids.map((id, i) => `
      <span class="orb" style="--a:${(360 / ids.length) * i}deg"><i style="background-image:url(photos/${id}.jpg?v=4)"></i></span>`).join("")}</div>`;
    const STORY = [
      ["intro-1.jpg", "조건부터 서로 맞춰 봐요", "나이·흡연·종교, 서로의 조건이 맞는 사람만 남겨요"],
      ["intro-2.jpg", "취향이 닮은 사람을 찾아요", "등산과 산 타기처럼 말이 달라도 같은 취향을 알아봐요"],
      ["intro-3.jpg", "왜 잘 맞는지 알려드려요", "점수만이 아니라 이유와 첫 만남 제안까지"],
    ];
    return `
      <div class="ob welcome enter-${dir}">
        <div class="hero">
          ${ring(["p01", "p13", "p07", "p16", "p05", "p12"], "orbit-in")}
          ${ring(["p02", "p11", "p09", "p20", "p06", "p17", "p08", "p19"], "orbit-out")}
          <div class="hero-core">
            <img src="logo.png?v=4" alt="">
            <span class="hero-heart">♥</span>
          </div>
          <div class="hero-pair">
            <i style="background-image:url(photos/me-f.jpg?v=4)"></i>
            <svg viewBox="0 0 120 30"><path d="M4 15 C 40 -5, 80 35, 116 15" /></svg>
            <i style="background-image:url(photos/me-m.jpg?v=4)"></i>
          </div>
          <span class="pen hero-title">오늘, 누구와?</span>
        </div>
        <div class="story">
          <div class="story-track">${STORY.map(([img, title, desc]) => `
            <div class="story-card"><img src="${img}" alt=""><div><b>${title}</b><p>${desc}</p></div></div>`).join("")}
          </div>
          <div class="story-dots"><i></i><i></i><i></i></div>
        </div>
        <div class="ob-foot">
          <button class="btn" data-act="ob-next">내 프로필 만들기</button>
          <button class="btn line" data-act="ob-pick-open">예시 프로필로 체험하기</button>
        </div>
      </div>`;
  }

  if (step.key === "done") {
    const avatar = d.photo
      ? `<div class="me-av big photo" style="background-image:url(${d.photo}?v=4)"></div>`
      : `<div class="me-av big">${esc(d.name.slice(0, 1))}</div>`;
    return `
      <div class="ob done enter-${dir}">
        ${ob.sample ? "" : `<div class="done-check">✓</div>`}
        <h2>${ob.sample ? `${esc(d.name)}님으로<br>체험해 볼게요` : `${esc(d.name)}님의 프로필이<br>완성됐어요`}</h2>
        <div class="summary">
          ${avatar}
          <b>${esc(d.name)}, ${d.age}</b>
          <p>${d.region} · ${esc(d.job)} · ${d.mbti}</p>
          <div>${d.interests.map(t => `<span class="chip">${esc(t)}</span>`).join("")}</div>
          <p class="muted small">${d.wants.gender === "여" ? "여자" : "남자"} ${d.wants.ageMin}~${d.wants.ageMax}살${d.wants.nonSmokerOnly ? " · 비흡연" : ""}${d.wants.religion !== "상관없음" ? ` · ${d.wants.religion}` : ""}</p>
        </div>
        <div class="ob-foot">
          <button class="btn" data-act="ob-finish">${editing ? "저장하기" : "이 프로필로 시작하기"}</button>
          <button class="link" data-act="ob-back">${ob.sample ? "다른 프로필 고르기" : "다시 확인하기"}</button>
        </div>
      </div>`;
  }

  const total = STEPS.length - 2; // welcome, done 제외
  return `
    <div class="ob">
      <div class="ob-top">
        <button class="icon-btn" data-act="${stepIndex === 1 && editing ? "ob-cancel" : "ob-back"}" aria-label="뒤로">←</button>
        <div class="progress"><i style="width:${(stepIndex / total) * 100}%"></i></div>
        <span class="muted small">${stepIndex}/${total}</span>
      </div>
      <div class="ob-body enter-${dir}">
        <h2>${step.title}</h2>
        <p class="ob-sub">${step.sub}</p>
        ${bodyHtml(step, d)}
      </div>
      <div class="ob-foot">
        <button class="btn" id="ob-next" data-act="ob-next" ${step.valid(d) ? "" : "disabled"}>다음</button>
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
