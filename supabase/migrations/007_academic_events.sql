-- 9단계: 학사일정 (학교 홈페이지 공개 데이터 → DB)
create table if not exists public.academic_events (
  id uuid primary key default gen_random_uuid(),
  source_key text not null unique,          -- 학교 데이터 식별용: 시작일|종료일|제목
  title varchar(255) not null,
  start_date date not null,
  end_date date not null,
  category varchar(10) not null,            -- 학사 / 입시 / 행사 / 장학
  sch_type varchar(10),                     -- 학교 코드 (R0201 등)
  sch_year int not null,                    -- 어느 연도 달력에서 가져왔는지
  is_active boolean not null default true,  -- 학교 사이트에서 사라지면 false
  crawled_at timestamptz default now(),
  last_verified_at timestamptz default now()
);
create index if not exists academic_events_date_idx on public.academic_events (start_date, end_date) where is_active;
alter table public.academic_events enable row level security;
