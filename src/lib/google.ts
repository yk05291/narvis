// 구글 캘린더 연결 (OAuth 2.0) + 일정 읽기/쓰기
// 구글 공식 REST API를 fetch로 직접 불러요.
import "server-only";
import { db, must } from "./db";
import { decrypt, encrypt } from "./crypto";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CAL = "https://www.googleapis.com/calendar/v3";
// 일정 읽기/쓰기 + 어떤 계정인지(이메일)만. 메일·드라이브 등은 요청하지 않아요.
const SCOPES = ["openid", "email", "https://www.googleapis.com/auth/calendar.events"];

export function googleConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function redirectUri(origin: string) {
  return `${origin}/api/google/callback`;
}

export function authUrl(origin: string, state: string) {
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri(origin),
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline", // refresh token 받기 (계속 연결 유지)
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_URL}?${p}`;
}

type TokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  id_token?: string;
};

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      ...params,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new GoogleError(res.status, data.error ?? "token_error", data.error_description);
  return data;
}

export class GoogleError extends Error {
  constructor(public status: number, public code: string, detail?: string) {
    super(`${code}${detail ? `: ${detail}` : ""}`);
  }
}

// id_token 안의 이메일 꺼내기 (구글에서 방금 직접 받은 토큰이라 서명 검증은 생략)
function emailFromIdToken(idToken?: string) {
  try {
    const payload = JSON.parse(Buffer.from(idToken!.split(".")[1], "base64url").toString());
    return typeof payload.email === "string" ? payload.email : null;
  } catch {
    return null;
  }
}

// 콜백에서: code → 토큰 → 암호화해서 저장
export async function connectWithCode(userId: string, code: string, origin: string) {
  const t = await tokenRequest({ code, grant_type: "authorization_code", redirect_uri: redirectUri(origin) });
  if (!t.scope.includes("calendar.events")) {
    throw new GoogleError(400, "scope_denied", "캘린더 권한을 체크하지 않았어요");
  }
  if (!t.refresh_token) throw new GoogleError(400, "no_refresh_token");
  must(
    await db().from("calendar_connections").upsert({
      user_id: userId,
      provider: "GOOGLE",
      account_email: emailFromIdToken(t.id_token),
      encrypted_access_token: encrypt(t.access_token),
      encrypted_refresh_token: encrypt(t.refresh_token),
      token_expires_at: new Date(Date.now() + (t.expires_in - 60) * 1000).toISOString(),
      scope: t.scope,
      updated_at: new Date().toISOString(),
    }),
  );
}

type Conn = {
  account_email: string | null;
  encrypted_access_token: string;
  encrypted_refresh_token: string;
  token_expires_at: string;
};

async function getConn(userId: string): Promise<Conn | null> {
  const rows = must(
    await db()
      .from("calendar_connections")
      .select("account_email, encrypted_access_token, encrypted_refresh_token, token_expires_at")
      .eq("user_id", userId)
      .eq("provider", "GOOGLE"),
  ) as Conn[];
  return rows[0] ?? null;
}

export async function googleStatus(userId: string) {
  if (!googleConfigured()) return { configured: false, connected: false, email: null };
  const c = await getConn(userId);
  return { configured: true, connected: Boolean(c), email: c?.account_email ?? null };
}

// 유효한 access token 얻기 (만료됐으면 refresh token으로 새로 받기)
async function accessToken(userId: string): Promise<string | null> {
  if (!googleConfigured()) return null;
  const c = await getConn(userId);
  if (!c) return null;
  if (Date.parse(c.token_expires_at) > Date.now()) return decrypt(c.encrypted_access_token);

  try {
    const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: decrypt(c.encrypted_refresh_token) });
    must(
      await db()
        .from("calendar_connections")
        .update({
          encrypted_access_token: encrypt(t.access_token),
          token_expires_at: new Date(Date.now() + (t.expires_in - 60) * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId)
        .eq("provider", "GOOGLE"),
    );
    return t.access_token;
  } catch (e) {
    // 사용자가 구글에서 권한을 취소했거나 토큰이 만료됨 → 연결 끊김 처리
    if (e instanceof GoogleError && e.code === "invalid_grant") {
      await db().from("calendar_connections").delete().eq("user_id", userId).eq("provider", "GOOGLE");
      return null;
    }
    throw e;
  }
}

export async function disconnect(userId: string) {
  const c = await getConn(userId);
  if (!c) return;
  // 구글 쪽 권한도 취소 (실패해도 우리 쪽 기록은 지워요)
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(decrypt(c.encrypted_refresh_token))}`, {
    method: "POST",
  }).catch(() => {});
  must(await db().from("calendar_connections").delete().eq("user_id", userId).eq("provider", "GOOGLE"));
}

// ---------- 일정 ----------
export type GoogleEvent = {
  id: string;
  title: string;
  start_time: string; // ISO, 종일 일정이면 "YYYY-MM-DD"
  end_time: string;
  all_day: boolean;
  location: string | null;
  link: string | null;
};

type RawEvent = {
  id: string;
  status?: string;
  summary?: string;
  location?: string;
  htmlLink?: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
};

function toEvent(e: RawEvent): GoogleEvent {
  const allDay = Boolean(e.start.date);
  return {
    id: e.id,
    title: e.summary ?? "(제목 없음)",
    start_time: (e.start.dateTime ?? e.start.date)!,
    end_time: (e.end.dateTime ?? e.end.date)!,
    all_day: allDay,
    location: e.location ?? null,
    link: e.htmlLink ?? null,
  };
}

// timeMin~timeMax 사이 기본 캘린더 일정. 연결 안 됐으면 null.
export async function listGoogleEvents(userId: string, timeMin: string, timeMax: string): Promise<GoogleEvent[] | null> {
  const token = await accessToken(userId);
  if (!token) return null;
  const p = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: "true", // 반복 일정을 하나하나 펼치기
    orderBy: "startTime",
    maxResults: "100",
    timeZone: "Asia/Seoul",
  });
  const res = await fetch(`${CAL}/calendars/primary/events?${p}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new GoogleError(res.status, "calendar_list_failed", (await res.text()).slice(0, 200));
  const data = (await res.json()) as { items: RawEvent[] };
  return data.items.filter((e) => e.status !== "cancelled").map(toEvent);
}

export async function createGoogleEvent(
  userId: string,
  ev: { title: string; start_time: string; end_time: string; location?: string | null },
): Promise<GoogleEvent | null> {
  const token = await accessToken(userId);
  if (!token) return null;
  const res = await fetch(`${CAL}/calendars/primary/events`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      summary: ev.title,
      location: ev.location ?? undefined,
      start: { dateTime: ev.start_time, timeZone: "Asia/Seoul" },
      end: { dateTime: ev.end_time, timeZone: "Asia/Seoul" },
      description: "NARVIS가 Boss 승인 후 추가한 일정",
    }),
  });
  if (!res.ok) throw new GoogleError(res.status, "calendar_insert_failed", (await res.text()).slice(0, 200));
  return toEvent(await res.json());
}
