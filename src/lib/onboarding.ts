// 3단계: 대화형 첫 설정 (온보딩)
// 대화하면서 모은 정보는 onboarding_sessions.session_data 에 조금씩 저장해요 (임시 저장).
// Boss가 요약 화면에서 "확인"을 눌러야 진짜 프로필/시간표에 저장돼요.
import "server-only";
import * as z from "zod/v4";
import { db, must } from "./db";

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM 형식 (예: 07:30)");

export const ClassItem = z.object({
  subject_name: z.string().min(1).max(100),
  day_of_week: z.number().int().min(1).max(7).describe("1=월 2=화 3=수 4=목 5=금 6=토 7=일"),
  start_time: hhmm,
  end_time: hhmm,
  classroom: z.string().max(100).nullish(),
  professor_name: z.string().max(100).nullish(),
});
export type ClassItem = z.infer<typeof ClassItem>;

export const ProfileFields = z.object({
  boss_title: z.string().min(1).max(50).nullish().describe("NARVIS가 부를 호칭 (예: Boss, 다혜님)"),
  department: z.string().min(1).max(100).nullish().describe("학과 (예: 컴퓨터정보과)"),
  grade: z.number().int().min(1).max(4).nullish().describe("학년"),
  semester: z.number().int().min(1).max(2).nullish().describe("이번 학기 (1 또는 2)"),
  wake_up_time: hhmm.nullish().describe("평소 일어나는 시간"),
  sleep_time: hhmm.nullish().describe("평소 자는 시간"),
  commute_minutes: z.number().int().min(0).max(300).nullish().describe("통학 시간(분)"),
  briefing_time: hhmm.nullish().describe("아침 브리핑 받을 시간 (기본 08:00)"),
});

export type Draft = z.infer<typeof ProfileFields> & {
  classes?: ClassItem[];
  timetable_skipped?: boolean;
};
export type Step = "collecting" | "confirm" | "done";

// 꼭 있어야 하는 항목 (나머지는 선택)
const REQUIRED: { key: keyof Draft; label: string }[] = [
  { key: "boss_title", label: "호칭" },
  { key: "department", label: "학과" },
  { key: "grade", label: "학년" },
  { key: "semester", label: "학기" },
];

export function missingFields(d: Draft) {
  const missing = REQUIRED.filter((r) => d[r.key] == null).map((r) => r.label);
  if (!d.classes?.length && !d.timetable_skipped) missing.push("시간표 (또는 '나중에')");
  return missing;
}

export async function getOnboarding(userId: string) {
  const rows = must(
    await db().from("onboarding_sessions").select("current_step, session_data").eq("user_id", userId),
  ) as { current_step: Step; session_data: Draft }[];
  if (rows[0]) return { step: rows[0].current_step, draft: rows[0].session_data ?? {} };

  // 세션이 없으면: 이미 설정을 마친 사람인지 프로필로 확인
  const prof = must(await db().from("profiles").select("onboarded_at, boss_title").eq("user_id", userId)) as {
    onboarded_at: string | null;
    boss_title: string | null;
  }[];
  if (prof[0]?.onboarded_at) return { step: "done" as Step, draft: { boss_title: prof[0].boss_title } as Draft };
  return { step: "collecting" as Step, draft: {} as Draft };
}

async function save(userId: string, step: Step, draft: Draft) {
  must(
    await db()
      .from("onboarding_sessions")
      .upsert({ user_id: userId, current_step: step, session_data: draft, updated_at: new Date().toISOString() }),
  );
}

// 받은 항목만 덮어쓰기 (빈 값은 무시)
export async function mergeDraft(userId: string, patch: Partial<Draft>) {
  const { draft } = await getOnboarding(userId);
  const next: Draft = { ...draft };
  for (const [k, v] of Object.entries(patch)) {
    if (v !== null && v !== undefined) (next as Record<string, unknown>)[k] = v;
  }
  // 필수 항목이 다 모이면 자동으로 '확인 대기' (화면에 확인 버튼이 떠요)
  await save(userId, missingFields(next).length ? "collecting" : "confirm", next);
  return next;
}

export async function restart(userId: string) {
  // 기존 프로필 값을 초안으로 불러와서 고치기 쉽게
  const prof = must(await db().from("profiles").select("*").eq("user_id", userId))[0] as
    | Record<string, unknown>
    | undefined;
  const classes = must(
    await db().from("timetables").select("subject_name, day_of_week, start_time, end_time, classroom, professor_name").eq("user_id", userId),
  ) as ClassItem[];
  const t = (v: unknown) => (typeof v === "string" ? v.slice(0, 5) : undefined); // "07:30:00" → "07:30"
  const draft: Draft = prof
    ? {
        boss_title: prof.boss_title as string,
        department: (prof.department as string) ?? undefined,
        grade: (prof.grade as number) ?? undefined,
        semester: (prof.semester as number) ?? undefined,
        wake_up_time: t(prof.wake_up_time),
        sleep_time: t(prof.sleep_time),
        commute_minutes: (prof.commute_minutes as number) ?? undefined,
        briefing_time: t(prof.briefing_time),
        classes: classes.map((c) => ({ ...c, start_time: c.start_time.slice(0, 5), end_time: c.end_time.slice(0, 5) })),
      }
    : {};
  await save(userId, missingFields(draft).length ? "collecting" : "confirm", draft);
  return draft;
}

// "확인" → 진짜 저장
export async function confirmOnboarding(userId: string) {
  const { step, draft } = await getOnboarding(userId);
  if (step !== "confirm") return { ok: false as const, message: "아직 확인 단계가 아니에요." };
  const missing = missingFields(draft);
  if (missing.length) return { ok: false as const, message: `빠진 항목: ${missing.join(", ")}` };

  must(
    await db().from("profiles").upsert({
      user_id: userId,
      boss_title: draft.boss_title,
      department: draft.department,
      grade: draft.grade,
      semester: draft.semester,
      wake_up_time: draft.wake_up_time ?? null,
      sleep_time: draft.sleep_time ?? null,
      commute_minutes: draft.commute_minutes ?? null,
      ...(draft.briefing_time ? { briefing_time: draft.briefing_time } : {}),
      onboarded_at: new Date().toISOString(),
    }),
  );

  // 시간표: 입력했으면 통째로 교체, '나중에'면 예시 시간표만 지우기
  must(await db().from("timetables").delete().eq("user_id", userId));
  if (draft.classes?.length) {
    must(
      await db()
        .from("timetables")
        .insert(draft.classes.map((c) => ({ ...c, user_id: userId }))),
    );
  }

  await save(userId, "done", draft);
  return { ok: true as const, message: `설정 완료! 앞으로 ${draft.boss_title}${josaRago(draft.boss_title!)} 부를게요.` };
}

// 받침 있으면 "이라고"(다혜님이라고), 없으면 "라고"(Boss라고·다혜라고)
function josaRago(word: string) {
  const last = word.trim().slice(-1);
  const code = last.charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) return "라고"; // 한글이 아니면
  return code % 28 === 0 ? "라고" : "이라고";
}
