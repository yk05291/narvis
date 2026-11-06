// 지금 날짜·시간 (한국 시간) — 모든 AI 요청에 자동으로 넣어서, 말 안 해도 '오늘'을 알게 해요
const DAYS = ["일", "월", "화", "수", "목", "금", "토"];

export function todayKST(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date()); // "2026-11-06"
}

function kstParts(d = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      hour12: false,
      weekday: "short",
    })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, min: +p.minute, dow };
}

// "2026년 11월 6일 금요일 오전 11시 7분"
export function nowLabelKST(d = new Date()) {
  const t = kstParts(d);
  const ampm = t.h < 12 ? "오전" : "오후";
  const h12 = t.h % 12 === 0 ? 12 : t.h % 12;
  return `${t.y}년 ${t.m}월 ${t.d}일 ${DAYS[t.dow]}요일 ${ampm} ${h12}시 ${t.min}분`;
}

// 이번 주 월요일부터 3주치 날짜+요일 표 ("이번 주 수요일", "다음주 월요일" 계산용)
export function calendarTable() {
  const today = new Date(`${todayKST()}T12:00:00+09:00`);
  const dow = (today.getUTCDay() + 6) % 7; // 월=0 ... 일=6
  const monday = new Date(today.getTime() - dow * 86400000);
  const weekName = ["이번 주", "다음 주", "다다음 주"];
  return Array.from({ length: 21 }, (_, i) => {
    const d = new Date(monday.getTime() + i * 86400000);
    const iso = d.toISOString().slice(0, 10);
    const tag = i === dow ? " ← 오늘" : i === dow + 1 ? " (내일)" : i === dow + 2 ? " (모레)" : i < dow ? " (지남)" : "";
    return `${i % 7 === 0 ? `  [${weekName[i / 7]}]\n` : ""}  ${iso} (${DAYS[d.getUTCDay()]})${tag}`;
  }).join("\n");
}

// 모든 시스템 프롬프트 맨 앞에 붙는 '지금' 정보
export function nowContext() {
  return `[지금] ${nowLabelKST()} (한국 시간, ${todayKST()}). 사용자가 날짜를 말하지 않아도 '오늘'은 이 날짜야. 날짜·요일·시간 질문엔 이걸로 바로 답해.
[달력] 주는 월요일 시작. "내일", "이번 주 수요일", "다음주 월요일" 같은 날짜는 반드시 이 표에서 찾아:
${calendarTable()}`;
}
