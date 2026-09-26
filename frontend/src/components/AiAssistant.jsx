import React, { useState, useRef, useEffect } from "react";
import { X, Send, Sparkles } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import api from "@/lib/api";
import { apiErr } from "@/lib/format";
import { useApp } from "@/context/AppContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function AiAssistant() {
  const { t, currentId } = useApp();
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [session, setSession] = useState(null);
  const endRef = useRef(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, busy]);
  if (!currentId) return null;

  const send = async (e) => {
    e?.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setMsgs((m) => [...m, { role: "user", content: text }]);
    setInput("");
    setBusy(true);
    try {
      const { data } = await api.post(`/households/${currentId}/ai/chat`, { message: text, session_id: session });
      setSession(data.session_id);
      setMsgs((m) => [...m, { role: "assistant", content: data.reply }]);
    } catch (err) {
      setMsgs((m) => [...m, { role: "assistant", content: apiErr(err) }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        data-testid="ai-assistant-toggle"
        onClick={() => setOpen((o) => !o)}
        className="fixed bottom-6 right-6 z-50 h-14 w-14 rounded-full bg-slate-900 text-white shadow-xl grid place-items-center hover:scale-105 transition-transform dark:bg-white dark:text-slate-900"
      >
        {open ? <X className="h-6 w-6" /> : <Sparkles className="h-6 w-6" />}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.96 }}
            transition={{ duration: 0.2 }}
            className="fixed bottom-24 right-6 z-50 w-[92vw] max-w-sm h-[70vh] max-h-[560px] bg-card border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden"
            data-testid="ai-assistant-panel"
          >
            <div className="p-4 border-b border-border flex items-center gap-2 bg-slate-900 text-white">
              <Sparkles className="h-5 w-5" />
              <span className="font-heading font-bold">{t("ai_assistant")}</span>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {!msgs.length && <p className="text-sm text-muted-foreground">{t("ai_intro")}</p>}
              {msgs.map((m, i) => (
                <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap ${
                    m.role === "user"
                      ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                      : "bg-slate-100 dark:bg-slate-800"
                  }`}>
                    {m.content}
                  </div>
                </div>
              ))}
              {busy && <div className="text-xs text-muted-foreground animate-pulse">{t("ai_thinking")}</div>}
              <div ref={endRef} />
            </div>
            <form onSubmit={send} className="p-3 border-t border-border flex gap-2">
              <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder={t("ai_ask_placeholder")} data-testid="ai-input" />
              <Button type="submit" size="icon" disabled={busy} data-testid="ai-send-btn"><Send className="h-4 w-4" /></Button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
