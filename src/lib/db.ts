// Supabase 연결 (서버 전용!)
// service_role 키는 모든 데이터를 볼 수 있는 "마스터 키"라서 절대 브라우저로 보내면 안 돼요.
// 이 파일은 서버 코드(route.ts, lib)에서만 import 해요.
import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export function db(): SupabaseClient {
  if (client) return client;
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Supabase 설정이 없어요. SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수를 확인해 주세요 (vercel env pull).",
    );
  }
  client = createClient(url, key, {
    auth: { persistSession: false },
    // DB가 응답 없이 멈추면 15초 뒤 포기 (화면이 오래 멈추지 않게)
    global: { fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(15_000) }) },
  });
  return client;
}

// Supabase 응답에서 오류가 있으면 던지고, 데이터만 꺼내요
export function must<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(`DB 오류: ${res.error.message}`);
  return res.data as T;
}
