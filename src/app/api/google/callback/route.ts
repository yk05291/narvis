// 구글 동의 후 돌아오는 곳: code를 토큰으로 바꿔 암호화 저장
import { NextResponse, type NextRequest } from "next/server";
import { connectWithCode, GoogleError } from "@/lib/google";

const USER_ID = "local-boss";

export async function GET(req: NextRequest) {
  const back = (result: string) => {
    console.log("google callback result:", result); // 나중에 원인 추적용 (토큰 등 비밀값은 안 남겨요)
    const res = NextResponse.redirect(new URL(`/?google=${result}`, req.url));
    res.cookies.delete({ name: "google_oauth_state", path: "/api/google" });
    return res;
  };

  const url = req.nextUrl;
  const gErr = url.searchParams.get("error");
  if (gErr) {
    console.log("google returned error:", gErr);
    return back("denied"); // 사용자가 '취소'를 눌렀거나 구글이 막음
  }

  const state = url.searchParams.get("state");
  const saved = req.cookies.get("google_oauth_state")?.value;
  const code = url.searchParams.get("code");
  if (!state || !saved || state !== saved || !code) return back("bad_state");

  try {
    await connectWithCode(USER_ID, code, url.origin);
    return back("connected");
  } catch (e) {
    console.error("google callback", e);
    if (e instanceof GoogleError && e.code === "scope_denied") return back("scope_denied");
    return back("error");
  }
}
