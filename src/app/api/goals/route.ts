// 목표 API (화면에서 Boss가 직접 누르는 동작 → 바로 반영)
// GET ?all=1 / POST {category,title,target_date?} / PATCH {id, progress?, done?} / DELETE ?id=
import { connection, type NextRequest } from "next/server";
import * as z from "zod/v4";
import { createGoal, deleteGoal, listGoals, updateGoal } from "@/lib/goals";

const USER_ID = "local-boss";
const uuid = z.string().regex(/^[0-9a-f-]{36}$/);

export async function GET(req: NextRequest) {
  await connection();
  try {
    return Response.json({ goals: await listGoals(USER_ID, req.nextUrl.searchParams.get("all") === "1") });
  } catch (e) {
    console.error(e);
    return Response.json({ error: "목표를 불러오지 못했어요." }, { status: 500 });
  }
}

const NewGoal = z.object({
  category: z.enum(["ACADEMIC", "CAREER", "PERSONAL"], "분류를 골라 주세요"),
  title: z.string().trim().min(1, "목표를 입력해 주세요").max(100, "목표가 너무 길어요"),
  target_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish()
    .or(z.literal("").transform(() => null)),
});

export async function POST(req: Request) {
  const p = NewGoal.safeParse(await req.json().catch(() => null));
  if (!p.success) return Response.json({ error: p.error.issues[0]?.message ?? "입력을 확인해 주세요." }, { status: 400 });
  try {
    return Response.json({ goal: await createGoal(USER_ID, p.data) });
  } catch (e) {
    console.error(e);
    return Response.json({ error: "저장하지 못했어요." }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  const p = z
    .object({ id: uuid, progress: z.number().int().min(0).max(100).optional(), done: z.boolean().optional() })
    .safeParse(await req.json().catch(() => null));
  if (!p.success) return Response.json({ error: "잘못된 요청이에요." }, { status: 400 });
  try {
    const g = await updateGoal(USER_ID, p.data.id, { progress: p.data.progress, is_completed: p.data.done });
    return g ? Response.json({ goal: g }) : Response.json({ error: "그 목표를 찾지 못했어요." }, { status: 404 });
  } catch (e) {
    console.error(e);
    return Response.json({ error: "바꾸지 못했어요." }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const id = uuid.safeParse(req.nextUrl.searchParams.get("id"));
  if (!id.success) return Response.json({ error: "잘못된 요청이에요." }, { status: 400 });
  try {
    const ok = await deleteGoal(USER_ID, id.data);
    return Response.json({ ok }, { status: ok ? 200 : 404 });
  } catch (e) {
    console.error(e);
    return Response.json({ error: "지우지 못했어요." }, { status: 500 });
  }
}
