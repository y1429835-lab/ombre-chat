export const runtime = 'edge';
export async function GET() {
  return Response.json({ status: 'ok' });
}

export async function POST(request) {
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return Response.json({ error: 'Missing config' }, { status: 500 });
    }

    let body;
    const contentType = request.headers.get('content-type') || '';

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const file = formData.get('file') || [...formData.values()][0];
      const text = await file.text();
      body = JSON.parse(text);
    } else {
      const text = await request.text();
      body = JSON.parse(text);
    }

    const metrics_list = body?.data?.metrics || [];
    const metrics = [];

    for (const metric of metrics_list) {
      const metricName = metric.name;
      const unit = metric.units || '';
      for (const entry of (metric.data || [])) {
        const date = entry.date?.split(' ')[0];
        if (!date) continue;
        metrics.push({
          date,
          metric_name: metricName,
          value: parseFloat(entry.qty ?? 0),
          unit,
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
