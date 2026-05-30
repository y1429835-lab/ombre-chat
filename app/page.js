"use client";
import { useState, useRef, useEffect } from "react";

export default function Home() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [ombreUrl, setOmbreUrl] = useState("");
  const [showSetting, setShowSetting] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  function getTime() {
    const now = new Date();
    return `${now.getHours().toString().padStart(2,"0")}:${now.getMinutes().toString().padStart(2,"0")}`;
  }

  async function send() {
    if (!input.trim() || loading) return;
    const userMsg = { role: "user", content: input, time: getTime() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: newMessages.map(m => ({ role: m.role, content: m.content })),
          ombreUrl
        }),
      });
      const data = await res.json();
      setMessages([...newMessages, {
        role: "assistant",
        content: data.content,
        time: getTime(),
        sources: data.sources || []
      }]);
    } catch {
      setMessages([...newMessages, { role: "assistant", content: "出错了。", time: getTime(), sources: [] }]);
    }
    setLoading(false);
  }

  return (
    <div style={{
      display: "flex", flexDirection: "column", height: "100dvh",
      background: "#ededed", fontFamily: "-apple-system, sans-serif",
      maxWidth: 480, margin: "0 auto"
    }}>
      {/* 顶部 */}
      <div style={{
        padding: "12px 16px", background: "#f7f7f7",
        borderBottom: "1px solid #ddd",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        flexShrink: 0
      }}>
        <div style={{ fontWeight: 600, fontSize: 17, color: "#111" }}>哥哥</div>
        <button onClick={() => setShowSetting(!showSetting)}
          style={{ background: "none", border: "none", color: "#999", fontSize: 20, cursor: "pointer" }}>
          ⚙
        </button>
      </div>

      {/* 设置 */}
      {showSetting && (
        <div style={{ background: "#f7f7f7", padding: "10px 16px", borderBottom: "1px solid
