import aiosqlite
from datetime import date, datetime

DB_PATH = "writing_bot.db"


async def init_db():
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS writing_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                username TEXT NOT NULL,
                write_date TEXT NOT NULL,
                year_month TEXT NOT NULL
            )
        """)
        await db.commit()


def _today() -> str:
    return date.today().isoformat()


def _year_month() -> str:
    return datetime.today().strftime("%Y-%m")


async def has_written_today(user_id: str) -> bool:
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT 1 FROM writing_records WHERE user_id = ? AND write_date = ?",
            (user_id, _today()),
        ) as cursor:
            return await cursor.fetchone() is not None


async def add_writing(user_id: str, username: str):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT INTO writing_records (user_id, username, write_date, year_month) VALUES (?, ?, ?, ?)",
            (user_id, username, _today(), _year_month()),
        )
        await db.commit()


async def remove_writing(user_id: str, username: str):
    """관리자용: 오늘 날짜 기록 1건 제거 (없으면 이번 달 최신 기록 제거)"""
    async with aiosqlite.connect(DB_PATH) as db:
        # 오늘 기록이 있으면 오늘 것 제거
        async with db.execute(
            "SELECT id FROM writing_records WHERE user_id = ? AND write_date = ? LIMIT 1",
            (user_id, _today()),
        ) as cursor:
            row = await cursor.fetchone()

        if row:
            await db.execute("DELETE FROM writing_records WHERE id = ?", (row[0],))
        else:
            # 이번 달 기록 중 가장 최근 것 제거
            async with db.execute(
                "SELECT id FROM writing_records WHERE user_id = ? AND year_month = ? ORDER BY write_date DESC LIMIT 1",
                (user_id, _year_month()),
            ) as cursor:
                row = await cursor.fetchone()
            if row:
                await db.execute("DELETE FROM writing_records WHERE id = ?", (row[0],))
            else:
                return False
        await db.commit()
        return True


async def get_monthly_stats() -> list[dict]:
    """이번 달 전체 멤버 글 작성 횟수"""
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            """
            SELECT user_id, username, COUNT(*) as count
            FROM writing_records
            WHERE year_month = ?
            GROUP BY user_id
            ORDER BY count DESC, username ASC
            """,
            (_year_month(),),
        ) as cursor:
            rows = await cursor.fetchall()
    return [{"user_id": r[0], "username": r[1], "count": r[2]} for r in rows]


async def set_writing_count(user_id: str, username: str, count: int):
    """이번 달 기록을 모두 지우고 count만큼 새로 삽입"""
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "DELETE FROM writing_records WHERE user_id = ? AND year_month = ?",
            (user_id, _year_month()),
        )
        for i in range(count):
            await db.execute(
                "INSERT INTO writing_records (user_id, username, write_date, year_month) VALUES (?, ?, ?, ?)",
                (user_id, username, _today(), _year_month()),
            )
        await db.commit()


async def get_today_writers() -> set[str]:
    """오늘 글을 작성한 user_id 집합"""
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT DISTINCT user_id FROM writing_records WHERE write_date = ?",
            (_today(),),
        ) as cursor:
            rows = await cursor.fetchall()
    return {r[0] for r in rows}
