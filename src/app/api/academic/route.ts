// 학사일정 (학교 홈페이지 공개 데이터를 모은 DB)
// GET ?from=YYYY-MM-DD&to=YYYY-MM-DD&limit=  (기본: 오늘부터)
import { connection, type NextRequest } from "next/server";
import { listAcademicEvents } from "@/lib/academic";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  await connection();
  const q = req.nextUrl.searchParams;
  const from = q.get("from");
  const to = q.get("to");
  try {
    const events = await listAcademicEvents({
      from: from && DATE.test(from) ? from : undefined,
      to: to && DATE.test(to) ? to : undefined,
      limit: Math.min(60, Number(q.get("limit")) || 20),
    });
    return Response.json({ events, source: "한양여대 홈페이지 학사일정" });
  } catch (e) {
    console.error(e);
    return Response.json({ error: "학사일정을 불러오지 못했어요." }, { status: 500 });
  }
}
