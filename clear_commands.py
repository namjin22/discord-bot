import asyncio
import os
import discord
from discord import app_commands
from dotenv import load_dotenv

load_dotenv()

TOKEN = os.getenv("DISCORD_TOKEN")
GUILD_ID = int(os.getenv("GUILD_ID", "0"))


async def clear():
    intents = discord.Intents.default()
    client = discord.Client(intents=intents)
    tree = app_commands.CommandTree(client)

    async with client:
        await client.login(TOKEN)

        guild = discord.Object(id=GUILD_ID)

        # 길드 커맨드 초기화
        tree.clear_commands(guild=guild)
        await tree.sync(guild=guild)
        print("길드 커맨드 초기화 완료")

        # 글로벌 커맨드 초기화
        tree.clear_commands(guild=None)
        await tree.sync()
        print("글로벌 커맨드 초기화 완료")


asyncio.run(clear())
