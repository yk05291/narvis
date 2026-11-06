// 한양여대 공지 수집기 (2단계)
// - 공개 게시판만 읽어요. 로그인/우회 시도 없음.
// - 학교 서버에 부담 주지 않게 요청 사이에 3초씩 쉬어요. (robots.txt 없음 = 제한 없음, 그래도 천천히)
// - 학교 사이트는 첫 방문 때 세션 쿠키를 주고, 그 쿠키가 있어야 게시판 목록(JSON)을 줘요.
import "server-only";
import { createHash } from "crypto";
import { db, must } from "./db";

const BASE = "https://www.hywoman.ac.kr";
const UA = "Mozilla/5.0 (compatible; NARVIS-student-assistant/0.2; personal project)";
const DELAY_MS = 3000;

// 대학공지 > 공지 게시판들 (2026-11 홈페이지 구조 기준)
export const BOARDS = [
  { key: "class", category: "수업", menuId: 4170, boardSeq: 58 },
  { key: "registration", category: "학적·등록", menuId: 4180, boardSeq: 59 },
  { key: "scholarship", category: "장학", menuId: 1360, boardSeq: 8 },
  { key: "campus_life", category: "학교생활", menuId: 4190, boardSeq: 60 },
  { key: "internship", category: "현장실습", menuId: 4200, boardSeq: 61 },
  { key: "career", category: "취업", menuId: 4210, boardSeq: 62 },
  { key: "etc", category: "기타", menuId: 4220, boardSeq: 63 },
] as const;
type Board = (typeof BOARDS)[number];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- 세션 쿠키 받기 (리다이렉트를 직접 따라가며 쿠키 모으기) ----------
async function getSessionCookie(): Promise<string> {
  const jar = new Map<string, string>();
  let url = `${BASE}/ko/index.do`;
  for (let hop = 0; hop < 8; hop++) {
    const res = await fetch(url, {
      redirect: "manual",
      headers: { "User-Agent": UA, Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") },
    });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";");
      const i = pair.indexOf("=");
      if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
    const loc = res.headers.get("location");
    await res.arrayBuffer(); // 본문 비우기
    if (res.status >= 300 && res.status < 400 && loc) {
      url = new URL(loc, url).toString();
      continue;
    }
    break;
  }
  if (jar.size === 0) throw new Error("학교 사이트 세션 쿠키를 못 받았어요");
  return [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
}

// ---------- 게시판 목록 가져오기 ----------
type RawNotice = {
  BBS_SEQ: number | string;
  SUBJECT: string;
  CONTENTS: string | null;
  WRITE_DATE: string; // "2026.10.13"
  LINK_URL: string | null;
  LINK_URL_YN: string;
  SECRET_YN: string;
  LVL: number;
};

async function fetchBoard(board: Board, cookie: string, perPage = 15): Promise<RawNotice[]> {
  const body = new URLSearchParams({
    pageNo: "1",
    pagePerCnt: String(perPage),
    MENU_ID: String(board.menuId),
    CONTENTS_NO: "1",
    SITE_NO: "2",
    BOARD_SEQ: String(board.boardSeq),
    BBS_SEQ: "",
    P_BBS_SEQ: "",
    PWD: "",
    CATE_SEQ: "",
    SEARCH_FLD: "",
    SHOWTYPE: "B0304",
    SEARCH: "",
  });
  const res = await fetch(`${BASE}/ajaxf/FrBoardSvc/bbsViewList.do`, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      Cookie: cookie,
      "X-Requested-With": "XMLHttpRequest",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Referer: `${BASE}/ko/cms/FrCon/index.do?MENU_ID=${board.menuId}&CONTENTS_NO=1`,
    },
    body,
  });
  if (!res.ok) throw new Error(`${board.category} 게시판 응답 ${res.status}`);
  const text = await res.text();
  if (!text.trim()) throw new Error(`${board.category} 게시판이 빈 응답 (세션 만료?)`);
  const json = JSON.parse(text) as { data?: { list?: RawNotice[] } };
  return json.data?.list ?? [];
}

// ---------- 본문 정리 (HTML → 글자) ----------
function decodeEntities(s: string) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export function htmlToText(raw: string | null): string {
  if (!raw) return "";
  // 학교 데이터는 한 번 더 이스케이프돼 있어서 두 번 풀어요
  let s = decodeEntities(decodeEntities(raw));
  s = s
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>|<\/tr>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(s)
    .replace(/[ \t ]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim()
    .slice(0, 8000);
}

function sourceUrl(board: Board, n: RawNotice) {
  if (n.LINK_URL_YN === "Y" && n.LINK_URL) return new URL(n.LINK_URL, BASE).toString();
  return `${BASE}/ko/cms/FrBoardCon/boardView.do?MENU_ID=${board.menuId}&SITE_NO=2&BOARD_SEQ=${board.boardSeq}&BBS_SEQ=${n.BBS_SEQ}`;
}

// ---------- 수집 + 저장 ----------
export async function crawlNotices() {
  const stats = { new_count: 0, updated_count: 0, errors: [] as string[] };
  const cookie = await getSessionCookie();
  const now = new Date().toISOString();

  for (const [i, board] of BOARDS.entries()) {
    if (i > 0) await sleep(DELAY_MS);
    try {
      const list = (await fetchBoard(board, cookie)).filter((n) => n.SECRET_YN !== "Y");
      const rows = list.map((n) => {
        const title = n.SUBJECT.trim();
        const content = htmlToText(n.CONTENTS);
        return {
          board_key: board.key,
          category: board.category,
          bbs_seq: Number(n.BBS_SEQ),
          title,
          content,
          content_hash: createHash("sha256").update(title + "\n" + content).digest("hex"),
          source_url: sourceUrl(board, n),
          posted_at: n.WRITE_DATE ? n.WRITE_DATE.replaceAll(".", "-") : null,
        };
      });
      if (rows.length === 0) continue;

      const existing = must(
        await db()
          .from("university_notices")
          .select("source_url, content_hash")
          .in("source_url", rows.map((r) => r.source_url)),
      ) as { source_url: string; content_hash: string }[];
      const known = new Map(existing.map((e) => [e.source_url, e.content_hash]));

      const fresh = rows.filter((r) => !known.has(r.source_url));
      const changed = rows.filter((r) => known.has(r.source_url) && known.get(r.source_url) !== r.content_hash);
      const same = rows.filter((r) => known.get(r.source_url) === r.content_hash);

      if (fresh.length) {
        must(await db().from("university_notices").insert(fresh.map((r) => ({ ...r, crawled_at: now, last_verified_at: now }))));
      }
      for (const r of changed) {
        // 내용이 바뀌면 AI 분석을 다시 하도록 extracted_at 을 비워요
        must(
          await db()
            .from("university_notices")
            .update({ ...r, last_verified_at: now, extracted_at: null })
            .eq("source_url", r.source_url),
        );
      }
      if (same.length) {
        must(
          await db()
            .from("university_notices")
            .update({ last_verified_at: now })
            .in("source_url", same.map((r) => r.source_url)),
        );
      }
      stats.new_count += fresh.length;
      stats.updated_count += changed.length;
    } catch (e) {
      stats.errors.push(`${board.category}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return stats;
}
