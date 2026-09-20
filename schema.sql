-- 기존 SQLite(writing_bot.db) 스키마를 그대로 옮긴 것입니다.
CREATE TABLE IF NOT EXISTS writing_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    username TEXT NOT NULL,
    write_date TEXT NOT NULL,
    year_month TEXT NOT NULL
);

-- 기존 버전에는 없던 인덱스입니다.
-- D1 무료 티어는 "읽은 행 수"로 과금/제한되기 때문에, 풀스캔을 막아 사용량을 크게 줄여줍니다.
CREATE INDEX IF NOT EXISTS idx_writing_records_year_month ON writing_records (year_month);
CREATE INDEX IF NOT EXISTS idx_writing_records_write_date ON writing_records (write_date);
CREATE INDEX IF NOT EXISTS idx_writing_records_user_date ON writing_records (user_id, write_date);
CREATE INDEX IF NOT EXISTS idx_writing_records_user_month ON writing_records (user_id, year_month);
