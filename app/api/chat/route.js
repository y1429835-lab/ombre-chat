export async function POST(req) {
  const { messages, ombreUrl } = await req.json();

  let memoryContext = "";
  if (ombreUrl) {
    try {
      const res = await fetch(`${ombreUrl}/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          method: "tools/call",
          params: { name: "breath", arguments: { query: messages.at(-1).content } }
        })
      });
      const data = await res.json();
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
