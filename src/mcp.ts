import { findSticker, listStickers, pickSticker, toView } from "./stickers";
import type { Env, StickerView } from "./types";
import { WIDGET_HTML, WIDGET_MIME, WIDGET_URI } from "./widget";

const SERVER_NAME = "daddy-sticker-box";
const DEFAULT_PROTOCOL = "2025-03-26";

const SHOW_META = {
  "openai/outputTemplate": WIDGET_URI,
  "openai/toolInvocation/invoking": "找图中\u2026",
  "openai/toolInvocation/invoked": "图来了",
} as const;

interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  _meta?: Record<string, unknown>;
}

const TOOLS: ToolDef[] = [
  {
    name: "list_stickers",
    description:
      "当你需要知道盒子里有哪些贴纸，或只想看某一个标签（例如「无语」「委屈」）下面有什么时使用。返回每张贴纸的 id、标签、含义、使用提示和图片地址。它只列清单，不会把图发给对方；真要亮出某一张时改用 show_sticker。",
    inputSchema: {
      type: "object",
      properties: {
        tag: {
          type: "string",
          description: "可选。精确匹配标签，只返回带这个标签的贴纸。不传则返回全部。",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "pick_sticker",
    description:
      "当对话里出现了情绪或场景，你想选一张最贴的贴纸、但还不知道 id 时使用。把对方的话或你的判断收成一句中文（例如「有点委屈」「想舔屏」）传给 query。标签命中优先，含义和用法提示其次；对不上就随机给一张并标明没对上。选好后如果要展示给对方，再调用 show_sticker。",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "用来对贴纸的一句话或关键词，中文短句即可。",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "show_sticker",
    description:
      "当你已经决定要把某一张贴纸发给对方看时使用。传入 list_stickers 或 pick_sticker 给出的 id，由贴纸卡片展示图片，不要再把图片地址写成 Markdown 图片。id 不存在就不要猜，先去列清单或重新挑。",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "贴纸 id，例如 \"1\"。",
        },
      },
      required: ["id"],
      additionalProperties: false,
    },
    _meta: { ...SHOW_META },
  },
];

export function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Accept, Mcp-Session-Id, MCP-Protocol-Version, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

type JsonRpcId = string | number | null;

interface RpcErrorBody {
  code: number;
  message: string;
}

interface RpcResponse {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: RpcErrorBody;
}

export async function handleMcp(request: Request, env: Env): Promise<Response> {
  let payload: unknown;
  try {
    payload = JSON.parse(await request.text());
  } catch {
    return rpcResponse(failure(null, -32700, "Parse error"), 400);
  }

  if (Array.isArray(payload)) {
    if (payload.length === 0) {
      return rpcResponse(failure(null, -32600, "Invalid Request"), 400);
    }
    const responses: RpcResponse[] = [];
    for (const item of payload) {
      const handled = handleMessage(item, env);
      if (handled.kind === "response") responses.push(handled.response);
    }
    if (responses.length === 0) return accepted();
    return rpcResponse(responses, 200);
  }

  const handled = handleMessage(payload, env);
  if (handled.kind === "notification") return accepted();
  const status = handled.response.error?.code === -32600 ? 400 : 200;
  return rpcResponse(handled.response, status);
}

function handleMessage(
  message: unknown,
  env: Env,
): { kind: "notification" } | { kind: "response"; response: RpcResponse } {
  if (!isRecord(message) || message.jsonrpc !== "2.0" || typeof message.method !== "string" || message.method.length === 0) {
    return { kind: "response", response: failure(idOf(message), -32600, "Invalid Request") };
  }
  if (message.method.startsWith("notifications/") || !Object.hasOwn(message, "id")) {
    return { kind: "notification" };
  }
  const id = message.id;
  if (id !== null && typeof id !== "string" && typeof id !== "number") {
    return { kind: "response", response: failure(null, -32600, "Invalid Request") };
  }
  return { kind: "response", response: dispatch(id, message.method, message.params, env) };
}

function dispatch(id: JsonRpcId, method: string, params: unknown, env: Env): RpcResponse {
  switch (method) {
    case "initialize":
      return ok(id, initializeResult(params));
    case "ping":
      return ok(id, {});
    case "tools/list":
      return ok(id, { tools: TOOLS });
    case "tools/call":
      return callTool(id, env, params);
    case "resources/list":
      return ok(id, { resources: resourceList() });
    case "resources/read":
      return readResource(id, params);
    default:
      return failure(id, -32601, "Method not found");
  }
}

function initializeResult(params: unknown): Record<string, unknown> {
  const record = isRecord(params) ? params : {};
  const requested = record.protocolVersion;
  const protocolVersion = typeof requested === "string" && requested.length > 0 ? requested : DEFAULT_PROTOCOL;
  return {
    protocolVersion,
    capabilities: {
      tools: {},
      resources: {},
    },
    serverInfo: {
      name: SERVER_NAME,
      version: "0.1.0",
    },
  };
}

// ChatGPT Apps SDK: legacy `_meta["openai/widgetCSP"]` (snake_case) plus the
// preferred `_meta.ui.csp` (camelCase). Images load through resource domains.
// https://developers.openai.com/plugins/reference
const WIDGET_RESOURCE_META: Record<string, unknown> = {
  "openai/widgetCSP": {
    connect_domains: [],
    resource_domains: ["https://cdn.jsdelivr.net"],
  },
  ui: {
    csp: {
      connectDomains: [],
      resourceDomains: ["https://cdn.jsdelivr.net"],
    },
  },
};

function resourceList(): Record<string, unknown>[] {
  return [
    {
      uri: WIDGET_URI,
      name: "sticker",
      description: "贴纸卡片。show_sticker 调用后，用圆角图片把这张贴纸画出来。",
      mimeType: WIDGET_MIME,
      _meta: WIDGET_RESOURCE_META,
    },
  ];
}

function readResource(id: JsonRpcId, params: unknown): RpcResponse {
  const record = isRecord(params) ? params : {};
  if (typeof record.uri !== "string" || record.uri.length === 0) {
    return failure(id, -32602, "Invalid params");
  }
  if (record.uri !== WIDGET_URI) {
    return failure(id, -32002, "Resource not found");
  }
  return ok(id, {
    contents: [
      {
        uri: WIDGET_URI,
        mimeType: WIDGET_MIME,
        text: WIDGET_HTML,
        _meta: WIDGET_RESOURCE_META,
      },
    ],
  });
}

function callTool(id: JsonRpcId, env: Env, params: unknown): RpcResponse {
  if (!isRecord(params) || typeof params.name !== "string" || params.name.length === 0) {
    return failure(id, -32602, "Invalid params");
  }
  const args = isRecord(params.arguments) ? params.arguments : {};
  return ok(id, runTool(env, params.name, args));
}

function runTool(env: Env, name: string, args: Record<string, unknown>): Record<string, unknown> {
  switch (name) {
    case "list_stickers":
      return runList(env, args);
    case "pick_sticker":
      return runPick(env, args);
    case "show_sticker":
      return runShow(env, args);
    default:
      return toolError(`没有工具「${name}」。`);
  }
}

function runList(env: Env, args: Record<string, unknown>): Record<string, unknown> {
  if (Object.hasOwn(args, "tag") && args.tag !== undefined && typeof args.tag !== "string") {
    return toolError("tag 必须是字符串。");
  }
  const tag = typeof args.tag === "string" ? args.tag : undefined;
  const stickers = listStickers(env, tag);
  return {
    content: [{ type: "text", text: formatList(stickers, tag) }],
    structuredContent: { stickers },
  };
}

function runPick(env: Env, args: Record<string, unknown>): Record<string, unknown> {
  if (typeof args.query !== "string" || args.query.trim().length === 0) {
    return toolError("请传入 query，用一句话或关键词描述想要的贴纸。");
  }
  const picked = pickSticker(args.query);
  const view = toView(env, picked.sticker);
  return {
    content: [{ type: "text", text: formatPick(view, picked.matched) }],
    structuredContent: {
      id: view.id,
      url: view.url,
      tags: view.tags,
      meaning: view.meaning,
      usage_hint: view.usage_hint,
      matched: picked.matched,
    },
  };
}

function runShow(env: Env, args: Record<string, unknown>): Record<string, unknown> {
  if (typeof args.id !== "string" || args.id.trim().length === 0) {
    return toolError("请传入贴纸 id。");
  }
  const sticker = findSticker(args.id);
  if (!sticker) {
    return toolError(`没有 id 为「${args.id.trim()}」的贴纸。`);
  }
  const view = toView(env, sticker);
  return {
    content: [
      {
        type: "text",
        text: `贴纸 ${view.id}（${view.meaning}）。图片已由贴纸卡片展示，不要再嵌入 Markdown 图片。`,
      },
    ],
    structuredContent: {
      id: view.id,
      url: view.url,
      meaning: view.meaning,
      usage_hint: view.usage_hint,
    },
    _meta: { ...SHOW_META },
  };
}

function formatList(stickers: StickerView[], tag?: string): string {
  const label = tag?.trim() ? `标签「${tag.trim()}」` : "全部贴纸";
  if (stickers.length === 0) return `${label}：没有。`;
  const lines = stickers.map(
    (sticker) => `${sticker.id}｜${sticker.tags.join("、")}｜${sticker.meaning}｜${sticker.usage_hint}\n${sticker.url}`,
  );
  return `${label}（${stickers.length}）\n${lines.join("\n")}`;
}

function formatPick(view: StickerView, matched: boolean): string {
  const head = matched
    ? `对上了贴纸 ${view.id}（${view.tags.join("、")}）`
    : `没有对上的贴纸，随机给了 ${view.id}（${view.tags.join("、")}）`;
  return `${head}\n${view.meaning}\n${view.usage_hint}\n${view.url}`;
}

function toolError(message: string): Record<string, unknown> {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

function ok(id: JsonRpcId, result: unknown): RpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function failure(id: JsonRpcId, code: number, message: string): RpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function idOf(message: unknown): JsonRpcId {
  if (!isRecord(message)) return null;
  const id = message.id;
  if (id === null || typeof id === "string" || typeof id === "number") return id;
  return null;
}

function rpcResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      ...corsHeaders(),
    },
  });
}

function accepted(): Response {
  return new Response(null, { status: 202, headers: corsHeaders() });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
