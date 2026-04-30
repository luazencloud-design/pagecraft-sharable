# 🔐 PageCraft Sharable

> **PageCraft Pro의 보안 강화 버전 — 어드민 링크 기반 접근 제어 + AI 모델 이미지 생성 + 사용량 한도**
> 어드민이 발급한 링크로만 접근 가능한 비공개 AI 상세페이지 생성 플랫폼.

- **GitHub:** [luazencloud-design/pagecraft-sharable](https://github.com/luazencloud-design/pagecraft-sharable)
- **버전:** v3.0
- **기술 스택:** Vercel Serverless · Vercel KV(Redis) · Gemini 2.5 Flash + Flash Image · @napi-rs/canvas
- **차이점 (vs pagecraft-pro):** 링크 시스템·세션 폴링·IP 등록·AI 모델 이미지(월 100장)·어드민 대시보드 추가

---

## 📋 목차

1. [pagecraft-pro와의 차이](#-pagecraft-pro와의-차이)
2. [3개 페이지 진입 흐름](#-3개-페이지-진입-흐름)
3. [파일 구성](#-파일-구성)
4. [코드 원리 — 보안 데이터 흐름](#-코드-원리--보안-데이터-흐름)
5. [Vercel KV 데이터 스키마](#-vercel-kv-데이터-스키마)
6. [다운로드 방법](#-다운로드-방법)
7. [외부 서비스 연동](#-외부-서비스-연동)
8. [Vercel 배포 + KV 연결](#-vercel-배포--kv-연결)
9. [로컬 개발 (`dev-server.js`)](#-로컬-개발-dev-serverjs)
10. [어드민 사용법](#-어드민-사용법)
11. [트러블슈팅](#-트러블슈팅)
12. [후임자 메모](#-후임자-메모)

---

## 🆚 pagecraft-pro와의 차이

| 항목 | pagecraft-pro | pagecraft-sharable |
|------|---------------|--------------------|
| 접근 제어 | 공개 | 🔐 어드민 링크 기반 |
| 페이지 수 | 1 (`index.html`) | 3 (`index.html` + `admin.html` + `view.html`) |
| 데이터 저장소 | 없음 | Vercel KV (Redis) |
| 세션 관리 | 없음 | 5초 폴링·TTL 자동 갱신 |
| IP 등록 | 없음 | 첫 방문 IP 등록·만료 |
| AI 모델 사진 | 없음 | ✅ Gemini 2.5 Flash Image |
| 사용량 한도 | 없음 | 월 100장 (IP별, 30일 주기) |
| 어드민 대시보드 | 없음 | ✅ 링크 CRUD + 방문 기록 |
| 봇/메신저 감지 | 없음 | ✅ User-Agent 필터 |
| 가격 정책 | 무제한 | 어드민이 링크별 횟수/만료 설정 |

---

## 🚪 3개 페이지 진입 흐름

```
[어드민]                    [공유받는 사용자]
  /admin                       /view?token=xxxxx
   │                              │
   │ ADMIN_PASSWORD 입력          │
   ▼                              ▼
  POST /api/links/create   POST /api/links/verify
   │                              │
   │ 링크 발급 (32자 hex)         │ 검증: NOT_FOUND/INACTIVE/
   │                              │       EXPIRED/MAX_VISITS
   │                              │ 봇/프리페치는 조용히 무시
   │                              ▼
   │                            세션 토큰 발급 (24자 hex)
   │                            IP 등록 (신규만)
   │                              │
   │                              ▼
   │                       /?s={sessionToken} 으로 리디렉트
   │                              │
   │                              ▼
   │                       index.html (메인 앱)
   │                       └ 5초마다 /api/links/check-session 폴링
   │                       └ 세션 무효 시 즉시 강제 퇴출
   │
   ▼
  /admin (방문 기록 조회·링크 관리)
```

---

## 📁 파일 구성

```
pagecraft-sharable/
├── index.html                  메인 웹앱 (PageCraft Pro 코어 + 세션 폴링)
├── admin.html                  관리자 대시보드 (링크 CRUD UI)
├── view.html                   링크 검증 + 세션 발급 페이지
├── dev-server.js               로컬 개발 서버 (포트 3000, 메모리 스토어)
├── setup-fonts.js              한글 폰트 다운로드
├── package.json                @napi-rs/canvas + @vercel/kv
├── vercel.json                 라우팅 + 함수별 maxDuration
├── README.md                   이 문서
├── README-ACCESS-CONTROL.md    접근 제어 시스템 상세 설명
├── fonts/                      NotoSansKR 폰트 (자동 생성)
└── api/
    ├── links/                  ── 어드민 링크 시스템 ──
    │   ├── _store.js           Vercel KV ↔ 메모리 스토어 추상화
    │   ├── _auth.js            verifyAdmin / verifySession + CORS
    │   ├── create.js           POST  /api/links/create   (어드민)
    │   ├── list.js             GET   /api/links/list      (어드민)
    │   ├── manage.js           POST  /api/links/manage    (toggle/update/delete/resetVisits)
    │   ├── verify.js           POST  /api/links/verify    (사용자: 링크 검증 + 세션 발급)
    │   └── check-session.js    POST  /api/links/check-session (5초 폴링용)
    ├── generate.js             Gemini 카피 생성 프록시
    ├── generate-model.js       Gemini 2.5 Flash Image (AI 모델 사진, 월 100장 제한)
    ├── render.js               @napi-rs/canvas PNG 렌더링 (pagecraft-pro와 동일 + 약관/소개 이미지)
    ├── ip-check.js             IP 인식 상태 + 사용량 조회
    └── pin-verify.js           어드민 PIN 검증 (어드민 페이지 진입용)
```

---

## 🧬 코드 원리 — 보안 데이터 흐름

### A. 링크 발급 → 사용자 접근 전체 흐름

```
1️⃣  어드민 링크 생성
    POST /api/links/create  (Authorization: Bearer ADMIN_PASSWORD)
    body: { title, maxVisits, expiresAt }
    └→ token = crypto.randomBytes(16).toString('hex')  // 32자 hex
    └→ KV.set(`link:{token}`, { token, title, maxVisits, currentVisits:0, visitLog:[], expiresAt, createdAt, active:true })
    └→ 응답: { url: "/view?token=..." }

2️⃣  사용자 링크 클릭 (view.html → /api/links/verify)
    ① 봇/프리페치 감지 → { preview: true } 조용히 반환
    ② 링크 존재? → NO: NOT_FOUND (404)
    ③ active? → NO: INACTIVE (단, 신규 IP에는 NOT_FOUND로 위장 ⭐)
    ④ 만료? → YES: EXPIRED (등록 IP만 공개, 신규 IP에는 NOT_FOUND)
    ⑤ 횟수초과? → 등록 IP는 통과, 신규 IP는 NOT_FOUND
    ⑥ 유예기간(grace:{token}:{ip}, TTL 300s) 안이면 카운트 안 함
    ⑦ visitLog 추가 + currentVisits 증가
    ⑧ 세션 토큰 발급
        sessionToken = crypto.randomBytes(24).toString('hex')
        TTL = min(1h, 링크 잔여시간, 7d)
        KV.set(`session:{token}`, { linkToken, title, createdAt }, { ex: TTL })
    ⑨ IP 등록 (신규만)
        KV.set(`ip:{clientIp}`, { firstVisit, linkToken, registeredAt, expiresAt })
    ⑩ 응답: { sessionToken, title, expiresAt, ipRegistered }
    └→ 클라이언트는 /?s={sessionToken} 으로 리디렉트

3️⃣  메인 앱 (index.html)
    ① URL ?s= 파싱 → sessionToken 추출
    ② 없으면 🔒 잠금 오버레이 표시
    ③ 5초 간격 폴링: POST /api/links/check-session
       └→ 무효 시 { kicked: true } 응답 → 즉시 오버레이 + 강제 퇴출
       └→ 유효 시 TTL 자동 갱신 (링크 잔여시간 기준)
    ④ AI 카피/모델/렌더링 사용 가능

4️⃣  어드민 관리 (admin.html → /api/links/manage)
    action: 'toggle'       링크 활성/비활성 + 세션 즉시 폐기
    action: 'update'       title/maxVisits/expiresAt 수정
    action: 'resetVisits'  방문 기록 초기화 + 세션·IP 폐기
    action: 'delete'       링크 + 모든 세션 + 모든 연결 IP + 고아 IP 정리
```

### B. 7-Layer 보안

```
🔒 Layer 1: 32자 hex 링크 토큰 (guess 불가)
🔒 Layer 2: 봇/메신저 감지 (User-Agent + Purpose 헤더)
🔒 Layer 3: 신규/등록 IP 차별 응답 (신규 IP에 링크 상태 숨김)
🔒 Layer 4: 5분 유예기간 (재방문 카운트 안 함)
🔒 Layer 5: 세션 TTL 자동 갱신 (폴링 시마다 링크 잔여시간 동기화)
🔒 Layer 6: ADMIN_PASSWORD timingSafeEqual (타이밍 공격 방지)
🔒 Layer 7: IP별 AI 모델 사용량 (월 100장, 30일 주기)
```

### C. AI 모델 이미지 생성 (`api/generate-model.js`)

**카테고리별 카메라 포커스 자동 결정:**

```js
function getCameraFocus(category, productName) {
  if (/모자|캡|비니/.test(name))        → '머리만, 모자 상단~턱'
  if (/신발|부츠|스니커즈/.test(cat))   → '의자에 앉은 포즈, 허벅지~발'
  if (/패딩|점퍼|티셔츠|코트/.test(cat))→ '상반신만 (하반신 제외)'
  if (/목걸이/.test(name))              → '머리~가슴, 목걸이 강조'
  // ...
}
```

**IP별 한도 제어:**
```js
CYCLE_MS = 30 * 24 * 3600 * 1000   // 30일
LIMIT = 100

// 매 30일 사이클이 firstVisit 기준으로 시작
// usage.cycleStart 가 다르면 자동 리셋
// usage.count >= LIMIT → 429 Too Many Requests
```

---

## 💾 Vercel KV 데이터 스키마

| 키 패턴 | 값 (JSON) | TTL |
|---------|----------|-----|
| `link:{token}` | `{ token, title, maxVisits, currentVisits, visitLog, expiresAt, createdAt, active }` | 영구 |
| `session:{token}` | `{ linkToken, title, createdAt }` | 1h ~ 7d (링크 잔여시간 기준) |
| `ip:{clientIp}` | `{ firstVisit, linkToken, registeredAt, expiresAt }` | 영구 |
| `grace:{token}:{ip}` | `'1'` | 300초 (방문 유예) |
| `ip-usage:{clientIp}` | `{ count, cycleStart }` | 영구 (cycleStart 비교로 리셋) |

> KV 환경변수가 없으면 자동으로 메모리 스토어 사용 (cold start 시 초기화됨 — 로컬/테스트 전용).

---

## 📥 다운로드 방법

```bash
git clone https://github.com/luazencloud-design/pagecraft-sharable.git
cd pagecraft-sharable
npm install
```

또는 GitHub에서 **Code → Download ZIP**.

---

## 🔑 외부 서비스 연동

### 1. Gemini API Key

[aistudio.google.com/apikey](https://aistudio.google.com/apikey)에서 `AIza...` 키 발급.

### 2. Vercel KV (Redis) 생성

1. Vercel 대시보드 → **Storage** → **Create Database** → **KV** 선택
2. 생성하면 자동으로 `KV_REST_API_URL`, `KV_REST_API_TOKEN` 환경변수가 프로젝트에 추가됨
3. Vercel 무료 한도: 30,000 commands/일 — 일반 사용에 충분

### 3. 환경변수 (Vercel Settings → Environment Variables)

| Name | Value | 필수 |
|------|-------|------|
| `ADMIN_PASSWORD` | 직접 정한 강력한 비밀번호 | ✅ |
| `GEMINI_API_KEY` | `AIza...` | ✅ |
| `KV_REST_API_URL` | (KV 생성 시 자동) | KV 사용 시 |
| `KV_REST_API_TOKEN` | (KV 생성 시 자동) | KV 사용 시 |
| `ALLOWED_ORIGIN` | `https://yourdomain.vercel.app` | 선택 (CORS 제한) |

---

## 🚀 Vercel 배포 + KV 연결

### STEP 1 — GitHub Push

```bash
git add .
git commit -m "deploy"
git push origin main
```

### STEP 2 — Vercel Import

1. [vercel.com/new](https://vercel.com/new) → `pagecraft-sharable` 저장소 Import
2. 설정 변경 없이 **Deploy**

### STEP 3 — KV 연결

1. 배포된 프로젝트 → **Storage 탭** → **Connect Database** → **Create New** → **KV**
2. Region은 `Seoul` 또는 `Tokyo` 권장
3. 생성 완료 후 **Connect Project** 클릭

### STEP 4 — 환경변수 설정

**Settings → Environment Variables** 에서 `ADMIN_PASSWORD`, `GEMINI_API_KEY` 추가 후 **Save**.

### STEP 5 — Redeploy

**Deployments** 탭 → 최신 배포 옆 `⋯` → **Redeploy** (환경변수 적용).

### STEP 6 — 어드민 접속 확인

`https://your-domain.vercel.app/admin` → `ADMIN_PASSWORD` 입력 → 링크 생성 화면이 나오면 성공.

---

## 💻 로컬 개발 (`dev-server.js`)

```bash
node dev-server.js
# → http://localhost:3000 자동 오픈
```

**특징:**
- 어드민 비밀번호: `test1234` (하드코딩, dev 전용)
- 메모리 스토어 (재시작 시 데이터 초기화)
- Gemini API는 환경변수 `GEMINI_API_KEY`가 있어야 작동 (`.env.local` 파일 생성)

**테스트 시나리오:**
1. `/admin` → `test1234` → 새 링크 생성
2. 발급된 `/view?token=...` 클릭
3. `/?s=...` 로 리디렉트 → 메인 앱 동작 확인

---

## 👨‍💼 어드민 사용법

### admin.html 구조

**탭 1: 📋 링크 목록**
```
링크 URL [복사]   상태   방문수    유효기간    [활성] [초기화] [삭제]
- 방문 기록: IP, 시간, 방문번호 (확장 가능한 리스트)
```

**탭 2: ➕ 새 링크 생성**
```
제목 (필수)
최대 접근 횟수 (0 = 무제한)
만료 일시 (빈칸 = 무기한)
[생성] → /view?token=xxxxx 발급
```

### 링크 관리 액션

| 액션 | 효과 |
|------|------|
| **활성/비활성 토글** | 링크 즉시 차단 + 해당 링크의 모든 세션 폐기 (IP는 유지) |
| **방문 초기화** | currentVisits=0 + visitLog=[] + 모든 세션·IP 폐기 |
| **삭제** | 링크 + 모든 세션 + 연결 IP + 고아 IP 정리 (완전 삭제) |
| **수정** | title / maxVisits / expiresAt 변경 |

---

## 🛠 트러블슈팅

| 증상 | 원인 / 해결 |
|------|-------------|
| `/admin` 접속 시 401 | `ADMIN_PASSWORD` 환경변수 누락. Vercel Settings 확인 + Redeploy |
| 링크 클릭 시 `NOT_FOUND` | (등록 IP) 토큰 오타 / (신규 IP) 비활성·만료·횟수초과 위장 응답 |
| 5초 후 강제 퇴출 | 어드민이 링크 비활성/삭제했거나 만료됨 (정상 동작) |
| KV 연결 실패 | Vercel Storage 탭에서 Project 연결 확인 |
| AI 모델 이미지 429 | 월 100장 한도 초과. 다음 사이클(30일)까지 대기 |
| 폰트 깨짐 | `setup-fonts.js` 빌드 실패 → Vercel 빌드 로그 확인 |

---

## 📝 후임자 메모

### 가장 자주 변경되는 곳

| 변경 항목 | 위치 |
|----------|------|
| 링크 기본 만료/횟수 | `admin.html` 폼 placeholder |
| 세션 TTL (최소/최대) | `api/links/check-session.js` `MIN_SESSION_TTL`, `MAX_SESSION_TTL` |
| 유예기간 | `api/links/verify.js` `GRACE_TTL = 300` |
| AI 모델 한도 | `api/generate-model.js` `LIMIT = 100`, `CYCLE_MS = 30일` |
| 카테고리별 포즈 | `api/generate-model.js` `getCameraFocus()` |
| 봇 패턴 | `api/links/verify.js` `botPatterns` 배열 |

### 보안 주의

- `ADMIN_PASSWORD`는 절대 코드에 하드코딩 X (오직 환경변수)
- `dev-server.js`의 `test1234`는 로컬 전용 — 절대 프로덕션 배포 금지
- `Authorization` 헤더는 `crypto.timingSafeEqual()`로 비교 (타이밍 공격 방지)
- 신규 IP에는 비활성/만료 사유를 노출하지 않음 (NOT_FOUND로 위장)

### KV 비용 관리

- `keys('link:*')`, `keys('ip:*')` 등은 모든 키를 스캔하므로 링크가 많아지면 비용 증가
- 1,000개 이상이면 인덱싱 키(`link-index`) 도입 검토 필요
- 무료 한도 30,000 commands/일 → 일반적으로 100명 이하는 충분

### 관련 프로젝트

| 프로젝트 | 차이점 |
|----------|--------|
| `pagecraft-pro` | 동일 코어 (생성/렌더링)지만 접근 제어·KV·세션 시스템 없음 |

자세한 접근 제어 메커니즘은 [README-ACCESS-CONTROL.md](./README-ACCESS-CONTROL.md) 참고.

---

*PageCraft Sharable v3.0 — Vercel KV + Gemini 2.5 Flash·Flash Image*
