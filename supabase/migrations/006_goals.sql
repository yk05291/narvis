-- 8단계: 목표 관리 (설계서 goals 테이블)
create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  category varchar(20) not null check (category in ('ACADEMIC', 'CAREER', 'PERSONAL')),
  title varchar(255) not null,
  description text,
  target_date date,
  progress int not null default 0 check (progress between 0 and 100),
  is_completed boolean not null default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists goals_user_idx on public.goals (user_id, is_completed);
alter table public.goals enable row level security;
