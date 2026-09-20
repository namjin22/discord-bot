export interface Env {
  /** wrangler.jsonc의 d1_databases 바인딩 */
  DB: D1Database;
  /** `wrangler secret put DISCORD_TOKEN`으로 등록하는 봇 토큰 */
  DISCORD_TOKEN: string;
  DISCORD_PUBLIC_KEY: string;
  DISCORD_APPLICATION_ID: string;
  GUILD_ID: string;
}
