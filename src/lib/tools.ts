// NARVIS가 쓸 수 있는 도구들
// 각 도구는 { 이름, 설명, 입력 형식(zod), 실행 함수 } 로 되어 있고,
// groq.ts 가 이걸 Groq(OpenAI 호환) 형식 { type: "function", function: {...} } 으로 바꿔서 보내요.
//
// 보안 포인트: user_id는 AI에게 받지 않아요. 서버가 로그인한 사람의 id를 직접 넣어요.
import * as z from "zod/v4";
import {
  createPendingAction,
  getScheduleForDate,
  listAssignments,
  todayKST,
  type PendingAction,
} from "./store";
import { searchNotices, type NoticeRow } from "./extract";
import { getBriefing, setBriefingPrefs } from "./briefing";

export type Tool = {
  name: string;
  description: string;
  schema: z.ZodObject;
  run: (input: never) => Promise<string>;
};

export function tool<S extends z.ZodObject>(t: {
  name: string;
  description: string;
  schema: S;
  run: (input: z.infer<S>) => Promise<string>;
}): Tool {
  return t as unknown as Tool;
}

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe("YYYY-MM-DD 형식의 날짜");

export function makeTools(
  userId: string,
  pendingSink: PendingAction[],
  noticeSink: NoticeRow[] = [],
  out: { briefing?: string } = {},
): Tool[] {
  return [
    // ---- 읽기 도구 (바로 실행) ----
    tool({
      name: "get_today_schedule",
      description:
        "Boss의 하루 일정을 가져옵니다: 그날의 수업 시간표, 캘린더 일정, 그날 마감인 과제. 날짜를 안 주면 오늘(한국 시간).",
      schema: z.object({ date_override: isoDate.nullish() }),
      run: async ({ date_override }) =>
        JSON.stringify(await getScheduleForDate(userId, date_override ?? todayKST())),
    }),

    tool({
      name: "list_assignments",
      description: "Boss의 과제 목록을 마감일 순서로 가져옵니다.",
      schema: z.object({
        include_completed: z.boolean().nullish().describe("true면 완료한 과제도 포함"),
      }),
      run: async ({ include_completed }) =>
        JSON.stringify(await listAssignments(userId, include_completed ?? false)),
    }),

    tool({
      name: "search_school_notices",
      description:
        "한양여대 공식 홈페이지 공지(수업, 학적·등록, 장학, 학교생활, 현장실습, 취업, 기타)를 검색합니다. 각 공지에 AI가 뽑은 요약과 신청 마감일(application_end)이 있을 수 있어요. 찾은 공지의 링크는 화면에 카드로 자동 표시되니, 답에는 링크를 쓰지 마세요.",
      schema: z.object({
        keyword: z.string().nullish().describe("검색어 (예: 장학금, 휴학, 수강신청). 없으면 최신 공지"),
        category: z
          .enum(["수업", "학적·등록", "장학", "학교생활", "현장실습", "취업", "기타"])
          .nullish(),
        open_only: z
          .boolean()
          .nullish()
          .describe("Boss가 '지금 신청 가능한/마감 임박' 공지를 물을 때만 true. 그냥 '~ 공지 있어?'면 비워둬"),
      }),
      run: async ({ keyword, category, open_only }) => {
        let rows = await searchNotices({ keyword, category, openOnly: open_only, limit: 8 });
        let note = "";
        if (rows.length === 0 && open_only) {
          // 신청 중인 게 없으면 최근 공지라도 보여줘요
          rows = await searchNotices({ keyword, category, limit: 5 });
          note = "지금 신청 가능한 공지는 없어요. 대신 최근 공지(마감 지났을 수 있음): ";
        }
        if (rows.length === 0) return "조건에 맞는 공지가 없어요.";
        for (const r of rows) if (!noticeSink.some((n) => n.id === r.id)) noticeSink.push(r);
        const today = todayKST();
        return note + JSON.stringify(
          rows.map((r) => ({
            deadline_passed: r.structured_data?.application_end ? r.structured_data.application_end < today : null,
            category: r.category,
            title: r.title,
            posted_at: r.posted_at,
            summary: r.structured_data?.summary ?? null,
            application_end: r.structured_data?.application_end ?? null,
            eligibility: r.structured_data?.eligibility ?? null,
          })),
        );
      },
    }),

    tool({
      name: "get_morning_briefing",
      description:
        "오늘의 아침 브리핑(수업, 일정, 출발 시각, 곧 마감인 과제, 학교 공지 요약)을 가져옵니다. '브리핑 해줘', '오늘 뭐 있어?' 같은 요청에 사용.",
      schema: z.object({ refresh: z.boolean().nullish().describe("true면 최신 정보로 다시 만들기") }),
      run: async ({ refresh }) => {
        const r = await getBriefing(userId, { ignoreTime: true, force: refresh ?? false });
        if (r.status !== "ready") return "브리핑을 만들 수 없어요.";
        out.briefing = r.briefing.spoken; // 화면에는 이 문장을 그대로 보여줘요 (AI가 바꿔 말하다 틀리지 않게)
        return JSON.stringify({ spoken: r.briefing.spoken, leave_by: r.briefing.leave_by, briefing_time: r.briefing_time });
      },
    }),

    tool({
      name: "set_briefing_preferences",
      description: "아침 브리핑 시간을 바꾸거나 켜고 끕니다. Boss가 직접 요청한 경우에만 사용.",
      schema: z.object({
        briefing_time: z
          .string()
          .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
          .nullish()
          .describe("HH:MM 24시간 (예: 07:30)"),
        enabled: z.boolean().nullish().describe("false면 브리핑 끄기"),
      }),
      run: async (input) => {
        await setBriefingPrefs(userId, input);
        return `설정 완료: ${input.briefing_time ? `브리핑 시간 ${input.briefing_time}` : ""}${input.enabled === false ? " 브리핑 끔" : input.enabled ? " 브리핑 켬" : ""}`;
      },
    }),

    // ---- 변경 도구 (바로 저장하지 않고 Boss 승인 대기) ----
    tool({
      name: "propose_add_assignment",
      description:
        "새 과제 추가를 '제안'합니다. 바로 저장되지 않고 Boss가 화면에서 승인 버튼을 눌러야 저장됩니다.",
      schema: z.object({
        subject_name: z.string().describe("과목 이름"),
        title: z.string().describe("과제 제목"),
        due_date: z
          .string()
          .describe("마감 날짜시간, ISO 형식 + 한국 시간대 (예: 2026-11-10T23:59:00+09:00)"),
      }),
      run: async (input) => {
        if (Number.isNaN(Date.parse(input.due_date))) {
          return "오류: due_date 형식이 잘못됐어요. 예: 2026-11-10T23:59:00+09:00";
        }
        const action = await createPendingAction(userId, {
          kind: "add_assignment",
          summary: `과제 추가 · ${input.subject_name} · ${input.title} (마감 ${input.due_date})`,
          data: input,
        });
        pendingSink.push(action);
        return "Boss 승인 대기 중으로 등록했습니다. 아직 저장되지 않았습니다.";
      },
    }),

    tool({
      name: "propose_add_calendar_event",
      description:
        "새 일정 추가를 '제안'합니다. 바로 저장되지 않고 Boss가 화면에서 승인 버튼을 눌러야 저장됩니다.",
      schema: z.object({
        title: z.string(),
        start_time: z.string().describe("시작, ISO 형식 + 한국 시간대"),
        end_time: z.string().describe("끝, ISO 형식 + 한국 시간대"),
        location: z.string().nullish(),
      }),
      run: async (input) => {
        if (Number.isNaN(Date.parse(input.start_time)) || Number.isNaN(Date.parse(input.end_time))) {
          return "오류: 시간 형식이 잘못됐어요. 예: 2026-11-10T14:00:00+09:00";
        }
        const action = await createPendingAction(userId, {
          kind: "add_calendar_event",
          summary: `일정 추가 · ${input.title} (${input.start_time} ~ ${input.end_time})`,
          data: { ...input, location: input.location ?? null },
        });
        pendingSink.push(action);
        return "Boss 승인 대기 중으로 등록했습니다. 아직 저장되지 않았습니다.";
      },
    }),
  ];
}
