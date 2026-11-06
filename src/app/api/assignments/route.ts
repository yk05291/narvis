// 과제 관리 API (화면에서 Boss가 직접 누르는 동작 → 승인 없이 바로 반영)
// GET    ?all=1           목록 (all=1이면 완료한 것도)
// POST   {subject_name, title, due}   추가 (due: "2026-11-10T23:59" 한국 시간)
// PATCH  {id, done}       완료/되돌리기
// DELETE ?id=             삭제
import { connection, type NextRequest } from "next/server";
import * as z from "zod/v4";
import { createAssignment, deleteAssignment, listAssignments, listSubjects, setAssignmentDone } from "@/lib/store";

const USER_ID = "local-boss";
const uuid = z.string().regex(/^[0-9a-f-]{36}$/);

export async function GET(req: NextRequest) {
  await connection();
  try {
    const all = req.nextUrl.searchParams.get("all") === "1";
    const [assignments, subjects] = await Promise.all([listAssignments(USER_ID, all), listSubjects(USER_ID)]);
    return Response.json({ assignments, subjects });
  } catch (e) {
    console.error(e);
    return Response.json({ error: "과제를 불러오지 못했어요." }, { status: 500 });
  }
}

const NewAssignment = z.object({
  subject_name: z.string().trim().min(1, "과목을 입력해 주세요").max(100, "과목 이름이 너무 길어요"),
  title: z.string().trim().min(1, "과제 제목을 입력해 주세요").max(255, "제목이 너무 길어요"),
  due: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "마감 날짜·시간을 골라 주세요"),
});

export async function POST(req: Request) {
  const parsed = NewAssignment.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "입력을 확인해 주세요." }, { status: 400 });
  }
  const { subject_name, title, due } = parsed.data;
  const due_date = new Date(`${due}:00+09:00`); // 화면에서 고른 시간은 한국 시간
  if (Number.isNaN(due_date.getTime())) return Response.json({ error: "날짜가 이상해요." }, { status: 400 });
  try {
    const a = await createAssignment(USER_ID, { subject_name, title, due_date: due_date.toISOString() });
    return Response.json({ assignment: a });
  } catch (e) {
    console.error(e);
    return Response.json({ error: "저장하지 못했어요." }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  const parsed = z.object({ id: uuid, done: z.boolean() }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "잘못된 요청이에요." }, { status: 400 });
  try {
    const a = await setAssignmentDone(USER_ID, parsed.data.id, parsed.data.done);
    if (!a) return Response.json({ error: "그 과제를 찾지 못했어요." }, { status: 404 });
    return Response.json({ assignment: a });
  } catch (e) {
    console.error(e);
    return Response.json({ error: "바꾸지 못했어요." }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const id = uuid.safeParse(req.nextUrl.searchParams.get("id"));
  if (!id.success) return Response.json({ error: "잘못된 요청이에요." }, { status: 400 });
  try {
    const ok = await deleteAssignment(USER_ID, id.data);
    return Response.json({ ok }, { status: ok ? 200 : 404 });
  } catch (e) {
    console.error(e);
    return Response.json({ error: "지우지 못했어요." }, { status: 500 });
  }
}
