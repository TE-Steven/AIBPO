import path from "node:path";
import { Fragment } from "react";
import { Document, Page, View, Text, Font, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import { lexer } from "marked";
import type { Token, Tokens } from "marked";

let fontsRegistered = false;

function ensureFontsRegistered() {
  if (fontsRegistered) return;
  Font.register({
    family: "NotoSansTC",
    fonts: [
      { src: path.join(process.cwd(), "src/fonts/NotoSansCJKtc-Regular.otf"), fontWeight: "normal" },
      { src: path.join(process.cwd(), "src/fonts/NotoSansCJKtc-Bold.otf"), fontWeight: "bold" },
    ],
  });
  // 預設的英文斷字規則會把中文字硬拆開，關掉讓每個詞（含中文）都當一個不可拆的單位。
  Font.registerHyphenationCallback((word) => [word]);
  fontsRegistered = true;
}

const styles = StyleSheet.create({
  page: { fontFamily: "NotoSansTC", fontSize: 10.5, lineHeight: 1.6, padding: 40 },
  h1: { fontSize: 16, fontWeight: "bold", marginBottom: 6 },
  h2: { fontSize: 13, fontWeight: "bold", marginBottom: 5 },
  h3: { fontSize: 11.5, fontWeight: "bold", marginBottom: 4 },
  h4: { fontSize: 10.5, fontWeight: "bold", marginBottom: 3, color: "#334155" },
  h5: { fontSize: 10, fontWeight: "bold", marginBottom: 3, color: "#64748b" },
  paragraph: { marginBottom: 8 },
  listWrap: { marginBottom: 8 },
  listItem: { flexDirection: "row", marginBottom: 3 },
  bullet: { width: 14 },
  listItemText: { flex: 1 },
  tableWrap: { marginBottom: 8 },
  tableRow: { flexDirection: "row" },
  tableHeaderCell: {
    flex: 1,
    borderWidth: 0.5,
    borderColor: "#cbd5e1",
    padding: 4,
    fontSize: 9.5,
    fontWeight: "bold",
    backgroundColor: "#f1f5f9",
  },
  tableCell: { flex: 1, borderWidth: 0.5, borderColor: "#cbd5e1", padding: 4, fontSize: 9.5 },
  strong: { fontWeight: "bold" },
  em: { fontStyle: "italic" },
  code: { fontFamily: "Courier" },
});

function headingStyle(depth: number) {
  if (depth <= 1) return styles.h1;
  if (depth === 2) return styles.h2;
  if (depth === 3) return styles.h3;
  if (depth === 4) return styles.h4;
  return styles.h5;
}

function renderInline(tokens: Token[] | undefined, fallbackText: string): React.ReactNode {
  if (!tokens || tokens.length === 0) return fallbackText;
  return tokens.map((t, i) => {
    if (t.type === "strong") {
      return (
        <Text key={i} style={styles.strong}>
          {renderInline((t as Tokens.Strong).tokens, (t as Tokens.Strong).text)}
        </Text>
      );
    }
    if (t.type === "em") {
      return (
        <Text key={i} style={styles.em}>
          {renderInline((t as Tokens.Em).tokens, (t as Tokens.Em).text)}
        </Text>
      );
    }
    if (t.type === "codespan") {
      return (
        <Text key={i} style={styles.code}>
          {(t as Tokens.Codespan).text}
        </Text>
      );
    }
    if (t.type === "link") {
      return <Text key={i}>{renderInline((t as Tokens.Link).tokens, (t as Tokens.Link).text)}</Text>;
    }
    if (t.type === "br") return "\n";
    // 緊湊清單（項目間沒有空行，例如我們產出的「- **欄位**：內容」）裡，marked 會把每個項目包成一個
    // type==="text" 的外層 token，真正的行內格式（粗體等）藏在它自己的 tokens 裡，不會被拆到上一層。
    // 沒有這一步，粗體標記會整段當純文字印出來，變成看得到 ** 符號的原始 markdown。
    if (t.type === "text") {
      const textToken = t as Tokens.Text;
      if (textToken.tokens && textToken.tokens.length > 0) {
        return <Fragment key={i}>{renderInline(textToken.tokens, textToken.text)}</Fragment>;
      }
      return textToken.text;
    }
    if ("text" in t) return (t as { text: string }).text;
    return null;
  });
}

function renderHeading(token: Tokens.Heading, key: string) {
  return (
    <Text key={key} style={headingStyle(token.depth)}>
      {renderInline(token.tokens, token.text)}
    </Text>
  );
}

function renderParagraph(token: Tokens.Paragraph, key: string) {
  return (
    <Text key={key} style={styles.paragraph}>
      {renderInline(token.tokens, token.text)}
    </Text>
  );
}

function renderList(token: Tokens.List, key: string) {
  return (
    <View key={key} style={styles.listWrap}>
      {token.items.map((item, i) => (
        <View key={i} style={styles.listItem} wrap={false}>
          <Text style={styles.bullet}>{token.ordered ? `${(Number(token.start) || 1) + i}.` : "•"}</Text>
          <Text style={styles.listItemText}>{renderInline(item.tokens, item.text)}</Text>
        </View>
      ))}
    </View>
  );
}

function renderTable(token: Tokens.Table, key: string) {
  return (
    <View key={key} style={styles.tableWrap}>
      <View style={styles.tableRow} wrap={false}>
        {token.header.map((cell, i) => (
          <Text key={i} style={styles.tableHeaderCell}>
            {renderInline(cell.tokens, cell.text)}
          </Text>
        ))}
      </View>
      {token.rows.map((row, ri) => (
        <View key={ri} style={styles.tableRow} wrap={false}>
          {row.map((cell, ci) => (
            <Text key={ci} style={styles.tableCell}>
              {renderInline(cell.tokens, cell.text)}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

function renderFallback(token: Token, key: string) {
  const raw = "raw" in token ? token.raw.trim() : "";
  if (!raw) return null;
  return (
    <Text key={key} style={styles.paragraph}>
      {raw}
    </Text>
  );
}

function renderBlock(token: Token, key: string): React.ReactNode {
  switch (token.type) {
    case "heading":
      return renderHeading(token as Tokens.Heading, key);
    case "paragraph":
      return renderParagraph(token as Tokens.Paragraph, key);
    case "list":
      return renderList(token as Tokens.List, key);
    case "table":
      return renderTable(token as Tokens.Table, key);
    case "space":
      return null;
    default:
      return renderFallback(token, key);
  }
}

/** 段落 500 字以內、清單 ≤5 項、表格 ≤8 列才視為「夠小」，可以跟標題綁在同一頁；其餘一律正常排版。 */
function isSmallBlock(token: Token): boolean {
  if (token.type === "paragraph") return (token as Tokens.Paragraph).text.length <= 500;
  if (token.type === "list") return (token as Tokens.List).items.length <= 5;
  if (token.type === "table") return (token as Tokens.Table).rows.length <= 8;
  return true;
}

/**
 * 每個標題（不分 H1/H2/H3）都跟緊接的第一個小區塊綁在同一個不可拆頁的區塊，避免標題孤零零留在頁尾。
 * 只綁「標題+第一小塊」，不是整個章節到下一個標題為止的全部內容——這樣長章節還是能正常跨頁，不會被硬擠爆版。
 */
function renderTokens(tokens: Token[]): React.ReactNode[] {
  const elements: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < tokens.length) {
    const token = tokens[i];

    if (token.type === "space") {
      i += 1;
      continue;
    }

    if (token.type === "heading") {
      let j = i + 1;
      while (j < tokens.length && tokens[j].type === "space") j += 1;
      const next = tokens[j];

      if (next && next.type !== "heading" && isSmallBlock(next)) {
        elements.push(
          <View key={key++} wrap={false}>
            {renderBlock(token, "h")}
            {renderBlock(next, "b")}
          </View>,
        );
        i = j + 1;
      } else {
        elements.push(
          <View key={key++} wrap={false}>
            {renderBlock(token, "h")}
          </View>,
        );
        i += 1;
      }
      continue;
    }

    elements.push(renderBlock(token, `t${key++}`));
    i += 1;
  }

  return elements;
}

function RagPdfDocument({ markdown, title }: { markdown: string; title?: string }) {
  const tokens = lexer(markdown);
  return (
    <Document title={title}>
      <Page size="A4" style={styles.page}>
        {renderTokens(tokens)}
      </Page>
    </Document>
  );
}

export async function generateRagPdf(markdown: string, title?: string): Promise<Buffer> {
  ensureFontsRegistered();
  return renderToBuffer(<RagPdfDocument markdown={markdown} title={title} />);
}
