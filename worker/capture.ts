import type { Browser } from "playwright-core";
import type { PageCapture, RawControl } from "@/lib/automationAnalysis";
import { isPublicHost } from "@/lib/automationUrl";

// 用瀏覽器打開表單頁面，擷取分析需要的資訊：可見文字、原生欄位、頁面自己載入的 JSON 設定資料、截圖，
// 並偵測不支援的情況（驗證碼、登入、付款）。只讀取頁面，不填寫、不送出。

const NAV_TIMEOUT_MS = 45_000;
const MAX_PAYLOAD_BYTES = 300_000;
const MAX_SCREENSHOT_HEIGHT = 7_000;

export type CaptureResult = { capture: PageCapture; blockers: string[] };

export async function capturePage(browser: Browser, url: string): Promise<CaptureResult> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "zh-TW" });
  // 頁面裡的每個請求（含轉址、子資源）都要指向公開網路，擋掉內部網址（SSRF）
  await context.route("**/*", async (route) => {
    try {
      const { protocol, hostname } = new URL(route.request().url());
      if (protocol === "data:" || protocol === "blob:") return route.continue();
      if ((protocol === "http:" || protocol === "https:") && (await isPublicHost(hostname))) return route.continue();
    } catch {
      // 網址解析失敗就擋
    }
    return route.abort("blockedbyclient");
  });
  const page = await context.newPage();
  // tsx（esbuild）編譯時會在函式外包 __name()；page.evaluate 的函式在瀏覽器裡執行，先補一個空的
  await page.addInitScript({ content: "window.__name = (fn) => fn;" });
  const payloads: { url: string; body: string }[] = [];
  page.on("response", async (res) => {
    try {
      const type = res.request().resourceType();
      if ((type !== "xhr" && type !== "fetch") || res.status() !== 200) return;
      if (!(res.headers()["content-type"] ?? "").includes("json")) return;
      const body = await res.text();
      if (body.length > 0 && body.length <= MAX_PAYLOAD_BYTES) payloads.push({ url: res.url().split("?")[0], body });
    } catch {
      // 回應讀不到就略過
    }
  });

  try {
    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: NAV_TIMEOUT_MS });
    } catch {
      // 有些頁面一直有連線（例如輪詢），等不到 networkidle：改等載入完成
      await page.goto(url, { waitUntil: "load", timeout: NAV_TIMEOUT_MS });
    }
    await page.waitForTimeout(1500);

    const info = await page.evaluate(() => {
      const visible = (el: Element) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
      };
      const clean = (t: string | null | undefined) => (t ?? "").replace(/\s+/g, " ").trim();

      // 不支援的情況
      const blockers: string[] = [];
      const frames = Array.from(document.querySelectorAll("iframe")).map((f) => f.src);
      if (
        frames.some((s) => /recaptcha|hcaptcha|turnstile|challenges\.cloudflare/i.test(s)) ||
        document.querySelector(".g-recaptcha, .h-captcha, .cf-turnstile, [data-sitekey]")
      ) {
        blockers.push("頁面有驗證碼（CAPTCHA），不支援自動填寫");
      }
      if (Array.from(document.querySelectorAll('input[type="password"]')).some(visible)) blockers.push("頁面需要登入（有密碼欄位），不支援自動填寫");
      if (document.querySelector('input[autocomplete^="cc-"], input[name*="card" i], input[name*="cvv" i], input[name*="cvc" i]')) {
        blockers.push("頁面看起來需要付款或信用卡資料，不支援自動填寫");
      }

      // 找欄位的標籤文字：<label>、aria-label、aria-labelledby、外層容器的第一行文字
      const labelOf = (el: HTMLElement): string | null => {
        const own = (el as HTMLInputElement).labels?.[0];
        if (own) return clean(own.innerText);
        const aria = el.getAttribute("aria-label");
        if (aria) return clean(aria);
        const by = el.getAttribute("aria-labelledby");
        if (by) {
          const t = by
            .split(/\s+/)
            .map((id) => document.getElementById(id)?.innerText ?? "")
            .join(" ");
          if (clean(t)) return clean(t);
        }
        let node: HTMLElement | null = el.parentElement;
        for (let i = 0; i < 4 && node; i++, node = node.parentElement) {
          const first = clean(node.innerText.split("\n").find((line) => clean(line)) ?? "");
          if (first && first.length <= 60) return first;
        }
        return null;
      };
      const selectorOf = (el: HTMLElement): string | null => {
        if (el.id) return `#${CSS.escape(el.id)}`;
        const name = el.getAttribute("name");
        if (name) return `${el.tagName.toLowerCase()}[name="${name.replace(/"/g, '\\"')}"]`;
        return null;
      };

      const controls: Omit<RawControl, "ref">[] = [];
      const groups = new Map<string, Omit<RawControl, "ref">>();
      const elements = Array.from(
        document.querySelectorAll<HTMLElement>("input, select, textarea, [role=combobox], [role=listbox], [role=radiogroup], [contenteditable=true]"),
      );
      for (const el of elements) {
        const tag = el.tagName.toLowerCase();
        const type = (el.getAttribute("type") ?? (tag === "input" ? "text" : tag)).toLowerCase();
        if (["hidden", "submit", "button", "reset", "image"].includes(type)) continue;
        const isChoice = type === "radio" || type === "checkbox";
        // 自訂樣式的單選／勾選常把原生 input 藏起來：看它的 label 有沒有顯示
        if (!visible(el) && !(isChoice && (el as HTMLInputElement).labels?.[0] && visible((el as HTMLInputElement).labels![0]))) continue;
        const name = el.getAttribute("name");
        const required = (el as HTMLInputElement).required || el.getAttribute("aria-required") === "true";
        if (isChoice && name) {
          const optionLabel = clean((el as HTMLInputElement).labels?.[0]?.innerText) || (el as HTMLInputElement).value;
          const g = groups.get(name);
          if (g) {
            g.options.push({ value: (el as HTMLInputElement).value, label: optionLabel });
            g.required = g.required || required;
            continue;
          }
          let groupLabel: string | null = null;
          const fieldset = el.closest("fieldset");
          if (fieldset?.querySelector("legend")) groupLabel = clean(fieldset.querySelector("legend")!.innerText);
          const control = {
            tag,
            type,
            name,
            id: el.id || null,
            label: groupLabel ?? labelOf(el.parentElement?.parentElement ?? el),
            placeholder: null,
            required,
            options: [{ value: (el as HTMLInputElement).value, label: optionLabel }],
            maxLength: null,
            pattern: null,
            role: el.getAttribute("role"),
            selector: `input[name="${name.replace(/"/g, '\\"')}"]`,
          };
          groups.set(name, control);
          controls.push(control);
          continue;
        }
        controls.push({
          tag,
          type,
          name,
          id: el.id || null,
          label: labelOf(el),
          placeholder: el.getAttribute("placeholder"),
          required,
          options:
            tag === "select"
              ? Array.from((el as HTMLSelectElement).options)
                  .map((o) => ({ value: o.value, label: clean(o.text) }))
                  .filter((o) => o.value || o.label)
              : [],
          maxLength: (el as HTMLInputElement).maxLength > 0 ? (el as HTMLInputElement).maxLength : null,
          pattern: el.getAttribute("pattern"),
          role: el.getAttribute("role"),
          selector: selectorOf(el),
        });
      }

      const submit = Array.from(document.querySelectorAll<HTMLElement>('button, input[type="submit"]')).find(
        (b) => visible(b) && (b.getAttribute("type") === "submit" || /送出|提交|申請|確認|submit/i.test(b.innerText || (b as HTMLInputElement).value || "")),
      );
      return {
        title: document.title,
        text: document.body.innerText.slice(0, 20_000),
        controls,
        blockers,
        submitText: submit ? clean(submit.innerText || (submit as HTMLInputElement).value) : null,
        height: document.documentElement.scrollHeight,
      };
    });

    const height = Math.min(info.height, MAX_SCREENSHOT_HEIGHT);
    const shot = await page.screenshot({ type: "jpeg", quality: 55, fullPage: info.height <= MAX_SCREENSHOT_HEIGHT, clip: info.height > MAX_SCREENSHOT_HEIGHT ? { x: 0, y: 0, width: 1280, height } : undefined });

    return {
      blockers: info.blockers,
      capture: {
        url,
        title: info.title,
        text: info.text,
        controls: info.controls.map((c, i) => ({ ...c, ref: `c${i + 1}` })),
        payloads,
        screenshot: shot.toString("base64"),
        submitText: info.submitText,
      },
    };
  } finally {
    await context.close();
  }
}
