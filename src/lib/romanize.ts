// 한글 이름 → 영어 표기 (국어의 로마자 표기법, 간단 버전). 예: "다혜님" → "Dahye"
const INITIAL = ["g", "kk", "n", "d", "tt", "r", "m", "b", "pp", "s", "ss", "", "j", "jj", "ch", "k", "t", "p", "h"];
const MEDIAL = ["a", "ae", "ya", "yae", "eo", "e", "yeo", "ye", "o", "wa", "wae", "oe", "yo", "u", "wo", "we", "wi", "yu", "eu", "ui", "i"];
const FINAL = ["", "k", "k", "k", "n", "n", "n", "t", "l", "l", "l", "l", "l", "l", "l", "l", "m", "p", "p", "t", "t", "ng", "t", "t", "k", "t", "p", "t"];

export function romanizeName(title: string) {
  const name = title.trim().replace(/\s*(님|씨|양|군|선배|후배)$/u, "");
  if (!/[가-힣]/.test(name)) return name || "Boss"; // 이미 영어면 그대로
  let out = "";
  for (const ch of name) {
    const c = ch.charCodeAt(0) - 0xac00;
    if (c < 0 || c > 11171) {
      out += ch;
      continue;
    }
    out += INITIAL[Math.floor(c / 588)] + MEDIAL[Math.floor((c % 588) / 28)] + FINAL[c % 28];
  }
  return out.charAt(0).toUpperCase() + out.slice(1);
}

// 시간대별 영어 인사 (한국 시간)
export function englishGreeting(title: string, d = new Date()) {
  const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", hour12: false }).format(d)) % 24;
  const part = h < 5 ? "evening" : h < 12 ? "morning" : h < 18 ? "afternoon" : "evening";
  return `Good ${part}, ${romanizeName(title)}. I'm listening.`;
}
