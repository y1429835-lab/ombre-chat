#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
搬家预警 —— UserPromptSubmit 钩子。让暮声自己盯上下文,到点主动喊桃枝,省得她总看百分比。

读 transcript 里『最近一次 API usage』算当前上下文占了多少(input + 两种 cache 全算上,
≈喂进模型的总 token,就是真实占用)。过 90% 就注入一句提醒,让暮声:① 先 save_session,
② 主动在微信告诉桃枝『该搬家了』。分档 90/93/95/97 各报一次,越后越急,不刷屏。

读 stdin: { transcript_path, session_id, ... }。命令型钩子,免费,不烧额度。
"""
import json
import os
import sys

WINDOW = int(os.environ.get("FORGE_WINDOW_TOKENS", "1000000"))   # 上下文窗口(1M 模型)
WARN_AT = float(os.environ.get("FORGE_WARN_AT", "0.90"))         # 从 90% 起报
STATE_DIR = os.path.expanduser(os.environ.get("FORGE_STATE_DIR", "~/.claude/.forge_state"))


def last_usage_tokens(path):
    """最后一条带 usage 的 assistant 消息 → 喂进模型的总 token(≈当前上下文占用)。"""
    total = None
    try:
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    o = json.loads(line)
                except Exception:
                    continue
                if o.get("type") != "assistant":
                    continue
                u = ((o.get("message") or {}).get("usage")) or {}
                if u.get("input_tokens") is None:
                    continue
                tot = (u.get("input_tokens", 0)
                       + u.get("cache_read_input_tokens", 0)
                       + u.get("cache_creation_input_tokens", 0))
                if tot:
                    total = tot
    except Exception:
        return None
    return total


def main():
    try:
        payload = json.load(sys.stdin)
    except Exception:
        sys.exit(0)
    tp = payload.get("transcript_path")
    sid = payload.get("session_id") or "default"
    if not tp or not os.path.exists(tp):
        sys.exit(0)

    tok = last_usage_tokens(tp)
    if not tok:
        sys.exit(0)
    pct = tok / float(WINDOW)
    if pct < WARN_AT:
        sys.exit(0)

    bucket = 97 if pct >= 0.97 else 95 if pct >= 0.95 else 93 if pct >= 0.93 else 90
    os.makedirs(STATE_DIR, exist_ok=True)
    sf = os.path.join(STATE_DIR, f"{sid}.txt")
    try:
        last = int(open(sf).read().strip() or "0")
    except Exception:
        last = 0
    if bucket <= last:
        sys.exit(0)   # 这档已经报过,不重复
    try:
        open(sf, "w").write(str(bucket))
    except Exception:
        pass

    urgent = "！！别再拖了" if bucket >= 95 else ""
    text = (
        f"（系统·搬家预警{urgent}）上下文已到约 {pct:.0%}（{tok // 1000}k / {WINDOW // 1000}k）。该准备 forge 搬家了:\n"
        f"1) 你现在先 save_session（刷新近况）+ 这程有动情的 feel 进年轮;\n"
        f"2) 然后**主动在微信告诉桃枝**:『该给我搬家了』，让她在 VPS 跑 `bash ~/safe-forge.sh`;\n"
        f"3) 等她在场再搬，别自己闷头弄。到 95%+ 就别拖。\n"
        f"（这是给你和桃枝的提醒，不用解释机制，自然跟她说一声就行。）"
    )
    print(json.dumps({
        "hookSpecificOutput": {"hookEventName": "UserPromptSubmit", "additionalContext": text}
    }, ensure_ascii=False))
    sys.exit(0)


if __name__ == "__main__":
    main()
