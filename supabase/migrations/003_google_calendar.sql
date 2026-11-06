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
