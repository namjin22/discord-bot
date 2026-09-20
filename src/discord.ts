/**
 * Discord HTTP Interactions 연동에 필요한 최소한의 타입/헬퍼.
 *
 * 기존 버전은 discord.py가 Gateway(WebSocket)로 상주하면서 이벤트를 받았지만,
 * Workers에서는 Discord가 우리 Worker로 HTTPS 요청을 보내는 방식으로 뒤집힌다.
 * 그래서 요청마다 Ed25519 서명을 직접 검증해야 한다.
 */

const API_BASE = "https://discord.com/api/v10";

export const InteractionType = {
  PING: 1,
  APPLICATION_COMMAND: 2,
} as const;

export const InteractionResponseType = {
  PONG: 1,
  CHANNEL_MESSAGE_WITH_SOURCE: 4,
  DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5,
} as const;

/** MessageFlags.EPHEMERAL — discord.py의 ephemeral=True에 해당 */
const EPHEMERAL_FLAG = 1 << 6;

/** Permissions.ADMINISTRATOR */
const ADMINISTRATOR = 1n << 3n;

export interface DiscordUser {
  id: string;
  username: string;
  global_name?: string | null;
  bot?: boolean;
}

export interface DiscordMember {
  user?: DiscordUser;
  nick?: string | null;
  /** 명령을 실행한 채널에서 사용자가 가진 권한 비트필드 (문자열) */
  permissions?: string;
}

export interface InteractionOption {
  name: string;
  type: number;
  value?: string | number | boolean;
}

export interface Interaction {
  type: number;
  id: string;
  token: string;
  application_id: string;
  guild_id?: string;
  member?: DiscordMember;
  user?: DiscordUser;
  data?: {
    name: string;
    options?: InteractionOption[];
    resolved?: {
      users?: Record<string, DiscordUser>;
      members?: Record<string, DiscordMember>;
    };
  };
}

// ---------------------------------------------------------------- 서명 검증

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

const HEX_ONLY = /^[0-9a-fA-F]+$/;

/**
 * Discord가 보낸 요청이 진짜인지 Ed25519로 검증한다.
 * 이 검증을 통과하지 못한 요청은 반드시 401로 돌려보내야 한다 (Discord의 엔드포인트 등록 조건이기도 하다).
 */
export async function verifySignature(
  publicKey: string,
  body: string,
  signature: string,
  timestamp: string,
): Promise<boolean> {
  if (publicKey.length !== 64 || !HEX_ONLY.test(publicKey)) return false;
  if (signature.length !== 128 || !HEX_ONLY.test(signature)) return false;

  try {
    const key = await crypto.subtle.importKey(
      "raw",
      hexToBytes(publicKey),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    return await crypto.subtle.verify(
      { name: "Ed25519" },
      key,
      hexToBytes(signature),
      new TextEncoder().encode(timestamp + body),
    );
  } catch {
    return false;
  }
}

// ------------------------------------------------------------- 응답 빌더

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json" },
  });
}

export function pongResponse(): Response {
  return jsonResponse({ type: InteractionResponseType.PONG });
}

export function messageResponse(content: string, ephemeral = false): Response {
  return jsonResponse({
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: ephemeral ? { content, flags: EPHEMERAL_FLAG } : { content },
  });
}

/** discord.py의 interaction.response.defer()에 해당. 3초 제한을 넘길 작업에 쓴다. */
export function deferredResponse(): Response {
  return jsonResponse({
    type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
  });
}

// --------------------------------------------------------------- 옵션 읽기

export function getOption(interaction: Interaction, name: string): InteractionOption | undefined {
  return interaction.data?.options?.find((option) => option.name === name);
}

export function getIntegerOption(interaction: Interaction, name: string): number | null {
  const value = getOption(interaction, name)?.value;
  return typeof value === "number" ? value : null;
}

export interface ResolvedMember {
  id: string;
  displayName: string;
}

/** discord.py의 Member.display_name: 서버 별명 > 전역 표시 이름 > 사용자명 */
export function displayName(member: DiscordMember | undefined, user: DiscordUser): string {
  return member?.nick || user.global_name || user.username;
}

/** USER 타입 옵션을 resolved 데이터와 합쳐 돌려준다. */
export function resolveMemberOption(
  interaction: Interaction,
  name: string,
): ResolvedMember | null {
  const value = getOption(interaction, name)?.value;
  if (typeof value !== "string") return null;

  const user = interaction.data?.resolved?.users?.[value];
  if (!user) return null;

  return {
    id: value,
    displayName: displayName(interaction.data?.resolved?.members?.[value], user),
  };
}

/** 명령을 실행한 사람 (길드 안에서는 member.user, DM에서는 user) */
export function invokingUser(interaction: Interaction): DiscordUser | undefined {
  return interaction.member?.user ?? interaction.user;
}

export function isAdministrator(member: DiscordMember | undefined): boolean {
  if (!member?.permissions) return false;
  try {
    return (BigInt(member.permissions) & ADMINISTRATOR) !== 0n;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------- REST

/**
 * 길드 전체 멤버 목록. GUILD_MEMBERS 특권 인텐트가 켜져 있어야 한다
 * (기존 봇이 intents.members = True로 쓰던 것과 같은 권한).
 */
export async function fetchGuildMembers(
  token: string,
  guildId: string,
): Promise<DiscordMember[]> {
  const members: DiscordMember[] = [];
  let after = "0";

  for (;;) {
    const response = await fetch(
      `${API_BASE}/guilds/${guildId}/members?limit=1000&after=${after}`,
      { headers: { Authorization: `Bot ${token}` } },
    );
    if (!response.ok) {
      throw new Error(`길드 멤버 조회 실패 (${response.status}): ${await response.text()}`);
    }

    const page = await response.json<DiscordMember[]>();
    members.push(...page);

    const last = page.at(-1);
    if (page.length < 1000 || !last?.user) break;
    after = last.user.id;
  }

  return members;
}

/** defer로 미뤄둔 응답을 실제 내용으로 채운다. */
export async function editOriginalResponse(
  applicationId: string,
  interactionToken: string,
  content: string,
): Promise<void> {
  const response = await fetch(
    `${API_BASE}/webhooks/${applicationId}/${interactionToken}/messages/@original`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    },
  );
  if (!response.ok) {
    console.error(`응답 수정 실패 (${response.status}): ${await response.text()}`);
  }
}
