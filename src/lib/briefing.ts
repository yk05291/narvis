// 아침 브리핑: 오늘 하루에 필요한 정보를 모아서, 말로 읽기 좋은 몇 문장으로 정리
// - 데이터 모으기는 코드가 정확하게 하고 (지어낼 일 없음)
// - 문장 다듬기만 AI가 해요. AI가 실패하면 정해진 틀로 문장을 만들어요.
// - 하루 한 번 만들어서 briefings 테이블에 저장 → 다시 열면 재사용
import "server-only";
import { db, must } from "./db";
import { callGroq } from "./groq";
import { getProfile, getScheduleForDate, todayKST, type Profile } from "./store";
import { searchNotices } from "./extract";
import { listAcademicEvents } from "./academic";

const DAY = ["일", "월", "화", "수", "목", "금", "토"];

export type BriefingItem = { time?: string; title: string; sub?: string | null; link?: string | null };
export type Briefing = {
  date: string;
  generated_at: string;
  greeting_name: string;
  classes: BriefingItem[];
  events: BriefingItem[];
  academic?: BriefingItem[]; // 학교 학사일정: 오늘 진행 중 + 7일 안
  deadlines: BriefingItem[]; // 3일 안에 마감인 과제
  new_notices: BriefingItem[]; // 최근 2일 새 공지
  closing_notices: BriefingItem[]; // 7일 안에 신청 마감인 공지
  leave_by: string | null; // 첫 수업 기준 출발 권장 시각
  spoken: string; // 읽어줄 문장
  spoken_by: "ai" | "template";
};

export type BriefingResult =
  | { status: "disabled" }
  | { status: "not_yet"; briefing_time: string }
  | { status: "ready"; briefing_time: string; briefing: Briefing };

const hm = (iso: string) =>
  new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false }).format(
    new Date(iso),
  );

function nowKSTMinutes() {
  const [h, m] = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false })
    .format(new Date())
    .split(":")
    .map(Number);
  return h * 60 + m;
}
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const fromMin = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const addDays = (iso: string, n: number) =>
  new Date(new Date(`${iso}T12:00:00+09:00`).getTime() + n * 86400000).toISOString().slice(0, 10);

// ---------- 1) 데이터 모으기 ----------
async function gather(userId: string, date: string, profile: Profile): Promise<Omit<Briefing, "spoken" | "spoken_by">> {
  const schedule = await getScheduleForDate(userId, date);

  const classes = schedule.classes.map((c) => ({
    time: `${c.start_time.slice(0, 5)}–${c.end_time.slice(0, 5)}`,
    title: c.subject_name,
    sub: c.classroom,
  }));
  const events: BriefingItem[] = [
    ...schedule.google_events.map((e) => ({
      time: e.all_day ? "종일" : `${hm(e.start_time)}–${hm(e.end_time)}`,
      title: e.title,
      sub: e.location,
      link: e.link,
    })),
    ...schedule.events.map((e) => ({ time: `${hm(e.start_time)}–${hm(e.end_time)}`, title: e.title, sub: e.location })),
  ].sort((a, b) => (a.time === "종일" ? -1 : b.time === "종일" ? 1 : a.time.localeCompare(b.time)));

  // 3일 안에 마감인 과제
  const until = new Date(`${addDays(date, 3)}T23:59:59+09:00`).toISOString();
  const due = must(
    await db()
      .from("assignments")
      .select("subject_name, title, due_date")
      .eq("user_id", userId)
      .eq("is_completed", false)
      .gte("due_date", new Date().toISOString())
      .lte("due_date", until)
      .order("due_date"),
  ) as { subject_name: string; title: string; due_date: string }[];
  const deadlines = due.map((a) => {
    const d = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date(a.due_date));
    const left = Math.round((Date.parse(d) - Date.parse(date)) / 86400000);
    return { time: left === 0 ? `오늘 ${hm(a.due_date)}` : `D-${left}`, title: `${a.subject_name} · ${a.title}` };
  });

  // 공지: 최근 2일 새 글 + 7일 안에 신청 마감
  const [latest, open] = await Promise.all([searchNotices({ limit: 10 }), searchNotices({ openOnly: true, limit: 10 })]);
  const since = addDays(date, -2);
  const weekEnd = addDays(date, 7);
  const new_notices = latest
    .filter((n) => n.posted_at && n.posted_at >= since)
    .slice(0, 4)
    .map((n) => ({ title: n.title, sub: n.structured_data?.summary ?? n.category, link: n.source_url }));
  const closing_notices = open
    .filter((n) => n.structured_data.application_end! <= weekEnd)
    .slice(0, 4)
    .map((n) => {
      const left = Math.round((Date.parse(n.structured_data.application_end!) - Date.parse(date)) / 86400000);
      return { time: left === 0 ? "오늘 마감" : `D-${left}`, title: n.title, link: n.source_url };
    });

  // 학사일정: 오늘 진행 중이거나 7일 안에 시작
  const acad = await listAcademicEvents({ from: date, to: addDays(date, 7), limit: 6 }).catch(() => []);
  const academic = acad.map((e) => {
    const left = Math.round((Date.parse(e.start_date) - Date.parse(date)) / 86400000);
    return {
      time: left <= 0 ? (e.end_date > date ? `~${Number(e.end_date.slice(5, 7))}/${Number(e.end_date.slice(8))}` : "오늘") : `D-${left}`,
      title: e.title,
      sub: e.category,
    };
  });

  // 출발 권장 시각: 첫 수업 - 통학 - 10분 여유
  let leave_by: string | null = null;
  const first = schedule.classes[0];
  if (first && profile.commute_minutes != null) {
    const m = toMin(first.start_time) - profile.commute_minutes - 10;
    // 이미 지난 출발 시각은 안 알려줘요 (오늘 브리핑을 늦게 열었을 때)
    const isToday = date === todayKST();
    if (m > 0 && (!isToday || m > nowKSTMinutes())) leave_by = fromMin(m);
  }

  return {
    date,
    generated_at: new Date().toISOString(),
    greeting_name: profile.boss_title || "Boss",
    classes,
    events,
    academic,
    deadlines,
    new_notices,
    closing_notices,
    leave_by,
  };
}

// ---------- 2) 말로 읽을 문장 만들기 ----------
function templateText(b: Omit<Briefing, "spoken" | "spoken_by">) {
  const d = new Date(`${b.date}T12:00:00+09:00`);
  const parts = [`좋은 아침이에요, ${b.greeting_name}. 오늘은 ${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일 ${DAY[d.getUTCDay()]}요일이에요.`];
  if (b.classes.length) {
    parts.push(`오늘 수업은 ${b.classes.length}개로, 첫 수업은 ${b.classes[0].time!.slice(0, 5)} ${b.classes[0].title}이에요.`);
    if (b.leave_by) parts.push(`통학 시간을 생각하면 ${b.leave_by}까지는 출발하는 게 좋아요.`);
  } else parts.push("오늘은 수업이 없어요.");
  if (b.events.length) parts.push(`일정은 ${b.events.map((e) => `${e.time} ${e.title}`).join(", ")}이 있어요.`);
  if (b.academic?.length) parts.push(`이번 주 학사일정: ${b.academic.map((a) => `${a.title}(${a.time})`).join(", ")}.`);
  if (b.deadlines.length) parts.push(`곧 마감인 과제가 ${b.deadlines.length}개 있어요: ${b.deadlines.map((x) => x.title).join(", ")}.`);
  if (b.closing_notices.length) parts.push(`신청 마감이 다가오는 학교 공지가 ${b.closing_notices.length}개 있어요.`);
  if (b.new_notices.length) parts.push(`새 학교 공지도 ${b.new_notices.length}개 올라왔어요.`);
  return parts.join(" ");
}

async function aiText(b: Omit<Briefing, "spoken" | "spoken_by">) {
  const d = new Date(`${b.date}T12:00:00+09:00`);
  const msg = await callGroq(
    [
      {
        role: "system",
        content: `너는 개인 비서 NARVIS야. 아래 JSON만 보고 ${b.greeting_name}에게 들려줄 아침 브리핑을 써.
- 한국어 존댓말, 4~6문장, 소리로 읽기 좋게. 마크다운·목록·이모지·링크 금지.
- 첫 문장은 인사와 날짜(${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일 ${DAY[d.getUTCDay()]}요일).
- 수업, 일정, 출발 시각(leave_by), 학사일정(academic: 학교 공식 일정, D-n은 n일 뒤 시작), 곧 마감인 과제, 마감 다가오는 공지, 새 공지 순서로 중요한 것만. 비어 있는 항목은 말하지 마.
- JSON에 없는 내용은 절대 지어내지 마. 시간은 "오전 9시", "오후 1시 반"처럼 읽기 쉽게.`,
      },
      { role: "user", content: JSON.stringify({ ...b, generated_at: undefined }) },
    ],
    { max_completion_tokens: 700 },
  );
  const text = (msg.content ?? "").replace(/[*#`>|]/g, "").trim();
  if (text.length < 20) throw new Error("브리핑 문장이 너무 짧아요");
  return text;
}

// ---------- 3) 하루 한 번 만들고 저장 ----------
export async function getBriefing(userId: string, opts: { force?: boolean; ignoreTime?: boolean } = {}): Promise<BriefingResult> {
  const profile = (await getProfile(userId)) as Profile & { briefing_time?: string; briefing_enabled?: boolean };
  const rows = must(
    await db().from("profiles").select("briefing_time, briefing_enabled").eq("user_id", userId),
  ) as { briefing_time: string; briefing_enabled: boolean }[];
  const pref = rows[0] ?? { briefing_time: "08:00:00", briefing_enabled: true };
  const briefing_time = pref.briefing_time.slice(0, 5);
  if (!pref.briefing_enabled && !opts.ignoreTime) return { status: "disabled" };
  if (!opts.ignoreTime && nowKSTMinutes() < toMin(briefing_time)) return { status: "not_yet", briefing_time };

  const date = todayKST();
  if (!opts.force) {
    const cached = must(
      await db().from("briefings").select("content").eq("user_id", userId).eq("brief_date", date),
    ) as { content: Briefing }[];
    if (cached[0]) return { status: "ready", briefing_time, briefing: cached[0].content };
  }

  const data = await gather(userId, date, profile);
  let spoken: string;
  let spoken_by: Briefing["spoken_by"] = "ai";
  try {
    spoken = await aiText(data);
  } catch (e) {
    console.error("briefing ai failed, using template", e);
    spoken = templateText(data);
    spoken_by = "template";
  }
  const briefing: Briefing = { ...data, spoken, spoken_by };
  must(await db().from("briefings").upsert({ user_id: userId, brief_date: date, content: briefing }));
  return { status: "ready", briefing_time, briefing };
}

export async function setBriefingPrefs(userId: string, prefs: { briefing_time?: string | null; enabled?: boolean | null }) {
  const update: Record<string, unknown> = {};
  if (prefs.briefing_time) update.briefing_time = prefs.briefing_time;
  if (prefs.enabled != null) update.briefing_enabled = prefs.enabled;
  if (Object.keys(update).length === 0) return;
  must(await db().from("profiles").update(update).eq("user_id", userId));
}
