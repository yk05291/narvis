// 온보딩 대화에서 NARVIS가 쓰는 도구들 (전부 '임시 저장'만 해요)
import "server-only";
import * as z from "zod/v4";
import { tool, type Tool } from "./tools";
import { ClassItem, ProfileFields, getOnboarding, mergeDraft } from "./onboarding";

const DAY = ["", "월", "화", "수", "목", "금", "토", "일"];

export function makeOnboardingTools(userId: string): Tool[] {
  return [
    tool({
      name: "save_profile_info",
      description:
        "Boss가 말해준 정보를 임시 저장합니다. 알게 된 항목만 넣으세요(나머지는 비워두기). 고칠 때도 같은 도구로 덮어씁니다.",
      schema: ProfileFields,
      run: async (input) => {
        const d = await mergeDraft(userId, input);
        return `임시 저장 완료. 현재: ${JSON.stringify({ ...d, classes: undefined })}`;
      },
    }),

    tool({
      name: "add_classes",
      description:
        "시간표에 수업을 추가합니다(여러 개 한 번에 가능). 같은 과목이 여러 요일이면 요일마다 하나씩 넣으세요.",
      schema: z.object({ classes: z.array(ClassItem).min(1).max(30) }),
      run: async ({ classes }) => {
        const bad = classes.find((c) => c.start_time >= c.end_time);
        if (bad) return `오류: ${bad.subject_name} 끝나는 시간이 시작 시간보다 빨라요.`;
        const { draft } = await getOnboarding(userId);
        // 같은 과목·요일·시작시간은 한 번만 (AI가 이미 있는 수업을 또 넣어도 중복 안 생기게)
        const key = (c: { subject_name: string; day_of_week: number; start_time: string }) =>
          `${c.subject_name.trim()}|${c.day_of_week}|${c.start_time}`;
        const map = new Map((draft.classes ?? []).map((c) => [key(c), c]));
        for (const c of classes) map.set(key(c), { ...map.get(key(c)), ...c });
        const merged = [...map.values()];
        const d = await mergeDraft(userId, { classes: merged, timetable_skipped: false });
        return `추가 완료. 현재 시간표: ${d.classes!.map((c) => `${DAY[c.day_of_week]} ${c.start_time}-${c.end_time} ${c.subject_name}`).join(" / ")}`;
      },
    }),

    tool({
      name: "remove_classes",
      description: "시간표에서 과목을 뺍니다. 요일을 주면 그 요일 것만, 안 주면 그 과목 전부.",
      schema: z.object({
        subject_name: z.string(),
        day_of_week: z.number().int().min(1).max(7).nullish(),
      }),
      run: async ({ subject_name, day_of_week }) => {
        const { draft } = await getOnboarding(userId);
        const before = draft.classes ?? [];
        const after = before.filter(
          (c) => !(c.subject_name.includes(subject_name) && (day_of_week == null || c.day_of_week === day_of_week)),
        );
        await mergeDraft(userId, { classes: after });
        return `${before.length - after.length}개 뺐어요. 남은 수업 ${after.length}개.`;
      },
    }),

    tool({
      name: "update_class",
      description:
        "이미 넣은 수업의 요일·시간·강의실을 바꿉니다 (예: '데이터베이스는 목요일 말고 금요일'). 바꿀 항목만 new_* 에 넣으세요.",
      schema: z.object({
        subject_name: z.string().describe("바꿀 과목 이름"),
        day_of_week: z.number().int().min(1).max(7).nullish().describe("지금 들어가 있는 요일 (같은 과목이 여러 요일일 때만)"),
        new_day_of_week: z.number().int().min(1).max(7).nullish(),
        new_start_time: ClassItem.shape.start_time.nullish(),
        new_end_time: ClassItem.shape.end_time.nullish(),
        new_classroom: z.string().max(100).nullish(),
      }),
      run: async (u) => {
        const { draft } = await getOnboarding(userId);
        const classes = draft.classes ?? [];
        const targets = classes.filter(
          (c) => c.subject_name.includes(u.subject_name) && (u.day_of_week == null || c.day_of_week === u.day_of_week),
        );
        if (targets.length === 0) return `오류: '${u.subject_name}' 수업을 못 찾았어요. 지금 시간표: ${classes.map((c) => c.subject_name).join(", ")}`;
        if (targets.length > 1) return `'${u.subject_name}'이(가) 여러 요일에 있어요. day_of_week 로 어느 요일 것인지 알려주세요.`;
        const t = targets[0];
        const updated = {
          ...t,
          day_of_week: u.new_day_of_week ?? t.day_of_week,
          start_time: u.new_start_time ?? t.start_time,
          end_time: u.new_end_time ?? t.end_time,
          classroom: u.new_classroom ?? t.classroom,
        };
        if (updated.start_time >= updated.end_time) return "오류: 끝나는 시간이 시작 시간보다 빨라요.";
        await mergeDraft(userId, { classes: classes.map((c) => (c === t ? updated : c)) });
        return `수정 완료: ${DAY[updated.day_of_week]} ${updated.start_time}-${updated.end_time} ${updated.subject_name}`;
      },
    }),

    tool({
      name: "skip_timetable",
      description: "Boss가 시간표는 나중에 입력하겠다고 할 때 사용합니다.",
      schema: z.object({}),
      run: async () => {
        await mergeDraft(userId, { timetable_skipped: true });
        return "시간표는 나중에 입력하기로 했어요.";
      },
    }),
  ];
}
