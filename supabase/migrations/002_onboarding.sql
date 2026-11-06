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
