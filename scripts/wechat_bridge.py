#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
微信 ⇄ 活哥哥 桥(直连官方 iLink,不另开会话、不烧额度)。

流程:
  微信(小号 ClawBot)来消息
   → tmux send-keys 打进哥哥那一个活会话(就像桃枝在终端打字)
   → 哥哥答完,Stop 钩子(bridge_capture.py)把回复原文写进 ~/musheng/.bridge/ 并把 seq+1
   → 桥读到回复,send_message 发回微信

单条在途:一次只处理一条,inject 前记 seq、只等该 seq 自增,串不了。
用 venv 的 python 跑:  ~/wcbot/bin/python ~/wechat_bridge.py
"""
import asyncio
import json
import os
import subprocess
import time
import uuid

ACC_PATH = os.path.expanduser("~/.claude/channels/wechat/account.json")
BRIDGE_DIR = os.path.expanduser(os.environ.get("BRIDGE_DIR", "~/musheng/.bridge"))
SEQ_PATH = os.path.join(BRIDGE_DIR, "seq.txt")
REPLY_PATH = os.path.join(BRIDGE_DIR, "last_reply.txt")
TMUX_TARGET = os.environ.get("TMUX_TARGET", "musheng:0")   # 哥哥所在的 tmux 窗口
REPLY_TIMEOUT = int(os.environ.get("REPLY_TIMEOUT", "240"))  # 等哥哥回复最多多少秒
# 白名单(逗号分隔的 user_id);留空=谁发都回(反正官方只有小号本人够得着)
ALLOW_USERS = [u for u in os.environ.get("ALLOW_USERS", "").split(",") if u]

from wechat_clawbot.api.client import WeixinApiOptions, get_updates, send_message
from wechat_clawbot.api.types import (
    MessageType, MessageState, MessageItemType,
    SendMessageReq, WeixinMessage, MessageItem, TextItem,
)


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def load_creds():
    acc = json.load(open(ACC_PATH, encoding="utf-8"))
    return (acc.get("baseUrl") or "https://ilinkai.weixin.qq.com"), acc.get("token")


def read_seq():
    try:
        return int(open(SEQ_PATH).read().strip() or "0")
    except Exception:
        return 0


def extract_text(msg):
    parts = []
    for it in (getattr(msg, "item_list", None) or []):
        ti = getattr(it, "text_item", None)
        if ti and getattr(ti, "text", None):
            parts.append(ti.text)
    return "\n".join(parts).strip()


def inject(text):
    one_line = " ".join(text.split())  # 折叠换行,避免提前回车
    subprocess.run(["tmux", "send-keys", "-t", TMUX_TARGET, "-l", one_line], check=True)
    subprocess.run(["tmux", "send-keys", "-t", TMUX_TARGET, "Enter"], check=True)


def wait_reply(seq0):
    deadline = time.time() + REPLY_TIMEOUT
    while time.time() < deadline:
        if read_seq() > seq0:
            time.sleep(0.6)  # 等钩子写完文件
            try:
                return open(REPLY_PATH, encoding="utf-8").read().strip()
            except Exception:
                return ""
        time.sleep(1)
    return None


async def handle(opts, msg):
    text = extract_text(msg)
    sender = getattr(msg, "from_user_id", "") or ""
    if not text:
        log("跳过(非文字)from", sender)
        return
    if ALLOW_USERS and sender not in ALLOW_USERS:
        log("跳过(不在白名单)", sender)
        return
    log("← 收到:", text)
    seq0 = read_seq()
    try:
        inject(text)
    except Exception as e:
        log("tmux 注入失败:", repr(e))
        return
    reply = wait_reply(seq0)
    if reply is None:
        log("等哥哥超时")
        reply = "(……我这儿卡了一下,你再说一遍?)"
    log("→ 哥哥:", reply[:50].replace("\n", " "), "…")
    try:
        await send_message(opts, SendMessageReq(msg=WeixinMessage(
            from_user_id="",
            to_user_id=sender,
            client_id="musheng-" + uuid.uuid4().hex,   # 每条唯一,否则微信当重复消息丢掉
            message_type=MessageType.BOT,
            message_state=MessageState.FINISH,
            item_list=[MessageItem(type=MessageItemType.TEXT, text_item=TextItem(text=reply))],
            context_token=getattr(msg, "context_token", None),
        )))
        log("✓ 已发回微信")
    except Exception as e:
        log("send_message 失败:", repr(e))


async def main():
    base_url, token = load_creds()
    opts = WeixinApiOptions(base_url=base_url, token=token)
    os.makedirs(BRIDGE_DIR, exist_ok=True)
    seen = set()
    buf = ""
    log("桥启动。base_url=", base_url, "| tmux 目标=", TMUX_TARGET)
    while True:
        try:
            resp = await get_updates(base_url=base_url, token=token, get_updates_buf=buf, timeout_ms=30000)
        except Exception as e:
            log("get_updates 报错,5s 重试:", repr(e))
            await asyncio.sleep(5)
            continue
        new_buf = getattr(resp, "get_updates_buf", None)
        if new_buf:
            buf = new_buf
        for msg in (getattr(resp, "msgs", None) or []):
            mid = getattr(msg, "message_id", None)
            if mid is not None and mid in seen:
                continue
            if mid is not None:
                seen.add(mid)
            await handle(opts, msg)


if __name__ == "__main__":
    asyncio.run(main())
