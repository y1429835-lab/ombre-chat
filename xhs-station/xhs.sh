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
# 把结构化结果排版给暮声读;顺带提示要不要登录
python3 - "$resp" <<'PY'
import json,sys
try:
    d=json.loads(sys.argv[1])
except Exception:
    print(sys.argv[1]); sys.exit(0)
if not d.get("ok"):
    print("（工位报错：%s）"%d.get("error")); sys.exit(0)
if d.get("need_login"):
    print("（看着没登录/被登录墙挡了——让桃枝在 Mac 浏览器里用小号登一下。）\n")

og, desc = d.get("ogTitle","").strip(), d.get("desc","").strip()
if og or desc:
    print("【这条笔记】" + og)
    if desc: print(desc)
    print()

notes = d.get("notes") or []
if notes:
    print("【可点开的笔记】(想看哪条,就 xhs go <它的链接>)")
    for n in notes[:15]:
        bits = [b for b in [n.get("author","").strip(), (n.get("likes","").strip()+"赞" if n.get("likes","").strip() else ""), (n.get("comments","").strip()+"评" if n.get("comments","").strip() else "")] if b]
        meta = ("  (" + " · ".join(bits) + ")") if bits else ""
        print("• %s%s\n    %s" % (n.get("title","(无题)"), meta, n.get("url","")))
    print()

txt = (d.get("text") or "").strip()
if txt:
    print("【页面文字·节选】(含评论等,夹杂界面词,挑有用的看)")
    print(txt[:1800])
PY
