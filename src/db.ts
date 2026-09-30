/**
 * database.py를 D1로 이식한 모듈.
 * 테이블 스키마와 쿼리는 기존 SQLite 버전과 동일하다(D1 자체가 SQLite라 SQL은 그대로 쓴다).
 */

import { adminDate, kstToday, kstYearMonth } from "./kst.ts";

export interface StatRow {
  user_id: string;
  username: string;
  count: number;
}

/** 관리자 명령으로 한 번에 설정할 수 있는 최대 횟수. D1 배치 한도를 넘기는 오타를 막는다. */
export const MAX_SET_COUNT = 500;

export async function hasWrittenToday(db: D1Database, userId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 FROM writing_records WHERE user_id = ? AND write_date = ?")
    .bind(userId, kstToday())
    .first();
  return row !== null;
}

export async function addWriting(
  db: D1Database,
  userId: string,
  username: string,
  writeDate?: string,
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO writing_records (user_id, username, write_date, year_month) VALUES (?, ?, ?, ?)",
    )
    .bind(userId, username, writeDate ?? kstToday(), kstYearMonth())
    .run();
}

/** 관리자용: 이번 달 기록을 count건 한 번에 추가 (write_date는 addCount와 동일하게 adminDate() 사용) */
export async function addWritingBulk(
  db: D1Database,
  userId: string,
  username: string,
  count: number,
): Promise<void> {
  const writeDate = adminDate();
  const yearMonth = kstYearMonth();
  const insert = db.prepare(
    "INSERT INTO writing_records (user_id, username, write_date, year_month) VALUES (?, ?, ?, ?)",
  );

  const statements: D1PreparedStatement[] = [];
  for (let i = 0; i < count; i++) {
    statements.push(insert.bind(userId, username, writeDate, yearMonth));
  }

  await db.batch(statements);
}

/**
 * 관리자용: 최대 count건 제거. 오늘 날짜 기록을 우선 지우고, 모자라면 이번 달 기록 중
 * 최근 것부터 채운다. 실제로 지워진 건수를 반환한다(기록이 부족하면 count보다 작을 수 있음).
 */
export async function removeWriting(
  db: D1Database,
  userId: string,
  count: number,
): Promise<number> {
  const { results } = await db
    .prepare(
      `SELECT id FROM writing_records
       WHERE user_id = ? AND year_month = ?
       ORDER BY (write_date = ?) DESC, write_date DESC, id DESC
       LIMIT ?`,
    )
    .bind(userId, kstYearMonth(), kstToday(), count)
    .all<{ id: number }>();

  if (results.length === 0) return 0;

  const del = db.prepare("DELETE FROM writing_records WHERE id = ?");
  await db.batch(results.map((row) => del.bind(row.id)));
  return results.length;
}

/** 특정 달(또는 이번 달) 전체 멤버 글 작성 횟수 */
export async function getMonthlyStats(db: D1Database, yearMonth?: string): Promise<StatRow[]> {
  const { results } = await db
    .prepare(
      `SELECT user_id, username, COUNT(*) as count
       FROM writing_records
       WHERE year_month = ?
       GROUP BY user_id
       ORDER BY count DESC, username ASC`,
    )
    .bind(yearMonth ?? kstYearMonth())
    .all<StatRow>();
  return results;
}

/** 전체 기간 누적 글 작성 횟수 */
export async function getCumulativeStats(db: D1Database): Promise<StatRow[]> {
  const { results } = await db
    .prepare(
      `SELECT user_id, username, COUNT(*) as count
       FROM writing_records
       GROUP BY user_id
       ORDER BY count DESC, username ASC`,
    )
    .all<StatRow>();
  return results;
}

/** 이번 달 기록을 모두 지우고 count만큼 새로 삽입 */
export async function setWritingCount(
  db: D1Database,
  userId: string,
  username: string,
  count: number,
): Promise<void> {
  const past = adminDate();
  const yearMonth = kstYearMonth();

  const statements: D1PreparedStatement[] = [
    db
      .prepare("DELETE FROM writing_records WHERE user_id = ? AND year_month = ?")
      .bind(userId, yearMonth),
  ];

  const insert = db.prepare(
    "INSERT INTO writing_records (user_id, username, write_date, year_month) VALUES (?, ?, ?, ?)",
  );
  for (let i = 0; i < count; i++) {
    statements.push(insert.bind(userId, username, past, yearMonth));
  }

  await db.batch(statements);
}

/** 오늘 글을 작성한 user_id 집합 */
export async function getTodayWriters(db: D1Database): Promise<Set<string>> {
  const { results } = await db
    .prepare("SELECT DISTINCT user_id FROM writing_records WHERE write_date = ?")
    .bind(kstToday())
    .all<{ user_id: string }>();
  return new Set(results.map((r) => r.user_id));
}
