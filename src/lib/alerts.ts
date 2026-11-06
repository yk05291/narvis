// 능동 알림: 오늘(한국 시간) 언제 무엇을 먼저 알려줄지 계산해요. AI 없이 데이터로만.
import "server-only";
import { getProfile, getScheduleForDate, listAssignments } from "./store";
import { todayKST } from "./time";

export type Alert = {
  id: string; // 같은 알림을 두 번 안 띄우려고 쓰는 고유 이름
  at: string; // 알림 띄울 시각 (ISO)
  kind: "class" | "leave" | "assignment" | "academic" | "event";
  title: string; // 짧은 제목
  body: string; // 소리로 읽을 문장
};

const CLASS_BEFORE_MIN = 10;
const EVENT_BEFORE_MIN = 10;
const ASSIGNMENT_BEFORE_H = 3;
const ACADEMIC_AT = "09:00";

const kstIso = (date: string, hhmm: string) => new Date(`${date}T${hhmm.slice(0, 5)}:00+09:00`).toISOString();
const minus = (iso: string, min: number) => new Date(Date.parse(iso) - min * 60000).toISOString();
const hmKST = (iso: string) =>
  new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "numeric", minute: "2-digit", hour12: false }).format(new Date(iso));

export async function buildAlerts(userId: string): Promise<{ date: string; alerts: Alert[] }> {
  const date = todayKST();
  const [profile, schedule, assignments] = await Promise.all([
    getProfile(userId),
    getScheduleForDate(userId, date),
    listAssignments(userId, false),
  ]);
  const name = profile.boss_title || "Boss";
  const alerts: Alert[] = [];

  // 1) 수업 10분 전
  const classes = [...schedule.classes].sort((a, b) => a.start_time.localeCompare(b.start_time));
  for (const c of classes) {
    const start = kstIso(date, c.start_time);
    alerts.push({
      id: `class:${date}:${c.id}`,
      at: minus(start, CLASS_BEFORE_MIN),
      kind: "class",
      title: `${CLASS_BEFORE_MIN}분 뒤 수업 · ${c.subject_name}`,
      body: `${name}, ${CLASS_BEFORE_MIN}분 뒤 ${c.subject_name} 수업이에요.${c.classroom ? ` 강의실은 ${c.classroom}이에요.` : ""}`,
    });
  }

  // 2) 출발 알림: 첫 수업 - 통학 시간 - 10분 여유 (통학 시간을 알 때만)
  const first = classes[0];
  if (first && profile.commute_minutes != null && profile.commute_minutes > 0) {
    const start = kstIso(date, first.start_time);
    alerts.push({
      id: `leave:${date}`,
      at: minus(start, profile.commute_minutes + 10),
      kind: "leave",
      title: `출발할 시간 · ${first.subject_name} ${first.start_time.slice(0, 5)}`,
      body: `${name}, 출발할 시간이에요. ${first.start_time.slice(0, 5)} ${first.subject_name} 수업이고, 통학은 ${profile.commute_minutes}분 걸려요.`,
    });
  }

  // 3) 과제 마감 3시간 전 (24시간 안에 마감인 것)
  const now = Date.now();
  for (const a of assignments) {
    const due = Date.parse(a.due_date);
    if (due < now || due - now > 24 * 3600000) continue;
    alerts.push({
      id: `assignment:${a.id}:${a.due_date}`,
      at: new Date(due - ASSIGNMENT_BEFORE_H * 3600000).toISOString(),
      kind: "assignment",
      title: `마감 ${ASSIGNMENT_BEFORE_H}시간 전 · ${a.subject_name}`,
      body: `${name}, ${a.subject_name} ${a.title} 과제 마감이 ${hmKST(a.due_date)}이에요. ${ASSIGNMENT_BEFORE_H}시간도 안 남았어요.`,
    });
  }

  // 4) 학사일정: 오늘 시작하는 일정은 오전 9시에
  for (const e of schedule.academic_events) {
    if (e.start_date !== date) continue;
    alerts.push({
      id: `academic:${date}:${e.title}`,
      at: kstIso(date, ACADEMIC_AT),
      kind: "academic",
      title: `오늘 학사일정 · ${e.title}`,
      body: `${name}, 오늘은 ${e.title}${e.end_date !== e.start_date ? " 시작일" : ""}이에요.`,
    });
  }

  // 5) 구글 캘린더·NARVIS 일정 10분 전 (종일 일정 제외)
  const timed = [
    ...schedule.google_events.filter((e) => !e.all_day).map((e) => ({ id: `g:${e.id}`, title: e.title, start: e.start_time, location: e.location })),
    ...schedule.events.map((e) => ({ id: `e:${e.id}`, title: e.title, start: e.start_time, location: e.location })),
  ];
  for (const e of timed) {
    alerts.push({
      id: `event:${e.id}:${e.start}`,
      at: minus(e.start, EVENT_BEFORE_MIN),
      kind: "event",
      title: `${EVENT_BEFORE_MIN}분 뒤 일정 · ${e.title}`,
      body: `${name}, ${EVENT_BEFORE_MIN}분 뒤 ${e.title} 일정이 있어요.${e.location ? ` 장소는 ${e.location}이에요.` : ""}`,
    });
  }

  alerts.sort((a, b) => a.at.localeCompare(b.at));
  return { date, alerts };
}
