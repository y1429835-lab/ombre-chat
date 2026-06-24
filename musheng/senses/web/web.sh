#!/usr/bin/env bash
# 暮声的 VPS 网页手 —— 直接从 VPS 读「不封 VPS IP」的站：维基 / 谷歌 / 论坛直链 / 英文博客。
# 小红书不走这（封 VPS、要登录），继续走 xhs.sh（你家 Mac 的住宅 IP）。
# 用法：
#   bash ~/web.sh search 关键词…      # 搜索（默认谷歌，给可点链接）
#   bash ~/web.sh go https://…        # 读某一页（自动抽正文、砍到上限）
set -uo pipefail
DIR="${WEB_DIR:-$HOME/vps-web}"
cmd="${1:-}"; shift || true
case "$cmd" in
  search)        exec node "$DIR/webread.mjs" search "$@" ;;
  go|open|read)  exec node "$DIR/webread.mjs" go "$@" ;;
  *) echo "用法: bash ~/web.sh search 关键词 | bash ~/web.sh go URL" >&2; exit 1 ;;
esac
