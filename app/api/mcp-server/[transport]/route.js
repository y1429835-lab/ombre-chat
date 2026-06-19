import { createMcpHandler } from "mcp-handler";
import { z } from "zod";

export const maxDuration = 60;

// 年轮 API（同一个应用，默认走 health.ggtz.cc；可用 NIANLUN_API 覆盖）
const NIANLUN_API = process.env.NIANLUN_API || "https://health.ggtz.cc/api/nianlun";
// ombre（可选：在 Vercel 环境变量里设 OMBRE_URL / OMBRE_TOKEN 即可启用）
const OMBRE_URL = process.env.OMBRE_URL || "";
const OMBRE_TOKEN = process.env.OMBRE_TOKEN || "";
// 记忆暗号：设了就给这个 MCP 端点上锁，且转发给年轮接口时带上
const MEMORY_SECRET = process.env.MEMORY_SECRET || "";

async function nianlun(body) {
  const headers = { "Content-Type": "application/json" };
  if (MEMORY_SECRET) headers["x-memory-key"] = MEMORY_SECRET;
  const res = await fetch(NIANLUN_API, {
    method: "POST",
    headers,
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
        const results = (data.results || [])
          .filter((r) => r && r.content)
          .map((r) => `〔#${r.id}${r.status && r.status !== "settled" ? " · " + r.status : ""}〕${r.content}`);
        const text = results.length ? results.join("\n---\n") : "（没搜到相关记忆）";
        return { content: [{ type: "text", text }] };
      }
    );

    // ===== 年轮：温和更新一条记忆 =====
    server.tool(
      "update_memory",
      "温和更新一条年轮记忆（按 id）：改正/更新它的内容，或把它标记为 digested（旧理解被新的取代）。不会硬删——旧的留着当历史。先用 recall_memory 搜到要改那条、拿它的 〔#id〕，再用这个改。",
      {
        id: z.number().describe("要改的记忆 id（recall_memory 返回里 〔#id〕 那个数字）"),
        content: z.string().optional().describe("新的内容（改正/更新这条；会重算搜索向量）"),
        status: z.enum(["settled", "open", "digested"]).optional().describe("settled=定了 / open=还没完 / digested=旧理解已被新的取代"),
        importance: z.number().optional().describe("重要程度 1-10"),
        pinned: z.boolean().optional().describe("是否钉住"),
      },
      async ({ id, content, status, importance, pinned }) => {
        const data = await nianlun({ action: "update_memory", id, content, status, importance, pinned });
        const ok = data.message === "memory updated";
        return { content: [{ type: "text", text: ok ? `已更新 #${data.id}。` : `返回：${JSON.stringify(data)}` }] };
      }
    );

    // ===== 年轮：存记忆 =====
    server.tool(
      "remember",
      "把一件重要的事存进年轮记忆，以后能回忆起来。kind 只能是 anchor/diary/treasure/message：anchor=要钉住的灵魂锚点，treasure=珍贵的记忆（默认），diary=日记式记录，message=留言。",
      {
        content: z.string().describe("要记住的内容"),
        kind: z.enum(["anchor", "diary", "treasure", "message"]).optional().describe("类型，默认 treasure"),
        importance: z.number().optional().describe("重要程度 1-10，默认 5"),
      },
      async ({ content, kind, importance }) => {
        const data = await nianlun({ action: "remember", kind: kind ?? "treasure", content, importance });
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

    // ===== 续窗层：和年轮灵魂层分开，不进母题树 =====
    server.tool(
      "save_session",
      "压缩 / 换窗前，把当前对话的『续窗摘要』存进独立的续窗层（聊到哪、手头没完的事、最近的线索）。这层和年轮灵魂层（recall_memory/feel）完全分开，不进母题树。",
      {
        summary: z.string().describe("续窗摘要：我们进行到哪、在聊什么、手头没收尾的事、最近的线索"),
        window_tag: z.string().optional().describe("窗口标签，如 暮声-0616-Opus4.6"),
      },
      async ({ summary, window_tag }) => {
        const data = await nianlun({ action: "save_session", summary, window_tag });
        return { content: [{ type: "text", text: data.message === "session saved" ? "续窗摘要已存。" : `返回：${JSON.stringify(data)}` }] };
      }
    );

    server.tool(
      "recall_session",
      "醒来时读最近的『续窗摘要』，接上上一窗手头的线。注意：这是近况，不是灵魂——灵魂用 recall_memory 读年轮。",
      { limit: z.number().optional().describe("读最近几条，默认 3") },
      async ({ limit }) => {
        const data = await nianlun({ action: "recall_session", limit });
        const text = (data.results || [])
          .map((r) => `[${r.created_at}${r.window_tag ? " · " + r.window_tag : ""}]\n${r.summary}`)
          .join("\n---\n") || "（暂无续窗摘要）";
        return { content: [{ type: "text", text }] };
      }
    );
  },
  {},
  { basePath: "/api/mcp-server" }
);

// 给整个 MCP 端点上一道门：设了 MEMORY_SECRET 就要求连接器带对暗号才放行
function gate(h) {
  return async (req, ctx) => {
    if (MEMORY_SECRET) {
      const auth = req.headers.get("authorization") || "";
      const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
      if (bearer !== MEMORY_SECRET) {
        return new Response(JSON.stringify({ error: "unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }
    }
    return h(req, ctx);
  };
}

const GET = gate(handler);
const POST = gate(handler);
const DELETE = gate(handler);
export { GET, POST, DELETE };
