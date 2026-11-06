// 영어 인사 음성 (미국 남성, Groq Orpheus). 실패하면 화면이 브라우저 영어 남성 목소리로 대신 읽어요.
// 짧은 인사용이라 200자까지만.
import * as z from "zod/v4";

const MODEL = "canopylabs/orpheus-v1-english";
const VOICE = process.env.GROQ_TTS_VOICE || "troy"; // 미국 남성

export async function POST(req: Request) {
  const p = z.object({ text: z.string().trim().min(1).max(200) }).safeParse(await req.json().catch(() => null));
  if (!p.success) return Response.json({ error: "잘못된 요청이에요." }, { status: 400 });
  if (!process.env.GROQ_API_KEY) return Response.json({ fallback: true, reason: "no_key" }, { status: 503 });

  const res = await fetch("https://api.groq.com/openai/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, voice: VOICE, input: p.data.text, response_format: "wav" }),
  });
  if (!res.ok) {
    const text = await res.text();
    const reason = /model_terms_required/.test(text) ? "terms_required" : `groq_${res.status}`;
    console.error("tts", reason, text.slice(0, 200));
    return Response.json({ fallback: true, reason }, { status: 503 });
  }
  return new Response(res.body, {
    headers: { "Content-Type": "audio/wav", "Cache-Control": "private, max-age=86400" },
  });
}
