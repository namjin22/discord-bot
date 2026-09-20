/**
 * 기존 Python 코드의 `KST = timezone(timedelta(hours=9))` 처리를 이식한 모듈.
 *
 * Workers 런타임의 로컬 타임존은 항상 UTC이므로, 타임스탬프를 9시간 앞당긴 뒤
 * UTC 게터(getUTC*, toISOString)로 읽으면 KST 벽시계 값이 그대로 나온다.
 */

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function kstShifted(at: number = Date.now()): Date {
  return new Date(at + KST_OFFSET_MS);
}

/** KST 기준 오늘 날짜 (YYYY-MM-DD) — database.py의 _today() */
export function kstToday(): string {
  return kstShifted().toISOString().slice(0, 10);
}

/** KST 기준 이번 달 (YYYY-MM) — database.py의 _year_month() */
export function kstYearMonth(): string {
  return kstShifted().toISOString().slice(0, 7);
}

export function kstYear(): number {
  return kstShifted().getUTCFullYear();
}

export function kstMonth(): number {
  return kstShifted().getUTCMonth() + 1;
}

/** "2026년 09월" */
export function kstYearMonthLabel(): string {
  return `${kstYear()}년 ${String(kstMonth()).padStart(2, "0")}월`;
}

/** "2026년 09월 20일" */
export function kstDateLabel(): string {
  const day = String(kstShifted().getUTCDate()).padStart(2, "0");
  return `${kstYearMonthLabel()} ${day}일`;
}

/**
 * 관리자가 횟수를 조정할 때 오늘 인증 여부와 충돌하지 않도록 오늘이 아닌 날짜를 반환.
 * database.py의 _admin_date()와 동일한 규칙:
 *   - 오늘이 2일 이상이면 이번 달 1일
 *   - 오늘이 1일이면 어제(= 지난달 말일)
 */
export function adminDate(): string {
  if (kstShifted().getUTCDate() > 1) {
    return `${kstYearMonth()}-01`;
  }
  return kstShifted(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
