// 학사일정 질문은 AI 없이 코드가 DB에서 바로 찾아 답해요.
// (날짜는 틀리면 안 되고, AI 무료 사용량이 바닥나도 정확해야 해서)
// AI로 넘기는 경우: 학사일정과 다른 주제(과제·공지·목표 등)가 섞인 질문
import "server-only";
import { listAcademicEvents, type AcademicEvent } from "./academic";
import { todayKST } from "./time";

const DOW = ["일", "월", "화", "수", "목", "금", "토"];
const md = (iso: string) => {
  const d = new Date(`${iso}T12:00:00+09:00`);
  return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일(${DOW[d.getUTCDay()]})`;
};
// 받침 있으면 "은", 없으면 "는" (숫자·영문 끝은 읽는 소리 기준으로 대략)
function eunNeun(word: string) {
  const last = word.trim().slice(-1);
  const code = last.charCodeAt(0) - 0xac00;
  if (code >= 0 && code <= 11171) return code % 28 === 0 ? "는" : "은";
  return /[013678]$/.test(last) ? "은" : "는"; // 일·삼·육·칠·팔·영 → 받침
}
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

const TOPIC =
  /(학사\s*일정|축제|대동제|개강|개학|종강|기말\s*고사|기말|중간\s*고사|중간|시험|수강\s*신청|수강\s*정정|방학|휴학|복학|졸업|학위\s*수여|등록\s*기간|등록금\s*납부|성적|계절\s*학기|입학식|학기\s*개시|수업\s*개시)/;
const ASKING = /(언제|며칠|몇\s*일|날짜|일정|알려|기간|부터|까지|남았|됐|였)/;
const OTHER_TOPIC = /(과제|숙제|공지|장학금|목표|기억|추가|넣어|등록해|메뉴|추천|시간표\s*바꿔)/;

// 질문 속 단어 → 검색어
function keywordOf(text: string): string | null {
  const m = text.match(TOPIC);
  if (!m) return null;
  const k = m[1].replace(/\s+/g, "");
  if (k === "학사일정") return null; // 전체 목록 요청
  if (k === "기말" || k === "기말고사") return "기말";
  if (k === "중간" || k === "중간고사") return "중간";
  if (k.startsWith("수강")) return "수강";
  if (k === "학기개시" || k === "수업개시" || k === "개학") return "개강";
  if (k === "등록기간" || k === "등록금납부") return "등록";
  if (k === "학위수여") return "졸업";
  return k;
}

function line(e: AcademicEvent, today: string) {
  const range = e.start_date === e.end_date ? md(e.start_date) : `${md(e.start_date)} ~ ${md(e.end_date)}`;
  let tag = "";
  if (e.start_date <= today && e.end_date >= today) tag = " · 지금 진행 중";
  else if (e.start_date > today) tag = ` · ${days(today, e.start_date)}일 남음`;
  else tag = " · 지났어요";
  return `- ${e.title}: ${range}${tag}`;
}

export async function answerAcademicQuestion(text: string, name: string): Promise<string | null> {
  const t = text.replace(/\s+/g, " ").trim();
  if (!TOPIC.test(t) || OTHER_TOPIC.test(t)) return null;
  if (!ASKING.test(t) && !/학사\s*일정/.test(t)) return null;

  const today = todayKST();
  const year = Number(today.slice(0, 4));
  const keyword = keywordOf(t);

  // 1) "학사일정 알려줘" / "이번 달 학사일정" / "다음 달 학사일정"
  if (!keyword) {
    let from = today;
    let to: string | undefined;
    let label = "앞으로의 학사일정";
    const [y, m] = today.split("-").map(Number);
    const monthEnd = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 0)).toISOString().slice(0, 10);
    if (/이번\s*달/.test(t)) {
      to = monthEnd(y, m);
      label = `${m}월 학사일정`;
    } else if (/다음\s*달/.test(t)) {
      const nm = m === 12 ? 1 : m + 1;
      const ny = m === 12 ? y + 1 : y;
      from = `${ny}-${String(nm).padStart(2, "0")}-01`;
      to = monthEnd(ny, nm);
      label = `${nm}월 학사일정`;
    }
    const rows = await listAcademicEvents({ from, to, limit: 8 });
    if (rows.length === 0) return `${name}, ${label}은 학교 학사일정에 없어요.`;
    return `${name}, ${label}이에요. (오늘 ${md(today)})\n${rows.map((e) => line(e, today)).join("\n")}`;
  }

  // 2) 특정 일정: 올해 + 내년 달력에서 찾기
  let rows = await listAcademicEvents({ from: `${year}-01-01`, keyword, limit: 30 });
  // "1학기"/"2학기" 를 말했으면 그 학기만 (학교 표기: 2026-1, 2026-2)
  const sem = t.match(/([12])\s*학기/)?.[1];
  if (sem) {
    const bySem = rows.filter((e) => new RegExp(`\\d{4}-${sem}(?!\\d)`).test(e.title));
    // 제목에 학기 표기가 없는 일정(기말고사 등)은 날짜로: 1학기=1~8월, 2학기=9~2월
    const byDate = rows.filter((e) => {
      if (/\d{4}-[12](?!\d)/.test(e.title)) return false;
      const mo = Number(e.start_date.slice(5, 7));
      return sem === "1" ? mo >= 3 && mo <= 8 : mo >= 9 || mo <= 2;
    });
    rows = [...bySem, ...byDate].sort((a, b) => a.start_date.localeCompare(b.start_date));
  }
  if (rows.length === 0) return `${name}, 학교 학사일정에서 그 일정은 찾지 못했어요. 학교 홈페이지 학사일정에 아직 안 올라왔을 수도 있어요.`;

  const past = /(였|었|지났|했었)/.test(t);
  const upcoming = rows.filter((e) => e.end_date >= today);
  const done = rows.filter((e) => e.end_date < today);
  const pick = past && done.length ? done.slice(-3) : upcoming.length ? upcoming.slice(0, 3) : done.slice(-3);

  const one = pick[0];
  const head =
    pick.length === 1
      ? `${name}, ${one.title}${eunNeun(one.title)} ${one.start_date === one.end_date ? `${md(one.start_date)}이에요.` : `${md(one.start_date)}부터 ${md(one.end_date)}까지예요.`}`
      : `${name}, 학교 학사일정에서 찾은 일정이에요.`;
  return `${head}\n${pick.map((e) => line(e, today)).join("\n")}`;
}
