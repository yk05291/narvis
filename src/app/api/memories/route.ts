// 기억 목록 보기 / 지우기
import { connection, type NextRequest } from "next/server";
import { forgetMemory, listMemories } from "@/lib/memories";

const USER_ID = "local-boss";

export async function GET() {
  await connection();
  try {
    return Response.json({ memories: await listMemories(USER_ID) });
  } catch (e) {
    console.error(e);
    return Response.json({ error: "기억을 불러오지 못했어요." }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id || !/^[0-9a-f-]{36}$/.test(id)) return Response.json({ error: "잘못된 요청이에요." }, { status: 400 });
  try {
    const n = await forgetMemory(USER_ID, { id });
    return Response.json({ ok: n > 0 });
  } catch (e) {
    console.error(e);
    return Response.json({ error: "지우지 못했어요." }, { status: 500 });
  }
}
