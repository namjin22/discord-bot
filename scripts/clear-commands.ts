/**
 * 등록된 슬래시 커맨드를 모두 지운다. (기존 clear_commands.py 대체)
 *
 *   npm run unregister
 */

export {};

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

async function clear(url: string, label: string): Promise<void> {
  const response = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
    },
    body: "[]",
  });

  if (!response.ok) {
    console.error(`${label} 초기화 실패 (${response.status}): ${await response.text()}`);
    process.exit(1);
  }
  console.log(`${label} 초기화 완료`);
}

const base = `https://discord.com/api/v10/applications/${applicationId}`;
await clear(`${base}/guilds/${guildId}/commands`, "길드 커맨드");
await clear(`${base}/commands`, "글로벌 커맨드");
