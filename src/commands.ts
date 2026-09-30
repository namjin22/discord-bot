/**
 * bot.py의 슬래시 커맨드 핸들러를 이식한 모듈.
 * 출력 문구와 순위 계산 규칙은 기존과 동일하게 유지했다.
 */

import type { Env } from "./env.ts";
import type { Interaction } from "./discord.ts";
import type { StatRow } from "./db.ts";
import {
  deferredResponse,
  displayName,
  editOriginalResponse,
  fetchGuildMembers,
  getIntegerOption,
  invokingUser,
  isAdministrator,
  messageResponse,
  resolveMemberOption,
} from "./discord.ts";
import {
  MAX_SET_COUNT,
  addWriting,
  addWritingBulk,
  getCumulativeStats,
  getMonthlyStats,
  getTodayWriters,
  hasWrittenToday,
  removeWriting,
  setWritingCount,
} from "./db.ts";
import { kstDateLabel, kstMonth, kstYear, kstYearMonthLabel } from "./kst.ts";

/** Discord 메시지 본문 최대 길이 */
const MAX_MESSAGE_LENGTH = 2000;

const RULES_MESSAGE = `## 규칙

- 은주T께서 주제방에 올려주시는 키워드를 주제로 글을 작성합니다.
- 작성한 글은 **글-올리기-방** 채널에 올립니다.
- 글 작성 후 **명령어** 채널에서 인증 명령어를 입력합니다. (인증 안할 시 본인 책임)
- 주제 추천은 **주제 추천** 채널에 올려주시면 됩니다.
- 본인이 개인적으로 작성하고 싶은 글은 **아무글이나** 포럼에 올려주시면 됩니다.

최소 3일에 한 번씩은 글을 올려주셔야 합니다.
**매달 한 번씩 확인을 하여 활동이 적은
인원(최소 10개)은 글쓰기 방에서 제외될 수 있습니다.**

확인 후 이모지 남겨주세요.`;

const NUMBER_EMOJIS: Record<number, string> = {
  4: "4️⃣",
  5: "5️⃣",
  6: "6️⃣",
  7: "7️⃣",
  8: "8️⃣",
  9: "9️⃣",
  10: "🔟",
};

function rankLabel(rank: number): string {
  if (rank === 1) return "🥇";
  if (rank === 2) return "🥈";
  if (rank === 3) return "🥉";
  return NUMBER_EMOJIS[rank] ?? `\`${rank}.\``;
}

/**
 * 동점자는 같은 순위로 묶고, 4위부터는 구분선을 한 번 넣는다.
 * cumulativeMap이 주어지면 누적 횟수를 함께 표시한다.
 */
function buildStatsLines(stats: StatRow[], cumulativeMap?: Map<string, number>): string[] {
  const lines: string[] = [];
  let rank = 1;
  let i = 0;
  let separatorAdded = false;

  while (i < stats.length) {
    const count = stats[i]!.count;
    const group: StatRow[] = [];
    while (i < stats.length && stats[i]!.count === count) {
      group.push(stats[i]!);
      i += 1;
    }

    if (rank > 3 && !separatorAdded) {
      lines.push("─────────────────");
      separatorAdded = true;
    }

    const label = rankLabel(rank);
    if (cumulativeMap) {
      for (const member of group) {
        const total = cumulativeMap.get(member.user_id) ?? member.count;
        lines.push(`${label}  **${member.username}** · ${count}회 (누적 ${total}회)`);
      }
    } else {
      const names = group.map((member) => `**${member.username}**`).join(", ");
      lines.push(`${label}  ${names} · ${count}회`);
    }
    rank += group.length;
  }

  return lines;
}

/** 인원이 아주 많아져도 Discord의 2000자 제한에 걸려 실패하지 않도록 잘라낸다. */
function joinWithinLimit(lines: string[]): string {
  const text = lines.join("\n");
  if (text.length <= MAX_MESSAGE_LENGTH) return text;

  const suffix = "\n…(이하 생략)";
  return `${text.slice(0, MAX_MESSAGE_LENGTH - suffix.length)}${suffix}`;
}

const ADMIN_ONLY = "관리자 권한이 있어야 쓸 수 있는 명령어예요.";

// ------------------------------------------------------------------ 핸들러

async function certifyWriting(interaction: Interaction, env: Env): Promise<Response> {
  const user = invokingUser(interaction);
  if (!user) return messageResponse("사용자 정보를 읽지 못했어요.", true);

  const name = displayName(interaction.member, user);

  if (await hasWrittenToday(env.DB, user.id)) {
    return messageResponse("오늘은 이미 인증했어요. 내일 또 와주세요!", true);
  }

  await addWriting(env.DB, user.id, name);
  const stats = await getMonthlyStats(env.DB);
  const monthCount = stats.find((s) => s.user_id === user.id)?.count ?? 1;

  return messageResponse(`인증 완료! 이번 달 ${monthCount}회 작성했어요.`);
}

async function writingStatus(_interaction: Interaction, env: Env): Promise<Response> {
  const [stats, cumulative] = await Promise.all([
    getMonthlyStats(env.DB),
    getCumulativeStats(env.DB),
  ]);
  const cumulativeMap = new Map(cumulative.map((s) => [s.user_id, s.count]));
  const label = kstYearMonthLabel();

  if (stats.length === 0) {
    return messageResponse(`${label} 글작성현황\n아직 이번 달 기록이 없어요.`);
  }

  return messageResponse(
    joinWithinLimit([`**✦ ${label} 글작성현황 ✦**\n`, ...buildStatsLines(stats, cumulativeMap)]),
  );
}

async function monthlyWritingStatus(interaction: Interaction, env: Env): Promise<Response> {
  const year = getIntegerOption(interaction, "year") ?? kstYear();
  const month = getIntegerOption(interaction, "month") ?? kstMonth();

  if (month < 1 || month > 12) {
    return messageResponse("월은 1~12 사이의 숫자를 입력해주세요.", true);
  }
  const maxYear = kstYear() + 1;
  if (year < 2000 || year > maxYear) {
    return messageResponse(`연도는 2000~${maxYear} 사이의 숫자를 입력해주세요.`, true);
  }

  const yearMonthKey = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
  const stats = await getMonthlyStats(env.DB, yearMonthKey);
  const label = `${year}년 ${String(month).padStart(2, "0")}월`;

  if (stats.length === 0) {
    return messageResponse(`**${label} 글작성현황**\n해당 기간 기록이 없어요.`);
  }

  return messageResponse(
    joinWithinLimit([`**✦ ${label} 글작성현황 ✦**\n`, ...buildStatsLines(stats)]),
  );
}

/** count 옵션이 생략되면 기존과 동일하게 1로 취급한다. */
function getCountOption(interaction: Interaction): number {
  return getIntegerOption(interaction, "count") ?? 1;
}

async function addCount(interaction: Interaction, env: Env): Promise<Response> {
  if (!isAdministrator(interaction.member)) return messageResponse(ADMIN_ONLY, true);

  const member = resolveMemberOption(interaction, "member");
  if (!member) return messageResponse("멤버 정보를 읽지 못했어요.", true);

  const count = getCountOption(interaction);
  if (count < 1) return messageResponse("1 이상의 숫자를 입력해주세요.", true);
  if (count > MAX_SET_COUNT) {
    return messageResponse(`${MAX_SET_COUNT} 이하의 숫자를 입력해주세요.`, true);
  }

  await addWritingBulk(env.DB, member.id, member.displayName, count);
  const stats = await getMonthlyStats(env.DB);
  const monthCount = stats.find((s) => s.user_id === member.id)?.count ?? count;

  return messageResponse(
    `${member.displayName} 이번 달 횟수 ${count} 추가했어요. 현재 ${monthCount}회예요.`,
  );
}

async function removeCount(interaction: Interaction, env: Env): Promise<Response> {
  if (!isAdministrator(interaction.member)) return messageResponse(ADMIN_ONLY, true);

  const member = resolveMemberOption(interaction, "member");
  if (!member) return messageResponse("멤버 정보를 읽지 못했어요.", true);

  const count = getCountOption(interaction);
  if (count < 1) return messageResponse("1 이상의 숫자를 입력해주세요.", true);
  if (count > MAX_SET_COUNT) {
    return messageResponse(`${MAX_SET_COUNT} 이하의 숫자를 입력해주세요.`, true);
  }

  const removed = await removeWriting(env.DB, member.id, count);
  if (removed === 0) {
    return messageResponse(`${member.displayName} 이번 달 기록이 없어요.`, true);
  }

  const stats = await getMonthlyStats(env.DB);
  const monthCount = stats.find((s) => s.user_id === member.id)?.count ?? 0;

  const shortfallNote = removed < count ? ` (기록이 모자라 ${removed}회만 차감됐어요)` : "";
  return messageResponse(
    `${member.displayName} 이번 달 횟수 ${removed} 차감했어요.${shortfallNote} 현재 ${monthCount}회예요.`,
  );
}

async function setCount(interaction: Interaction, env: Env): Promise<Response> {
  if (!isAdministrator(interaction.member)) return messageResponse(ADMIN_ONLY, true);

  const member = resolveMemberOption(interaction, "member");
  if (!member) return messageResponse("멤버 정보를 읽지 못했어요.", true);

  const count = getIntegerOption(interaction, "count");
  if (count === null) return messageResponse("설정할 횟수를 입력해주세요.", true);
  if (count < 0) return messageResponse("0 이상의 숫자를 입력해주세요.", true);
  if (count > MAX_SET_COUNT) {
    return messageResponse(`${MAX_SET_COUNT} 이하의 숫자를 입력해주세요.`, true);
  }

  await setWritingCount(env.DB, member.id, member.displayName, count);
  return messageResponse(`${member.displayName} 이번 달 횟수를 ${count}회로 설정했어요.`);
}

/**
 * 길드 멤버 목록을 REST로 받아와야 해서 Discord의 3초 제한을 넘길 수 있다.
 * 그래서 먼저 defer로 응답하고, 실제 내용은 waitUntil 안에서 원본 메시지를 고쳐 채운다.
 */
async function respondTodayStatus(interaction: Interaction, env: Env): Promise<void> {
  const applicationId = interaction.application_id;
  const token = interaction.token;

  try {
    if (!interaction.guild_id) {
      await editOriginalResponse(applicationId, token, "서버 안에서만 쓸 수 있는 명령어예요.");
      return;
    }

    const [todayWriters, members] = await Promise.all([
      getTodayWriters(env.DB),
      fetchGuildMembers(env.DISCORD_TOKEN, interaction.guild_id),
    ]);

    const written: string[] = [];
    for (const member of members) {
      const user = member.user;
      if (!user || user.bot) continue;
      if (!todayWriters.has(user.id)) continue;
      written.push(displayName(member, user));
    }

    const todayLabel = kstDateLabel();

    if (written.length === 0) {
      await editOriginalResponse(
        applicationId,
        token,
        `**${todayLabel} 글작성현황**\n오늘 아직 아무도 안 썼어요.`,
      );
      return;
    }

    written.sort();
    await editOriginalResponse(
      applicationId,
      token,
      joinWithinLimit([`**${todayLabel} 글작성현황**\n`, ...written.map((name) => `- ${name}`)]),
    );
  } catch (error) {
    console.error("오늘글작성현황 처리 실패:", error);
    await editOriginalResponse(
      applicationId,
      token,
      "목록을 불러오지 못했어요. 잠시 후 다시 시도해주세요.",
    );
  }
}

// ------------------------------------------------------------------ 디스패치

export async function handleCommand(
  interaction: Interaction,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  switch (interaction.data?.name) {
    case "글작성인증":
      return certifyWriting(interaction, env);
    case "규칙":
      return messageResponse(RULES_MESSAGE);
    case "글작성현황":
      return writingStatus(interaction, env);
    case "월별글작성현황":
      return monthlyWritingStatus(interaction, env);
    case "글작성횟수추가":
      return addCount(interaction, env);
    case "글작성횟수차감":
      return removeCount(interaction, env);
    case "글작성횟수설정":
      return setCount(interaction, env);
    case "오늘글작성현황":
      ctx.waitUntil(respondTodayStatus(interaction, env));
      return deferredResponse();
    default:
      return messageResponse("알 수 없는 명령어예요.", true);
  }
}
