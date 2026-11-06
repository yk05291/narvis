-- NARVIS Supabase 스키마 (현재 단계용)
-- 서버(Vercel)만 service_role 키로 접근해요. 브라우저용 공개 키로는 아무것도 못 보도록
-- 모든 테이블에 RLS를 켜고 정책은 만들지 않았어요. (= 공개 키로는 전부 차단)
-- 로그인 기능(Supabase Auth)을 붙이는 단계에서 user_id 를 auth.users 와 연결할 예정이에요.

create extension if not exists "pgcrypto";

-- ===== 개인 데이터 =====
create table if not exists public.profiles (
  user_id text primary key,
  boss_title varchar(50) not null default 'Boss',
  department varchar(100),
  grade int check (grade between 1 and 4),
  created_at timestamptz default now()
);

create table if not exists public.timetables (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  subject_name varchar(100) not null,
  professor_name varchar(100),
  day_of_week int not null check (day_of_week between 1 and 7), -- 1 = 월요일
  start_time time not null,
  end_time time not null,
  classroom varchar(100),
  created_at timestamptz default now()
);

create table if not exists public.assignments (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  subject_name varchar(100) not null,
  title varchar(255) not null,
  due_date timestamptz not null,
  is_completed boolean not null default false,
  created_at timestamptz default now()
);

create table if not exists public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  title varchar(255) not null,
  start_time timestamptz not null,
  end_time timestamptz not null,
  location varchar(255),
  source_type varchar(50) not null default 'MANUAL',
  created_at timestamptz default now()
);

-- AI가 제안하고 Boss 승인을 기다리는 작업
create table if not exists public.pending_actions (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  kind varchar(50) not null,
  summary text not null,
  data jsonb not null,
  created_at timestamptz default now()
);

-- ===== 한양여대 공지 (모두 공통) =====
create table if not exists public.university_notices (
  id uuid primary key default gen_random_uuid(),
  board_key varchar(50) not null,          -- 예: scholarship
  category varchar(50) not null,           -- 예: 장학
  bbs_seq bigint not null,                 -- 학교 게시판 글 번호
  title varchar(500) not null,
  content text,                            -- 태그 뺀 본문
  content_hash varchar(64) not null,       -- 내용 바뀜 감지용
  source_url text not null unique,
  posted_at date,
  structured_data jsonb not null default '{}'::jsonb, -- {application_start, application_end, eligibility, summary}
  extracted_at timestamptz,                -- AI 분석 완료 시각 (null = 아직)
  crawled_at timestamptz default now(),
  last_verified_at timestamptz default now(),
  is_active boolean not null default true
);
create index if not exists notices_posted_idx on public.university_notices (posted_at desc);
create index if not exists notices_pending_extract_idx on public.university_notices (extracted_at) where extracted_at is null;

-- 수집기 실행 기록
create table if not exists public.crawl_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz default now(),
  finished_at timestamptz,
  new_count int default 0,
  updated_count int default 0,
  extracted_count int default 0,
  errors text
);

-- ===== RLS: 공개 키 차단 =====
alter table public.profiles enable row level security;
alter table public.timetables enable row level security;
alter table public.assignments enable row level security;
alter table public.calendar_events enable row level security;
alter table public.pending_actions enable row level security;
alter table public.university_notices enable row level security;
alter table public.crawl_runs enable row level security;

-- ===== 예시 데이터 (처음 한 번) =====
insert into public.profiles (user_id) values ('local-boss') on conflict do nothing;
insert into public.timetables (user_id, subject_name, day_of_week, start_time, end_time, classroom)
select 'local-boss', s, d, st, et, c from (values
  ('자료구조 (예시)', 5, '10:00'::time, '12:00'::time, '예시관 301'),
  ('웹프로그래밍 (예시)', 5, '14:00'::time, '16:00'::time, '예시관 205')
) v(s, d, st, et, c)
where not exists (select 1 from public.timetables where user_id = 'local-boss');
-- 3단계: 대화형 첫 설정 (온보딩)

-- 프로필에 학교·생활 정보 추가
alter table public.profiles add column if not exists semester int check (semester between 1 and 2);
alter table public.profiles add column if not exists wake_up_time time;
alter table public.profiles add column if not exists sleep_time time;
alter table public.profiles add column if not exists commute_minutes int check (commute_minutes between 0 and 300);
alter table public.profiles add column if not exists onboarded_at timestamptz;

-- 대화 도중 모은 정보를 조금씩 저장해 두는 곳 (중간에 창을 닫아도 이어서 할 수 있게)
create table if not exists public.onboarding_sessions (
  user_id text primary key,
  current_step varchar(20) not null default 'collecting', -- collecting | confirm | done
  session_data jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);
alter table public.onboarding_sessions enable row level security;
-- 4단계: 구글 캘린더 연결
-- 토큰은 서버에서 AES-256-GCM 으로 암호화해서 저장해요 (DB가 털려도 바로 못 씀)
create table if not exists public.calendar_connections (
  user_id text not null,
  provider varchar(20) not null default 'GOOGLE',
  account_email varchar(255),
  encrypted_access_token text not null,
  encrypted_refresh_token text not null,
  token_expires_at timestamptz not null,
  scope text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  primary key (user_id, provider)
);
alter table public.calendar_connections enable row level security;
-- 6단계: 아침 브리핑
alter table public.profiles add column if not exists briefing_time time not null default '08:00';
alter table public.profiles add column if not exists briefing_enabled boolean not null default true;

-- 하루 한 번 만든 브리핑을 저장 (다시 열면 AI를 또 부르지 않고 재사용)
create table if not exists public.briefings (
  user_id text not null,
  brief_date date not null,
  content jsonb not null,
  created_at timestamptz default now(),
  primary key (user_id, brief_date)
);
alter table public.briefings enable row level security;
