// 학사일정: 한양여대 홈페이지 '대학생활 > 학사안내 > 학사일정'에 공개된 데이터를 DB로
// - 공개 페이지가 쓰는 데이터 주소(ScheduleListData.do)를 그대로 읽어요. 로그인·우회 없음.
// - 올해 + 내년 달력을 가져와요 (12월에 1~2월 일정이 필요해서). 요청 사이 3초 쉬기.
import "server-only";
import { db, must } from "./db";
import { BASE, UA, getSessionCookie } from "./hywu";
import { todayKST } from "./time";

const CATEGORY: Record<string, string> = { R0201: "학사", R0202: "입시", R0203: "행사", R0206: "장학" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type RawEvent = {
  START_Y: string;
  START_M: string;
  START_D: string;
  END_Y: string;
  END_M: string;
  END_D: string;
  SCH_TYPE: string | null;
  SUBJECT: string;
};

export type AcademicEvent = {
  id: string;
  title: string;
  start_date: string;
  end_date: string;
  category: string;
};

const pad = (s: string) => s.padStart(2, "0");

async function fetchYear(year: number, cookie: string): Promise<RawEvent[]> {
  const res = await fetch(`${BASE}/ajaxf/FrScheduleSvc/ScheduleListData.do`, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      Cookie: cookie,
      "X-Requested-With": "XMLHttpRequest",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Referer: `${BASE}/ko/cms/FrCon/index.do?MENU_ID=570`,
    },
    body: new URLSearchParams({ SCH_YEAR: String(year), SCH_DEPT_CD: "2" }),
  });
  if (!res.ok) throw new Error(`${year}년 학사일정 응답 ${res.status}`);
  const text = (await res.text()).trim();
  if (!text) return []; // 아직 안 올라온 해
  const json = JSON.parse(text) as RawEvent[] | { data?: RawEvent[] };
  return Array.isArray(json) ? json : (json.data ?? []);
}

export async function crawlAcademicCalendar() {
  const stats = { years: [] as string[], new_count: 0, updated_count: 0, removed_count: 0, errors: [] as string[] };
  const cookie = await getSessionCookie();
  const thisYear = Number(todayKST().slice(0, 4));
  const now = new Date().toISOString();

  for (const [i, year] of [thisYear, thisYear + 1].entries()) {
    if (i > 0) await sleep(3000);
    try {
      const raw = await fetchYear(year, cookie);
      stats.years.push(`${year}:${raw.length}`);
      if (raw.length === 0) continue;

      const rows = raw
        .filter((e) => e.SUBJECT?.trim() && e.START_Y && e.END_Y)
        .map((e) => {
          const start = `${e.START_Y}-${pad(e.START_M)}-${pad(e.START_D)}`;
          const end = `${e.END_Y}-${pad(e.END_M)}-${pad(e.END_D)}`;
          const title = e.SUBJECT.trim();
          return {
            source_key: `${start}|${end}|${title}`,
            title,
            start_date: start,
            end_date: end,
            category: CATEGORY[e.SCH_TYPE ?? ""] ?? "학사",
            sch_type: e.SCH_TYPE,
            sch_year: year,
            is_active: true,
            last_verified_at: now,
          };
        });
      // 같은 일정이 두 해 달력에 겹쳐 나올 수 있어서 키로 한 번 정리
      const unique = [...new Map(rows.map((r) => [r.source_key, r])).values()];

      const existing = must(
        await db().from("academic_events").select("source_key").in("source_key", unique.map((r) => r.source_key)),
      ) as { source_key: string }[];
      const known = new Set(existing.map((e) => e.source_key));
      stats.new_count += unique.filter((r) => !known.has(r.source_key)).length;
      stats.updated_count += unique.filter((r) => known.has(r.source_key)).length;

      must(await db().from("academic_events").upsert(unique, { onConflict: "source_key" }));

      // 이번에 안 보인 그 해 일정 = 학교가 지우거나 바꾼 것 → 숨기기
      const gone = must(
        await db()
          .from("academic_events")
          .update({ is_active: false })
          .eq("sch_year", year)
          .eq("is_active", true)
          .lt("last_verified_at", now)
          .select("id"),
      ) as { id: string }[];
      stats.removed_count += gone.length;
    } catch (e) {
      stats.errors.push(`${year}년: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return stats;
}

// ---------- 읽기 ----------
// 사람들이 부르는 말 → 학교 달력에 적힌 말
const ALIASES: Record<string, string[]> = {
  개강: ["수업 개시", "학기 개시", "개강"],
  개학: ["수업 개시", "학기 개시"],
  종강: ["종강"],
  시험: ["중간고사", "기말고사", "시험"],
  중간: ["중간고사"],
  기말: ["기말고사"],
  방학: ["방학"],
  수강: ["수강신청", "수강정정"],
  수강신청: ["수강신청"],
  등록: ["등록"],
  등록금: ["등록"],
  휴학: ["휴학"],
  복학: ["복학"],
  졸업: ["졸업", "학위수여"],
  성적: ["성적"],
  계절학기: ["계절학기"],
  입학식: ["입학식"],
  축제: ["축제", "대동제"],
};

const DOW = ["일", "월", "화", "수", "목", "금", "토"];
// "2026-12-21" → "2026-12-21(월)" (요일은 코드가 정확히 계산)
export function withDow(iso: string) {
  return `${iso}(${DOW[new Date(`${iso}T12:00:00+09:00`).getUTCDay()]})`;
}

function keywordTerms(keyword: string) {
  const k = keyword.replace(/[,()%_]/g, " ").replace(/\s+/g, " ").trim();
  const base = k.replace(/(일|날|일정|기간|언제)$/u, "").trim() || k;
  return [...new Set([k, base, ...(ALIASES[base] ?? []), ...(ALIASES[k] ?? [])])].filter(Boolean);
}
// from~to 기간과 겹치는 일정 (예: 진행 중인 '복학 기간'도 포함)
export async function listAcademicEvents(opts: { from?: string; to?: string; keyword?: string | null; limit?: number } = {}) {
  const from = opts.from ?? todayKST();
  let q = db()
    .from("academic_events")
    .select("id, title, start_date, end_date, category")
    .eq("is_active", true)
    .gte("end_date", from)
    .order("start_date")
    .limit(opts.limit ?? 30);
  if (opts.to) q = q.lte("start_date", opts.to);
  if (opts.keyword) {
    const terms = keywordTerms(opts.keyword);
    if (terms.length) q = q.or(terms.map((t) => `title.ilike.%${t}%`).join(","));
  }
  return must(await q) as AcademicEvent[];
}

export async function academicEventsOn(date: string) {
  return listAcademicEvents({ from: date, to: date, limit: 10 });
}
