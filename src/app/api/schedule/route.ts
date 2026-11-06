// 대시보드용: 하루 일정(수업 + 구글 캘린더 + NARVIS 일정 + 마감 과제) + 구글 연결 상태
import { connection, type NextRequest } from "next/server";
import { getScheduleForDate, todayKST } from "@/lib/store";
import { googleStatus } from "@/lib/google";

const USER_ID = "local-boss";

export async function GET(req: NextRequest) {
  await connection();
  const q = req.nextUrl.searchParams.get("date");
  const date = q && /^\d{4}-\d{2}-\d{2}$/.test(q) ? q : todayKST();
  try {
    const [schedule, google] = await Promise.all([getScheduleForDate(USER_ID, date), googleStatus(USER_ID)]);
    return Response.json({ ...schedule, google });
  } catch (e) {
    console.error(e);
    return Response.json({ error: "일정을 불러오지 못했어요." }, { status: 500 });
  }
}
