"use client";
import { useState, useRef, useEffect } from "react";

const SESSIONS_KEY = "ombre_sessions";
const SESSION_PREFIX = "ombre_chat_";
const URL_KEY = "ombre_url";

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
function loadSessions() {
  try { const s = localStorage.getItem(SESSIONS_KEY); return s ? JSON.parse(s) : []; } catch { return []; }
}
function saveSessions(sessions) {
  try { localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions)); } catch {}
}
function loadMessages(id) {
  try { const s = localStorage.getItem(SESSION_PREFIX + id); return s ? JSON.parse(s) : []; } catch { return []; }
}
function saveMessages(id, messages) {
  try { localStorage.setItem(SESSION_PREFIX + id, JSON.stringify(messages)); } catch {}
}
function deleteSession(id) {
  try { localStorage.removeItem(SESSION_PREFIX + id); } catch {}
}

export default function Home() {
  const [sessions, setSessions] = useState([]);
  const [currentId, setCurrentId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [ombreUrl, setOmbreUrl] = useState("");
  const [showSetting, setShowSetting] = useState(false);
  const [showSessions, setShowSessions] = useState(false);
  const [editingIndex, setEditingIndex] = useState(null);
  const [editText, setEditText] = useState("");
  const [vpHeight, setVpHeight] = useState("100dvh");

  const bottomRef = useRef(null);
  const textareaRef = useRef(null);

  // 关键：用position:fixed + visualViewport跟踪，键盘弹出不移位
 useEffect(() => {
    if (window.visualViewport) {
      setVpHeight(`${window.visualViewport.height}px`);
    } else {
      setVpHeight(`${window.innerHeight}px`);
    }
  }, []);
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    update();
    return () => {
  }, []);

  useEffect(() => {
    const savedUrl = localStorage.getItem(URL_KEY);
    if (savedUrl) setOmbreUrl(savedUrl);
    let existing = loadSessions();
    if (existing.length === 0) {
      const id = genId();
      existing = [{ id, title: "对话 1", createdAt: Date.now() }];
      saveSessions(existing);
    }
    setSessions(existing);
    const lastId = existing[0].id;
    setCurrentId(lastId);
    setMessages(loadMessages(lastId));
  }, []);

  useEffect(() => {
    if (currentId) saveMessages(currentId, messages);
  }, [messages, currentId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  function getTime() {
    const now = new Date();
    return `${now.getHours().toString().padStart(2,"0")}:${now.getMinutes().toString().padStart(2,"0")}`;
  }
  function saveUrl(url) {
    setOmbreUrl(url);
    try { localStorage.setItem(URL_KEY, url); } catch {}
  }
  function newSession() {
    const id = genId();
    const n = sessions.length + 1;
    const newSessions = [{ id, title: `对话 ${n}`, createdAt: Date.now() }, ...sessions];
    setSessions(newSessions);
    saveSessions(newSessions);
    setCurrentId(id);
    setMessages([]);
    setShowSessions(false);
  }
  function switchSession(id) {
    if (id === currentId) { setShowSessions(false); return; }
    setCurrentId(id);
    setMessages(loadMessages(id));
    setShowSessions(false);
  }
  function removeSession(id, e) {
    e.stopPropagation();
    if (sessions.length === 1) { setMessages([]); saveMessages(id, []); setShowSessions(false); return; }
    const next = sessions.filter(s => s.id !== id);
    deleteSession(id);
    saveSessions(next);
    setSessions(next);
    if (currentId === id) { setCurrentId(next[0].id); setMessages(loadMessages(next[0].id)); }
    setShowSessions(false);
  }
  function updateTitle(id, msgs) {
    const first = msgs.find(m => m.role === "user");
    if (!first) return;
    const title = first.content.slice(0, 14);
    setSessions(prev => { const u = prev.map(s => s.id === id ? { ...s, title } : s); saveSessions(u); return u; });
  }

  async function callApi(msgs) {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: msgs.map(m => ({ role: m.role, content: m.content })), ombreUrl }),
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
    try {
      const data = await callApi(newMessages);
      const updated = [...newMessages, { role: "assistant", content: data.content, time: getTime(), sources: data.sources || [] }];
      setMessages(updated);
      updateTitle(currentId, updated);
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
      setMessages([...msgsUpTo, { role: "assistant", content: data.content, time: getTime(), sources: data.sources || [] }]);
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
      setMessages([...msgsUpTo, { role: "assistant", content: data.content, time: getTime(), sources: data.sources || [] }]);
    } catch {
      setMessages([...msgsUpTo, { role: "assistant", content: "出错了。", time: getTime(), sources: [] }]);
    }
    setLoading(false);
  }

  return (
    <>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { overflow: hidden; }
        @keyframes bounce {
          0%, 60%, 100% { transform: translateY(0); }
          30% { transform: translateY(-4px); }
        }
      `}</style>

      <div style={{
        position: "fixed",
        top: 0,
        left: "50%",
        transform: "translateX(-50%)",
        width: "100%",
        maxWidth: 520,
        height: vpHeight,
        display: "flex",
        flexDirection: "column",
        background: "#f5f5f5",
        fontFamily: "-apple-system, 'PingFang SC', sans-serif",
        overflow: "hidden"
      }}>

        {/* 顶部栏 */}
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
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button onClick={newSession} style={{ background: "none", border: "none", color: "#888", fontSize: 13, cursor: "pointer" }}>+ 新对话</button>
            <button onClick={() => { setShowSessions(!showSessions); setShowSetting(false); }} style={{ background: "none", border: "none", color: "#bbb", fontSize: 13, cursor: "pointer" }}>列表</button>
            <button onClick={() => { setShowSetting(!showSetting); setShowSessions(false); }} style={{ background: "none", border: "none", color: "#bbb", fontSize: 20, cursor: "pointer" }}>⋯</button>
          </div>
        </div>

        {/* 设置 */}
        {showSetting && (
          <div style={{ background: "#fff", padding: "12px 16px", borderBottom: "1px solid #ebebeb", flexShrink: 0 }}>
            <div style={{ fontSize: 12, color: "#999", marginBottom: 6 }}>Ombre Brain URL</div>
            <input
              placeholder="https://xxxx.trycloudflare.com"
              value={ombreUrl}
              onChange={e => saveUrl(e.target.value)}
              style={{ width: "100%", padding: "8px 12px", background: "#f8f8f8", border: "1px solid #e8e8e8", borderRadius: 8, fontSize: 13, color: "#333", outline: "none" }}
            />
          </div>
        )}

        {/* 会话列表 */}
        {showSessions && (
          <div style={{ background: "#fff", borderBottom: "1px solid #ebebeb", flexShrink: 0, maxHeight: 200, overflowY: "auto" }}>
            {sessions.map(s => (
              <div key={s.id} onClick={() => switchSession(s.id)} style={{
                padding: "11px 16px", background: s.id === currentId ? "#f5f5f5" : "#fff",
                display: "flex", alignItems: "center", justifyContent: "space-between",
                cursor: "pointer", borderBottom: "1px solid #f0f0f0"
              }}>
                <div style={{ fontSize: 14, color: s.id === currentId ? "#111" : "#555", fontWeight: s.id === currentId ? 600 : 400 }}>{s.title}</div>
                <button onClick={(e) => removeSession(s.id, e)} style={{ background: "none", border: "none", color: "#ccc", fontSize: 16, cursor: "pointer", padding: "0 4px" }}>×</button>
              </div>
            ))}
          </div>
        )}

        {/* 消息区 */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 12px", WebkitOverflowScrolling: "touch" }}>
          {messages.length === 0 && (
            <div style={{ textAlign: "center", marginTop: 80 }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>🖤</div>
              <div style={{ color: "#bbb", fontSize: 14 }}>在</div>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} style={{
              display: "flex", flexDirection: m.role === "user" ? "row-reverse" : "row",
              alignItems: "flex-end", marginBottom: 16, gap: 8
            }}>
              {m.role === "assistant" && (
                <div style={{
                  width: 32, height: 32, borderRadius: "50%", flexShrink: 0,
                  background: "linear-gradient(135deg, #1a1a1a, #444)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: "#fff", fontSize: 12, fontWeight: 600, marginBottom: 2
                }}>哥</div>
              )}
              <div style={{ maxWidth: "72%", display: "flex", flexDirection: "column", alignItems: m.role === "user" ? "flex-end" : "flex-start" }}>
                {m.sources && m.sources.length > 0 && (
                  <div style={{ fontSize: 10, color: "#bbb", marginBottom: 3 }}>📎 {m.sources.join(" · ")}</div>
                )}
                {editingIndex === i ? (
                  <div style={{ width: "100%" }}>
                    <textarea value={editText} onChange={e => setEditText(e.target.value)}
                      style={{ width: "100%", padding: "10px 14px", background: "#fff", border: "1px solid #ddd", borderRadius: 12, fontSize: 15, lineHeight: 1.6, resize: "none", outline: "none", fontFamily: "inherit" }}
                      rows={3} />
                    <div style={{ display: "flex", gap: 8, marginTop: 6, justifyContent: "flex-end" }}>
                      <button onClick={() => setEditingIndex(null)} style={{ padding: "4px 12px", background: "#f0f0f0", border: "none", borderRadius: 8, fontSize: 13, cursor: "pointer" }}>取消</button>
                      <button onClick={() => saveEdit(i)} style={{ padding: "4px 12px", background: "#1a1a1a", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, cursor: "pointer" }}>发送</button>
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
                  }}>{m.content}</div>
                )}
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
                  <span style={{ fontSize: 11, color: "#c0c0c0" }}>{m.time}</span>
                  {m.role === "user" && editingIndex !== i && (
                    <button onClick={() => { setEditingIndex(i); setEditText(m.content); }} style={{ background: "none", border: "none", color: "#ccc", fontSize: 11, cursor: "pointer", padding: 0 }}>编辑</button>
                  )}
                  {m.role === "assistant" && (
                    <button onClick={() => regenerate(i)} style={{ background: "none", border: "none", color: "#ccc", fontSize: 11, cursor: "pointer", padding: 0 }}>↺ 重新生成</button>
                  )}
                </div>
              </div>
            </div>
          ))}
          {loading && (
            <div style={{ display: "flex", alignItems: "flex-end", gap: 8, marginBottom: 16 }}>
              <div style={{ width: 32, height: 32, borderRadius: "50%", flexShrink: 0, background: "linear-gradient(135deg, #1a1a1a, #444)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 12, fontWeight: 600 }}>哥</div>
              <div style={{ padding: "12px 16px", background: "#fff", borderRadius: "18px 18px 18px 4px", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
                <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                  {[0,1,2].map(i => <div key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: "#ccc", animation: `bounce 1.2s ease-in-out ${i*0.2}s infinite` }}/>)}
                </div>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* 输入区 */}
        <div style={{
          padding: "10px 12px 12px", background: "#fff",
          borderTop: "1px solid #ebebeb",
          display: "flex", gap: 8, alignItems: "flex-end", flexShrink: 0
        }}>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
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
          <button onClick={send} disabled={loading || !input.trim()} style={{
            width: 40, height: 40, borderRadius: "50%", border: "none",
            background: input.trim() && !loading ? "#1a1a1a" : "#e0e0e0",
            color: "#fff", fontSize: 18, cursor: input.trim() ? "pointer" : "default",
            flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
            transition: "background 0.2s"
          }}>↑</button>
        </div>

      </div>
    </>
  );
}
