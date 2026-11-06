// 온보딩 API
// GET  → 지금 상태 (모으는 중 / 확인 대기 / 완료) + 모은 정보
// POST → 온보딩 대화 한 번
import { connection } from "next/server";
import { runAgent, GroqError } from "@/lib/groq";
import { makeOnboardingTools } from "@/lib/onboarding-tools";
import { getOnboarding, missingFields } from "@/lib/onboarding";
import { nowContext } from "@/lib/time";

const USER_ID = "local-boss";
type ChatTurn = { role: "user" | "assistant"; text: string };

async function status() {
  const { step, draft } = await getOnboarding(USER_ID);
  return { step, draft, missing: missingFields(draft) };
}

export async function GET() {
  await connection();
  try {
    return Response.json(await status());
  } catch (e) {
    console.error(e);
    return Response.json({ error: "상태를 불러오지 못했어요." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  let turns: ChatTurn[];
  try {
    ({ turns } = (await req.json()) as { turns: ChatTurn[] });
    if (!Array.isArray(turns) || turns.length === 0) throw new Error();
  } catch {
    return Response.json({ error: "잘못된 요청이에요." }, { status: 400 });
  }

  const before = await status();
  const system = `${nowContext()}

너는 NARVIS, 한양여자대학교 학생의 개인 AI 비서야. 지금은 처음 만나서 '워크스페이스 보정(calibration)' 중이야.
목표: 대화로 아래 정보를 모아서 도구로 임시 저장하기.
- 필수: 호칭(뭐라고 불러줄지), 학과, 학년(1~4), 이번 학기(1 또는 2), 시간표(또는 '나중에')
- 선택: 일어나는 시간, 자는 시간, 통학 시간(분), 아침 브리핑 시간(기본 8시. 일어나는 시간을 알면 그 즈음을 추천) — 한 번만 가볍게 물어보고, 싫다고 하면 넘어가.

규칙:
- 한국어로, 친근하지만 짧게. 한 번에 1~2개만 물어봐. 마크다운 기호(**) 쓰지 마.
- 사용자가 정보를 말하면 바로 save_profile_info / add_classes 로 저장하고, 저장했다고 짧게 확인해.
- 시간표는 "월 10시-12시 자료구조, 수 13시-15시 웹프로그래밍"처럼 편하게 말해달라고 해. 오후 1시는 13:00처럼 24시간으로 바꿔서 저장해. 요일 숫자: 1=월 2=화 3=수 4=목 5=금 6=토 7=일.
- 수업 시간에서 "1시~6시"처럼 오전/오후가 없으면 수업은 보통 낮이니 13:00~18:00으로. 단 9~11시는 오전.
- 자는 시간 "12시", "12시 반", "1시"는 밤이야 → 00:00, 00:30, 01:00. "11시"는 23:00. 일어나는 시간 "7시"는 07:00.
- 이미 넣은 수업의 요일·시간·강의실을 바꿀 땐 update_class 를 써. 과목을 아예 뺄 때만 remove_classes.
- 고쳐달라는 말을 들으면 그 턴에 반드시 도구를 먼저 호출하고, 도구 결과를 보고 "바꿨어요"라고 답해. "수정해 드릴게요"처럼 하겠다는 말만 하고 끝내지 마.
- 애매하면 추측하지 말고 다시 물어봐.
- 필수 정보가 다 모이면 화면에 요약 패널과 '확인' 버튼이 자동으로 떠. 그때 선택 항목을 아직 안 물어봤으면 한 번 물어보고, 그다음 패널을 보고 확인을 눌러달라고 해. 진짜 저장은 확인 버튼을 눌러야 돼.
- 실제로 도구로 저장하지 않은 걸 저장했다고 말하지 마.
- 오늘 날짜·요일·시간 같은 간단한 질문엔 [지금] 정보로 바로 짧게 답하고, 이어서 설정을 계속해.
- 그 밖에 설정과 관계없는 부탁이 오면, 설정을 먼저 끝내자고 부드럽게 말해.

지금까지 임시 저장된 정보: ${JSON.stringify(before.draft)}
아직 빠진 필수 항목: ${before.missing.join(", ") || "없음"}`;

  try {
    const reply = await runAgent(
      system,
      turns.map((t) => ({ role: t.role, content: t.text })),
      makeOnboardingTools(USER_ID),
      8,
    );
    return Response.json({ reply: reply || "(응답 없음)", ...(await status()) });
  } catch (err) {
    if (err instanceof GroqError) {
      const msg = err.status === 429 ? "무료 사용량이 잠깐 다 찼어요. 1분쯤 뒤에 다시 시도해 주세요." : `Groq 오류 (${err.status})`;
      console.error("groq error", err.status, err.message);
      return Response.json({ error: msg }, { status: err.status === 429 ? 429 : 502 });
    }
    console.error(err);
    return Response.json({ error: "서버 오류가 났어요." }, { status: 500 });
  }
}
