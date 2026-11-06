// 요약 패널 버튼: 확인(진짜 저장) / 계속 수정 / 처음부터 다시 설정
import { confirmOnboarding, getOnboarding, missingFields, restart } from "@/lib/onboarding";

const USER_ID = "local-boss";

export async function POST(req: Request) {
  const { action } = (await req.json().catch(() => ({}))) as { action?: string };
  try {
    let message = "";
    if (action === "confirm") {
      const r = await confirmOnboarding(USER_ID);
      if (!r.ok) return Response.json({ error: r.message }, { status: 400 });
      message = r.message;
    } else if (action === "edit") {
      message = "네, 고칠 부분을 말씀해 주세요. (예: 학년은 3학년이야, 데이터베이스 빼줘)";
    } else if (action === "restart") {
      await restart(USER_ID);
      message = "프로필 재설정을 시작할게요. 지금 저장된 정보를 불러왔어요. 바꾸고 싶은 걸 말씀해 주세요.";
    } else {
      return Response.json({ error: "잘못된 요청이에요." }, { status: 400 });
    }
    const { step, draft } = await getOnboarding(USER_ID);
    return Response.json({ message, step, draft, missing: missingFields(draft) });
  } catch (e) {
    console.error(e);
    return Response.json({ error: "서버 오류가 났어요." }, { status: 500 });
  }
}
