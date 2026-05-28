"use client";
import { useState, useRef, useEffect } from "react";

export default function Home() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [ombreUrl, setOmbreUrl] = useState("");
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send() {
    if (!input.trim()) return;
    const newMessages = [...messages, { role: "user", content: input }];
    setMessages(newMessages);
    setInput("");
    setLoading(true);
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: newMessages, ombreUrl }),
    });
    const data = await res.json();
    setMessages([...newMessages, { role: "assistant", content: data.content }]);
    setLoading(false);
  }

  return (
    <main style={{ maxWidth: 700, margin: "0 auto", padding: "20px", fontFamily: "sans-serif" }}>
      <h2>Ombre Chat</h2>
      <input
        placeholder="Ombre Brain URL（可选）"
        value={ombreUrl}
        onChange={e => setOmbreUrl(e.target.value)}
        style={{ width: "100%", padding: 8, marginBottom: 12, boxSizing: "border-box" }}
      />
      <div style={{ height: 500, overflowY: "auto", border: "1px solid #ccc", padding: 12, marginBottom: 12 }}>
        {messages.map((m, i) => (
          <div key={i} style={{ marginBottom: 12, textAlign: m.role === "user" ? "right" : "left" }}>
            <span style={{ background: m.role === "user" ? "#000" : "#eee", color: m.role === "user" ? "#fff" : "#000", padding: "8px 12px", borderRadius: 12, display: "inline-block", maxWidth: "80%", whiteSpace: "pre-wrap" }}>
              {m.content}
            </span>
          </div>
        ))}
        {loading && <div>思考中...</div>}
        <div ref={bottomRef} />
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && send()}
          placeholder="输入消息..."
          style={{ flex: 1, padding: 8 }}
        />
        <button onClick={send} style={{ padding: "8px 16px" }}>发送</button>
      </div>
    </main>
  );
}
