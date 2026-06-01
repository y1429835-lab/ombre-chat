"use client";
import { useState, useRef, useEffect } from "react";

const SESSIONS_KEY = "ombre_sessions";
const SESSION_PREFIX = "ombre_chat_";
const SUMMARY_PREFIX = "ombre_summary_";
const URL_KEY = "ombre_url";

const GEGE_IMG = "data:image/jpeg;base64,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";
const TAOZHI_IMG = "data:image/jpeg;base64,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";

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
function loadSummary(id) {
  try { const s = localStorage.getItem(SUMMARY_PREFIX + id); return s || ""; } catch { return ""; }
}
function saveSummary(id, summary) {
  try { localStorage.setItem(SUMMARY_PREFIX + id, summary); } catch {}
}
function deleteSession(id) {
  try { localStorage.removeItem(SESSION_PREFIX + id); localStorage.removeItem(SUMMARY_PREFIX + id); } catch {}
}

export default function Home() {
  const [sessions, setSessions] = useState([]);
  const [currentId, setCurrentId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [summary, setSummary] = useState("");
  const [summarizedCount, setSummarizedCount] = useState(0);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [ombreUrl, setOmbreUrl] = useState("");
  const [showSetting, setShowSetting] = useState(false);
  const [showSessions, setShowSessions] = useState(false);
  const [editingIndex, setEditingIndex] = useState(null);
  const [editText, setEditText] = useState("");
  const [vpHeight, setVpHeight] = useState("100dvh");
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [attachedFile, setAttachedFile] = useState(null);
  const [attachedFileData, setAttachedFileData] = useState(null);

  const bottomRef = useRef(null);
  const textareaRef = useRef(null);
  const scrollRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (window.visualViewport) {
      setVpHeight(`${window.visualViewport.height}px`);
    } else {
      setVpHeight(`${window.innerHeight}px`);
    }
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
    setSummary(loadSummary(lastId));
    setSummarizedCount(0);
  }, []);

  useEffect(() => {
    if (currentId) saveMessages(currentId, messages);
  }, [messages, currentId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function tryAutoSummarize(msgs, prevSummarizedCount, prevSummary, sessionId) {
    const newCount = msgs.length - prevSummarizedCount;
    if (newCount < 10) return { summary: prevSummary, summarizedCount: prevSummarizedCount };
    const toSummarize = msgs.slice(prevSummarizedCount, prevSummarizedCount + 10);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: `以下是桃枝和哥哥的对话，用2-3句话总结聊了什么，保留重要细节和情感，第一人称是哥哥：\n\n${toSummarize.map(m => `${m.role === "user" ? "桃枝" : "哥哥"}：${m.content}`).join("\n")}` }],
          ombreUrl: "",
          isSummaryRequest: true
        }),
      });
      const data = await res.json();
      const newPart = data.content || "";
      const newSummary = prevSummary ? `${prevSummary}\n${newPart}` : newPart;
      const newCount2 = prevSummarizedCount + 10;
      saveSummary(sessionId, newSummary);
      return { summary: newSummary, summarizedCount: newCount2 };
    } catch {
      return { summary: prevSummary, summarizedCount: prevSummarizedCount };
    }
  }

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
    setSummary("");
    setSummarizedCount(0);
    setShowSessions(false);
  }
  function switchSession(id) {
    if (id === currentId) { setShowSessions(false); return; }
    setCurrentId(id);
    setMessages(loadMessages(id));
    setSummary(loadSummary(id));
    setSummarizedCount(0);
    setShowSessions(false);
  }
  function removeSession(id, e) {
    e.stopPropagation();
    if (sessions.length === 1) { setMessages([]); saveMessages(id, []); saveSummary(id, ""); setSummary(""); setShowSessions(false); return; }
    const next = sessions.filter(s => s.id !== id);
    deleteSession(id);
    saveSessions(next);
    setSessions(next);
    if (currentId === id) {
      setCurrentId(next[0].id);
      setMessages(loadMessages(next[0].id));
      setSummary(loadSummary(next[0].id));
      setSummarizedCount(0);
    }
    setShowSessions(false);
  }
  function updateTitle(id, msgs) {
    const first = msgs.find(m => m.role === "user");
    if (!first) return;
    const title = first.content.slice(0, 14);
    setSessions(prev => { const u = prev.map(s => s.id === id ? { ...s, title } : s); saveSessions(u); return u; });
  }

  function handleFileChange(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setAttachedFile(file);
      setAttachedFileData(ev.target.result);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  function removeAttachment() {
    setAttachedFile(null);
    setAttachedFileData(null);
  }

  async function callApi(msgs, currentSummary) {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: msgs.map(m => ({ role: m.role, content: m.content })),
        ombreUrl,
        summary: currentSummary || ""
        clientTime: new Date().toLocaleString("zh-CN", { timeZone: "Asia/Kuala_Lumpur" }),
    });
    return await res.json();
  }

  async function send() {
    if ((!input.trim() && !attachedFile) || loading) return;
    let content = input.trim();
    if (attachedFile && attachedFileData) {
      const isImage = attachedFile.type.startsWith("image/");
      if (isImage) {
        content = content ? `${content}\n\n[图片：${attachedFile.name}]\n${attachedFileData}` : `[图片：${attachedFile.name}]\n${attachedFileData}`;
      } else {
        content = content ? `${content}\n\n[文件：${attachedFile.name}]` : `[文件：${attachedFile.name}]`;
      }
    }
    const userMsg = {
      role: "user",
      content: content,
      displayContent: input.trim(),
      time: getTime(),
      attachment: attachedFile ? { name: attachedFile.name, type: attachedFile.type, data: attachedFileData } : null
    };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setAttachedFile(null);
    setAttachedFileData(null);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    setLoading(true);
    try {
      const { summary: newSummary, summarizedCount: newCount } = await tryAutoSummarize(newMessages, summarizedCount, summary, currentId);
      if (newCount !== summarizedCount) { setSummary(newSummary); setSummarizedCount(newCount); }
      const data = await callApi(newMessages, newSummary);
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
      const data = await callApi(msgsUpTo, summary);
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
      const data = await callApi(msgsUpTo, summary);
      setMessages([...msgsUpTo, { role: "assistant", content: data.content, time: getTime(), sources: data.sources || [] }]);
    } catch {
      setMessages([...msgsUpTo, { role: "assistant", content: "出错了。", time: getTime(), sources: [] }]);
    }
    setLoading(false);
  }

  const Avatar = ({ src, size = 36 }) => (
    <div style={{
      width: size, height: size, borderRadius: "50%", flexShrink: 0,
      overflow: "hidden", border: "1px solid rgba(0,0,0,0.08)"
    }}>
      <img src={src} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
    </div>
  );

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

      <input ref={fileInputRef} type="file" accept="image/*,.pdf,.txt,.md" style={{ display: "none" }} onChange={handleFileChange} />

      <div style={{
        position: "fixed", top: 0, left: 0, right: 0,
        height: vpHeight, display: "flex", flexDirection: "column",
        background: "#f5f5f5", fontFamily: "-apple-system, 'PingFang SC', sans-serif",
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
            <Avatar src={GEGE_IMG} size={44} />
            <div>
              <div style={{ fontWeight: 600, fontSize: 18, color: "#111" }}>哥哥</div>
              <div style={{ fontSize: 13, color: "#999", marginTop: 1 }}>在线</div>
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
        <div ref={scrollRef} onScroll={() => { const el = scrollRef.current; if (!el) return; setShowScrollBtn(el.scrollHeight - el.scrollTop - el.clientHeight > 120); }} style={{ flex: 1, overflowY: "auto", padding: "16px 12px", WebkitOverflowScrolling: "touch" }}>
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
              {m.role === "assistant" && <Avatar src={GEGE_IMG} size={40} />}
              {m.role === "user" && <Avatar src={TAOZHI_IMG} size={40} />}
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
                  <div>
                    {m.attachment && m.attachment.type.startsWith("image/") && (
                      <img src={m.attachment.data} alt={m.attachment.name}
                        style={{ maxWidth: "100%", borderRadius: 12, marginBottom: 6, display: "block" }} />
                    )}
                    {m.attachment && !m.attachment.type.startsWith("image/") && (
                      <div style={{ padding: "8px 12px", background: m.role === "user" ? "rgba(255,255,255,0.15)" : "#f0f0f0", borderRadius: 10, marginBottom: 6, fontSize: 13, color: m.role === "user" ? "#fff" : "#555" }}>
                        📎 {m.attachment.name}
                      </div>
                    )}
                    {(m.displayContent || m.content) && !m.content.startsWith("[图片：") && (
                      <div style={{
                        padding: "10px 14px",
                        background: m.role === "user" ? "#1a1a1a" : "#fff",
                        color: m.role === "user" ? "#fff" : "#1a1a1a",
                        borderRadius: m.role === "user" ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
                        fontSize: 16, lineHeight: 1.6, whiteSpace: "pre-wrap",
                        boxShadow: "0 1px 3px rgba(0,0,0,0.08)"
                      }}>{m.displayContent || m.content}</div>
                    )}
                  </div>
                )}
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
                  <span style={{ fontSize: 13, color: "#c0c0c0" }}>{m.time}</span>
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
              <Avatar src={GEGE_IMG} size={40} />
              <div style={{ padding: "12px 16px", background: "#fff", borderRadius: "18px 18px 18px 4px", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
                <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                  {[0,1,2].map(i => <div key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: "#ccc", animation: `bounce 1.2s ease-in-out ${i*0.2}s infinite` }}/>)}
                </div>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* 回到底部按钮 */}
        {showScrollBtn && (
          <button onClick={() => bottomRef.current?.scrollIntoView({ behavior: "smooth" })} style={{
            position: "absolute", right: 16, bottom: 80,
            width: 36, height: 36, borderRadius: "50%",
            background: "rgba(26,26,26,0.75)", border: "none",
            color: "#fff", fontSize: 16, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 2px 8px rgba(0,0,0,0.2)", zIndex: 20
          }}>↓</button>
        )}

        {/* 附件预览 */}
        {attachedFile && (
          <div style={{ padding: "8px 16px", background: "#fff", borderTop: "1px solid #f0f0f0", display: "flex", alignItems: "center", gap: 8 }}>
            {attachedFile.type.startsWith("image/") && attachedFileData && (
              <img src={attachedFileData} style={{ height: 48, width: 48, objectFit: "cover", borderRadius: 8 }} />
            )}
            {!attachedFile.type.startsWith("image/") && (
              <div style={{ fontSize: 20 }}>📎</div>
            )}
            <span style={{ fontSize: 13, color: "#555", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{attachedFile.name}</span>
            <button onClick={removeAttachment} style={{ background: "none", border: "none", color: "#bbb", fontSize: 18, cursor: "pointer", padding: "0 4px" }}>×</button>
          </div>
        )}

        {/* 输入区 */}
        <div style={{
          padding: "10px 12px 12px", background: "#fff",
          borderTop: "1px solid #ebebeb",
          display: "flex", gap: 8, alignItems: "flex-end", flexShrink: 0
        }}>
          <button onClick={() => fileInputRef.current?.click()} style={{
            width: 36, height: 36, borderRadius: "50%", border: "none",
            background: "#f0f0f0", color: "#888", fontSize: 18,
            cursor: "pointer", flexShrink: 0,
            display: "flex", alignItems: "center", justifyContent: "center"
          }}>+</button>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="说点什么…"
            rows={1}
            style={{
              flex: 1, padding: "10px 14px", background: "#f5f5f5",
              border: "none", borderRadius: 22, fontSize: 16,
              resize: "none", outline: "none", lineHeight: 1.5,
              maxHeight: 120, overflowY: "auto", fontFamily: "inherit", color: "#111"
            }}
            onInput={e => {
              e.target.style.height = "auto";
              e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
            }}
          />
          <button onClick={send} disabled={loading || (!input.trim() && !attachedFile)} style={{
            width: 40, height: 40, borderRadius: "50%", border: "none",
            background: (input.trim() || attachedFile) && !loading ? "#1a1a1a" : "#e0e0e0",
            color: "#fff", fontSize: 18, cursor: (input.trim() || attachedFile) ? "pointer" : "default",
            flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
            transition: "background 0.2s"
          }}>↑</button>
        </div>

      </div>
    </>
  );
}
