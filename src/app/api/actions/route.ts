// 승인 대기 작업 처리 API: Boss가 "승인" 또는 "취소"를 누르면 여기로 와요.
import { connection } from "next/server";
import { listPendingActions, resolvePendingAction } from "@/lib/store";

const USER_ID = "local-boss";

export async function GET() {
  await connection();
  return Response.json({ pending: await listPendingActions(USER_ID) });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as
    | { id?: string; approve?: boolean }
    | null;
  if (!body?.id || typeof body.approve !== "boolean") {
    return Response.json({ error: "잘못된 요청이에요." }, { status: 400 });
  }
  const result = await resolvePendingAction(USER_ID, body.id, body.approve);
  return Response.json(result, { status: result.ok ? 200 : 404 });
}
