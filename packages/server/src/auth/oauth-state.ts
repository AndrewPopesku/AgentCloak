import { timingSafeEqual } from "node:crypto";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Config } from "../config.js";

const COOKIE = "oauth_state";
const PATH = "/auth/callback";

export function setOAuthStateCookie(c: Context, authUrl: string, config: Config): void {
  setCookie(c, COOKIE, new URL(authUrl).searchParams.get("state")!, {
    httpOnly: true, secure: config.baseUrl.startsWith("https:"),
    sameSite: "Lax", path: PATH, maxAge: 600,
  });
}

export function consumeOAuthStateCookie(c: Context, state: string): boolean {
  const cookie = getCookie(c, COOKIE);
  deleteCookie(c, COOKIE, { path: PATH });
  if (!cookie) return false;
  const expected = Buffer.from(cookie);
  const received = Buffer.from(state);
  return expected.length === received.length && timingSafeEqual(expected, received);
}
