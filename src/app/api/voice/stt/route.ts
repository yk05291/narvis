// 음성 → 글자 (STT): 브라우저에서 녹음한 소리를 Groq Whisper로 받아쓰기
const GROQ_STT = "https://api.groq.com/openai/v1/audio/transcriptions";
const MAX_BYTES = 4 * 1024 * 1024; // Vercel 요청 한도(4.5MB)보다 작게

// 조용한 소리를 넣으면 Whisper가 가끔 지어내는 문장들 → 무시
const HALLUCINATIONS = [/시청해\s*주셔서\s*감사/, /구독과\s*좋아요/, /^\s*(감사합니다|MBC 뉴스.*)\.?\s*$/];

export async function POST(req: Request) {
  if (!process.env.GROQ_API_KEY) return Response.json({ error: "GROQ_API_KEY 없음" }, { status: 500 });

  let audio: File | null = null;
  try {
    const form = await req.formData();
    const f = form.get("audio");
    audio = f instanceof File ? f : null;
  } catch {
    /* 아래에서 처리 */
  }
  if (!audio || audio.size === 0) return Response.json({ error: "녹음 파일이 없어요." }, { status: 400 });
  if (audio.size > MAX_BYTES) return Response.json({ error: "녹음이 너무 길어요 (30초 이내로)." }, { status: 413 });

  const body = new FormData();
  body.append("file", audio, audio.name || "speech.webm");
  body.append("model", "whisper-large-v3-turbo");
  body.append("language", "ko");
  body.append("response_format", "json");
  body.append("temperature", "0");
  // 자주 나오는 단어를 미리 알려주면 더 잘 알아들어요
  body.append("prompt", "NARVIS, 한양여대, 시간표, 과제, 일정, 장학금, 수강신청, 휴학, 공지");

  const res = await fetch(GROQ_STT, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    console.error("stt error", res.status, text.slice(0, 300));
    return Response.json(
      { error: res.status === 429 ? "음성 인식 사용량이 잠깐 다 찼어요. 잠시 후 다시 시도해 주세요." : "음성 인식에 실패했어요." },
      { status: res.status === 429 ? 429 : 502 },
    );
  }
  const data = (await res.json()) as { text?: string };
  let text = (data.text ?? "").trim();
  if (HALLUCINATIONS.some((r) => r.test(text))) text = "";
  return Response.json({ text });
}
