"use client";

// 온보딩 중에 모은 정보를 실시간으로 보여주는 HUD 패널
export type ClassItem = {
  subject_name: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  classroom?: string | null;
};
export type Draft = {
  boss_title?: string | null;
  department?: string | null;
  grade?: number | null;
  semester?: number | null;
  wake_up_time?: string | null;
  sleep_time?: string | null;
  commute_minutes?: number | null;
  briefing_time?: string | null;
  classes?: ClassItem[];
  timetable_skipped?: boolean;
};
export type Onboarding = { step: "collecting" | "confirm" | "done"; draft: Draft; missing: string[] };

const DAYS = ["", "월", "화", "수", "목", "금", "토", "일"];

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  const empty = value === null || value === undefined || value === "";
  return (
    <div className="flex justify-between gap-3 border-b border-cyan-400/10 py-1.5 text-sm">
      <span className="text-cyan-100/50">{label}</span>
      <span className={empty ? "font-mono text-xs text-cyan-100/30" : "text-cyan-50"}>{empty ? "—" : value}</span>
    </div>
  );
}

export default function CalibrationPanel({
  ob,
  busy,
  onAction,
}: {
  ob: Onboarding;
  busy: boolean;
  onAction: (a: "confirm" | "edit") => void;
}) {
  const d = ob.draft;
  const filled = 4 - ob.missing.filter((m) => !m.startsWith("시간표")).length;
  const pct = Math.round(((filled + (d.classes?.length || d.timetable_skipped ? 1 : 0)) / 5) * 100);
  const classes = [...(d.classes ?? [])].sort(
    (a, b) => a.day_of_week - b.day_of_week || a.start_time.localeCompare(b.start_time),
  );

  return (
    <section className={`glass w-full p-4 ${ob.step === "confirm" ? "ring-1 ring-cyan-300" : ""}`}>
      <div className="mb-3 flex items-center justify-between font-mono text-xs tracking-widest">
        <span className="text-cyan-300">
          {ob.step === "confirm" ? "CALIBRATION // 확인해 주세요" : "CALIBRATION // 프로필 설정 중"}
        </span>
        <span className="text-cyan-100/50">{pct}%</span>
      </div>
      <div className="mb-3 h-1 w-full overflow-hidden rounded bg-cyan-400/10">
        <div className="h-full bg-cyan-300 transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>

      <div className="grid gap-x-6">
        <div>
          <Row label="호칭" value={d.boss_title} />
          <Row label="학과" value={d.department} />
          <Row label="학년 · 학기" value={d.grade && d.semester ? `${d.grade}학년 ${d.semester}학기` : d.grade ? `${d.grade}학년` : null} />
        </div>
        <div>
          <Row label="기상 / 취침" value={d.wake_up_time || d.sleep_time ? `${d.wake_up_time ?? "?"} / ${d.sleep_time ?? "?"}` : null} />
          <Row label="통학" value={d.commute_minutes != null ? `${d.commute_minutes}분` : null} />
          <Row label="아침 브리핑" value={d.briefing_time ?? "08:00 (기본)"} />
          <Row label="시간표" value={d.timetable_skipped ? "나중에 입력" : classes.length ? `${classes.length}개 수업` : null} />
        </div>
      </div>

      {classes.length > 0 && (
        <ul className="mt-3 grid gap-1 text-xs">
          {classes.map((c, i) => (
            <li key={i} className="rounded border border-cyan-400/15 px-2 py-1">
              <span className="text-cyan-300">{DAYS[c.day_of_week]}</span> {c.start_time}–{c.end_time} {c.subject_name}
              {c.classroom && <span className="text-cyan-100/40"> · {c.classroom}</span>}
            </li>
          ))}
        </ul>
      )}

      {ob.step === "confirm" && (
        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          <span className="mr-auto text-xs text-cyan-100/60">이대로 저장할까요? 시간표는 이 내용으로 바뀌어요.</span>
          <button className="btn btn-no" disabled={busy} onClick={() => onAction("edit")}>
            계속 수정
          </button>
          <button className="btn btn-ok" disabled={busy} onClick={() => onAction("confirm")}>
            확인 · 저장
          </button>
        </div>
      )}
    </section>
  );
}
