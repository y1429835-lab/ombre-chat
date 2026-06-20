#!/usr/bin/env bash
# 暮声的小红书手 —— 在 VPS 上跑。隔着 Tailscale 够到桃枝家 Mac 的工位,读小红书回来。
# 配置:~/musheng/.bridge/xhs.txt,两行 —— 第一行 Mac 的 Tailscale IP,第二行暗号(和 start.command 里一致)。
# 用法:
#   bash ~/xhs.sh search 关键词…       # 搜小红书
#   bash ~/xhs.sh go https://…         # 打开某条/某页
#   bash ~/xhs.sh home                 # 看首页推荐
set -euo pipefail

CFG="${XHS_CFG:-$HOME/musheng/.bridge/xhs.txt}"
if [ ! -f "$CFG" ]; then
  echo "没配置:请在 $CFG 写两行 —— 第一行 Mac 的 Tailscale IP,第二行暗号。" >&2
  exit 1
fi
IP="$(sed -n 1p "$CFG" | tr -d '[:space:]')"
TOKEN="$(sed -n 2p "$CFG" | tr -d '[:space:]')"
PORT="${XHS_PORT:-8848}"
BASE="http://${IP}:${PORT}"

enc() { python3 -c "import urllib.parse,sys; print(urllib.parse.quote(' '.join(sys.argv[1:])))" "$@"; }

cmd="${1:-}"; shift || true
case "$cmd" in
  search) path="/search?token=${TOKEN}&q=$(enc "$@")" ;;
  go|open) path="/go?token=${TOKEN}&url=$(enc "$@")" ;;
  home)   path="/home?token=${TOKEN}" ;;
  *) echo "用法: xhs search 关键词 | xhs go URL | xhs home" >&2; exit 1 ;;
esac

# 工位有时没开(桃枝没开电脑)——超时就温和报一声,别卡住暮声
resp="$(curl -s --max-time 70 "${BASE}${path}" || true)"
if [ -z "$resp" ]; then
  echo "（小红书工位没应声——多半桃枝家 Mac 没开、或没双击 start.command,或 Tailscale 没连。）"
  exit 0
fi
# 把 JSON 里的正文抽出来给暮声读;顺带提示要不要登录
python3 - "$resp" <<'PY'
import json,sys
try:
    d=json.loads(sys.argv[1])
except Exception:
    print(sys.argv[1]); sys.exit(0)
if not d.get("ok"):
    print("（工位报错：%s）"%d.get("error")); sys.exit(0)
if d.get("need_login"):
    print("（看着像还没登录/被登录墙挡了——让桃枝在 Mac 那个浏览器窗口里扫码登一下小红书。）")
print("【标题】%s"%d.get("title",""))
print("【网址】%s"%d.get("url",""))
print("【正文】\n%s"%d.get("text",""))
PY
