# NARVIS — Boss의 개인 AI 비서

Next.js 하나로 만든 버전이에요. 두뇌는 **Groq**(무료), 저장소는 **Supabase**, 배포는 **Vercel**.
(설계서: 데스크탑의 navis_master_architecture_design_document.md)

## 지금 되는 것
- 1단계: 채팅, 오늘 일정/과제 조회, 과제·일정 추가 "제안" → Boss 승인 후 저장
- 2단계: 한양여대 공지 자동 수집 (매일 오전 7시) + AI가 신청 마감일·대상·요약 추출
  - "장학금 공지 있어?", "마감 임박한 공지 알려줘" 처럼 물어보면 돼요
  - 화면에 '마감 임박 / 최근 학교 공지' 패널
- 3단계: 대화형 첫 설정 (호칭·학과·학년·시간표·생활패턴) → 확인 버튼으로 저장, '프로필 설정'으로 다시 수정
- 4단계: 구글 캘린더 연결 — 오늘 일정 대시보드(수업+구글+마감), 승인한 일정은 구글 캘린더에 추가. 토큰은 AES-256-GCM 암호화 저장
- 5단계: 음성 — 🎤 버튼으로 말하기(Groq Whisper 받아쓰기, 말 끝나면 자동 전송), NARVIS 답을 소리로 읽기(브라우저 한국어 음성, VOICE ON/OFF)
  - 3D AI 코어(Three.js): STANDBY 숨쉬기 / LISTENING 마이크 크기에 맞춰 링 / THINKING 보라색 빠른 회전 / SPEAKING 말소리 리듬에 맞춰 커짐
- 6단계: 아침 브리핑 — 브리핑 시간(기본 08:00)이 지나면 메인 화면 맨 위에 카드: 오늘 수업·일정·출발 권장 시각·3일 안 마감 과제·마감 다가오는 공지·새 공지 + AI 요약 문장(▶ 듣기). 하루 한 번 만들어 저장, "브리핑 해줘"/"브리핑 7시 반에 해줘"로 채팅 사용 가능
- 목표(GOALS): 학업·취업·개인 목표, 진행률, 목표일 D-day — 채팅으로 등록(승인)·진행률 갱신
- 학사일정(ACADEMIC): 학교 홈페이지 '학사일정' 공개 데이터를 매일 DB에 저장(올해+내년). "종강 언제야?" 같은 질문은 AI 없이 DB에서 바로 답해 정확함
- 현재 날짜·시간을 모든 AI 요청에 자동 포함, 화면 위 실시간 시계
- 비밀번호 잠금 (NARVIS_PASSWORD)

## 환경변수
| 이름 | 설명 |
|---|---|
| `GROQ_API_KEY` | Groq 키 (`gsk_...`) |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Vercel Supabase 연동이 자동으로 넣어줘요 |
| `NARVIS_PASSWORD` | 사이트 접속 비밀번호 |
| `CRON_SECRET` | 자동 수집 주소 보호용 비밀값 (아무 긴 글자) |
| `ENCRYPTION_SECRET_KEY` | 구글 토큰 암호화 키 (32바이트 base64) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | 구글 클라우드 콘솔에서 만든 OAuth 클라이언트 |

## 내 컴퓨터에서 실행
```
cd ~/Desktop/narvis
vercel env pull .env.local   # Vercel에 저장된 환경변수 받아오기
npm run dev
```

## 공지 수집을 지금 바로 돌리기
```
curl -H "Authorization: Bearer <CRON_SECRET>" https://<배포주소>/api/cron/notices
```
AI 분석만 더 돌리기: 주소 뒤에 `?extract_only=1`

## 폴더 안내
| 파일 | 하는 일 |
|---|---|
| `src/app/page.tsx` | 화면 (HUD, 채팅, 승인, 공지 패널, 마이크) |
| `src/app/AICore.tsx` | 3D 홀로그램 코어 (소리 크기 반응) |
| `src/app/BriefingCard.tsx`, `src/lib/briefing.ts` | 아침 브리핑 화면 / 데이터 모으기·문장 만들기 |
| `src/lib/voice/` | 녹음·소리크기(recorder, level), 음성 출력(speaker) |
| `src/app/api/voice/stt/route.ts` | 음성 → 글자 (Groq Whisper) |
| `src/app/login/page.tsx` | 비밀번호 화면 |
| `src/proxy.ts` | 로그인 안 했으면 막는 문지기 |
| `src/app/api/chat/route.ts` | 대화 API |
| `src/app/api/cron/notices/route.ts` | 매일 공지 수집 + AI 분석 |
| `src/lib/groq.ts` | Groq 호출 + 도구 실행 반복 |
| `src/lib/tools.ts` | NARVIS 도구 (일정, 과제, 공지 검색, 추가 제안) |
| `src/lib/hywu.ts` | 한양여대 게시판 수집기 (요청 사이 3초 쉬기) |
| `src/lib/extract.ts` | 공지 AI 분석 + 검색 |
| `src/lib/store.ts` | 일정·과제 저장 (Supabase) |
| `supabase/schema.sql` | DB 테이블 만드는 SQL |

## 안전 장치
- AI는 과제·일정을 직접 저장 못 하고 "제안"만 해요. 승인 버튼을 눌러야 저장.
- `user_id`는 AI가 아니라 서버가 정해요.
- Supabase 마스터 키는 서버에만 있고, 공개 키로는 모든 테이블이 막혀 있어요(RLS).

## 다음에 해볼 것
- 진짜 파형을 쓰는 한국어 TTS(오디오 파일) — 지금은 브라우저 음성이라 '말하는 리듬'으로 코어를 움직임
- 구글의 다른 캘린더(기본 캘린더 외)도 읽기
