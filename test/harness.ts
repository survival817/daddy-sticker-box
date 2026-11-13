import worker from "../src/index";
import { pickSticker, scoreSticker, STICKERS } from "../src/stickers";
import type { Env } from "../src/types";
import stickers from "../stickers.json";

const env: Env = { GH_USER: "survival817", GH_REPO: "daddy-sticker-box" };

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, actual?: unknown): void {
  if (ok) {
    passed += 1;
    console.log(`ok  ${name}`);
    return;
  }
  failed += 1;
  const extra = actual === undefined ? "" : ` ${JSON.stringify(actual)}`;
  console.error(`FAIL ${name}${extra}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exit1(): never {
  const proc = (globalThis as { process?: { exit(code: number): never } }).process;
  if (proc) proc.exit(1);
  throw new Error("tests failed");
}

function expectedUrl(custom: Env, file: string): string {
  return `https://cdn.jsdelivr.net/gh/${custom.GH_USER}/${custom.GH_REPO}@main/stickers/${file}`;
}

async function call(request: Request, custom: Env = env): Promise<Response> {
  return worker.fetch(request, custom);
}

async function post(body: unknown, custom: Env = env, path = "/mcp"): Promise<Response> {
  return call(
    new Request(`https://sticker.test${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    custom,
  );
}

async function rpc(method: string, params?: unknown, id: string | number = 1, custom: Env = env) {
  const message: Record<string, unknown> = { jsonrpc: "2.0", id, method };
  if (params !== undefined) message.params = params;
  const res = await post(message, custom);
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { res, body };
}

function assertCors(name: string, res: Response): void {
  check(`${name} allow-origin`, res.headers.get("access-control-allow-origin") === "*");
  const methods = res.headers.get("access-control-allow-methods") ?? "";
  check(
    `${name} allow-methods`,
    methods.includes("GET") && methods.includes("POST") && methods.includes("OPTIONS"),
  );
}

function resultOf(body: unknown): Record<string, unknown> | undefined {
  if (!isRecord(body) || !isRecord(body.result)) return undefined;
  return body.result;
}

async function testHealthAndCors(): Promise<void> {
  const health = await call(new Request("https://sticker.test/"));
  check("GET / status", health.status === 200);
  check("GET / body", (await health.text()) === "daddy-sticker-box ok");
  check("GET / content-type", (health.headers.get("content-type") ?? "").includes("text/plain"));
  assertCors("GET /", health);

  const preflight = await call(
    new Request("https://sticker.test/mcp", {
      method: "OPTIONS",
      headers: {
        Origin: "https://chatgpt.com",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
      },
    }),
  );
  check("OPTIONS status", preflight.status === 204);
  check("OPTIONS empty", (await preflight.text()) === "");
  assertCors("OPTIONS", preflight);
  const allowHeaders = (preflight.headers.get("access-control-allow-headers") ?? "").toLowerCase();
  check("OPTIONS allow content-type", allowHeaders.includes("content-type"));

  const missing = await call(new Request("https://sticker.test/nope", { method: "POST" }));
  check("unknown path", missing.status === 404);
  assertCors("404", missing);
}

async function testProtocol(): Promise<void> {
  const echoed = await rpc("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "harness", version: "0" },
  });
  check("initialize status", echoed.res.status === 200);
  check("initialize content-type", (echoed.res.headers.get("content-type") ?? "").includes("application/json"));
  assertCors("initialize", echoed.res);
  const echoedResult = resultOf(echoed.body);
  check("initialize echoes protocol", echoedResult?.protocolVersion === "2025-06-18", echoed.body);
  const caps = isRecord(echoedResult?.capabilities) ? echoedResult.capabilities : undefined;
  check("initialize tools capability", isRecord(caps) && isRecord(caps.tools));
  check("initialize resources capability", isRecord(caps) && isRecord(caps.resources));
  const info = isRecord(echoedResult?.serverInfo) ? echoedResult.serverInfo : undefined;
  check("initialize server name", info?.name === "daddy-sticker-box", info);

  const fallback = await rpc("initialize");
  const fallbackResult = resultOf(fallback.body);
  check("initialize default protocol", fallbackResult?.protocolVersion === "2025-03-26", fallback.body);

  const ping = await rpc("ping", undefined, "ping-1");
  check("ping status", ping.res.status === 200);
  const pingBody = isRecord(ping.body) ? ping.body : undefined;
  check("ping id", pingBody?.id === "ping-1");
  check("ping result", isRecord(pingBody?.result) && Object.keys(pingBody.result).length === 0, ping.body);

  const stateless = await rpc("tools/list");
  check("stateless tools/list", stateless.res.status === 200 && resultOf(stateless.body)?.tools !== undefined);

  const unknown = await rpc("tools/nope", undefined, 9);
  check("unknown method status", unknown.res.status === 200);
  const unknownBody = isRecord(unknown.body) ? unknown.body : undefined;
  const unknownError = isRecord(unknownBody?.error) ? unknownBody.error : undefined;
  check("unknown method code", unknownError?.code === -32601, unknown.body);
  check("unknown method id", unknownBody?.id === 9);

  const bad = await post("{");
  check("bad JSON status", bad.status === 400);
  assertCors("bad JSON", bad);
  const badBody = JSON.parse(await bad.text()) as Record<string, unknown>;
  const badError = isRecord(badBody.error) ? badBody.error : undefined;
  check("bad JSON code", badError?.code === -32700, badBody);
  check("bad JSON id", badBody.id === null);

  const invalid = await post({ jsonrpc: "2.0", id: 3 });
  const invalidJson = JSON.parse(await invalid.text()) as Record<string, unknown>;
  const invalidError = isRecord(invalidJson.error) ? invalidJson.error : undefined;
  check("invalid request", invalid.status === 400 && invalidError?.code === -32600, invalidJson);

  const note = await post({ jsonrpc: "2.0", method: "notifications/initialized" });
  check("notification status", note.status === 202);
  check("notification empty", (await note.text()) === "");
  assertCors("notification", note);

  const batch = await post([
    { jsonrpc: "2.0", id: 1, method: "ping" },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "2024-11-05" } },
  ]);
  check("batch status", batch.status === 200);
  check("batch content-type", (batch.headers.get("content-type") ?? "").includes("application/json"));
  const batchBody = JSON.parse(await batch.text()) as unknown;
  check("batch is array", Array.isArray(batchBody) && batchBody.length === 2, batchBody);
  if (Array.isArray(batchBody)) {
    const first = isRecord(batchBody[0]) ? batchBody[0] : undefined;
    const second = isRecord(batchBody[1]) ? batchBody[1] : undefined;
    const secondResult = isRecord(second?.result) ? second.result : undefined;
    check("batch keeps request order", first?.id === 1 && isRecord(first?.result));
    check("batch echoes later protocol", second?.id === 2 && secondResult?.protocolVersion === "2024-11-05");
  }

  const notes = await post([
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", method: "notifications/cancelled" },
  ]);
  check("notification batch status", notes.status === 202);
  check("notification batch empty", (await notes.text()) === "");

  const emptyBatch = await post("[]");
  const emptyJson = JSON.parse(await emptyBatch.text()) as Record<string, unknown>;
  const emptyError = isRecord(emptyJson.error) ? emptyJson.error : undefined;
  check("empty batch", emptyBatch.status === 400 && emptyError?.code === -32600, emptyJson);
}

async function testTools(): Promise<void> {
  const listed = await rpc("tools/list");
  const tools = resultOf(listed.body)?.tools;
  check("tools/list array", Array.isArray(tools) && tools.length === 3, tools);
  if (!Array.isArray(tools)) return;

  const byName = new Map<string, Record<string, unknown>>();
  for (const tool of tools) {
    if (isRecord(tool) && typeof tool.name === "string") byName.set(tool.name, tool);
  }
  check("tool names", ["list_stickers", "pick_sticker", "show_sticker"].every((name) => byName.has(name)));

  for (const name of ["list_stickers", "pick_sticker", "show_sticker"]) {
    const description = byName.get(name)?.description;
    check(
      `${name} tells the model when to use it`,
      typeof description === "string" && description.includes("使用") && description.length > 20,
    );
  }

  const show = byName.get("show_sticker");
  const showDescription = show?.description;
  check(
    "show tells the model the widget has the image",
    typeof showDescription === "string" &&
      showDescription.includes("贴纸卡片") &&
      showDescription.includes("不要") &&
      showDescription.includes("Markdown 图片") &&
      !showDescription.includes("返回 Markdown 图片"),
    showDescription,
  );
  const showMeta = isRecord(show?._meta) ? show._meta : undefined;
  check("tools/list outputTemplate", showMeta?.["openai/outputTemplate"] === "ui://widget/sticker.html", showMeta);
  check("tools/list invoking", showMeta?.["openai/toolInvocation/invoking"] === "找图中\u2026");
  check("tools/list invoked", showMeta?.["openai/toolInvocation/invoked"] === "图来了");
  check("list has no widget", !isRecord(byName.get("list_stickers")?._meta));
  check("pick has no widget", !isRecord(byName.get("pick_sticker")?._meta));

  const listSchema = isRecord(byName.get("list_stickers")?.inputSchema) ? byName.get("list_stickers")?.inputSchema : undefined;
  const pickSchema = isRecord(byName.get("pick_sticker")?.inputSchema) ? byName.get("pick_sticker")?.inputSchema : undefined;
  const showSchema = isRecord(byName.get("show_sticker")?.inputSchema) ? byName.get("show_sticker")?.inputSchema : undefined;
  const listSchemaRecord = isRecord(listSchema) ? listSchema : undefined;
  const pickSchemaRecord = isRecord(pickSchema) ? pickSchema : undefined;
  const showSchemaRecord = isRecord(showSchema) ? showSchema : undefined;
  check("list tag optional", !listSchemaRecord?.required);
  check(
    "pick requires query",
    Array.isArray(pickSchemaRecord?.required) && pickSchemaRecord.required.includes("query"),
  );
  check(
    "show requires id",
    Array.isArray(showSchemaRecord?.required) && showSchemaRecord.required.includes("id"),
  );
}

async function testCatalog(): Promise<void> {
  check("catalog size", stickers.length === 10 && STICKERS.length === 10);
  check(
    "catalog ids",
    stickers.map((sticker) => sticker.id).join(",") === "1,2,4,5,6,7,8,9,10,11",
  );
  check(
    "catalog files",
    stickers.map((sticker) => sticker.file).join(",") === "1.jpg,2.jpg,4.jpg,5.jpg,6.jpg,7.jpg,8.jpg,9.jpg,10.jpg,11.jpg",
  );
  check("sticker 3 removed", stickers.every((sticker) => sticker.id !== "3" && sticker.file !== "3.jpg"));
  check(
    "catalog tags",
    stickers.map((sticker) => sticker.tags.join(",")).join("|") ===
      "无语,嫌弃,冷眼|被拿捏,凶不起来,服了|摆烂,淡定,看透了|震惊,傻眼,懵了|吃瓜,看戏,躺平|委屈,撒娇,求抱抱|偷看,窥屏,等消息|伴侣嘎了,哀嚎,崩溃|累趴,放弃,不用再战斗了|舔屏,斯哈斯哈,馋了",
  );

  const all = await rpc("tools/call", { name: "list_stickers", arguments: {} });
  const allResult = resultOf(all.body);
  const structured = isRecord(allResult?.structuredContent) ? allResult.structuredContent : undefined;
  const rows = Array.isArray(structured?.stickers) ? structured.stickers : [];
  check("list_stickers count", rows.length === 10, rows);
  const text = Array.isArray(allResult?.content) && isRecord(allResult.content[0]) ? allResult.content[0].text : "";
  check("list_stickers text", typeof text === "string" && text.includes("全部贴纸"));

  rows.forEach((row, index) => {
    if (!isRecord(row)) {
      check(`list row ${index}`, false, row);
      return;
    }
    const source = stickers[index];
    if (!source) return;
    const url = expectedUrl(env, source.file);
    check(
      `list ${source.id} fields`,
      row.id === source.id &&
        row.meaning === source.meaning &&
        row.usage_hint === source.usage_hint &&
        row.url === url &&
        Array.isArray(row.tags) &&
        row.tags.join(",") === source.tags.join(","),
      row,
    );
  });

  const filtered = await rpc("tools/call", { name: "list_stickers", arguments: { tag: "无语" } });
  const filteredRows = stickersOf(resultOf(filtered.body));
  check("filter tag", filteredRows.length === 1 && isRecord(filteredRows[0]) && filteredRows[0].id === "1", filteredRows);

  const none = await rpc("tools/call", { name: "list_stickers", arguments: { tag: "没有这个标签" } });
  check("filter miss", stickersOf(resultOf(none.body)).length === 0);

  const otherEnv: Env = { GH_USER: "octocat", GH_REPO: "widgets" };
  const other = await rpc("tools/call", { name: "list_stickers", arguments: { tag: "舔屏" } }, 1, otherEnv);
  const otherRows = stickersOf(resultOf(other.body));
  check(
    "url uses GH_USER and GH_REPO",
    otherRows.length === 1 && isRecord(otherRows[0]) && otherRows[0].url === expectedUrl(otherEnv, "11.jpg"),
    otherRows[0],
  );
}

function assertWidgetCsp(name: string, meta: unknown): void {
  if (!isRecord(meta)) {
    check(`${name} csp meta`, false, meta);
    return;
  }
  const openai = isRecord(meta["openai/widgetCSP"]) ? meta["openai/widgetCSP"] : undefined;
  const domains = Array.isArray(openai?.resource_domains) ? openai.resource_domains : [];
  check(
    `${name} openai/widgetCSP`,
    Array.isArray(openai?.connect_domains) &&
      openai.connect_domains.length === 0 &&
      domains.length === 1 &&
      domains[0] === "https://cdn.jsdelivr.net",
    openai,
  );
  const ui = isRecord(meta.ui) ? meta.ui : undefined;
  const csp = isRecord(ui?.csp) ? ui.csp : undefined;
  const resourceDomains = Array.isArray(csp?.resourceDomains) ? csp.resourceDomains : [];
  check(
    `${name} ui.csp.resourceDomains`,
    Array.isArray(csp?.connectDomains) &&
      csp.connectDomains.length === 0 &&
      resourceDomains.length === 1 &&
      resourceDomains[0] === "https://cdn.jsdelivr.net",
    csp,
  );
}

function stickersOf(result: Record<string, unknown> | undefined): unknown[] {
  const structured = isRecord(result?.structuredContent) ? result.structuredContent : undefined;
  return Array.isArray(structured?.stickers) ? structured.stickers : [];
}

async function testPick(): Promise<void> {
  const cases: Array<[string, string]> = [
    ["无语", "1"],
    ["嫌弃", "1"],
    ["冷眼", "1"],
    ["被拿捏", "2"],
    ["凶不起来", "2"],
    ["服了", "2"],
    ["摆烂", "4"],
    ["淡定", "4"],
    ["看透了", "4"],
    ["震惊", "5"],
    ["傻眼", "5"],
    ["懵了", "5"],
    ["吃瓜", "6"],
    ["看戏", "6"],
    ["躺平", "6"],
    ["委屈", "7"],
    ["撒娇", "7"],
    ["求抱抱", "7"],
    ["偷看", "8"],
    ["窥屏", "8"],
    ["等消息", "8"],
    ["伴侣嘎了", "9"],
    ["哀嚎", "9"],
    ["崩溃", "9"],
    ["累趴", "10"],
    ["放弃", "10"],
    ["不用再战斗了", "10"],
    ["舔屏", "11"],
    ["斯哈斯哈", "11"],
    ["馋了", "11"],
    ["有点委屈", "7"],
    ["想舔屏", "11"],
    ["我不能哈气了", "2"],
    ["可以不用再战斗了", "10"],
  ];
  for (const [query, id] of cases) {
    const response = await rpc("tools/call", { name: "pick_sticker", arguments: { query } });
    const result = resultOf(response.body);
    const structured = isRecord(result?.structuredContent) ? result.structuredContent : undefined;
    check(`pick ${query}`, structured?.id === id && structured.matched === true, structured);
  }

  const tagHit = scoreSticker(mustSticker("1"), "无语");
  const meaningHit = scoreSticker(mustSticker("1"), "黑猫冷着脸");
  const mentioned = scoreSticker(mustSticker("1"), "伴侣");
  const tagContains = scoreSticker(mustSticker("9"), "伴侣");
  check("tag outweighs a usage mention", tagContains > mentioned && mentioned > 0, {
    tagContains,
    mentioned,
  });
  check("tag weight beats longer meaning text", tagHit > meaningHit && meaningHit > 0, { tagHit, meaningHit });
  check(
    "unrelated query scores zero",
    STICKERS.every((sticker) => scoreSticker(sticker, "zzzzzz") === 0),
  );

  const sample = await rpc("tools/call", { name: "pick_sticker", arguments: { query: "无语" } });
  const sampleResult = resultOf(sample.body);
  const sampleStructured = isRecord(sampleResult?.structuredContent) ? sampleResult.structuredContent : undefined;
  const sampleText = Array.isArray(sampleResult?.content) && isRecord(sampleResult.content[0]) ? sampleResult.content[0].text : "";
  check("pick text summary", typeof sampleText === "string" && sampleText.includes(String(sampleStructured?.url)));
  check(
    "pick structured fields",
    typeof sampleStructured?.url === "string" &&
      Array.isArray(sampleStructured.tags) &&
      typeof sampleStructured.meaning === "string" &&
      typeof sampleStructured.usage_hint === "string",
  );

  const tieQuery = "的时候";
  const tieScores = STICKERS.map((sticker) => scoreSticker(sticker, tieQuery));
  const tieBest = Math.max(...tieScores);
  const tied = STICKERS.filter((sticker) => scoreSticker(sticker, tieQuery) === tieBest).map((sticker) => sticker.id);
  check("tie set", tied.length === STICKERS.length && tieBest > 0, { tieBest, tied });

  const low = pickSticker(tieQuery, () => 0);
  const high = pickSticker(tieQuery, () => 0.999999);
  check(
    "random among top ties",
    low.matched && high.matched && low.sticker.id !== high.sticker.id && tied.includes(low.sticker.id) && tied.includes(high.sticker.id),
    { low: low.sticker.id, high: high.sticker.id },
  );

  const seen = new Set<string>();
  let tieMatched = true;
  for (let i = 0; i < 16; i++) {
    const response = await rpc("tools/call", { name: "pick_sticker", arguments: { query: tieQuery } }, i + 1);
    const structured = isRecord(resultOf(response.body)?.structuredContent) ? resultOf(response.body)?.structuredContent : undefined;
    if (!isRecord(structured) || structured.matched !== true || typeof structured.id !== "string" || !tied.includes(structured.id)) {
      tieMatched = false;
    } else {
      seen.add(structured.id);
    }
  }
  check("worker tie picks stay in the top set", tieMatched, [...seen]);
  check("worker tie picks vary", seen.size > 1, [...seen]);

  const missLow = pickSticker("zzzzzz", () => 0);
  const missHigh = pickSticker("zzzzzz", () => 0.999999);
  check(
    "no match is random and marked",
    missLow.matched === false && missHigh.matched === false && missLow.sticker.id !== missHigh.sticker.id,
  );

  const misses = new Set<string>();
  let missOk = true;
  for (let i = 0; i < 16; i++) {
    const response = await rpc("tools/call", { name: "pick_sticker", arguments: { query: "zzzzzz" } });
    const structured = isRecord(resultOf(response.body)?.structuredContent) ? resultOf(response.body)?.structuredContent : undefined;
    if (!isRecord(structured) || structured.matched !== false || typeof structured.id !== "string") {
      missOk = false;
      continue;
    }
    const source = stickers.find((sticker) => sticker.id === structured.id);
    if (!source || structured.url !== expectedUrl(env, source.file)) missOk = false;
    misses.add(structured.id);
  }
  check("worker no-match flag", missOk, [...misses]);
  check("worker no-match varies", misses.size > 1, [...misses]);

  const missingQuery = await rpc("tools/call", { name: "pick_sticker", arguments: {} });
  check("pick missing query", resultOf(missingQuery.body)?.isError === true);
}

function mustSticker(id: string) {
  const sticker = STICKERS.find((item) => item.id === id);
  if (!sticker) throw new Error(`missing sticker ${id}`);
  return sticker;
}

async function testShow(): Promise<void> {
  const source = stickers.find((sticker) => sticker.id === "1");
  if (!source) throw new Error("missing sticker 1");
  const url = expectedUrl(env, source.file);
  const response = await rpc("tools/call", { name: "show_sticker", arguments: { id: "1" } });
  const result = resultOf(response.body);
  const text = Array.isArray(result?.content) && isRecord(result.content[0]) ? result.content[0].text : "";
  check(
    "show text leaves the image to the widget",
    text === `贴纸 ${source.id}（${source.meaning}）。图片已由贴纸卡片展示，不要再嵌入 Markdown 图片。`,
    text,
  );
  check("show text is not a markdown image", typeof text === "string" && !text.includes("![") && !text.includes(url), text);
  const structured = isRecord(result?.structuredContent) ? result.structuredContent : undefined;
  check(
    "show structuredContent",
    structured?.id === "1" &&
      structured.url === url &&
      structured.meaning === source.meaning &&
      structured.usage_hint === source.usage_hint &&
      Object.keys(structured).sort().join(",") === "id,meaning,url,usage_hint",
    structured,
  );
  const meta = isRecord(result?._meta) ? result._meta : undefined;
  check("show outputTemplate", meta?.["openai/outputTemplate"] === "ui://widget/sticker.html", meta);
  check("show invoking", meta?.["openai/toolInvocation/invoking"] === "找图中\u2026");
  check("show invoked", meta?.["openai/toolInvocation/invoked"] === "图来了");
  check("show not error", result?.isError !== true);

  const missing = await rpc("tools/call", { name: "show_sticker", arguments: { id: "99" } });
  const missingResult = resultOf(missing.body);
  const missingText = Array.isArray(missingResult?.content) && isRecord(missingResult.content[0]) ? missingResult.content[0].text : "";
  check("unknown id isError", missingResult?.isError === true && typeof missingText === "string" && missingText.includes("99"));
  check("unknown id has no card", missingResult?.structuredContent === undefined && missingResult?._meta === undefined);

  const unknownTool = await rpc("tools/call", { name: "dance", arguments: {} });
  check("unknown tool isError", resultOf(unknownTool.body)?.isError === true);
}

async function testResources(): Promise<void> {
  const listed = await rpc("resources/list");
  const resources = resultOf(listed.body)?.resources;
  check("resources/list", Array.isArray(resources) && resources.length === 1, resources);
  const resource = Array.isArray(resources) && isRecord(resources[0]) ? resources[0] : undefined;
  check("widget uri", resource?.uri === "ui://widget/sticker.html");
  check("widget mime", resource?.mimeType === "text/html+skybridge");
  assertWidgetCsp("resources/list", resource?._meta);

  const read = await rpc("resources/read", { uri: "ui://widget/sticker.html" });
  const contents = resultOf(read.body)?.contents;
  const widget = Array.isArray(contents) && isRecord(contents[0]) ? contents[0] : undefined;
  const html = typeof widget?.text === "string" ? widget.text : "";
  check("widget read mime", widget?.mimeType === "text/html+skybridge");
  assertWidgetCsp("resources/read", widget?._meta);
  check("widget reads toolOutput", html.includes("window.openai") && html.includes("toolOutput"));
  check("widget listens for set_globals", html.includes("openai:set_globals"));
  check("widget renders on load", html.includes("render();"));
  check("widget re-reads toolOutput from the event", html.includes("globals.toolOutput"));
  check("widget renders img", html.includes("createElement(\"img\")") || html.includes("createElement('img')"));
  check("widget clears before a new img", html.includes('textContent = ""'));
  check("widget uses url and meaning", html.includes("data.url") && html.includes("data.meaning"));
  check("widget max width", html.includes("max-width: 240px"));
  check("widget rounded corners", html.includes("border-radius: 12px"));

  const missing = await rpc("resources/read", { uri: "ui://widget/missing.html" });
  const missingBody = isRecord(missing.body) ? missing.body : undefined;
  const missingError = isRecord(missingBody?.error) ? missingBody.error : undefined;
  check("missing resource", missingError?.code === -32002, missing.body);
}

async function main(): Promise<void> {
  console.log("daddy-sticker-box tests");
  await testHealthAndCors();
  await testProtocol();
  await testTools();
  await testCatalog();
  await testPick();
  await testShow();
  await testResources();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) exit1();
}

main().catch((error: unknown) => {
  console.error(error);
  exit1();
});
