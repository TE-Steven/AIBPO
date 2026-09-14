"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { IconMicrophone, IconSparkles, IconX } from "@/components/icons";

type Msg = { role: "user" | "assistant"; content: string };

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
};

function getSpeechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1 px-1 py-1">
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.3s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.15s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" />
    </span>
  );
}

export function ChatPanel({ sourceId }: { sourceId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, open]);

  useEffect(() => {
    setVoiceSupported(getSpeechRecognitionCtor() !== null);
    return () => {
      recognitionRef.current?.stop();
    };
  }, []);

  function toggleVoice() {
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }

    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;

    const recognition = new Ctor();
    recognition.lang = "zh-TW";
    recognition.interimResults = true;
    recognition.continuous = false;

    recognition.onresult = (event) => {
      let transcript = "";
      for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      setInput(transcript);
    };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);

    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  }

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
      // AI 可能在這輪對話裡改了資料（找替換、新增題組、重新歸類、刪除），重新整理頁面資料讓下面的列表同步。
      router.refresh();
    }
  }

  return (
    <>
      {/* 收合時：右下角浮動按鈕 */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="AI 知識庫助手"
        className={`fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-teal-600 to-cyan-500 text-white shadow-lg shadow-teal-900/20 transition-all duration-300 hover:scale-105 ${
          open ? "pointer-events-none scale-0 opacity-0" : "scale-100 opacity-100"
        }`}
      >
        <span className="absolute inset-0 -z-10 animate-ping rounded-full bg-teal-400/40" />
        <IconSparkles className="h-6 w-6" />
      </button>

      {/* 展開時：右下角浮動聊天視窗 */}
      <div
        className={`fixed bottom-6 right-6 z-40 flex h-[32rem] w-96 max-w-[calc(100vw-2rem)] origin-bottom-right flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200 transition-all duration-200 ${
          open ? "scale-100 opacity-100" : "pointer-events-none scale-95 opacity-0"
        }`}
      >
        <div className="flex shrink-0 items-center justify-between bg-gradient-to-r from-teal-800 to-cyan-500 px-4 py-3">
          <span className="flex items-center gap-2 text-sm font-semibold text-white">
            <IconSparkles className="h-4 w-4" />
            AI 知識庫助手
          </span>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="關閉"
            className="rounded-md p-1 text-white/80 transition hover:bg-white/10 hover:text-white"
          >
            <IconX className="h-4 w-4" />
          </button>
        </div>

        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
          {messages.length === 0 && (
            <div className="space-y-2 text-sm text-slate-400">
              <p>可以問問題，例如：</p>
              <ul className="list-disc space-y-1 pl-4">
                <li>「第一題為什麼會這樣回答？」</li>
              </ul>
              <p>也可以直接下指令，例如：</p>
              <ul className="list-disc space-y-1 pl-4">
                <li>「把所有提到 XXX 的地方改成 YYY」</li>
                <li>「幫我新增10題關於活動的」</li>
                <li>「把價格相關的題目歸到商品資訊分類」</li>
                <li>「刪掉關於舊活動的題目」</li>
              </ul>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={m.role === "user" ? "text-right" : "text-left"}>
              <span
                className={`inline-block max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-left text-sm ${
                  m.role === "user" ? "bg-teal-600 text-white" : "bg-slate-100 text-slate-700"
                }`}
              >
                {m.content || (sending && i === messages.length - 1 ? <TypingDots /> : "")}
              </span>
            </div>
          ))}
        </div>

        <div className="flex shrink-0 gap-2 border-t border-slate-100 p-3">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) send();
            }}
            placeholder="輸入問題…"
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-teal-400 focus:outline-none focus:ring-4 focus:ring-teal-100"
          />
          {voiceSupported && (
            <button
              type="button"
              onClick={toggleVoice}
              disabled={sending}
              aria-label={listening ? "停止語音輸入" : "語音輸入"}
              className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition disabled:opacity-50 ${
                listening
                  ? "border-red-300 bg-red-50 text-red-600"
                  : "border-slate-300 text-slate-500 hover:border-teal-400 hover:text-teal-600"
              }`}
            >
              {listening && <span className="absolute inset-0 -z-10 animate-ping rounded-lg bg-red-400/30" />}
              <IconMicrophone className="h-4 w-4" />
            </button>
          )}
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
    </>
  );
}
