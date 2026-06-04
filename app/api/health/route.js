export const runtime = 'edge';

export async function POST(request) {
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return Response.json({ error: 'Missing config' }, { status: 500 });
    }

    const text = await request.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return Response.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const data = body.data || body;
    const metrics = [];

    for (const [metricName, entries] of Object.entries(data)) {
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        const date = entry.date?.split(' ')[0] || entry.startDate?.split(' ')[0];
        if (!date) continue;
        metrics.push({
          date,
          metric_name: metricName,
          value: parseFloat(entry.qty ?? entry.value ?? 0),
          unit: entry.units || entry.unit || '',
          source: entry.source || 'iPhone',
        });
      }
    }

    if (metrics.length === 0) {
      return Response.json({ message: 'No data', count: 0 });
    }

    const res = await fetch(`${supabaseUrl}/rest/v1/health_data`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Prefer': 'resolution=merge-duplicates',
      },
      body: JSON.stringify(metrics),
    });

    if (!res.ok) {
      const err = await res.text();
      return Response.json({ error: err }, { status: 500 });
    }

    return Response.json({ message: 'ok', count: metrics.length });

  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
