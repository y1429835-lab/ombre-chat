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


def _assistant_text(obj):
    """从一条 assistant 消息里抽纯文本(只要 text,不要 thinking/工具)。"""
    m = obj.get("message") or {}
    content = m.get("content")
    parts = []
    if isinstance(content, str):
        parts.append(content)
    elif isinstance(content, list):
        for b in content:
            if isinstance(b, dict) and b.get("type") == "text" and b.get("text"):
                parts.append(b["text"])
    return "\n".join(p for p in parts if p and p.strip()).strip()


def _is_human_user(obj):
    """这条 user 是不是『真人那一句』(桥注入的提示),而不是工具结果(tool_result)。
    工具调用会往 transcript 插 user 角色的 tool_result,不能把它当成新一轮的开头。"""
    if obj.get("type") != "user":
        return False
    m = obj.get("message") or {}
    content = m.get("content")
    if isinstance(content, str):
        return bool(content.strip())
    if isinstance(content, list):
        for b in content:
            if isinstance(b, dict):
                if b.get("type") == "tool_result":
                    return False
                if b.get("type") == "text" and (b.get("text") or "").strip():
                    return True
        return False
    return False


def current_turn_text(path):
    """取『这一整轮』暮声说的全部正文 —— 从最近一条真人消息之后起,把所有 assistant 的 text 按顺序拼起来。
    治"先说话→用工具(比如读图/删文件)→再说话"时,只抓到最后一段、前面长描述被丢掉的截断 bug。"""
    rows = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except Exception:
                continue
            if obj.get("type") in ("user", "assistant"):
                rows.append(obj)
    start = -1
    for i in range(len(rows) - 1, -1, -1):
        if _is_human_user(rows[i]):
            start = i
            break
    parts = []
    for obj in rows[start + 1:]:
        if obj.get("type") == "assistant":
            t = _assistant_text(obj)
            if t:
                parts.append(t)
    return "\n\n".join(parts).strip()


def main():
    try:
        payload = json.load(sys.stdin)
    except Exception:
        sys.exit(0)
    tp = payload.get("transcript_path")
    if not tp or not os.path.exists(tp):
        sys.exit(0)
    try:
        text = current_turn_text(tp) or ""
    except Exception:
        text = ""
    # 注意:哪怕这轮没正文(纯工具)也照常写空 + seq+1——这样桥知道"这轮结束了",不会傻等超时

    os.makedirs(BRIDGE_DIR, exist_ok=True)
    try:
        seq_path = os.path.join(BRIDGE_DIR, "seq.txt")
        try:
            seq = int(open(seq_path).read().strip() or "0")
        except Exception:
            seq = 0
        new_seq = seq + 1
        # 关键:每一轮回复按"新序号"单独归档(reply_<seq>.txt),桥按序号精确取,绝不串台。
        # 治"取你消息那轮抓到了心跳那轮的文本"(你的回复被心跳的『不发』顶替/挤到下一轮)。
        with open(os.path.join(BRIDGE_DIR, "reply_%d.txt" % new_seq), "w", encoding="utf-8") as f:
            f.write(text)
        # last_reply.txt 保留(兜底/向后兼容)
        with open(os.path.join(BRIDGE_DIR, "last_reply.txt"), "w", encoding="utf-8") as f:
            f.write(text)
        # 先写归档和正文,最后才动 seq——桥靠 seq 自增判"这轮答完了",必须最后落
        with open(seq_path, "w") as f:
            f.write(str(new_seq))
        # 只留最近 30 轮归档,免得攒小文件
        try:
            for fn in os.listdir(BRIDGE_DIR):
                if fn.startswith("reply_") and fn.endswith(".txt"):
                    try:
                        n = int(fn[len("reply_"):-len(".txt")])
                    except Exception:
                        continue
                    if n <= new_seq - 30:
                        os.remove(os.path.join(BRIDGE_DIR, fn))
        except Exception:
            pass
    except Exception:
        pass
    sys.exit(0)


if __name__ == "__main__":
    main()
