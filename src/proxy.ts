// 모든 요청 전에 실행: 비밀번호 쿠키가 없으면 /login 으로 보내요
import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, authToken } from "@/lib/auth";

export async function proxy(req: NextRequest) {
  const password = process.env.NARVIS_PASSWORD;

  if (!password) {
    // 내 컴퓨터(개발)에서는 비밀번호 없이 OK, 배포(production)에서는 잠가요
    if (process.env.NODE_ENV !== "production") return NextResponse.next();
    return new NextResponse("NARVIS_PASSWORD 환경변수를 설정해 주세요.", { status: 503 });
  }

  if (req.cookies.get(AUTH_COOKIE)?.value === (await authToken(password))) {
    return NextResponse.next();
  }

  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "로그인이 필요해요." }, { status: 401 });
  }
  return NextResponse.redirect(new URL("/login", req.url));
}

export const config = {
  // 로그인 화면, 로그인 API, 자동 수집(cron — 자체 비밀키로 보호), 정적 파일은 제외
  matcher: ["/((?!login|api/login|api/cron|_next/static|_next/image|favicon.ico|clap-processor.js).*)"],
};
