// 把整份 md 依 H1（# 標題）切成多份：結構化文件一個 H1 就是一份文件，上傳到後台時各自一個 md 檔。純函式。

export type MarkdownPart = { title: string; content: string };

export function splitMarkdownByH1(markdown: string): MarkdownPart[] {
  const parts: MarkdownPart[] = [];
  const preamble: string[] = [];
  let current: { title: string; lines: string[] } | null = null;
  let inFence = false;

  for (const line of markdown.split("\n")) {
    // 程式碼區塊裡的 # 不算標題
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const h1 = !inFence ? line.match(/^#\s+(.+?)\s*#*\s*$/) : null;
    if (h1) {
      if (current) parts.push({ title: current.title, content: current.lines.join("\n").trim() });
      current = { title: h1[1].trim(), lines: [line] };
    } else if (current) {
      current.lines.push(line);
    } else {
      preamble.push(line);
    }
  }
  if (current) parts.push({ title: current.title, content: current.lines.join("\n").trim() });

  // 第一個 H1 之前的內容（通常沒有）併到第一份，避免遺失
  const intro = preamble.join("\n").trim();
  if (intro && parts.length > 0) parts[0] = { ...parts[0], content: `${intro}\n\n${parts[0].content}` };
  return parts;
}
