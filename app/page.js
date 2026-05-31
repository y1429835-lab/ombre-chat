"use client";
import { useState, useRef, useEffect } from "react";

const STORAGE_KEY = "ombre_chat_history";

export default function Home() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [ombreUrl, setOmbreUrl] = useState(() => {
    try { return localStorage.getItem("ombre_url") || ""; } catch { return ""; }
  });
  const [showSetting, setShowSetting] = useState(false);
  const [editingIndex, setEditingIndex] = useState(null);
  const [editText, setEditText] = useState("");
  const bottomRef = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setMessages(JSON.parse(saved));
      const savedUrl = localStorage.getItem("ombre_url");
      if (savedUrl) setOmbreUrl(savedUrl);
    } catch {}
  }, []);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(messages)); } catch {}
  }, [messages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  function getTime() {
    const now = new Date();
    return `${now.getHours().toString().padStart(2,"0")}:${now.getMinutes().toString().padStart(2,"0")}`;
  }

  function saveUrl(url) {
    setOmbreUrl(url);
    try { localStorage.setItem("ombre_url", url); } catch {}
  }

  function clearHistory() {
    if (confirm("清除所有对话记录？")) {
      setMessages([]);
      try { localStorage.removeItem(STORAGE_KEY); } catch {}
    }
  }

  async function callApi(msgs) {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: msgs.map(m => ({ role: m.role, content: m.content })),
        ombreUrl
      }),
    });
    return await res.json();
  }

  async function send() {
    if (!input.trim() || loading) return;
    const userMsg = { role: "user", content: input.trim(), time: getTime() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    setLoading(true);
    console.log("ombreUrl at send:", ombreUrl);
    try {
      const data = await callApi(newMessages);
      setMessages(prev => [...prev, {
        role: "assistant", content: data.content,
        time: getTime(), sources: data.sources || []
      }]);
    } catch {
      setMessages(prev => [...prev, { role: "assistant", content: "出错了，稍后再试。", time: getTime(), sources: [] }]);
    }
    setLoading(false);
  }

  async function regenerate(index) {
    if (loading) return;
    const msgsUpTo = messages.slice(0, index);
    setMessages(msgsUpTo);
    setLoading(true);
    try {
      const data = await callApi(msgsUpTo);
      setMessages([...msgsUpTo, {
        role: "assistant", content: data.content,
        time: getTime(), sources: data.sources || []
      }]);
    } catch {
      setMessages([...msgsUpTo, { role: "assistant", content: "出错了。", time: getTime(), sources: [] }]);
    }
    setLoading(false);
  }

  async function saveEdit(index) {
    if (!editText.trim()) return;
    const updated = messages.map((m, i) => i === index ? { ...m, content: editText } : m);
    const msgsUpTo = updated.slice(0, index + 1);
    setMessages(msgsUpTo);
    setEditingIndex(null);
    setLoading(true);
    try {
      const data = await callApi(msgsUpTo);
      setMessages([...msgsUpTo, {
        role: "assistant", content: data.content,
        time: getTime(), sources: data.sources || []
      }]);
    } catch {
      setMessages([...msgsUpTo, { role: "assistant", content: "出错了。", time: getTime(), sources: [] }]);
    }
    setLoading(false);
  }

  return (
    <div style={{
      display: "flex", flexDirection: "column", height: "100dvh",
      background: "#f5f5f5", fontFamily: "-apple-system, 'PingFang SC', sans-serif",
      maxWidth: 520, margin: "0 auto"
    }}>
      <div style={{
        padding: "14px 16px 12px", background: "#fff",
        borderBottom: "1px solid #ebebeb",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        flexShrink: 0, boxShadow: "0 1px 3px rgba(0,0,0,0.05)"
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 36, height: 36, borderRadius: "50%",
            background: "linear-gradient(135deg, #1a1a1a, #444)",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "#fff", fontSize: 15, fontWeight: 600
          }}>哥</div>
          <div>
            <div style={{ fontWeight: 600, fontSize: 16, color: "#111" }}>哥哥</div>
            <div style={{ fontSize: 11, color: "#999", marginTop: 1 }}>在线</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <button onClick={clearHistory} style={{ background: "none", border: "none", color: "#bbb", fontSize: 13, cursor: "pointer" }}>清除</button>
          <button onClick={() => setShowSetting(!showSetting)} style={{ background: "none", border: "none", color: "#bbb", fontSize: 20, cursor: "pointer" }}>⋯</button>
        </div>
      </div>

      {showSetting && (
        <div style={{ background: "#fff", padding: "12px 16px", borderBottom: "1px solid #ebebeb", flexShrink: 0 }}>
          <div style={{ fontSize: 12, color: "#999", marginBottom: 6 }}>Ombre Brain URL</div>
          <input
            placeholder="https://xxxx.trycloudflare.com"
            value={ombreUrl}
            onChange={e => saveUrl(e.target.value)}
            style={{
              width: "100%", padding: "8px 12px", background: "#f8f8f8",
              border: "1px solid #e8e8e8", borderRadius: 8, fontSize: 13,
              boxSizing: "border-box", color: "#333", outline: "none"
            }}
          />
        </div>
      )}

      <div style={{ flex: 1, overflowY: "auto", padding: "16px 12px" }}>
        {messages.length === 0 && (
          <div style={{ textAlign: "center", marginTop: 80 }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🖤</div>
            <div style={{ color: "#bbb", fontSize: 14 }}>在</div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{
            display: "flex",
            flexDirection: m.role === "user" ? "row-reverse" : "row",
            alignItems: "flex-end",
            marginBottom: 16, gap: 8
          }}>
            {m.role === "assistant" && (
              <div style={{
                width: 32, height: 32, borderRadius: "50%", flexShrink: 0,
                background: "linear-gradient(135deg, #1a1a1a, #444)",
                display: "flex", alignItems: "center", justifyContent: "center",
                color: "#fff", fontSize: 12, fontWeight: 600, marginBottom: 2
              }}>哥</div>
            )}
            <div style={{ maxWidth: "72%", display: "flex", flexDirection: "column",
              alignItems: m.role === "user" ? "flex-end" : "flex-start" }}>
              {m.sources && m.sources.length > 0 && (
                <div style={{ fontSize: 10, color: "#bbb", marginBottom: 3 }}>
                  📎 {m.sources.join(" · ")}
                </div>
              )}
              {editingIndex === i ? (
                <div style={{ width: "100%" }}>
                  <textarea
                    value={editText}
                    onChange={e => setEditText(e.target.value)}
                    style={{
                      width: "100%", padding: "10px 14px", background: "#fff",
                      border: "1px solid #ddd", borderRadius: 12, fontSize: 15,
                      lineHeight: 1.6, resize: "none", outline: "none", fontFamily: "inherit"
                    }}
                    rows={3}
                  />
                  <div style={{ display: "flex", gap: 8, marginTop: 6, justifyContent: "flex-end" }}>
                    <button onClick={() => setEditingIndex(null)}
                      style={{ padding: "4px 12px", background: "#f0f0f0", border: "none", borderRadius: 8, fontSize: 13, cursor: "pointer" }}>取消</button>
                    <button onClick={() => saveEdit(i)}
                      style={{ padding: "4px 12px", background: "#1a1a1a", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, cursor: "pointer" }}>发送</button>
                  </div>
                </div>
              ) : (
                <div style={{
                  padding: "10px 14px",
                  background: m.role === "user" ? "#1a1a1a" : "#fff",
                  color: m.role === "user" ? "#fff" : "#1a1a1a",
                  borderRadius: m.role === "user" ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
                  fontSize: 15, lineHeight: 1.6, whiteSpace: "pre-wrap",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.08)"
                }}>
                  {m.content}
                </div>
              )}
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
                <span style={{ fontSize: 11, color: "#c0c0c0" }}>{m.time}</span>
                {m.role === "user" && editingIndex !== i && (
                  <button onClick={() => { setEditingIndex(i); setEditText(m.content); }}
                    style={{ background: "none", border: "none", color: "#ccc", fontSize: 11, cursor: "pointer", padding: 0 }}>编辑</button>
                )}
                {m.role === "assistant" && (
                  <button onClick={() => regenerate(i)}
                    style={{ background: "none", border: "none", color: "#ccc", fontSize: 11, cursor: "pointer", padding: 0 }}>↺ 重新生成</button>
                )}
              </div>
            </div>
          </div>
        ))}
        {loading && (
          <div style={{ display: "flex", alignItems: "flex-end", gap: 8, marginBottom: 16 }}>
            <div style={{
              width: 32, height: 32, borderRadius: "50%", flexShrink: 0,
              background: "linear-gradient(135deg, #1a1a1a, #444)",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "#fff", fontSize: 12, fontWeight: 600
            }}>哥</div>
            <div style={{
              padding: "12px 16px", background: "#fff",
              borderRadius: "18px 18px 18px 4px",
              boxShadow: "0 1px 3px rgba(0,0,0,0.08)"
            }}>
              <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                {[0,1,2].map(i => (
                  <div key={i} style={{
                    width: 6, height: 6, borderRadius: "50%", background: "#ccc",
                    animation: `bounce 1.2s ease-in-out ${i*0.2}s infinite`
                  }}/>
                ))}
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div style={{
        padding: "10px 12px 12px", background: "#fff",
        borderTop: "1px solid #ebebeb",
        display: "flex", gap: 8, alignItems: "flex-end", flexShrink: 0
      }}>
        <textarea
          ref={textareaRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
          }}
          placeholder="说点什么…"
          rows={1}
          style={{
            flex: 1, padding: "10px 14px", background: "#f5f5f5",
            border: "none", borderRadius: 22, fontSize: 15,
            resize: "none", outline: "none", lineHeight: 1.5,
            maxHeight: 120, overflowY: "auto", fontFamily: "inherit", color: "#111"
          }}
          onInput={e => {
            e.target.style.height = "auto";
            e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
          }}
        />
        <button onClick={send} disabled={loading || !input.trim()}
          style={{
            width: 40, height: 40, borderRadius: "50%", border: "none",
            background: input.trim() && !loading ? "#1a1a1a" : "#e0e0e0",
            color: "#fff", fontSize: 18, cursor: input.trim() ? "pointer" : "default",
            flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
            transition: "background 0.2s"
          }}>
          ↑
        </button>
      </div>
      <style>{`
        @keyframes bounce {
          0%, 60%, 100% { transform: translateY(0); }
          30% { transform: translateY(-4px); }
        }
      `}</style>
    </div>
  );
}
