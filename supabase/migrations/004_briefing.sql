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
