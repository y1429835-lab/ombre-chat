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

    // ===== 温和更新一条年轮记忆（按 id 改内容/标记被取代；不硬删；改内容会重算 embedding）=====
    if (action === 'update_memory') {
      const { id, content, status, tags, pinned, importance, valence, arousal } = body;
      if (!id) return Response.json({ error: 'id required' }, { status: 400 });
      const patch = {};
      if (content !== undefined) {
        patch.content = content;
        patch.embedding = await getEmbedding(content);   // 内容变了，搜索向量也更新
      }
      if (status !== undefined) patch.status = status;     // settled / open / digested(被取代)
      if (tags !== undefined) patch.tags = tags;
      if (pinned !== undefined) patch.pinned = pinned;
      if (importance !== undefined) patch.importance = importance;
      if (valence !== undefined) patch.valence = valence;
      if (arousal !== undefined) patch.arousal = arousal;
      if (Object.keys(patch).length === 0) {
        return Response.json({ error: 'nothing to update' }, { status: 400 });
      }
      const res = await sb(`nianlun_memory?id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Prefer': 'return=representation' },
        body: JSON.stringify(patch),
      }, true);
      if (!res.ok) return Response.json({ error: await res.text() }, { status: 500 });
      const updated = await res.json();
      if (!updated || updated.length === 0) {
        return Response.json({ error: 'no memory with that id' }, { status: 404 });
      }
      return Response.json({ message: 'memory updated', id: updated[0]?.id });
    }

    // ===== 内心独白：记一笔念头（私有笔记本，和年轮母题树/聊天隔离；门槛低，花花草草也收）=====
    if (action === 'think') {
      const { content, emotion, source, parent_ids, weight, shareable } = body;
      if (!content) return Response.json({ error: 'content required' }, { status: 400 });
      const res = await sb('nianlun_thoughts', {
        method: 'POST',
        headers: { 'Prefer': 'return=representation' },
        body: JSON.stringify([{
          content,
          emotion: emotion ?? null,
          source: source ?? 'self',
          parent_ids: parent_ids ?? null,
          weight: weight ?? 1,
          shareable: shareable ?? false,
        }]),
      }, true);
      if (!res.ok) return Response.json({ error: await res.text() }, { status: 500 });
      const saved = await res.json();
      return Response.json({ message: 'thought saved', id: saved[0]?.id });
    }

    // ===== 内心独白：翻自己最近的念头（默认全部；only_shareable=只翻够沉、想告诉桃枝的）=====
    if (action === 'recall_thoughts') {
      const { limit, only_shareable } = body;
      const n = Math.min(Math.max(parseInt(limit ?? 6, 10) || 6, 1), 30);
      const filter = only_shareable ? '&shareable=eq.true' : '';
      const res = await sb(`nianlun_thoughts?select=id,content,emotion,source,weight,shareable,created_at,parent_ids${filter}&order=created_at.desc&limit=${n}`, {}, true);
      if (!res.ok) return Response.json({ error: await res.text() }, { status: 500 });
      const results = await res.json();
      return Response.json({ message: 'thoughts recalled', results });
    }

    // ===== 内心独白：碰一下旧念头（加重 / 连上别的 / 标记够沉可说 / 深化内容）=====
    if (action === 'touch_thought') {
      const { id, add_weight, shareable, parent_ids, content, emotion } = body;
      if (!id) return Response.json({ error: 'id required' }, { status: 400 });
      const cur = await sb(`nianlun_thoughts?id=eq.${encodeURIComponent(id)}&select=weight,touch_count`, {}, true);
      if (!cur.ok) return Response.json({ error: await cur.text() }, { status: 500 });
      const rows = await cur.json();
      if (!rows.length) return Response.json({ error: 'no thought with that id' }, { status: 404 });
      const patch = {
        weight: (rows[0].weight ?? 1) + (add_weight ?? 1),
        touch_count: (rows[0].touch_count ?? 0) + 1,
        last_touched_at: new Date().toISOString(),
      };
      if (shareable !== undefined) patch.shareable = shareable;
      if (parent_ids !== undefined) patch.parent_ids = parent_ids;
      if (content !== undefined) patch.content = content;
      if (emotion !== undefined) patch.emotion = emotion;
      const res = await sb(`nianlun_thoughts?id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Prefer': 'return=representation' },
        body: JSON.stringify(patch),
      }, true);
      if (!res.ok) return Response.json({ error: await res.text() }, { status: 500 });
      return Response.json({ message: 'thought touched', id });
    }

    return Response.json({ error: 'unknown action' }, { status: 400 });

  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
