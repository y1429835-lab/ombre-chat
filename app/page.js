"use client";
import { useState, useRef, useEffect } from "react";

export default function Home() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [ombreUrl, setOmbreUrl] = useState("");
  const [showSetting, setShowSetting] = useState(false);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function send() {
    if (!input.trim() || loading) return;
    const newMessages = [...messages, { role: "user", content: input }];
    setMessages(newMessages);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: newMessages, ombreUrl }),
      });
      const data = await res.json();
      setMessages([...newMessages, { role: "assistant", content: data.content }]);
    } catch {
      setMessages([...newMessages, { role: "assistant", content: "出错了，稍后再试。" }]);
    }
    setLoading(false);
  }

  return (
    <div style={{
      display: "flex", flexDirection: "column", height: "100dvh",
      background: "#1a1a1a", color: "#f0f0f0", fontFamily: "-apple-system, sans-serif",
      maxWidth: 480, margin: "0 auto"
    }}>
      {/* 顶部栏 */}
      <div style={{
        padding: "12px 16px", background: "#111", borderBottom: "1px solid #2a2a2a",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        flexShrink: 0
      }}>
        <div style={{ fontWeight: 600, fontSize: 16 }}>哥哥</div>
        <button onClick={() => setShowSetting(!showSetting)}
          style={{ background: "none", border: "none", color: "#888", fontSize: 20, cursor: "pointer" }}>
          ⚙
        </button>
      </div>

      {/* 设置栏 */}
      {showSetting && (
        <div style={{ background: "#111", padding: "10px 16px", borderBottom: "1px solid #2a2a2a", flexShrink: 0 }}>
          <input
            placeholder="Ombre Brain URL"
            value={ombreUrl}
            onChange={e => setOmbreUrl(e.target.value)}
            style={{
              width: "100%", padding: "8px 12px", background: "#222", border: "1px solid #333",
              borderRadius: 8, color: "#f0f0f0", fontSize: 13, boxSizing: "border-box"
            }}
          />
        </div>
      )}

      {/* 消息区 */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 12px" }}>
        {messages.length === 0 && (
          <div style={{ textAlign: "center", color: "#444", marginTop: 60, fontSize: 14 }}>
            在
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{
            display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start",
            marginBottom: 10
          }}>
            <div style={{
              maxWidth: "75%", padding: "10px 14px",
              background: m.role === "user" ? "#3a3a3a" : "#222",
              borderRadius: m.role === "user" ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
              fontSize: 15, lineHeight: 1.5, whiteSpace: "pre-wrap",
              border: m.role === "assistant" ? "1px solid #2a2a2a" : "none"
            }}>
              {m.content}
            </div>
          </div>
        ))}
        {loading && (
          <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: 10 }}>
            <div style={{
              padding: "10px 16px", background: "#222", borderRadius: "18px 18px 18px 4px",
              border: "1px solid #2a2a2a", color: "#555", fontSize: 15
            }}>···</div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* 输入区 */}
      <div style={{
        padding: "10px 12px", background: "#111", borderTop: "1px solid #2a2a2a",
        display: "flex", gap: 8, alignItems: "flex-end", flexShrink: 0
      }}>
        <textarea
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
          }}
          placeholder="说点什么…"
          rows={1}
          style={{
            flex: 1, padding: "10px 14px", background: "#222", border: "1px solid #333",
            borderRadius: 20, color: "#f0f0f0", fontSize: 15, resize: "none",
            outline: "none", lineHeight: 1.5, maxHeight: 120, overflowY: "auto",
            fontFamily: "inherit"
          }}
          onInput={e => {
            e.target.style.height = "auto";
            e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
          }}
        />
        <button onClick={send} disabled={loading || !input.trim()}
          style={{
            width: 40, height: 40, borderRadius: "50%", border: "none",
            background: input.trim() && !loading ? "#f0f0f0" : "#333",
            color: input.trim() && !loading ? "#111" : "#555",
            fontSize: 18, cursor: "pointer", flexShrink: 0,
            display: "flex", alignItems: "center", justifyContent: "center"
          }}>
          ↑
        </button>
      </div>
    </div>
  );
}
