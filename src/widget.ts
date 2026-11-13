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
  function render(event) {
    var data = (window.openai && window.openai.toolOutput) || {};
    var globals = event && event.detail && event.detail.globals;
    if (globals && globals.toolOutput && typeof globals.toolOutput === "object") {
      data = globals.toolOutput;
    }
    var root = document.getElementById("root");
    if (!root) return;
    var url = typeof data.url === "string" ? data.url : "";
    var meaning = typeof data.meaning === "string" ? data.meaning : "";
    var current = root.querySelector("img");
    if (url.length === 0) {
      root.textContent = "";
      return;
    }
    if (current && current.getAttribute("src") === url && current.alt === meaning && root.children.length === 1) {
      return;
    }
    root.textContent = "";
    var img = document.createElement("img");
    img.src = data.url;
    img.alt = meaning;
    root.appendChild(img);
  }
  window.addEventListener("openai:set_globals", render);
  render();
</script>
</body>
</html>
`;
