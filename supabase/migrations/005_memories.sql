-- 7단계: 기억 (Boss가 동의한 것만 저장)
create table if not exists public.memories (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  memory_key varchar(100) not null,   -- 짧은 이름표 (예: 음식 취향)
  memory_value text not null,         -- 내용 (예: 매운 음식을 못 먹음)
  consent_given boolean not null default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (user_id, memory_key)
);
alter table public.memories enable row level security;
