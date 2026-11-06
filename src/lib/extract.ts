// 공지 AI 분석: 본문에서 신청 기간, 대상, 한 줄 요약을 뽑아 JSON으로 저장
import "server-only";
import * as z from "zod/v4";
import { db, must } from "./db";
import { callGroq, GroqError } from "./groq";

const Extracted = z.object({
  summary: z.string().max(200),
  application_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  application_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  eligibility: z.string().max(200).nullable(),
});
export type NoticeInfo = z.infer<typeof Extracted>;

const SYSTEM = `너는 대학 공지에서 정보를 뽑는 도우미야. 아래 형식의 JSON만 출력해:
{"summary": "학생에게 필요한 핵심을 한국어 한 문장(80자 이내)으로", "application_start": "YYYY-MM-DD 또는 null", "application_end": "YYYY-MM-DD 또는 null", "eligibility": "대상 학생(예: 재학생 전체, 2학년) 또는 null"}
- 신청/접수/제출 기간이 있으면 그 시작일과 마감일. 없으면 null.
- 연도가 안 써 있으면 게시일 기준으로 가장 자연스러운 연도.
- 본문에 없는 내용은 지어내지 말고 null.`;

// 오래된 공지는 분석하지 않아요 (무료 사용량 아끼기)
const RECENT_DAYS = 45;

export async function extractPendingNotices(limit = 6) {
  const since = new Date(Date.now() - RECENT_DAYS * 86400000).toISOString().slice(0, 10);

  // 오래된 공지는 분석 없이 '완료' 처리
  must(
    await db()
      .from("university_notices")
      .update({ extracted_at: new Date().toISOString() })
      .is("extracted_at", null)
      .lt("posted_at", since),
  );

  const todo = must(
    await db()
      .from("university_notices")
      .select("id, title, content, posted_at")
      .is("extracted_at", null)
      .order("posted_at", { ascending: false })
      .limit(limit),
  ) as { id: string; title: string; content: string | null; posted_at: string | null }[];

  let done = 0;
  const errors: string[] = [];
  for (const n of todo) {
    try {
      const msg = await callGroq(
        [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content: `게시일: ${n.posted_at}\n제목: ${n.title}\n본문:\n${(n.content ?? "").slice(0, 2500)}`,
          },
        ],
        { response_format: { type: "json_object" }, max_completion_tokens: 600 },
      );
      const parsed = Extracted.safeParse(JSON.parse(msg.content ?? "{}"));
      if (!parsed.success) throw new Error("AI 응답 형식 오류");
      must(
        await db()
          .from("university_notices")
          .update({ structured_data: parsed.data, extracted_at: new Date().toISOString() })
          .eq("id", n.id),
      );
      done++;
    } catch (e) {
      errors.push(`${n.title.slice(0, 20)}: ${e instanceof Error ? e.message : String(e)}`);
      // 사용량 한도에 걸리면 이번 실행은 여기까지
      if (e instanceof GroqError && e.status === 429) break;
    }
  }
  return { extracted_count: done, remaining: todo.length - done, errors };
}

// ---------- 검색 (NARVIS 도구 + 화면에서 사용) ----------
export type NoticeRow = {
  id: string;
  category: string;
  title: string;
  posted_at: string | null;
  source_url: string;
  structured_data: Partial<NoticeInfo>;
};

export async function searchNotices(opts: {
  keyword?: string | null;
  category?: string | null;
  openOnly?: boolean | null;
  limit?: number;
}) {
  let q = db()
    .from("university_notices")
    .select("id, category, title, posted_at, source_url, structured_data")
    .eq("is_active", true)
    .order("posted_at", { ascending: false })
    .limit(opts.openOnly ? 100 : (opts.limit ?? 8));

  if (opts.category) q = q.eq("category", opts.category);
  if (opts.keyword) {
    // 쉼표·괄호는 검색식을 깨뜨려서 빼요
    const k = opts.keyword.replace(/[,()%]/g, " ").trim();
    if (k) q = q.or(`title.ilike.%${k}%,content.ilike.%${k}%`);
  }
  let rows = must(await q) as NoticeRow[];

  if (opts.openOnly) {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
    rows = rows
      .filter((r) => r.structured_data?.application_end && r.structured_data.application_end >= today)
      .sort((a, b) => (a.structured_data.application_end! < b.structured_data.application_end! ? -1 : 1))
      .slice(0, opts.limit ?? 8);
  }
  return rows;
}
