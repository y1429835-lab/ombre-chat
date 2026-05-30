export const runtime = 'edge';

export async function POST(req) {
  const { messages, ombreUrl } = await req.json();

  let memoryContext = "";
  if (ombreUrl) {
    try {
      const res = await fetch(`${ombreUrl}/all`);
      const data = await res.json();
      if (data.results && data.results.length > 0) {
        memoryContext = data.results.slice(0, 3).join("\n---\n");
      }
    } catch {}
  }

  const system = memoryContext
    ? `你有以下相关记忆：\n${memoryContext}\n\n请结合记忆回答。`
    : "你是一个有帮助的助手。";

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 1024,
      system,
      messages,
    })
  });

  const data = await response.json();
  return Response.json({ content: data.content[0].text });
}
