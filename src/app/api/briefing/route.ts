// 아침 브리핑 API
// GET            → 브리핑 시간이 지났으면 오늘 브리핑 (없으면 만들어서 저장)
// GET ?now=1     → 시간 전이어도 지금 보기 (버튼/채팅 "브리핑 해줘")
// GET ?force=1   → 새로 만들기 (오늘 바뀐 내용 반영)
import { connection, type NextRequest } from "next/server";
import { getBriefing } from "@/lib/briefing";

const USER_ID = "local-boss";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  await connection();
  const q = req.nextUrl.searchParams;
  try {
    const r = await getBriefing(USER_ID, { force: q.get("force") === "1", ignoreTime: q.get("now") === "1" || q.get("force") === "1" });
    return Response.json(r);
  } catch (e) {
    console.error("briefing", e);
    return Response.json({ error: "브리핑을 만들지 못했어요." }, { status: 500 });
  }
}
