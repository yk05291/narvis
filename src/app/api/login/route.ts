import { AUTH_COOKIE, authToken } from "@/lib/auth";
import { timingSafeEqual } from "crypto";

export async function POST(req: Request) {
  const expected = process.env.NARVIS_PASSWORD;
  if (!expected) return Response.json({ ok: true }); // 비밀번호 설정 안 됨 (내 컴퓨터 개발용)

  const { password } = (await req.json().catch(() => ({}))) as { password?: string };
  const a = Buffer.from(password ?? "");
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    // 마구 시도하는 걸 늦추기
    await new Promise((r) => setTimeout(r, 800));
    return Response.json({ ok: false, error: "비밀번호가 틀렸어요." }, { status: 401 });
  }

  const token = await authToken(expected);
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return new Response(JSON.stringify({ ok: true }), {
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": `${AUTH_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}${secure}`,
    },
  });
}
