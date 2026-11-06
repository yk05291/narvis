// 매일 아침 Vercel이 자동으로 부르는 주소: 학교 공지 수집 → AI 분석
// Vercel Cron은 Authorization: Bearer <CRON_SECRET> 을 붙여서 불러요. 그 외엔 거절.
import { crawlNotices } from "@/lib/hywu";
import { extractPendingNotices } from "@/lib/extract";
import { db } from "@/lib/db";
import { crawlAcademicCalendar } from "@/lib/academic";

export const maxDuration = 300; // 최대 5분

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const skipCrawl = url.searchParams.get("extract_only") === "1";
  const run = await db().from("crawl_runs").insert({}).select("id").single();

  const errors: string[] = [];
  let crawl = { new_count: 0, updated_count: 0, errors: [] as string[] };
  if (!skipCrawl) {
    try {
      crawl = await crawlNotices();
    } catch (e) {
      errors.push(`수집 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  // 학사일정 (올해 + 내년)
  let academic: Awaited<ReturnType<typeof crawlAcademicCalendar>> | null = null;
  if (!skipCrawl) {
    try {
      academic = await crawlAcademicCalendar();
    } catch (e) {
      errors.push(`학사일정 수집 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const extract = await extractPendingNotices(Number(url.searchParams.get("limit") ?? 6));
  errors.push(...crawl.errors, ...(academic?.errors ?? []), ...extract.errors);

  if (run.data) {
    await db()
      .from("crawl_runs")
      .update({
        finished_at: new Date().toISOString(),
        new_count: crawl.new_count,
        updated_count: crawl.updated_count,
        extracted_count: extract.extracted_count,
        errors: errors.join("\n") || null,
      })
      .eq("id", run.data.id);
  }

  return Response.json({
    new: crawl.new_count,
    updated: crawl.updated_count,
    extracted: extract.extracted_count,
    remaining_to_extract: extract.remaining,
    academic: academic && { years: academic.years, new: academic.new_count, removed: academic.removed_count },
    errors,
  });
}
