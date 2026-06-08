export const maxDuration = 60;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const SILICONFLOW_API_KEY = process.env.SILICONFLOW_API_KEY;

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

async function sb(path, options = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
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
    if (!SUPABASE_URL || !SUPABASE_KEY || !SILICONFLOW_API_KEY) {
      return Response.json({ error: 'Missing config' }, { status: 500 });
    }

    const body = await request.json();
    const action = body.action;

    // ===== 存记忆 =====
    if (action === 'remember') {
      const { kind, content, valence, arousal, importance, status, linked_date, tags, pinned } = body;
      if (!kind || !content) {
        return Response.json({ error: 'kind and content required' }, { status: 400 });
      }
      const embedding = await getEmbedding(content);
      const res = await sb('nianlun_memory', {
        method: 'POST',
        headers: { 'Prefer': 'return=representation' },
        body: JSON.stringify([{
          kind, content, embedding,
          valence: valence ?? null,
          arousal: arousal ?? null,
          importance: importance ?? 5,
          status: status ?? 'settled',
          linked_date: linked_date ?? null,
          tags: tags ?? null,
          pinned: pinned ?? false,
        }]),
      });
      if (!res.ok) return Response.json({ error: await res.text() }, { status: 500 });
      const saved = await res.json();
      return Response.json({ message: 'remembered', id: saved[0]?.id });
    }

    // ===== 搜记忆 =====
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
      });
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
      });
      if (!res.ok) return Response.json({ error: await res.text() }, { status: 500 });
      return Response.json({ message: 'felt' });
    }

    return Response.json({ error: 'unknown action' }, { status: 400 });

  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
