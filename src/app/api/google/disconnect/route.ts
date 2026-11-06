import { disconnect } from "@/lib/google";

const USER_ID = "local-boss";

export async function POST() {
  try {
    await disconnect(USER_ID);
    return Response.json({ ok: true });
  } catch (e) {
    console.error(e);
    return Response.json({ error: "연결 해제 중 오류가 났어요." }, { status: 500 });
  }
}
