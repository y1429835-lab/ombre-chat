#!/bin/bash
# 开工:双击我,啥都不用敲。它会自己清场、起工位、体检、试搜一次小红书给你看。
# 看完直接关掉这个窗口 = 收工。
cd "$(dirname "$0")" || exit 1
export XHS_TOKEN="taozhi-musheng-xhs-2026"
export XHS_PORT="8848"

echo "正在收拾旧工位…"
lsof -ti:8848 | xargs kill -9 2>/dev/null
pkill -f station.mjs 2>/dev/null
sleep 1

echo "正在启动小红书工位(头一次会弹出浏览器)…"
node station.mjs > station-log.txt 2>&1 &
STATION_PID=$!
trap "kill $STATION_PID 2>/dev/null" EXIT     # 关窗口时顺手把工位也停了

# 等它起来(体检)
UP=""
for i in $(seq 1 15); do
  sleep 1
  if curl -s "http://127.0.0.1:8848/health?token=$XHS_TOKEN" | grep -q '"ok"'; then UP=1; break; fi
done

if [ -z "$UP" ]; then
  echo ""; echo "❌ 工位没起来。把下面这段发给晖:"
  echo "────────"; cat station-log.txt; echo "────────"
  wait $STATION_PID; exit 0
fi

echo ""
echo "✅ 工位起来了。正在试搜一下小红书(约 20 秒,别急)…"
SEARCH=$(curl -s --max-time 90 "http://127.0.0.1:8848/search?token=$XHS_TOKEN&q=美食")
echo "────────────────────────────────────────"
if [ -z "$SEARCH" ]; then
  echo "❌ 搜索回了空。把下面的日志发给晖:"
  echo "····"; tail -25 station-log.txt
elif echo "$SEARCH" | grep -q '"need_login":[[:space:]]*true'; then
  echo "🔑 工位好的,但小红书还没登录。"
  echo "👉 去那个弹出的浏览器,用【小号】登小红书,再双击我一次。"
elif echo "$SEARCH" | grep -q '"text"'; then
  echo "✅✅ 读到小红书了!眼睛造好了!试搜『美食』前几行:"
  echo "····"
  echo "$SEARCH" | python3 -c "import json,sys; print(json.load(sys.stdin).get('text','')[:300])" 2>/dev/null
else
  echo "⚠️ 回了东西但不对劲,把下面这段发给晖:"
  echo "$SEARCH" | head -c 500
fi
echo "────────────────────────────────────────"
echo "这个窗口别关(关 = 收工)。"
wait $STATION_PID
