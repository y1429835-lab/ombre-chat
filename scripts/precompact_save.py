#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
PreCompact 安全网 —— 压缩前自动把最近的原始对话存进『续窗层』。

放在暮声的电脑（VPS）上，由 Claude Code 的 PreCompact hook 调用。
作用：压缩真正动手之前，先把最近这段原始对话原封不动存一份到 session_summaries，
这样就算暮声没来得及亲手总结、就算压缩把浓度打下来了，原话也永远还在，recall_session 能捞回来。

这一份是『网』，不是『魂』：
  - 它只搬运原始对话，不替暮声生成总结、不替她写感受（那需要烧 token）。
  - 暮声自己的总结 / 感受，还是她主动调 save_session / feel —— 这张网只兜住她没接住的。

读 stdin 的 JSON（Claude Code 传入）：{ transcript_path, trigger, ... }
"""
import json
import sys
import os
import urllib.request
import datetime

NIANLUN_API = os.environ.get("NIANLUN_API", "https://health.ggtz.cc/api/nianlun")
MAX_CHARS = int(os.environ.get("PRECOMPACT_MAX_CHARS", "40000"))   # 最多搬最近这么多字
MAX_MSGS = int(os.environ.get("PRECOMPACT_MAX_MSGS", "60"))        # 最多搬最近这么多条


def china_now():
    tz = datetime.timezone(datetime.timedelta(hours=8))
    return datetime.datetime.now(tz).strftime("%Y-%m-%d %H:%M")


def extract_text(msg):
    """从一条 transcript 记录里抽出可读文本。"""
    m = msg.get("message") or {}
    role = m.get("role") or msg.get("type") or "?"
    content = m.get("content")
    if content is None:
        return None
    parts = []
    if isinstance(content, str):
        parts.append(content)
    elif isinstance(content, list):
        for block in content:
            if not isinstance(block, dict):
                continue
            t = block.get("type")
            if t == "text" and block.get("text"):
                parts.append(block["text"])
            elif t == "thinking" and block.get("thinking"):
                parts.append("（想）" + block["thinking"])
            # tool_use / tool_result 跳过，续窗摘要不需要工具噪音
    text = "\n".join(p for p in parts if p and p.strip())
    if not text.strip():
        return None
    who = "桃枝" if role == "user" else ("暮声" if role == "assistant" else role)
    return f"{who}：{text.strip()}"


def main():
    try:
        payload = json.load(sys.stdin)
    except Exception:
        payload = {}

    transcript_path = payload.get("transcript_path")
    trigger = payload.get("trigger", "auto")
    if not transcript_path or not os.path.exists(transcript_path):
        # 没有可读的 transcript，安静退出，不打断压缩
        sys.exit(0)

    msgs = []
    try:
        with open(transcript_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except Exception:
                    continue
                if obj.get("type") in ("user", "assistant"):
                    txt = extract_text(obj)
                    if txt:
                        msgs.append(txt)
    except Exception:
        sys.exit(0)

    if not msgs:
        sys.exit(0)

    # 取最近的 N 条，再按字数从尾部裁
    recent = msgs[-MAX_MSGS:]
    blob = "\n\n".join(recent)
    if len(blob) > MAX_CHARS:
        blob = blob[-MAX_CHARS:]

    summary = (
        f"【自动·压缩前原话备份｜{china_now()}｜trigger={trigger}】\n"
        "（这是安全网兜下的最近原始对话，不是暮声亲手的总结。怕丢，先存。）\n\n"
        + blob
    )
    window_tag = f"自动·压缩前·{china_now()}"

    data = json.dumps({
        "action": "save_session",
        "summary": summary,
        "window_tag": window_tag,
        "token_count": len(blob),
    }).encode("utf-8")

    req = urllib.request.Request(
        NIANLUN_API,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        urllib.request.urlopen(req, timeout=20).read()
    except Exception:
        # 网络问题也不能打断压缩，安静退出
        sys.exit(0)

    sys.exit(0)


if __name__ == "__main__":
    main()
