import os
import discord
from discord import app_commands
from discord.ext import tasks
from dotenv import load_dotenv
from datetime import datetime, date, timedelta, timezone

KST = timezone(timedelta(hours=9))
import json
import pathlib

import database as db

load_dotenv()

TOKEN = os.getenv("DISCORD_TOKEN")
GUILD_ID = int(os.getenv("GUILD_ID", "0"))
OWNER_ID = 1346775971612856394

REMINDER_FILE = pathlib.Path("last_reminder.json")


def get_last_reminder() -> date | None:
    if not REMINDER_FILE.exists():
        return None
    data = json.loads(REMINDER_FILE.read_text())
    return date.fromisoformat(data["date"])


def save_last_reminder():
    REMINDER_FILE.write_text(json.dumps({"date": datetime.now(KST).date().isoformat()}))


class WritingBot(discord.Client):
    def __init__(self):
        intents = discord.Intents.default()
        intents.members = True
        super().__init__(intents=intents)
        self.tree = app_commands.CommandTree(self)

    async def setup_hook(self):
        await db.init_db()
        guild = discord.Object(id=GUILD_ID)
        self.tree.copy_global_to(guild=guild)
        await self.tree.sync(guild=guild)
        print(f"슬래시 커맨드 동기화 완료 (guild={GUILD_ID})")
        reminder_task.start()

    async def on_ready(self):
        print(f"봇 온라인: {self.user} (id={self.user.id})")


client = WritingBot()


@tasks.loop(hours=24)
async def reminder_task():
    last = get_last_reminder()
    today = date.today()
    if last is None or (today - last).days >= 15:
        owner = await client.fetch_user(OWNER_ID)
        await owner.send("서버 VM 만료 15일 주기 알림이에요. GSM SV에서 인스턴스 연장 확인해주세요!")
        save_last_reminder()


@reminder_task.before_loop
async def before_reminder():
    await client.wait_until_ready()


def is_admin():
    async def predicate(interaction: discord.Interaction) -> bool:
        if interaction.user.guild_permissions.administrator:
            return True
        await interaction.response.send_message(
            "관리자 권한이 있어야 쓸 수 있는 명령어예요.", ephemeral=True
        )
        return False
    return app_commands.check(predicate)


@client.tree.command(name="글작성인증", description="오늘도 수고하셨습니다!! (하루 1회)")
async def certify_writing(interaction: discord.Interaction):
    user_id = str(interaction.user.id)
    username = interaction.user.display_name

    if await db.has_written_today(user_id):
        await interaction.response.send_message(
            "오늘은 이미 인증했어요. 내일 또 와주세요!",
            ephemeral=True,
        )
        return

    await db.add_writing(user_id, username)
    stats = await db.get_monthly_stats()
    month_count = next((s["count"] for s in stats if s["user_id"] == user_id), 1)

    month = datetime.now(KST).strftime("%m월")
    await interaction.response.send_message(
        f"인증 완료! 이번 달 {month_count}회 작성했어요."
    )


def _rank_label(i: int) -> str:
    if i == 1: return "🥇"
    if i == 2: return "🥈"
    if i == 3: return "🥉"
    number_emojis = {4:"4️⃣",5:"5️⃣",6:"6️⃣",7:"7️⃣",8:"8️⃣",9:"9️⃣",10:"🔟"}
    return number_emojis.get(i, f"`{i}.`")


@client.tree.command(name="글작성현황", description="이번 달 전체 멤버의 글 작성 횟수를 표시합니다.")
async def writing_status(interaction: discord.Interaction):
    stats = await db.get_monthly_stats()
    year_month = datetime.now(KST).strftime("%Y년 %m월")

    if not stats:
        await interaction.response.send_message(
            f"{year_month} 글작성현황\n아직 이번 달 기록이 없어요."
        )
        return

    lines = [f"**✦ {year_month} 글작성현황 ✦**\n"]
    rank = 1
    i = 0
    separator_added = False

    while i < len(stats):
        count = stats[i]["count"]
        group = []
        while i < len(stats) and stats[i]["count"] == count:
            group.append(stats[i])
            i += 1

        if rank > 3 and not separator_added:
            lines.append("─────────────────")
            separator_added = True

        label = _rank_label(rank)
        names = ", ".join(f"**{m['username']}**" for m in group)
        lines.append(f"{label}  {names} · {count}회")
        rank += len(group)

    await interaction.response.send_message("\n".join(lines))


@client.tree.command(name="글작성횟수추가", description="[관리자] 특정 멤버의 글 작성 횟수를 1 추가합니다.")
@app_commands.describe(member="횟수를 추가할 멤버")
@is_admin()
async def add_count(interaction: discord.Interaction, member: discord.Member):
    await db.add_writing(str(member.id), member.display_name, db._admin_date())
    stats = await db.get_monthly_stats()
    month_count = next((s["count"] for s in stats if s["user_id"] == str(member.id)), 1)

    await interaction.response.send_message(
        f"{member.display_name} 이번 달 횟수 1 추가했어요. 현재 {month_count}회예요."
    )


@client.tree.command(name="글작성횟수차감", description="[관리자] 특정 멤버의 글 작성 횟수를 1 차감합니다.")
@app_commands.describe(member="횟수를 차감할 멤버")
@is_admin()
async def remove_count(interaction: discord.Interaction, member: discord.Member):
    success = await db.remove_writing(str(member.id), member.display_name)
    if not success:
        await interaction.response.send_message(
            f"{member.display_name} 이번 달 기록이 없어요.",
            ephemeral=True,
        )
        return

    stats = await db.get_monthly_stats()
    month_count = next((s["count"] for s in stats if s["user_id"] == str(member.id)), 0)

    await interaction.response.send_message(
        f"{member.display_name} 이번 달 횟수 1 차감했어요. 현재 {month_count}회예요."
    )


@client.tree.command(name="글작성횟수설정", description="[관리자] 특정 멤버의 이번 달 글 작성 횟수를 지정한 값으로 설정합니다.")
@app_commands.describe(member="횟수를 설정할 멤버", count="설정할 횟수")
@is_admin()
async def set_count(interaction: discord.Interaction, member: discord.Member, count: int):
    if count < 0:
        await interaction.response.send_message("0 이상의 숫자를 입력해주세요.", ephemeral=True)
        return
    await db.set_writing_count(str(member.id), member.display_name, count)
    await interaction.response.send_message(
        f"{member.display_name} 이번 달 횟수를 {count}회로 설정했어요."
    )


@client.tree.command(name="오늘글작성현황", description="오늘 글을 작성한 멤버 목록을 표시합니다.")
async def today_status(interaction: discord.Interaction):
    await interaction.response.defer()

    today_writers = await db.get_today_writers()
    guild = interaction.guild

    written = []
    for member in guild.members:
        if member.bot:
            continue
        if str(member.id) in today_writers:
            written.append(member.display_name)

    today_str = datetime.now(KST).strftime("%Y년 %m월 %d일")

    if not written:
        await interaction.followup.send(
            f"**{today_str} 글작성현황**\n오늘 아직 아무도 안 썼어요."
        )
        return

    lines = [f"**{today_str} 글작성현황**\n"]
    for name in sorted(written):
        lines.append(f"- {name}")

    await interaction.followup.send("\n".join(lines))


client.run(TOKEN)
