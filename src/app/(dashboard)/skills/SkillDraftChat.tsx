"use client";

import { useEffect, useRef, useState } from "react";
import { parseSkillDraftReply, type SkillDraftFields } from "@/lib/skillChat";
import { IconSparkles, IconCheckCircle } from "@/components/icons";

type Msg = { role: "user" | "assistant"; content: string };

const EMPTY_DRAFT: SkillDraftFields = {
  name: null,
  description: null,
  method: null,
  urlTemplate: null,
  authType: null,
  authConfig: null,
  headers: [],
  paramsSchema: [],
};

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1 px-1 py-1">
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.3s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.15s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" />
    </span>
  );
}

export function SkillDraftChat({ onApply }: { onApply: (draft: SkillDraftFields) => void }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState<SkillDraftFields>(EMPTY_DRAFT);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  async function send() {
    const question = input.trim();
    if (!question || sending) return;

    const nextMessages: Msg[] = [...messages, { role: "user", content: question }];
    setMessages([...nextMessages, { role: "assistant", content: "" }]);
    setInput("");
    setSending(true);

    try {
      const res = await fetch(`/api/skills/draft-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextMessages }),
      });

      if (!res.body) throw new Error("沒有收到回應");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        const displayText = acc.split("```json")[0].trim();
        setMessages((prev) => {
          const copy = [...prev];
          copy[copy.length - 1] = { role: "assistant", content: displayText };
          return copy;
        });
      }

      const { reply, draft: parsedDraft } = parseSkillDraftReply(acc);
      setMessages((prev) => {
        const copy = [...prev];
        copy[copy.length - 1] = { role: "assistant", content: reply };
        return copy;
      });
      setDraft(parsedDraft);
    } catch {
      setMessages((prev) => {
        const copy = [...prev];
        copy[copy.length - 1] = { role: "assistant", content: "連線失敗，請重試一次。" };
        return copy;
      });
    } finally {
      setSending(false);
    }
  }

  const knownCount = [draft.name, draft.description, draft.method, draft.urlTemplate].filter(Boolean).length;

  return (
    <div className="space-y-3">
      <div ref={scrollRef} className="h-64 space-y-3 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-3">
        {messages.length === 0 && (
          <p className="text-sm text-slate-400">
            直接描述你要串接的 API，例如「幫我串一個查詢保固的功能，GET
            https://api.example.com/warranty/型號，header要帶X-Api-Key」，也可以直接貼 curl 指令或 API 文件片段。
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "text-right" : "text-left"}>
            <span
              className={`inline-block max-w-[90%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-left text-sm ${
                m.role === "user" ? "bg-teal-600 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200"
              }`}
            >
              {m.content || (sending && i === messages.length - 1 ? <TypingDots /> : "")}
            </span>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) send();
          }}
          placeholder="描述你要的 API…"
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-teal-400 focus:outline-none focus:ring-4 focus:ring-teal-100"
        />
        <button
          type="button"
          onClick={send}
          disabled={sending}
          className="rounded-lg bg-gradient-to-r from-teal-600 to-cyan-500 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-teal-500/25 transition hover:from-teal-700 hover:to-cyan-600 disabled:opacity-50"
        >
          送出
        </button>
      </div>

      {knownCount > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-500">
          <p className="mb-1 font-medium text-slate-700">目前已知：</p>
          <ul className="space-y-0.5">
            {draft.name && <li>名稱：{draft.name}</li>}
            {draft.method && draft.urlTemplate && (
              <li>
                {draft.method} {draft.urlTemplate}
              </li>
            )}
            {draft.authType && <li>認證：{draft.authType}</li>}
            {draft.paramsSchema.length > 0 && <li>參數：{draft.paramsSchema.map((p) => p.name).join("、")}</li>}
          </ul>
        </div>
      )}

      <button
        type="button"
        onClick={() => onApply(draft)}
        disabled={knownCount === 0}
        className="inline-flex items-center gap-1.5 rounded-lg border border-teal-300 bg-teal-50 px-3.5 py-2 text-xs font-semibold text-teal-700 transition hover:bg-teal-100 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <IconCheckCircle className="h-3.5 w-3.5" />
        套用到表單（不完整也可以，剩下的手動補）
      </button>
      <p className="flex items-center gap-1.5 text-xs text-slate-400">
        <IconSparkles className="h-3 w-3" />
        套用後仍會顯示完整表單讓你確認/補齊，不會直接存檔。
      </p>
    </div>
  );
}
