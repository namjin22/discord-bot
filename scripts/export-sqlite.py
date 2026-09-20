"""기존 SQLite 파일(writing_bot.db)을 D1로 옮길 SQL로 변환한다.

GSM SV에서 내려받은 writing_bot.db를 이 저장소 루트에 두고 실행하세요.

    python scripts/export-sqlite.py               # writing_bot.db -> data/import.sql
    python scripts/export-sqlite.py <db경로>      # 경로 직접 지정

만들어진 파일은 이렇게 D1에 넣습니다.

    npx wrangler d1 execute writing-bot --remote --file=data/import.sql
"""

import pathlib
import sqlite3
import sys

# 윈도우 콘솔에서 한글이 깨지지 않도록
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

SOURCE = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "writing_bot.db")
OUTPUT = pathlib.Path("data/import.sql")

if not SOURCE.exists():
    sys.exit(f"'{SOURCE}' 파일이 없습니다. GSM SV에서 writing_bot.db를 먼저 내려받아 주세요.")


def quote(value: str) -> str:
    escaped = value.replace("'", "''")
    return f"'{escaped}'"


connection = sqlite3.connect(SOURCE)
rows = connection.execute(
    "SELECT id, user_id, username, write_date, year_month FROM writing_records ORDER BY id"
).fetchall()
connection.close()

OUTPUT.parent.mkdir(parents=True, exist_ok=True)

lines = [
    "-- writing_bot.db에서 생성된 D1 이관용 데이터입니다.",
    "-- schema.sql을 먼저 실행한 뒤 이 파일을 실행하세요.",
    "",
]

# 같은 파일을 두 번 실행해도 중복되지 않도록 기존 내용을 비우고 시작한다.
lines.append("DELETE FROM writing_records;")
lines.append("")

for row_id, user_id, username, write_date, year_month in rows:
    values = ", ".join(
        [str(row_id), quote(user_id), quote(username), quote(write_date), quote(year_month)]
    )
    lines.append(
        "INSERT INTO writing_records (id, user_id, username, write_date, year_month) "
        f"VALUES ({values});"
    )

OUTPUT.write_text("\n".join(lines) + "\n", encoding="utf-8")

print(f"{SOURCE} -> {OUTPUT}")
print(f"기록 {len(rows)}건, 인원 {len({r[1] for r in rows})}명")
print()
print("다음 명령으로 D1에 넣으세요:")
print(f"  npx wrangler d1 execute writing-bot --remote --file={OUTPUT.as_posix()}")
