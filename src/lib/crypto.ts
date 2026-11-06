// 토큰 암호화 (AES-256-GCM)
// 키(ENCRYPTION_SECRET_KEY)는 Vercel 환경변수에만 있고, 브라우저로는 절대 안 가요.
import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

function key() {
  const raw = process.env.ENCRYPTION_SECRET_KEY;
  if (!raw) throw new Error("ENCRYPTION_SECRET_KEY 가 없어요");
  const k = Buffer.from(raw, "base64");
  if (k.length !== 32) throw new Error("ENCRYPTION_SECRET_KEY 는 32바이트(base64)여야 해요");
  return k;
}

// 결과 형식: "iv.tag.암호문" (모두 base64)
export function encrypt(plain: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64")).join(".");
}

export function decrypt(packed: string) {
  const [iv, tag, data] = packed.split(".").map((s) => Buffer.from(s, "base64"));
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
