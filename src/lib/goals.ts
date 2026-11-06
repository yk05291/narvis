// 목표 관리 (학업 / 취업 / 개인)
import "server-only";
import { db, must } from "./db";

export type GoalCategory = "ACADEMIC" | "CAREER" | "PERSONAL";
export const CATEGORY_KO: Record<GoalCategory, string> = { ACADEMIC: "학업", CAREER: "취업", PERSONAL: "개인" };

export type Goal = {
  id: string;
  category: GoalCategory;
  title: string;
  description: string | null;
  target_date: string | null; // YYYY-MM-DD
  progress: number; // 0~100
  is_completed: boolean;
  updated_at: string;
};

const COLS = "id, category, title, description, target_date, progress, is_completed, updated_at";

export async function listGoals(userId: string, includeCompleted = false): Promise<Goal[]> {
  let q = db().from("goals").select(COLS).eq("user_id", userId).order("is_completed").order("target_date", { nullsFirst: false });
  if (!includeCompleted) q = q.eq("is_completed", false);
  return must(await q) as Goal[];
}

export async function createGoal(
  userId: string,
  g: { category: GoalCategory; title: string; description?: string | null; target_date?: string | null },
) {
  return must(
    await db()
      .from("goals")
      .insert({ user_id: userId, ...g, description: g.description ?? null, target_date: g.target_date ?? null })
      .select(COLS)
      .single(),
  ) as Goal;
}

export async function updateGoal(userId: string, id: string, patch: { progress?: number; is_completed?: boolean }) {
  const p: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.progress != null) p.progress = Math.max(0, Math.min(100, Math.round(patch.progress)));
  if (patch.is_completed != null) {
    p.is_completed = patch.is_completed;
    if (patch.is_completed) p.progress = 100;
  }
  const rows = must(await db().from("goals").update(p).eq("user_id", userId).eq("id", id).select(COLS)) as Goal[];
  return rows[0] ?? null;
}

export async function deleteGoal(userId: string, id: string) {
  const rows = must(await db().from("goals").delete().eq("user_id", userId).eq("id", id).select("id")) as { id: string }[];
  return rows.length > 0;
}

// 채팅용: "토익 목표" → 단어로 찾기 (딱 하나일 때만)
export async function findGoal(userId: string, query: string) {
  const open = await listGoals(userId, false);
  const words = query.split(/\s+/).filter((w) => w.length >= 2 && !["목표", "달성", "했어", "완료"].includes(w));
  const scored = open
    .map((g) => ({ g, score: words.filter((w) => g.title.replace(/\s+/g, "").includes(w.replace(/\s+/g, ""))).length }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  const best = scored.filter((x) => x.score === scored[0]?.score).map((x) => x.g);
  return { goal: best.length === 1 ? best[0] : null, candidates: best.length ? best : open };
}

// 대화 프롬프트용 요약
export function goalsForPrompt(list: Goal[]) {
  if (list.length === 0) return "아직 없음";
  return list
    .map((g) => `- [${CATEGORY_KO[g.category]}] ${g.title} (${g.progress}%${g.target_date ? `, 목표일 ${g.target_date}` : ""})`)
    .join("\n");
}
