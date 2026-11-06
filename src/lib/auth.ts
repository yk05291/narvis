// 아주 간단한 비밀번호 잠금
// NARVIS_PASSWORD 를 맞히면 30일짜리 쿠키를 줘요. 쿠키 값은 비밀번호 자체가 아니라 해시값이에요.
export const AUTH_COOKIE = "narvis_auth";

export async function authToken(password: string) {
  const data = new TextEncoder().encode(`narvis:${password}`);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}
