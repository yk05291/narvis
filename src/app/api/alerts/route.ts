// 오늘의 능동 알림 목록 (언제 무엇을 알려줄지). 화면이 이걸 받아서 시간이 되면 띄워요.
import { connection } from "next/server";
import { buildAlerts } from "@/lib/alerts";

const USER_ID = "local-boss";

export async function GET() {
  await connection();
  try {
    return Response.json(await buildAlerts(USER_ID));
  } catch (e) {
    console.error("alerts", e);
    return Response.json({ error: "알림을 준비하지 못했어요." }, { status: 500 });
  }
}
