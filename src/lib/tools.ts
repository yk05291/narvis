// NARVIS가 쓸 수 있는 도구들
// 각 도구는 { 이름, 설명, 입력 형식(zod), 실행 함수 } 로 되어 있고,
// groq.ts 가 이걸 Groq(OpenAI 호환) 형식 { type: "function", function: {...} } 으로 바꿔서 보내요.
//
// 보안 포인트: user_id는 AI에게 받지 않아요. 서버가 로그인한 사람의 id를 직접 넣어요.
import * as z from "zod/v4";
import {
  createPendingAction,
  completeAssignmentByName,
  getScheduleForDate,
  listAssignments,
  todayKST,
  type PendingAction,
} from "./store";
import { searchNotices, type NoticeRow } from "./extract";
import { getBriefing, setBriefingPrefs } from "./briefing";
import { forgetMemory } from "./memories";
import { CATEGORY_KO, findGoal, listGoals, updateGoal } from "./goals";

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

    tool({
      name: "complete_assignment",
      description:
        "Boss가 과제를 끝냈다고 하면('자료구조 과제 다 했어') 완료로 표시합니다. 화면에서 언제든 되돌릴 수 있어서 승인 없이 바로 반영돼요. 후보가 여러 개면 어느 건지 물어보세요.",
      schema: z.object({ query: z.string().min(1).max(100).describe("과목명이나 과제 제목에 들어간 단어 (예: '자료구조', '연결 리스트')") }),
      run: async ({ query }) => {
        const r = await completeAssignmentByName(userId, query);
        if (r.done) return `완료로 표시했어요: ${r.done.subject_name} · ${r.done.title}`;
        if (r.candidates.length === 0) return "남은 과제가 없어요.";
        return `어느 과제인지 애매해요. 후보: ${r.candidates.map((a) => `${a.subject_name} · ${a.title}`).join(" / ")}`;
      },
    }),

    tool({
      name: "list_goals",
      description: "Boss의 목표(학업·취업·개인)와 진행률을 가져옵니다. '내 목표 어떻게 돼가?' 같은 질문에 사용.",
      schema: z.object({ include_completed: z.boolean().nullish() }),
      run: async ({ include_completed }) => {
        const goals = await listGoals(userId, include_completed ?? false);
        if (goals.length === 0) return "등록된 목표가 없어요.";
        return JSON.stringify(goals.map((g) => ({ category: CATEGORY_KO[g.category], title: g.title, progress: g.progress, target_date: g.target_date, done: g.is_completed })));
      },
    }),

    tool({
      name: "propose_add_goal",
      description: "새 목표 등록을 '제안'합니다. Boss가 화면에서 승인해야 저장돼요. 목표일이 애매하면 비워두세요.",
      schema: z.object({
        category: z.enum(["ACADEMIC", "CAREER", "PERSONAL"]).describe("ACADEMIC=학업(학점·자격증·시험), CAREER=취업(인턴·포트폴리오·지원), PERSONAL=개인(운동·습관)"),
        title: z.string().min(1).max(100).describe("짧은 목표 이름 (예: 정보처리기사 필기 합격)"),
        description: z.string().max(300).nullish().describe("Boss가 직접 말한 내용만. 없으면 비워두기 (추측해서 쓰지 마세요)"),
        target_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().describe("YYYY-MM-DD, [달력] 기준. Boss가 날짜를 정확히 말했을 때만"),
      }),
      run: async (g) => {
        const action = await createPendingAction(userId, {
          kind: "add_goal",
          summary: `목표 추가 · [${CATEGORY_KO[g.category]}] ${g.title}${g.target_date ? ` (목표일 ${g.target_date})` : ""}`,
          data: g,
        });
        pendingSink.push(action);
        return "목표 등록을 제안했어요. Boss가 화면에서 승인해야 저장돼요.";
      },
    }),

    tool({
      name: "update_goal",
      description:
        "목표 진행률을 바꾸거나 달성 처리합니다 ('토익 50%까지 했어', '정처기 붙었어!'). 화면에서 되돌릴 수 있어서 바로 반영돼요. 애매하면 어느 목표인지 물어보세요.",
      schema: z.object({
        query: z.string().min(1).max(60).describe("목표 이름에 들어간 단어 (예: 토익, 정보처리기사)"),
        progress: z.number().int().min(0).max(100).nullish(),
        completed: z.boolean().nullish(),
      }),
      run: async ({ query, progress, completed }) => {
        const r = await findGoal(userId, query);
        if (!r.goal) {
          return r.candidates.length ? `어느 목표인지 애매해요. 후보: ${r.candidates.map((g) => g.title).join(" / ")}` : "진행 중인 목표가 없어요.";
        }
        const g = await updateGoal(userId, r.goal.id, { progress: progress ?? undefined, is_completed: completed ?? undefined });
        return g ? `반영했어요: ${g.title} ${g.is_completed ? "달성! 🎉" : `${g.progress}%`}` : "바꾸지 못했어요.";
      },
    }),

    tool({
      name: "propose_memory",
      description:
        "Boss가 말한 '오래 유효한' 개인 정보·취향을 기억하자고 '제안'합니다 (예: 매운 음식 못 먹음, 화·목 저녁 알바). Boss가 화면에서 '기억하기'를 눌러야 저장돼요. 한 번 쓰고 말 정보(오늘 기분, 오늘 점심 메뉴)나 민감한 정보(건강 상세, 비밀번호, 계좌, 주민번호)는 Boss가 직접 기억해달라고 하지 않으면 제안하지 마세요.",
      schema: z.object({
        key: z.string().min(1).max(40).describe("짧은 이름표 (예: 음식 취향, 아르바이트). 같은 이름표면 내용이 바뀐 걸로 덮어써요"),
        value: z.string().min(1).max(200).describe("기억할 내용 한 문장 (예: 매운 음식을 못 먹음)"),
      }),
      run: async ({ key, value }) => {
        if (pendingSink.some((p) => p.kind === "save_memory")) return "이번 대화에서는 이미 하나 제안했어요. 한 번에 하나만.";
        const action = await createPendingAction(userId, {
          kind: "save_memory",
          summary: `기억 · ${key}: ${value}`,
          data: { key, value },
        });
        pendingSink.push(action);
        return "기억 제안을 화면에 띄웠어요. Boss가 '기억하기'를 눌러야 저장돼요. 아직 기억한 게 아니에요.";
      },
    }),

    tool({
      name: "forget_memory",
      description:
        "Boss가 '잊어줘/지워줘/기억하지 마'라고 하면 되묻지 말고 바로 호출해서 지웁니다. key 에는 기억 목록의 이름표나 내용 속 핵심 단어 하나(예: '음식 취향' 또는 '매운').",
      schema: z.object({ key: z.string().min(1).max(40) }),
      run: async ({ key }) => {
        const n = await forgetMemory(userId, { key });
        return n ? `${n}개 지웠어요.` : "그런 기억은 없어요.";
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
