import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { createAuth } from "../../../adapters/auth/index";

export const prerender = false;

export const ALL: APIRoute = ({ request }) =>
  createAuth(env).handler(request);
