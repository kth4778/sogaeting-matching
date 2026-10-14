# 오늘, 누구와? — 소개팅 매칭 로직 데모

웹 화면 왼쪽의 가상 아이폰에서 앱을 쓰고, 오른쪽 로그에서 매칭이 어떤 과정을 거치는지 실시간으로 보는 데모입니다.

## 매칭 4단계

| 단계 | 하는 일 | 어디서 |
|---|---|---|
| 1. 규칙 거르기 | 성별·나이·흡연·종교 조건을 내 쪽과 상대 쪽 모두 확인해 뺀다. 나 자신 제외, 0명이면 안내 | 브라우저 |
| 2. 임베딩 후보 | 관심사·소개·성격 문장을 좌표로 바꿔 가까운 5명을 고른다 (`Xenova/multilingual-e5-small`) | 브라우저 |
| 3. LLM 재순위 | Claude가 5명의 글을 읽고 성격·대화 스타일까지 보고 다시 줄 세운다 | 서버 → Claude API |
| 4. LLM 이유 설명 | 1위를 고른 이유를 두 프로필에 적힌 내용만으로 쓴다 | 서버 → Claude API |

## 실행

```bash
npm install
```

`.env`에 `ANTHROPIC_API_KEY=...`를 넣은 뒤:

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

GitHub Pages 배포판(`gh-pages` 브랜치)은 `public/config.js`의 `PAGES_API_BASE`에 Vercel 주소를 넣으면 같은 서버로 Claude를 부른다.

인물 사진 20명과 예시 프로필 6명은 모두 AI로 만든 가상 인물이다.
