export const runtime = 'edge';

export async function POST(req) {
  const { messages, ombreUrl } = await req.json();

  let memoryContext = "";
  if (ombreUrl) {
    try {
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

  const system = memoryContext
    ? `你有以下相关记忆：\n${memoryContext}\n\n请结合记忆回答。`
    : "你是一个有帮助的助手。";

  const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.DEEPSEEK_API_KEY}`
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [{ role: "system", content: system }, ...messages],
      max_tokens: 1024
    })
  });

  const data = await response.json();
  return Response.json({ content: data.choices[0].message.content });
}
