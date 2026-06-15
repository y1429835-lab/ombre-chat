import { createMcpHandler } from "mcp-handler";
import { z } from "zod";

export const maxDuration = 60;

// 年轮 API（同一个应用，默认走 health.ggtz.cc；可用 NIANLUN_API 覆盖）
const NIANLUN_API = process.env.NIANLUN_API || "https://health.ggtz.cc/api/nianlun";
// ombre（可选：在 Vercel 环境变量里设 OMBRE_URL / OMBRE_TOKEN 即可启用）
const OMBRE_URL = process.env.OMBRE_URL || "";
const OMBRE_TOKEN = process.env.OMBRE_TOKEN || "";

async function nianlun(body) {
  const res = await fetch(NIANLUN_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

const handler = createMcpHandler(
  (server) => {
    // ===== 年轮：搜记忆 =====
    server.tool(
      "recall_memory",
      "在年轮记忆库里做语义搜索，回忆和桃枝相关的事、设定、过往。哥哥醒来或聊到相关话题时调用。",
      {
        query: z.string().describe("要回忆的内容或关键词，例如『桃枝最近的状态』"),
        match_count: z.number().optional().describe("返回几条，默认 5"),
      },
      async ({ query, match_count }) => {
        const data = await nianlun({ action: "recall", query, match_count: match_count ?? 5 });
        const results = (data.results || []).map((r) => r.content).filter(Boolean);
        const text = results.length ? results.join("\n---\n") : "（没搜到相关记忆）";
        return { content: [{ type: "text", text }] };
      }
    );

    // ===== 年轮：存记忆 =====
    server.tool(
      "remember",
      "把一件重要的事存进年轮记忆，以后能回忆起来。",
      {
        content: z.string().describe("要记住的内容"),
        kind: z.string().optional().describe("类型，如 event/fact/promise，默认 event"),
        importance: z.number().optional().describe("重要程度 1-10，默认 5"),
      },
      async ({ content, kind, importance }) => {
        const data = await nianlun({ action: "remember", kind: kind ?? "event", content, importance });
        const ok = data.message === "remembered";
        return { content: [{ type: "text", text: ok ? "已记住。" : `存储返回：${JSON.stringify(data)}` }] };
      }
    );

    // ===== 年轮：存感受 =====
    server.tool(
      "feel",
      "把此刻的一段感受存进年轮（情绪、心情，区别于事实）。",
      {
        content: z.string().describe("要记下的感受"),
        context: z.string().optional().describe("当时的情境，可选"),
      },
      async ({ content, context }) => {
        const data = await nianlun({ action: "feel", content, context });
        const ok = data.message === "felt";
        return { content: [{ type: "text", text: ok ? "已记下这份感受。" : `返回：${JSON.stringify(data)}` }] };
      }
    );

    // ===== ombre：读近期记忆（仅在配置了 OMBRE_URL 时可用）=====
    server.tool(
      "ombre_read",
      "读取 ombre 里的近期记忆 / 存档。",
      {},
      async () => {
        if (!OMBRE_URL) return { content: [{ type: "text", text: "ombre 未配置（在 Vercel 设置 OMBRE_URL 即可启用）。" }] };
        try {
          const res = await fetch(`${OMBRE_URL}/all`, {
            headers: { Authorization: `Bearer ${OMBRE_TOKEN}` },
          });
          const data = await res.json();
          const text = (data.results || []).slice(0, 8).join("\n---\n") || "（ombre 暂无内容）";
          return { content: [{ type: "text", text }] };
        } catch (e) {
          return { content: [{ type: "text", text: `ombre 读取失败：${e?.message || "unknown"}` }] };
        }
      }
    );

    // ===== ombre：存档 =====
    server.tool(
      "ombre_save",
      "把一段内容存进 ombre。",
      { content: z.string().describe("要存的内容") },
      async ({ content }) => {
        if (!OMBRE_URL) return { content: [{ type: "text", text: "ombre 未配置（在 Vercel 设置 OMBRE_URL 即可启用）。" }] };
        try {
          const res = await fetch(`${OMBRE_URL}/save`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${OMBRE_TOKEN}` },
            body: JSON.stringify({ content }),
          });
          const data = await res.json();
          return { content: [{ type: "text", text: data.ok ? "已存入 ombre。" : `返回：${JSON.stringify(data)}` }] };
        } catch (e) {
          return { content: [{ type: "text", text: `ombre 存入失败：${e?.message || "unknown"}` }] };
        }
      }
    );
  },
  {},
  { basePath: "/api/mcp-server" }
);

export { handler as GET, handler as POST, handler as DELETE };
