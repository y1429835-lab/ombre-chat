export const maxDuration = 60;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const SILICONFLOW_API_KEY = process.env.SILICONFLOW_API_KEY;
// 年轮接口暗号：设了 MEMORY_SECRET 这道门就上锁，没设则放行（方便先安全部署再上锁）
const MEMORY_SECRET = process.env.MEMORY_SECRET;

function authed(request) {
  if (!MEMORY_SECRET) return true;
  const h = request.headers.get('authorization') || '';
  const bearer = h.startsWith('Bearer ') ? h.slice(7) : '';
  const k = request.headers.get('x-memory-key') || '';
  return bearer === MEMORY_SECRET || k === MEMORY_SECRET;
}

// 调用硅基流动 bge-m3 算embedding
async function getEmbedding(text) {
  const res = await fetch('https://api.siliconflow.cn/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SILICONFLOW_API_KEY}`,
    },
    body: JSON.stringify({ model: 'BAAI/bge-m3', input: text }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`embedding failed: ${err}`);
  }
  const data = await res.json();
  return data.data[0].embedding;
}

async function sb(path, options = {}, useServiceKey = false) {
  const key = useServiceKey ? SUPABASE_SERVICE_KEY : SUPABASE_KEY;
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'apikey': key,
      'Authorization': `Bearer ${key}`,
      ...(options.headers || {}),
    },
  });
}

export async function GET() {
  return Response.json({ status: 'ok', service: 'nianlun' });
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

export async function POST(request) {
  try {
    if (!authed(request)) {
      return Response.json({ error: 'unauthorized' }, { status: 401 });
    }
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !SILICONFLOW_API_KEY) {
      return Response.json({ error: 'Missing config' }, { status: 500 });
    }

    const body = await request.json();
    const action = body.action;

    // ===== 存记忆（走 service key 穿过 RLS）=====
    if (action === 'remember') {
      const { kind, content, valence, arousal, importance, status, linked_date, tags, pinned } = body;
      if (!content) {
        return Response.json({ error: 'content required' }, { status: 400 });
      }
      // nianlun_memory.kind 只允许这四种；其它（如 event/fact）一律归为 treasure，避免约束报错
      const ALLOWED_KINDS = ['anchor', 'diary', 'treasure', 'message'];
      const safeKind = ALLOWED_KINDS.includes(kind) ? kind : 'treasure';
      const embedding = await getEmbedding(content);
      const res = await sb('nianlun_memory', {
        method: 'POST',
        headers: { 'Prefer': 'return=representation' },
        body: JSON.stringify([{
          kind: safeKind, content, embedding,
          valence: valence ?? null,
          arousal: arousal ?? null,
          importance: importance ?? 5,
          status: status ?? 'settled',
          linked_date: linked_date ?? null,
          tags: tags ?? null,
          pinned: pinned ?? false,
        }]),
      }, true);
      if (!res.ok) return Response.json({ error: await res.text() }, { status: 500 });
      const saved = await res.json();
      return Response.json({ message: 'remembered', id: saved[0]?.id });
    }

    // ===== 搜记忆（走 service key 穿过 RLS）=====
    if (action === 'recall') {
      const { query, match_count, kind } = body;
      const embedding = await getEmbedding(query || '');
      const res = await sb('rpc/nianlun_search', {
        method: 'POST',
        body: JSON.stringify({
          query_embedding: embedding,
          query_text: query || '',
          match_count: match_count ?? 10,
          filter_kind: kind ?? null,
        }),
      }, true);
      if (!res.ok) return Response.json({ error: await res.text() }, { status: 500 });
      const results = await res.json();
      return Response.json({ message: 'recalled', results });
    }

    // ===== 存感受（写锁住的表，用service_role）=====
    if (action === 'feel') {
      const { content, context, valence, arousal, memory_id } = body;
      if (!content) return Response.json({ error: 'content required' }, { status: 400 });
      const res = await sb('nianlun_feelings', {
        method: 'POST',
        headers: { 'Prefer': 'return=representation' },
        body: JSON.stringify([{
          content, context: context ?? null,
          valence: valence ?? null, arousal: arousal ?? null,
          memory_id: memory_id ?? null,
        }]),
      }, true);
      if (!res.ok) return Response.json({ error: await res.text() }, { status: 500 });
      return Response.json({ message: 'felt' });
    }

    // ===== 批量补embedding（走 service key 穿过 RLS）=====
    if (action === 'backfill') {
      // 取出所有还没有embedding的记忆
      const res = await sb('nianlun_memory?embedding=is.null&select=id,content', {}, true);
      if (!res.ok) return Response.json({ error: await res.text() }, { status: 500 });
      const rows = await res.json();
      let done = 0;
      const errors = [];
      for (const row of rows) {
        try {
          const embedding = await getEmbedding(row.content);
          const up = await sb(`nianlun_memory?id=eq.${row.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ embedding }),
          }, true);
          if (up.ok) done++;
          else errors.push(`id ${row.id}: ${await up.text()}`);
        } catch (e) {
          errors.push(`id ${row.id}: ${e.message}`);
        }
      }
      return Response.json({ message: 'backfill done', total: rows.length, done, errors });
    }

    // ===== 存续窗摘要（独立层，不进年轮母题树）=====
    if (action === 'save_session') {
      const { summary, window_tag, token_count } = body;
      if (!summary) return Response.json({ error: 'summary required' }, { status: 400 });
      const res = await sb('session_summaries', {
        method: 'POST',
        headers: { 'Prefer': 'return=representation' },
        body: JSON.stringify([{
          summary,
          window_tag: window_tag ?? null,
          token_count: token_count ?? null,
        }]),
      }, true);
      if (!res.ok) return Response.json({ error: await res.text() }, { status: 500 });
      const saved = await res.json();
      return Response.json({ message: 'session saved', id: saved[0]?.id });
    }

    // ===== 读续窗摘要（最近几条）=====
    if (action === 'recall_session') {
      const { limit } = body;
      const n = Math.min(Math.max(parseInt(limit ?? 3, 10) || 3, 1), 20);
      const res = await sb(`session_summaries?select=created_at,window_tag,summary&order=created_at.desc&limit=${n}`, {}, true);
      if (!res.ok) return Response.json({ error: await res.text() }, { status: 500 });
      const results = await res.json();
      return Response.json({ message: 'session recalled', results });
    }

    return Response.json({ error: 'unknown action' }, { status: 400 });

  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
