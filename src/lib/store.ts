// 데이터 저장소 (Supabase)
import "server-only";
import { db, must } from "./db";
import { createGoogleEvent, listGoogleEvents, type GoogleEvent } from "./google";
import { saveMemory } from "./memories";

export type TimetableItem = {
  id: string;
  subject_name: string;
  professor_name: string | null;
  day_of_week: number; // 1 = 월요일 ... 7 = 일요일
  start_time: string; // "09:00:00"
  end_time: string;
  classroom: string | null;
};

export type Assignment = {
  id: string;
  subject_name: string;
  title: string;
  due_date: string; // ISO 날짜시간
  is_completed: boolean;
};

export type CalendarEvent = {
  id: string;
  title: string;
  start_time: string;
  end_time: string;
  location: string | null;
  source_type: string;
};

// Boss의 승인을 기다리는 "변경 작업"
export type PendingAction =
  | {
      id: string;
      kind: "add_assignment";
      summary: string;
      data: { subject_name: string; title: string; due_date: string };
    }
  | {
      id: string;
      kind: "add_calendar_event";
      summary: string;
      data: { title: string; start_time: string; end_time: string; location?: string | null };
    }
  | {
      id: string;
      kind: "save_memory";
      summary: string;
      data: { key: string; value: string };
    };

// ---------- 날짜 도우미 (한국 시간 기준) ----------
export function todayKST(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date()); // "2026-11-06"
}

function dayOfWeek(isoDate: string): number {
  const d = new Date(`${isoDate}T12:00:00+09:00`).getUTCDay(); // 0 = 일요일
  return d === 0 ? 7 : d;
}

// 한국 날짜 하루의 시작~끝 (UTC ISO)
function kstDayRange(isoDate: string) {
  const start = new Date(`${isoDate}T00:00:00+09:00`);
  const end = new Date(start.getTime() + 86400000);
  return { start: start.toISOString(), end: end.toISOString() };
}

// ---------- 읽기 ----------
export type Profile = {
  boss_title: string;
  department?: string | null;
  grade?: number | null;
  semester?: number | null;
  wake_up_time?: string | null;
  sleep_time?: string | null;
  commute_minutes?: number | null;
};

export async function getProfile(userId: string) {
  const rows = must(
    await db()
      .from("profiles")
      .select("boss_title, department, grade, semester, wake_up_time, sleep_time, commute_minutes")
      .eq("user_id", userId),
  ) as Profile[];
  return rows[0] ?? ({ boss_title: "Boss" } as Profile);
}

export async function getScheduleForDate(userId: string, isoDate: string) {
  const { start, end } = kstDayRange(isoDate);
  // 구글 캘린더는 실패해도 나머지 일정은 보여줘요
  const google = listGoogleEvents(userId, start, end).catch((e) => {
    console.error("google list", e);
    return "error" as const;
  });
  const [classes, events, due] = await Promise.all([
    db().from("timetables").select("*").eq("user_id", userId).eq("day_of_week", dayOfWeek(isoDate)).order("start_time"),
    db().from("calendar_events").select("*").eq("user_id", userId).gte("start_time", start).lt("start_time", end).order("start_time"),
    db().from("assignments").select("*").eq("user_id", userId).eq("is_completed", false).gte("due_date", start).lt("due_date", end),
  ]);
  const g = await google;
  return {
    date: isoDate,
    classes: must(classes) as TimetableItem[],
    events: must(events) as CalendarEvent[],
    google_events: (Array.isArray(g) ? g : []) as GoogleEvent[],
    google_status: g === null ? "not_connected" : g === "error" ? "error" : "ok",
    assignments_due: must(due) as Assignment[],
  };
}

export async function listAssignments(userId: string, includeCompleted: boolean) {
  let q = db().from("assignments").select("*").eq("user_id", userId).order("due_date");
  if (!includeCompleted) q = q.eq("is_completed", false);
  return must(await q) as Assignment[];
}

export async function listSubjects(userId: string) {
  const rows = must(await db().from("timetables").select("subject_name").eq("user_id", userId)) as { subject_name: string }[];
  return [...new Set(rows.map((r) => r.subject_name))].sort();
}

// ---------- 과제 직접 관리 (Boss가 화면에서 누르는 것 → 바로 반영) ----------
export async function createAssignment(userId: string, a: { subject_name: string; title: string; due_date: string }) {
  return must(
    await db()
      .from("assignments")
      .insert({ user_id: userId, ...a, is_completed: false })
      .select("*")
      .single(),
  ) as Assignment;
}

export async function setAssignmentDone(userId: string, id: string, done: boolean) {
  const rows = must(
    await db().from("assignments").update({ is_completed: done }).eq("user_id", userId).eq("id", id).select("*"),
  ) as Assignment[];
  return rows[0] ?? null;
}

export async function deleteAssignment(userId: string, id: string) {
  const rows = must(await db().from("assignments").delete().eq("user_id", userId).eq("id", id).select("id")) as {
    id: string;
  }[];
  return rows.length > 0;
}

// 채팅용: "자료구조 과제 다 했어" → 단어로 찾아서 완료 처리
// 가장 많이 맞는 과제가 딱 하나일 때만 완료하고, 애매하면 후보만 돌려줘요
const STOP = new Set(["과제", "숙제", "레포트", "리포트", "다", "했어", "끝", "완료", "제출", "그거"]);
export async function completeAssignmentByName(userId: string, query: string) {
  const open = await listAssignments(userId, false);
  const words = query
    .split(/[\s·,]+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2 && !STOP.has(w));
  const scored = open
    .map((a) => {
      const hay = `${a.subject_name} ${a.title}`.replace(/\s+/g, "");
      return { a, score: words.filter((w) => hay.includes(w.replace(/\s+/g, ""))).length };
    })
    .filter((x) => x.score > 0)
    .sort((x, y) => y.score - x.score);
  const best = scored.filter((x) => x.score === scored[0]?.score).map((x) => x.a);
  if (best.length !== 1) return { done: null, candidates: best.length ? best : open };
  const done = await setAssignmentDone(userId, best[0].id, true);
  return { done, candidates: best };
}

export async function listPendingActions(userId: string) {
  return must(
    await db().from("pending_actions").select("id, kind, summary, data").eq("user_id", userId).order("created_at"),
  ) as PendingAction[];
}

// ---------- 변경 (승인 대기 → 승인 시 실행) ----------
export async function createPendingAction(
  userId: string,
  action: Omit<PendingAction, "id">,
): Promise<PendingAction> {
  return must(
    await db()
      .from("pending_actions")
      .insert({ user_id: userId, ...action })
      .select("id, kind, summary, data")
      .single(),
  ) as PendingAction;
}

export async function resolvePendingAction(userId: string, actionId: string, approve: boolean) {
  // 지우면서 동시에 내용을 받아와요 → 두 번 눌러도 한 번만 실행돼요
  const rows = must(
    await db()
      .from("pending_actions")
      .delete()
      .eq("user_id", userId)
      .eq("id", actionId)
      .select("id, kind, summary, data"),
  ) as PendingAction[];
  const action = rows[0];
  if (!action) return { ok: false as const, message: "이미 처리됐거나 없는 요청이에요." };
  if (!approve) {
    return {
      ok: true as const,
      message: action.kind === "save_memory" ? "알겠어요, 기억하지 않을게요." : `취소했어요: ${action.summary}`,
    };
  }

  if (action.kind === "save_memory") {
    await saveMemory(userId, action.data.key, action.data.value);
    return { ok: true as const, message: `기억했어요: ${action.data.value}` };
  }

  if (action.kind === "add_assignment") {
    must(await db().from("assignments").insert({ user_id: userId, ...action.data }));
  } else {
    // 구글 캘린더가 연결돼 있으면 구글에, 아니면 NARVIS 안에 저장
    let created: GoogleEvent | null = null;
    try {
      created = await createGoogleEvent(userId, action.data);
    } catch (e) {
      console.error("google insert", e);
      must(await db().from("pending_actions").insert({ user_id: userId, ...action, id: undefined }));
      return { ok: false as const, message: "구글 캘린더에 추가하지 못했어요. 잠시 후 다시 승인해 주세요." };
    }
    if (created) return { ok: true as const, message: `구글 캘린더에 추가했어요: ${action.summary}` };
    must(await db().from("calendar_events").insert({ user_id: userId, ...action.data, source_type: "MANUAL" }));
  }
  return { ok: true as const, message: `완료했어요: ${action.summary}` };
}
