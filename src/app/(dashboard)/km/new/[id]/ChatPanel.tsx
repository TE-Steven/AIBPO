"use client";

import { useState } from "react";
import { IconChevronDown, IconSparkles } from "@/components/icons";

type Msg = { role: "user" | "assistant"; content: string };

export function ChatPanel({ sourceId }: { sourceId: string }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  async function send() {
    const question = input.trim();
    if (!question || sending) return;

    const nextMessages: Msg[] = [...messages, { role: "user", content: question }];
    setMessages([...nextMessages, { role: "assistant", content: "" }]);
    setInput("");
    setSending(true);

    try {
      const res = await fetch(`/api/km/sources/${sourceId}/chat`, {
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
        const text = acc;
        setMessages((prev) => {
          const copy = [...prev];
          copy[copy.length - 1] = { role: "assistant", content: text };
          return copy;
        });
      }
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

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-5 py-4 text-sm font-semibold text-slate-900"
      >
        <span className="flex items-center gap-2">
          <IconSparkles className="h-4 w-4 text-teal-600" />
          問 AI：為什麼這樣回答？
        </span>
        <IconChevronDown className={`h-4 w-4 shrink-0 transition-transform ${open ? "" : "-rotate-90"}`} />
      </button>

      {open && (
        <div className="border-t border-slate-100 p-5">
          <div className="mb-3 max-h-80 space-y-3 overflow-y-auto">
            {messages.length === 0 && (
              <p className="text-sm text-slate-400">可以問，例如：「第一題為什麼會這樣回答？」「這個答案的依據是文件哪一段？」</p>
            )}
            {messages.map((m, i) => (
              <div key={i} className={m.role === "user" ? "text-right" : "text-left"}>
                <span
                  className={`inline-block max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-left text-sm ${
                    m.role === "user" ? "bg-teal-600 text-white" : "bg-slate-100 text-slate-700"
                  }`}
                >
                  {m.content || (sending && i === messages.length - 1 ? "思考中…" : "")}
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
              placeholder="輸入問題…"
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
        </div>
      )}
    </div>
  );
}
