// 화면용: 최근 공지 + 마감 임박 공지
import { connection } from "next/server";
import { searchNotices } from "@/lib/extract";

export async function GET() {
  await connection(); // 항상 최신 데이터 (미리 만들어두지 않기)
  try {
    const [latest, open] = await Promise.all([
      searchNotices({ limit: 6 }),
      searchNotices({ openOnly: true, limit: 6 }),
    ]);
    return Response.json({ latest, open });
  } catch (e) {
    console.error(e);
    return Response.json({ latest: [], open: [], error: "공지를 불러오지 못했어요." }, { status: 500 });
  }
}
