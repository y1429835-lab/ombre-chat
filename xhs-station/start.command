#!/bin/bash
# 开工:双击我,啥都不用敲。它会自己清场、起工位、体检、弹浏览器。
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

# 等它起来,自检
for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
  sleep 1
  if curl -s "http://127.0.0.1:8848/health?token=$XHS_TOKEN" | grep -q '"ok"'; then
    echo ""
    echo "✅ 工位起来了!"
    echo "────────────────────────────────────────"
    echo "👉 去那个自动弹出的浏览器窗口,用【小号】登小红书(扫码 / 手机号都行)。"
    echo "👉 登好就行了。这个黑窗口别关 —— 关了 = 收工。"
    echo "────────────────────────────────────────"
    wait $STATION_PID
    exit 0
  fi
done

echo ""
echo "❌ 工位没起来。把下面这段(或 station-log.txt)发给晖:"
echo "────────────────────────────────────────"
cat station-log.txt
echo "────────────────────────────────────────"
echo "(这个窗口先别关,把上面红字发晖)"
wait $STATION_PID
