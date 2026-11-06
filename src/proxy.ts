// 모든 요청 전에 실행: (비밀번호를 켠 경우에만) 비밀번호 쿠키가 없으면 /login 으로 보내요
// 비밀번호 잠금은 Vercel 환경변수 NARVIS_PASSWORD 가 있을 때만 켜져요. 없으면 누구나 바로 들어와요.
import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, authToken } from "@/lib/auth";

export async function proxy(req: NextRequest) {
  const password = process.env.NARVIS_PASSWORD;

  if (!password) {
    // 비밀번호 없음: /login 으로 오면 바로 메인으로
    if (req.nextUrl.pathname === "/login") return NextResponse.redirect(new URL("/", req.url));
    return NextResponse.next();
  }

  // 비밀번호를 켰을 땐 로그인 화면 자체는 항상 보여줘요 (안 그러면 /login → /login 무한 반복)
  if (req.nextUrl.pathname === "/login") return NextResponse.next();

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
  matcher: ["/((?!api/login|api/cron|_next/static|_next/image|favicon.ico|clap-processor.js|manifest.webmanifest|sw.js|offline.html|icon|apple-icon|logo-96.png).*)"],
};
