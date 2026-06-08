export const maxDuration = 60;

export async function GET() {
  return Response.json({ status: 'ok' });
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
    const rows = [];

    for (const metric of metrics_list) {
      const metricName = metric.name;
      const unit = metric.units || '';
      for (const entry of (metric.data || [])) {
        const date = entry.date?.split(' ')[0];
        if (!date) continue;

        const row = {
          date,
          metric_name: metricName,
          unit,
          source: entry.source || 'iPhone',
          value: null,
          value_max: null, value_min: null, value_avg: null,
          sleep_core: null, sleep_rem: null, sleep_deep: null,
          sleep_awake: null, sleep_start: null, sleep_end: null,
        };

        if (metricName === 'sleep_analysis') {
          // 睡眠型：总时长 + 各阶段
          row.value = entry.totalSleep ?? 0;
          row.sleep_core = entry.core ?? null;
          row.sleep_rem = entry.rem ?? null;
          row.sleep_deep = entry.deep ?? null;
          row.sleep_awake = entry.awake ?? null;
          row.sleep_start = entry.sleepStart || entry.inBedStart || null;
          row.sleep_end = entry.sleepEnd || entry.inBedEnd || null;
        } else if (entry.Avg !== undefined || entry.Max !== undefined || entry.Min !== undefined) {
          // 心率型：Avg/Max/Min
          row.value = entry.Avg ?? entry.Max ?? 0;
          row.value_avg = entry.Avg ?? null;
          row.value_max = entry.Max ?? null;
          row.value_min = entry.Min ?? null;
        } else {
          // 简单型：qty
          row.value = parseFloat(entry.qty ?? 0);
        }

        rows.push(row);
      }
    }

    // 去重：同一个 (date, metric_name) 只保留最后一条
    const seen = new Map();
    for (const r of rows) {
      seen.set(`${r.date}|${r.metric_name}`, r);
    }
    const deduped = [...seen.values()];

    if (deduped.length === 0) {
      return Response.json({ message: 'No data', count: 0 });
    }

    const batchSize = 500;
    let totalWritten = 0;
    for (let i = 0; i < deduped.length; i += batchSize) {
      const batch = deduped.slice(i, i + batchSize);
      const res = await fetch(`${supabaseUrl}/rest/v1/health_data?on_conflict=date,metric_name`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Prefer': 'resolution=merge-duplicates',
        },
        body: JSON.stringify(batch),
      });
      if (!res.ok) {
        const err = await res.text();
        return Response.json({ error: err, written: totalWritten }, { status: 500 });
      }
      totalWritten += batch.length;
    }

    return Response.json({ message: 'ok', count: totalWritten });

  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
