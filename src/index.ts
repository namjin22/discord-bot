/**
 * Worker 진입점.
 *
 * 기존 bot.py는 `client.run(TOKEN)`으로 Gateway에 상주했지만, 여기서는 Discord가
 * 인터랙션마다 이 Worker로 POST를 보낸다. 상주 프로세스가 없으므로 봇은 멤버 목록에서
 * 오프라인으로 보이지만, 슬래시 커맨드는 정상 동작한다.
 */

import type { Env } from "./env.ts";
import type { Interaction } from "./discord.ts";
import { InteractionType, messageResponse, pongResponse, verifySignature } from "./discord.ts";
import { handleCommand } from "./commands.ts";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // 배포 확인용. Discord는 항상 POST로 보낸다.
    if (request.method === "GET") {
      return new Response("discord-writing-bot: ok", {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const signature = request.headers.get("x-signature-ed25519");
    const timestamp = request.headers.get("x-signature-timestamp");
    const body = await request.text();

    // Discord는 엔드포인트 등록 시 일부러 잘못된 서명을 보내 401이 돌아오는지 확인한다.
    if (
      !signature ||
      !timestamp ||
      !(await verifySignature(env.DISCORD_PUBLIC_KEY, body, signature, timestamp))
    ) {
      return new Response("invalid request signature", { status: 401 });
    }

    let interaction: Interaction;
    try {
      interaction = JSON.parse(body) as Interaction;
    } catch {
      return new Response("Bad Request", { status: 400 });
    }

    if (interaction.type === InteractionType.PING) {
      return pongResponse();
    }
    if (interaction.type !== InteractionType.APPLICATION_COMMAND) {
      return new Response("Unsupported interaction type", { status: 400 });
    }

    try {
      return await handleCommand(interaction, env, ctx);
    } catch (error) {
      console.error("명령 처리 실패:", error);
      return messageResponse("문제가 생겼어요. 잠시 후 다시 시도해주세요.", true);
    }
  },
} satisfies ExportedHandler<Env>;
