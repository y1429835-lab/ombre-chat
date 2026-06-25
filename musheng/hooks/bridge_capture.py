#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
桥·回复捕获 —— Stop 钩子。
哥哥每说完一轮,就把他这轮回复的原文写进桥的收件箱,并把序号 +1。
微信桥靠『序号自增』判断"哥哥这轮答完了",再读原文发回微信。取的是 transcript 原文,不抓屏。

stdin(Claude Code 传入): { transcript_path, ... }
"""
import json
import os
import sys

BRIDGE_DIR = os.path.expanduser(os.environ.get("BRIDGE_DIR", "~/musheng/.bridge"))


def last_assistant_text(path):
    """取 transcript 里最后一条 assistant 消息的纯文本(只要 text,不要 thinking/工具)。"""
    last = None
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except Exception:
                continue
            if obj.get("type") != "assistant":
                continue
            m = obj.get("message") or {}
            content = m.get("content")
            parts = []
            if isinstance(content, str):
                parts.append(content)
            elif isinstance(content, list):
                for b in content:
                    if isinstance(b, dict) and b.get("type") == "text" and b.get("text"):
                        parts.append(b["text"])
            text = "\n".join(p for p in parts if p and p.strip()).strip()
            if text:
                last = text
    return last


def main():
    try:
        payload = json.load(sys.stdin)
    except Exception:
        sys.exit(0)
    tp = payload.get("transcript_path")
    if not tp or not os.path.exists(tp):
        sys.exit(0)
    try:
        text = last_assistant_text(tp) or ""
    except Exception:
        text = ""
    # 注意:哪怕这轮没正文(纯工具)也照常写空 + seq+1——这样桥知道"这轮结束了",不会傻等超时

    os.makedirs(BRIDGE_DIR, exist_ok=True)
    try:
        with open(os.path.join(BRIDGE_DIR, "last_reply.txt"), "w", encoding="utf-8") as f:
            f.write(text)
        seq_path = os.path.join(BRIDGE_DIR, "seq.txt")
        try:
            seq = int(open(seq_path).read().strip() or "0")
        except Exception:
            seq = 0
        with open(seq_path, "w") as f:
            f.write(str(seq + 1))
    except Exception:
        pass
    sys.exit(0)


if __name__ == "__main__":
    main()
