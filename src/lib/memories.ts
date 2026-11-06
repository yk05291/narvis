// 기억: Boss가 '기억하기'에 동의한 것만 저장해요 (consent_given = true)
import "server-only";
import { db, must } from "./db";

export type Memory = { id: string; memory_key: string; memory_value: string; updated_at: string };

export async function listMemories(userId: string): Promise<Memory[]> {
  return must(
    await db()
      .from("memories")
      .select("id, memory_key, memory_value, updated_at")
      .eq("user_id", userId)
      .eq("consent_given", true)
      .order("updated_at", { ascending: false })
      .limit(50),
  ) as Memory[];
}

// 같은 이름표가 있으면 내용을 새로 덮어써요 (예: 알바 시간이 바뀜)
export async function saveMemory(userId: string, key: string, value: string) {
  must(
    await db()
      .from("memories")
      .upsert(
        {
          user_id: userId,
          memory_key: key.trim().slice(0, 100),
          memory_value: value.trim().slice(0, 500),
          consent_given: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,memory_key" },
      ),
  );
}

export async function forgetMemory(userId: string, idOrKey: { id?: string; key?: string }) {
  let q = db().from("memories").delete().eq("user_id", userId);
  if (idOrKey.id) q = q.eq("id", idOrKey.id);
  else if (idOrKey.key) {
    // 이름표나 내용 중 하나라도 맞으면 (예: "매운" → "음식 취향: 매운 음식을 못 먹음")
    const k = idOrKey.key.replace(/[%_,()]/g, " ").trim();
    if (!k) return 0;
    q = q.or(`memory_key.ilike.%${k}%,memory_value.ilike.%${k}%`);
  }
  else return 0;
  const rows = must(await q.select("id")) as { id: string }[];
  return rows.length;
}

// 대화 프롬프트에 넣을 짧은 목록
export function memoriesForPrompt(list: Memory[]) {
  if (list.length === 0) return "아직 없음";
  return list.map((m) => `- ${m.memory_key}: ${m.memory_value}`).join("\n");
}
