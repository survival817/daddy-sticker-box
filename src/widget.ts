export const WIDGET_URI = "ui://widget/sticker.html";
export const WIDGET_MIME = "text/html+skybridge";

export const WIDGET_HTML = `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>贴纸</title>
<style>
  html, body { margin: 0; background: transparent; }
  img { max-width: 240px; height: auto; border-radius: 12px; display: block; }
</style>
</head>
<body>
<div id="root"></div>
<script>
  function render() {
    var data = (window.openai && window.openai.toolOutput) || {};
    var root = document.getElementById("root");
    if (!root) return;
    root.textContent = "";
    if (typeof data.url !== "string" || data.url.length === 0) return;
    var img = document.createElement("img");
    img.src = data.url;
    img.alt = typeof data.meaning === "string" ? data.meaning : "";
    root.appendChild(img);
  }
  window.addEventListener("openai:set_globals", render);
  render();
</script>
</body>
</html>
`;
