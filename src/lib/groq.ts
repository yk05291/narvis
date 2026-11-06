// Groq 두뇌: 대화를 보내고, AI가 도구를 쓰겠다고 하면 실행해서 결과를 돌려주는 반복(loop)
// Groq는 OpenAI와 같은 형식(chat/completions)을 써요.
import "server-only";
import * as z from "zod/v4";
import type { Tool } from "./tools";

const URL = "https://api.groq.com/openai/v1/chat/completions";

// 무료 한도(분당 토큰)에 걸리면(429) 다음 모델로 자동 전환
const MODEL_CHAIN = process.env.GROQ_MODEL
  ? [process.env.GROQ_MODEL]
  : ["openai/gpt-oss-120b", "qwen/qwen3.8-27b", "openai/gpt-oss-20b"];

type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
export type GroqMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

type AssistantMessage = { content: string | null; tool_calls?: ToolCall[] };

export class GroqError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function toGroqTools(tools: Tool[]) {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: z.toJSONSchema(t.schema),
    },
  }));
}

function modelOptions(model: string) {
  // gpt-oss는 먼저 생각하고 답하는 모델 — 생각은 짧게, 화면엔 안 보이게
  if (model.startsWith("openai/gpt-oss")) return { reasoning_effort: "low", include_reasoning: false };
  if (model.startsWith("qwen/")) return { reasoning_effort: "none", reasoning_format: "hidden" };
  return {};
}

// Groq 한 번 호출 (모델 자동 전환 포함)
export async function callGroq(
  messages: GroqMessage[],
  extra: Record<string, unknown> = {},
  models: string[] = MODEL_CHAIN,
): Promise<AssistantMessage> {
  if (!process.env.GROQ_API_KEY) throw new GroqError(401, "GROQ_API_KEY 없음");
  let lastError: GroqError | null = null;
  // 같은 모델로 한 번 더 시도(형식 실수는 다시 하면 대개 성공) → 그래도 안 되면 다음 모델
  const attempts = models.flatMap((m) => [m, m]);
  for (const [i, model] of attempts.entries()) {
    if (i % 2 === 1 && lastError?.status === 429) continue; // 한도 초과면 같은 모델 재시도는 의미 없음
    if (i % 2 === 1 && lastError?.status === 404) continue;
    const res = await fetch(URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        max_completion_tokens: 1000,
        ...modelOptions(model),
        ...extra,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      const u = data.usage ?? {};
      console.log(`groq ok ${model} prompt=${u.prompt_tokens} completion=${u.completion_tokens}`);
      return data.choices[0].message as AssistantMessage;
    }
    const text = await res.text();
    lastError = new GroqError(res.status, text.slice(0, 300));
    // 429(한도 초과), 모델 없음(404), 도구/JSON 형식 실수면 다음 모델로
    const retryable =
      res.status === 429 ||
      res.status === 404 ||
      (res.status === 400 && /tool_use_failed|json_validate_failed/.test(text));
    if (!retryable) throw lastError;

    // 한도 초과인데 "몇 초만 기다려"라고 하면, 약한 모델로 바꾸기 전에 기다렸다가 같은 모델로 다시
    if (res.status === 429 && i % 2 === 0) {
      const wait = Number(res.headers.get("retry-after"));
      if (Number.isFinite(wait) && wait > 0 && wait <= 12) {
        console.error(`groq 429 on ${model} → ${wait}초 기다렸다 재시도`);
        await new Promise((r) => setTimeout(r, wait * 1000 + 300));
        lastError = null; // 같은 모델 재시도 허용
        continue;
      }
    }
    console.error(`groq ${res.status} on ${model} → 다음 시도`, text.slice(0, 300));
  }
  throw lastError ?? new GroqError(500, "모델 목록이 비어 있어요");
}

export async function runAgent(
  system: string,
  history: GroqMessage[],
  tools: Tool[],
  maxRounds = 6,
): Promise<string> {
  const messages: GroqMessage[] = [{ role: "system", content: system }, ...history];
  const groqTools = toGroqTools(tools);

  for (let round = 0; round < maxRounds; round++) {
    const msg = await callGroq(messages, { tools: groqTools, tool_choice: "auto" });
    if (!msg.tool_calls?.length) return (msg.content ?? "").trim();

    messages.push({ role: "assistant", content: msg.content, tool_calls: msg.tool_calls });

    for (const call of msg.tool_calls) {
      const t = tools.find((x) => x.name === call.function.name);
      let result: string;
      if (!t) {
        result = `오류: ${call.function.name} 라는 도구는 없어요.`;
      } else {
        // AI가 보낸 입력은 믿지 않고 형식 검사부터
        let raw: unknown;
        try {
          raw = JSON.parse(call.function.arguments || "{}");
        } catch {
          raw = null;
        }
        const parsed = t.schema.safeParse(raw);
        try {
          result = parsed.success
            ? await t.run(parsed.data as never)
            : `오류: 입력 형식이 잘못됐어요. ${parsed.error?.message ?? ""}`;
        } catch (e) {
          console.error("tool error", t.name, e);
          result = "오류: 도구 실행 중 문제가 생겼어요.";
        }
      }
      // 어떤 도구를 썼는지 기록 (입력 내용은 개인정보일 수 있어서 개발 모드에서만)
      if (process.env.NODE_ENV !== "production") console.log(`tool ${call.function.name} ${call.function.arguments} → ${result.slice(0, 80)}`);
      else console.log(`tool ${call.function.name}`);
      messages.push({ role: "tool", tool_call_id: call.id, content: result });
    }
  }
  return "죄송해요 Boss, 처리가 너무 길어져서 멈췄어요. 다시 한 번 말씀해 주세요.";
}
