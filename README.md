# 오늘, 누구와? — 소개팅 매칭 로직 데모

가상 아이폰(폰에서는 전체 화면)에서 앱을 쓰고, 매칭 탭 안의 매칭 과정 카드에서 매칭이 어떤 과정을 거치는지 실시간으로 보는 데모입니다.

## 매칭 4단계

| 단계 | 하는 일 | 어디서 |
|---|---|---|
| 1. 규칙 거르기 | 성별·나이·흡연·종교 조건을 내 쪽과 상대 쪽 모두 확인해 뺀다. 나 자신 제외, 0명이면 안내 | 브라우저 |
| 2. 임베딩 후보 | 관심사·소개·성격 글을 벡터로 바꿔 코사인 유사도가 높은 5명을 고른다 (`bge-m3`) | 서버 → 로컬 LLM(Ollama) |
| 3. LLM 재순위 | Claude가 5명의 글을 읽고 성격·대화 스타일까지 보고 다시 줄 세운다 | 서버 → Claude API |
| 4. LLM 이유 설명 | 5명 각각을 고른 이유를 두 프로필에 적힌 내용만으로 쓴다 (1위는 결과 화면, 2~5위는 상세 화면) | 서버 → Claude API |

임베딩은 이 컴퓨터의 Ollama가 한다(`local-llm/`). 배포판처럼 Ollama가 없으면 관심사 뜻 묶음 계산으로 대신하고 로그에 그렇게 적는다. 재순위·이유·채팅은 기본으로 Claude가 하고, `.env`에 `LLM_PROVIDER=ollama`를 넣으면 로컬 모델(`qwen3.6:27b`, 바꾸려면 `OLLAMA_CHAT_MODEL`)이 같은 질문지로 답한다. 질문지는 `llm.js` 하나이고, 묻는 쪽만 `claudeRunner`(llm.js) / `ollamaRunner`(local-llm/ollama.js)로 갈린다. Vercel 배포판은 늘 Claude를 쓴다.

## 폰에서 앱처럼 쓰기

폰 브라우저로 열면 첫 매칭 결과가 나온 뒤(또는 두 번째 방문 때) 아래쪽에 「앱으로 쓰기」 안내가 뜬다. 가입 중에는 뜨지 않고, 닫으면 7일 동안 다시 뜨지 않는다. 내 정보 탭에서 언제든 다시 열 수 있다.

- 아이폰(Safari): 아래 `···` → 공유 → 「홈 화면에 추가」
- 안드로이드(Chrome): 안내의 「설치」 버튼
- 카카오톡 안에서 열었으면: 안내의 「Safari로 열기」/「Chrome으로 열기」로 브라우저에서 다시 연다

앱 이름·아이콘·세로 고정은 `public/manifest.webmanifest`, 안내와 확대 막기는 `public/install.js`, 오프라인 화면은 `public/sw.js`(https 배포에서만 켜짐)에 있다.

## 실행

```bash
npm install
```

`.env`에 `ANTHROPIC_API_KEY=...`를 넣고, Ollama에 임베딩 모델을 받아 둔 뒤(`ollama pull bge-m3`):

```bash
npm start
```

http://localhost:3000 을 엽니다.

## 배포 (Vercel, 카드 등록 없음)

화면(`public/`)과 Claude 중계 함수(`api/`)를 한 주소에 올린다. API 키는 Vercel 환경 변수에만 두고 브라우저로 내려보내지 않는다.

1. vercel.com 에서 GitHub 계정으로 로그인
2. Add New → Project → 이 저장소 Import
3. Environment Variables 에 `ANTHROPIC_API_KEY` 추가
4. Deploy

남용을 막으려고 IP당 분당 요청 수, 요청 크기, 대화 길이에 상한을 둔다. Anthropic 콘솔에서 월 사용 한도도 걸어 두는 것을 권한다.

GitHub Pages 배포판(`gh-pages` 브랜치)은 `public/js/config.js`의 `PAGES_API_BASE`에 Vercel 주소를 넣으면 같은 서버로 Claude를 부른다.

인물 사진 20명과 예시 프로필 6명은 모두 AI로 만든 가상 인물이다.
