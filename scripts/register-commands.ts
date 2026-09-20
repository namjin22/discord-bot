/**
 * 슬래시 커맨드를 길드에 등록한다. (기존 bot.py의 tree.copy_global_to + tree.sync 대체)
 *
 *   npm run register
 *
 * .dev.vars 파일이나 환경변수에서 DISCORD_TOKEN / DISCORD_APPLICATION_ID / GUILD_ID를 읽는다.
 */

import { COMMANDS } from "../src/command-defs.ts";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`환경변수 ${name}가 없습니다. .dev.vars 파일을 확인해주세요.`);
    process.exit(1);
  }
  return value;
}

const token = requireEnv("DISCORD_TOKEN");
const applicationId = requireEnv("DISCORD_APPLICATION_ID");
const guildId = requireEnv("GUILD_ID");

const response = await fetch(
  `https://discord.com/api/v10/applications/${applicationId}/guilds/${guildId}/commands`,
  {
    method: "PUT",
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(COMMANDS),
  },
);

if (!response.ok) {
  console.error(`등록 실패 (${response.status}):`);
  console.error(await response.text());
  process.exit(1);
}

const registered = (await response.json()) as { name: string }[];
console.log(`슬래시 커맨드 동기화 완료 (guild=${guildId}, ${registered.length}개)`);
for (const command of registered) {
  console.log(`  /${command.name}`);
}
