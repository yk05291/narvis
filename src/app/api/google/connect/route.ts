// "구글 캘린더 연결" 버튼 → 구글 로그인/동의 화면으로 보내기
import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "crypto";
import { authUrl, googleConfigured } from "@/lib/google";

export async function GET(req: NextRequest) {
  if (!googleConfigured()) {
    return NextResponse.redirect(new URL("/?google=not_configured", req.url));
  }
  // state: 다른 사이트가 가짜로 연결시키는 걸 막는 1회용 값
  const state = randomBytes(24).toString("hex");
  console.log("google connect started from", req.nextUrl.origin);
  const res = NextResponse.redirect(authUrl(req.nextUrl.origin, state));
  res.cookies.set("google_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 600,
    path: "/api/google",
  });
  return res;
}
