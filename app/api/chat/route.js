let memoryContext = "";
if (ombreUrl) {
  try {
    // 初始化session
    const initRes = await fetch(`${ombreUrl}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream"
      },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1,
        method: "initialize",
        params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "ombre-chat", version: "1.0" } }
      })
    });
    const sessionId = initRes.headers.get("mcp-session-id");

    // 调breath工具
    const breathRes = await fetch(`${ombreUrl}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        ...(sessionId ? { "mcp-session-id": sessionId } : {})
      },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 2,
        method: "tools/call",
        params: { name: "breath", arguments: { query: messages.at(-1).content } }
      })
    });
    const data = await breathRes.json();
    memoryContext = data?.result?.content?.[0]?.text || "";
  } catch {}
}
