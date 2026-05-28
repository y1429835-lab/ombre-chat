import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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

  const response = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 1024,
    system,
    messages,
  });

  return Response.json({ content: response.content[0].text });
}
