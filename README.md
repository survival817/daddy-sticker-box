# daddy-sticker-box

Daddy 的破图盒子：一个独立的 Cloudflare Worker，作为远程 MCP 服务，让 ChatGPT 挑贴纸、发贴纸。图片放在本仓库 `stickers/`，经 jsDelivr 读取。没有数据库，也没有账号。入口是 `POST /mcp`（无状态 JSON-RPC），`GET /` 用来看服务是否活着。

三个工具：`list_stickers` 按标签列清单，`pick_sticker` 按一句话挑一张，`show_sticker` 把选中的图发给对方（带贴纸卡片）。v1 不做鉴权，内容是公开贴纸。

## 加一张贴纸

1. 把图片放进 `stickers/N.jpg`（例如 `7.jpg`）。
2. 在 `stickers.json` 加一条，写上 `id`、`file`、`tags`、`meaning`、`usage_hint`。

图片地址是 `https://cdn.jsdelivr.net/gh/<GH_USER>/<GH_REPO>@main/stickers/N.jpg`。`GH_USER` 和 `GH_REPO` 在 `wrangler.toml` 的 `[vars]` 里。

## 本地检查

```bash
npm install
npm run typecheck
npm test
npm run dev
```

`npm run dev` 只在本机 8787 端口启动，不会部署。另开终端：

```bash
curl -s http://127.0.0.1:8787/

curl -s http://127.0.0.1:8787/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'

curl -s http://127.0.0.1:8787/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'

curl -s http://127.0.0.1:8787/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"pick_sticker","arguments":{"query":"得意"}}}'

curl -s http://127.0.0.1:8787/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"show_sticker","arguments":{"id":"1"}}}'
```

## 部署

部署留到主人同意之后。同意后再运行 `wrangler deploy`，这条命令会新建一个 Worker。然后把 `https://<worker>.workers.dev/mcp` 加为 ChatGPT 的 connector。

ChatGPT 里的图片和贴纸卡片是否能渲染，必须在部署之后亲自确认。v1 没有鉴权。
