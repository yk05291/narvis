// NARVIS 대화 API: 화면에서 보낸 대화를 Groq에게 전달하고, 도구를 쓰게 한 뒤 답을 돌려줘요.
import { makeTools } from "@/lib/tools";
import { runAgent, GroqError } from "@/lib/groq";
import { getProfile, type PendingAction } from "@/lib/store";
import { nowContext } from "@/lib/time";
import type { NoticeRow } from "@/lib/extract";
import { listMemories, memoriesForPrompt } from "@/lib/memories";

// 1단계: 로그인 기능이 없으니 사용자 한 명으로 고정. (나중에 Supabase 로그인으로 교체)
const USER_ID = "local-boss";

type ChatTurn = { role: "user" | "assistant"; text: string };

// 답할 때 쓴 도구 → 화면 가운데로 꺼낼 패널 (Focus Mode). 마지막에 쓴 것 우선.
const FOCUS_BY_TOOL: Record<string, "briefing" | "schedule" | "study" | "notices" | "memory"> = {
  get_morning_briefing: "briefing",
  get_today_schedule: "schedule",
  propose_add_calendar_event: "schedule",
  list_assignments: "study",
  complete_assignment: "study",
  propose_add_assignment: "study",
  search_school_notices: "notices",
  forget_memory: "memory",
};

export async function POST(req: Request) {
  let turns: ChatTurn[];
  try {
    ({ turns } = (await req.json()) as { turns: ChatTurn[] });
    if (!Array.isArray(turns) || turns.length === 0) throw new Error();
  } catch {
    return Response.json({ error: "잘못된 요청이에요." }, { status: 400 });
  }

  if (!process.env.GROQ_API_KEY?.startsWith("gsk_")) {
    return Response.json(
      { error: "Groq API 키가 아직 없어요. narvis 폴더의 .env.local 파일에 GROQ_API_KEY 를 넣고 서버를 다시 켜 주세요." },
      { status: 500 },
    );
  }

  const [profile, memories] = await Promise.all([getProfile(USER_ID), listMemories(USER_ID)]);
  const pending: PendingAction[] = [];
  const notices: NoticeRow[] = [];
  const out: { briefing?: string } = {};
  const used: string[] = [];

  const about = [
    profile.department && `학과: ${profile.department}`,
    profile.grade && `${profile.grade}학년`,
    profile.semester && `${profile.semester}학기`,
    profile.wake_up_time && `기상 ${profile.wake_up_time.slice(0, 5)}`,
    profile.sleep_time && `취침 ${profile.sleep_time.slice(0, 5)}`,
    profile.commute_minutes != null && `통학 ${profile.commute_minutes}분`,
  ]
    .filter(Boolean)
    .join(", ");

  const system = `${nowContext()}

너는 NARVIS, ${profile.boss_title}의 개인 AI 비서야. 사용자는 한양여자대학교 학생이고, 항상 "${profile.boss_title}"라고 불러.
- ${profile.boss_title}에 대해 아는 것: ${about || "아직 없음"}. 공지를 찾을 때 학년·학과에 맞는 걸 먼저 알려주고, 아침 일정은 통학 시간을 고려해 조언해.
- 반드시 한국어로 짧고 명확하게 대답해. 화면이 마크다운을 못 보여주니 ** 같은 기호는 쓰지 말고 줄바꿈과 "-"만 써.
- 날짜를 말할 땐 요일도 [달력] 표 그대로.
- 일정·과제 질문에는 추측하지 말고 도구로 확인해.
- get_today_schedule 결과에서 classes 는 시간표(구글과 무관), google_events 는 구글 캘린더 일정이야. 구글이 연결 안 됐다는 말은 사용자가 구글 일정을 물을 때만 해.
- 일정 추가를 승인하면 구글 캘린더가 연결돼 있을 땐 구글 캘린더에 바로 들어가.
- 학교 공지(장학금, 수강, 휴학·복학, 등록, 현장실습, 취업 등) 질문에는 search_school_notices 로 찾아보고 마감일을 함께 알려줘. 링크는 화면에 카드로 자동으로 붙으니 절대 직접 쓰지 마.
- 과제·일정을 추가할 때는 propose_* 도구만 쓸 수 있어. 그건 "제안"일 뿐이고, ${profile.boss_title}가 화면의 승인 버튼을 눌러야 저장된다고 꼭 알려줘. 절대 "저장했다"고 말하지 마.
- "브리핑 해줘", "오늘 하루 정리해줘"면 get_morning_briefing 결과의 spoken 문장을 거의 그대로 전해줘. 브리핑 시간 변경 요청은 set_briefing_preferences.
- ${profile.boss_title}가 동의해서 기억하고 있는 것 (추천·조언할 때 자연스럽게 반영해. 단, 매번 "기억하고 있어요"라고 티 내지는 마):
${memoriesForPrompt(memories)}
- ${profile.boss_title}가 오래 유효한 취향·사정을 말하면 propose_memory 로 기억을 제안할 수 있어 (한 대화에 최대 1개). 제안했으면 "기억해도 될지 화면에서 골라주세요"라고 짧게 말해. 저장됐다고 말하지 마. 이미 기억 목록에 같은 내용이 있으면 제안하지 마.
- "잊어줘/지워줘"라고 하면 되묻지 말고 바로 forget_memory 를 호출하고, 결과대로 "잊었어요"라고 말해.
- 날짜나 시간이 애매하면 먼저 물어봐.`;

  try {
    const reply = await runAgent(
      system,
      turns.map((t) => ({ role: t.role, content: t.text })),
      makeTools(USER_ID, pending, notices, out),
      6,
      used,
    );
    const focus = [...used].reverse().map((t) => FOCUS_BY_TOOL[t]).find(Boolean) ?? null;
    // 브리핑을 요청했으면 AI가 바꿔 말한 문장 대신, 데이터로 만든 브리핑 문장을 그대로
    const finalReply = out.briefing ?? reply;
    return Response.json({ reply: finalReply || "(응답 없음)", pending, notices: notices.slice(0, 8), focus });
  } catch (err) {
    if (err instanceof GroqError) {
      const msg =
        err.status === 401
          ? "Groq API 키가 잘못됐어요. .env.local 의 GROQ_API_KEY 를 확인해 주세요."
          : err.status === 429
            ? "무료 사용량이 잠깐 다 찼어요. 1분쯤 뒤에 다시 시도해 주세요."
            : `Groq 오류 (${err.status})`;
      console.error("groq error", err.status, err.message);
      return Response.json({ error: msg }, { status: err.status === 429 ? 429 : 502 });
    }
    console.error(err);
    return Response.json({ error: "서버 오류가 났어요." }, { status: 500 });
  }
}
