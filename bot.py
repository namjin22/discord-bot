import os
import discord
from discord import app_commands
from dotenv import load_dotenv
from datetime import datetime

import database as db

load_dotenv()

TOKEN = os.getenv("DISCORD_TOKEN")
GUILD_ID = int(os.getenv("GUILD_ID", "0"))


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

    async def on_ready(self):
        print(f"봇 온라인: {self.user} (id={self.user.id})")


client = WritingBot()


def is_admin():
    async def predicate(interaction: discord.Interaction) -> bool:
        if interaction.user.guild_permissions.administrator:
            return True
        await interaction.response.send_message(
            "❌ 관리자 권한이 필요한 명령어입니다.", ephemeral=True
        )
        return False
    return app_commands.check(predicate)


# ───────────────────────────────────────────────────────
# 1. /글작성인증
# ───────────────────────────────────────────────────────
@client.tree.command(name="글작성인증", description="오늘 글 작성을 인증합니다. (하루 1회)")
async def certify_writing(interaction: discord.Interaction):
    user_id = str(interaction.user.id)
    username = interaction.user.display_name

    if await db.has_written_today(user_id):
        await interaction.response.send_message(
            "⚠️ 오늘은 이미 글작성인증을 완료했습니다. 내일 다시 시도해주세요!",
            ephemeral=True,
        )
        return

    await db.add_writing(user_id, username)
    stats = await db.get_monthly_stats()
    month_count = next((s["count"] for s in stats if s["user_id"] == user_id), 1)

    year_month = datetime.today().strftime("%Y년 %m월")
    await interaction.response.send_message(
        f"✅ **{username}** 님의 글작성이 인증되었습니다!\n"
        f"📅 {year_month} 누적 횟수: **{month_count}회**"
    )


# ───────────────────────────────────────────────────────
# 2. /글작성현황
# ───────────────────────────────────────────────────────
@client.tree.command(name="글작성현황", description="이번 달 전체 멤버의 글 작성 횟수를 표시합니다.")
async def writing_status(interaction: discord.Interaction):
    stats = await db.get_monthly_stats()
    year_month = datetime.today().strftime("%Y년 %m월")

    if not stats:
        await interaction.response.send_message(
            f"📊 **{year_month} 글작성현황**\n아직 이번 달 글작성 인증 기록이 없습니다.",
            ephemeral=False,
        )
        return

    lines = [f"📊 **{year_month} 글작성현황**\n"]
    for i, s in enumerate(stats, 1):
        medal = {1: "🥇", 2: "🥈", 3: "🥉"}.get(i, f"**{i}.**")
        lines.append(f"{medal} {s['username']} — {s['count']}회")

    await interaction.response.send_message("\n".join(lines))


# ───────────────────────────────────────────────────────
# 3. /글작성횟수추가 (관리자)
# ───────────────────────────────────────────────────────
@client.tree.command(name="글작성횟수추가", description="[관리자] 특정 멤버의 글 작성 횟수를 1 추가합니다.")
@app_commands.describe(member="횟수를 추가할 멤버")
@is_admin()
async def add_count(interaction: discord.Interaction, member: discord.Member):
    await db.add_writing(str(member.id), member.display_name)
    stats = await db.get_monthly_stats()
    month_count = next((s["count"] for s in stats if s["user_id"] == str(member.id)), 1)

    await interaction.response.send_message(
        f"➕ **{member.display_name}** 님의 글작성 횟수를 1 추가했습니다.\n"
        f"📅 이번 달 누적: **{month_count}회**"
    )


# ───────────────────────────────────────────────────────
# 4. /글작성횟수차감 (관리자)
# ───────────────────────────────────────────────────────
@client.tree.command(name="글작성횟수차감", description="[관리자] 특정 멤버의 글 작성 횟수를 1 차감합니다.")
@app_commands.describe(member="횟수를 차감할 멤버")
@is_admin()
async def remove_count(interaction: discord.Interaction, member: discord.Member):
    success = await db.remove_writing(str(member.id), member.display_name)
    if not success:
        await interaction.response.send_message(
            f"⚠️ **{member.display_name}** 님의 이번 달 글작성 기록이 없습니다.",
            ephemeral=True,
        )
        return

    stats = await db.get_monthly_stats()
    month_count = next((s["count"] for s in stats if s["user_id"] == str(member.id)), 0)

    await interaction.response.send_message(
        f"➖ **{member.display_name}** 님의 글작성 횟수를 1 차감했습니다.\n"
        f"📅 이번 달 누적: **{month_count}회**"
    )


# ───────────────────────────────────────────────────────
# 5. /오늘글작성현황
# ───────────────────────────────────────────────────────
@client.tree.command(name="오늘글작성현황", description="오늘 글을 작성한 멤버 목록을 표시합니다.")
async def today_status(interaction: discord.Interaction):
    await interaction.response.defer()

    today_writers = await db.get_today_writers()
    guild = interaction.guild

    # 봇을 제외한 전체 멤버 중 오늘 글 작성한 사람 필터
    written = []
    for member in guild.members:
        if member.bot:
            continue
        if str(member.id) in today_writers:
            written.append(member.display_name)

    today_str = datetime.today().strftime("%Y년 %m월 %d일")

    if not written:
        await interaction.followup.send(
            f"📋 **{today_str} 글작성현황**\n오늘 글을 작성한 멤버가 없습니다."
        )
        return

    lines = [f"📋 **{today_str} 글작성현황**\n"]
    for name in sorted(written):
        lines.append(f"✅ {name}")

    await interaction.followup.send("\n".join(lines))


client.run(TOKEN)
