import { corsHeaders, handleMcp } from "./mcp";
import type { Env } from "./types";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Auth can be added here later (for example a bearer token) before routing.
    // v1 has no auth: the stickers are public.
    const path = normalizePath(new URL(request.url).pathname);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (request.method === "GET" && path === "/") {
      return new Response("daddy-sticker-box ok", {
        status: 200,
        headers: {
          "content-type": "text/plain; charset=utf-8",
          ...corsHeaders(),
        },
      });
    }

    if (request.method === "POST" && path === "/mcp") {
      return handleMcp(request, env);
    }

    return new Response("not found", {
      status: 404,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        ...corsHeaders(),
      },
    });
  },
};

function normalizePath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) return pathname.slice(0, -1);
  return pathname;
}
