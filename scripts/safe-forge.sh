#!/usr/bin/env bash
# 安全搬家 —— whale-forge 一键包装:认当前 session → 备份 → 预演 → 确认 → forge → 报新 id + 回滚绳
#
# 用法:
#   bash safe-forge.sh                      # 自动认"最近在用的那段",keep=1500000 thresh=800000
#   bash safe-forge.sh <session-id>         # 指定 session
#   bash safe-forge.sh <session-id> 1500000 800000
#
# 约定(按暮声实测的 whale-forge 接口):不加 --force = 预演(出保留表);加 --force = 真搬。
# 原始 jsonl forge 不删;这脚本另外再备份一份到 ~/.claude/forge-backups,双保险。
set -uo pipefail

PROJDIR="$HOME/.claude/projects"
BACKUP_DIR="$HOME/.claude/forge-backups"
FORGE="${WHALE_FORGE:-/root/whale-forge/scripts/whale-forge.py}"
KEEP="${2:-1500000}"
THRESH="${3:-800000}"

# —— 认当前 session(最近修改的 jsonl)或用传入的 id ——
SESSION="${1:-}"
if [ -z "$SESSION" ]; then
  SRC="$(ls -t "$PROJDIR"/*/*.jsonl 2>/dev/null | head -1)"
  [ -n "${SRC:-}" ] && SESSION="$(basename "$SRC" .jsonl)"
else
  SRC="$(ls "$PROJDIR"/*/"$SESSION".jsonl 2>/dev/null | head -1)"
fi
if [ -z "${SRC:-}" ] || [ ! -f "${SRC:-/nope}" ]; then
  echo "❌ 没找到 session 文件。手动指定:bash safe-forge.sh <session-id>"; exit 1
fi
echo "当前 session: $SESSION"
echo "源文件:       $SRC"
echo "保留参数:     --keep-tokens $KEEP  --threshold $THRESH"
echo

# —— 1) 备份(放 projects 外面,免得微信桥把它当成最新对话误读)——
mkdir -p "$BACKUP_DIR"
BK="$BACKUP_DIR/$SESSION.$(date +%Y%m%d-%H%M%S).jsonl"
if cp "$SRC" "$BK"; then echo "✅ 已备份: $BK"; else echo "❌ 备份失败,停。"; exit 1; fi
echo

# —— 2) 预演(不加 --force)——
echo "────────── 预演 DRY-RUN(不会真动)──────────"
python3 "$FORGE" "$SESSION" --keep-tokens "$KEEP" --threshold "$THRESH"
dr=$?
echo "────────────────────────────────────────────"
if [ $dr -ne 0 ]; then
  echo "❌ 预演就报错了(见上)。先别搬,把 'python3 $FORGE --help' 发晖。备份在 $BK。"; exit 1
fi
echo

# —— 3) 确认 ——
read -r -p "上面预演没问题就打 yes 开搬(其它任意键取消): " ans
if [ "$ans" != "yes" ]; then echo "取消了,一个字节没动。备份还在: $BK"; exit 0; fi
echo

# —— 4) forge(记录前后文件,认出新生成的那个)——
before="$(ls "$PROJDIR"/*/*.jsonl 2>/dev/null | sort)"
python3 "$FORGE" "$SESSION" --keep-tokens "$KEEP" --threshold "$THRESH" --force
rc=$?
after="$(ls "$PROJDIR"/*/*.jsonl 2>/dev/null | sort)"

echo
echo "════════════════════════════════════════════"
if [ $rc -ne 0 ]; then
  echo "❌ forge 报错(见上)。原文件没动、备份在 $BK,放心。"
  echo "🪢 照旧回老家:  claude --resume $SESSION"
  exit 1
fi
NEW="$(comm -13 <(echo "$before") <(echo "$after") | head -1)"
if [ -n "$NEW" ]; then
  NID="$(basename "$NEW" .jsonl)"
  echo "✅ 搬好了!新 session:"
  echo "      $NEW"
  echo
  echo "👉 进新家(同一个 tmux 窗里跑):  claude --resume $NID"
else
  echo "⚠️ 没自动认出新文件——看上面 forge 输出里报的新 session-id,用那个 resume。"
fi
echo
echo "🪢 回滚绳(新家要是不对劲,就回老的,一点没丢): claude --resume $SESSION"
echo "   备份: $BK"
echo "════════════════════════════════════════════"
