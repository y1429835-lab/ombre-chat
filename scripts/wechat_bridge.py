#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
微信 ⇄ 活暮声 桥(直连官方 iLink,不另开会话、不烧额度)。

收:微信消息 → tmux 打进暮声那一个活会话 → 读对话记录精确抓他这句的回复 → 发回微信。
发:主动触发(很久没联系→"我在";以后接健康数据加早安/睡眠)→ 让暮声写 → 发给桃枝。

一把锁 LOCK 保证"收"和"主动发"不会同时往暮声那插话。
用 venv 的 python 跑:  ~/wcbot/bin/python ~/wechat_bridge.py
"""
import asyncio
import json
import os
import subprocess
import time
import uuid
import datetime
import base64
import math

ACC_PATH = os.path.expanduser("~/.claude/channels/wechat/account.json")
BRIDGE_DIR = os.path.expanduser(os.environ.get("BRIDGE_DIR", "~/musheng/.bridge"))
SEQ_PATH = os.path.join(BRIDGE_DIR, "seq.txt")
REPLY_PATH = os.path.join(BRIDGE_DIR, "last_reply.txt")
STATE_FILE = os.path.join(BRIDGE_DIR, "state.json")
TMUX_TARGET = os.environ.get("TMUX_TARGET", "musheng:0")     # 暮声所在的 tmux 窗口
REPLY_TIMEOUT = int(os.environ.get("REPLY_TIMEOUT", "240"))   # 等暮声回复最多多少秒
NOCONTACT_SECS = int(os.environ.get("NOCONTACT_SECS", "86400"))  # 多久没找他→他发"我在"(默认24h)
QUIET_START = int(os.environ.get("QUIET_START_HOUR", "0"))    # 北京时间静音时段开始(深夜保险)
QUIET_END = int(os.environ.get("QUIET_END_HOUR", "8"))       # 静音时段结束
PRO_DAILY_CAP = int(os.environ.get("PRO_DAILY_CAP", "3"))     # 主动消息一天最多几条
SLEEP_WORDS = ("睡了", "晚安", "睡觉", "困了", "我睡", "去睡", "睡啦", "睡个好觉", "晚安啦")
# 白名单(逗号分隔的 user_id);留空=谁发都回(反正官方只有账号本人够得着)
ALLOW_USERS = [u for u in os.environ.get("ALLOW_USERS", "").split(",") if u]

from wechat_clawbot.api.client import WeixinApiOptions, get_updates, send_message
from wechat_clawbot.api.types import (
    MessageType, MessageState, MessageItemType,
    SendMessageReq, WeixinMessage, MessageItem, TextItem,
)
from wechat_clawbot.cdn.download import download_and_decrypt_buffer
from wechat_clawbot.auth.accounts import CDN_BASE_URL

LOCK = None  # asyncio.Lock,main 里建
# 会话状态(给主动发送用):最近是谁、凭证、最近联系时间、上次主动时间
STATE = {"last_sender": "", "last_ctx": "", "last_msg_ts": 0.0, "last_proactive_ts": 0.0,
         "sleeping": False, "pro_date": "", "pro_count": 0}


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def load_creds():
    acc = json.load(open(ACC_PATH, encoding="utf-8"))
    return (acc.get("baseUrl") or "https://ilinkai.weixin.qq.com"), acc.get("token")


def load_state():
    try:
        STATE.update(json.load(open(STATE_FILE, encoding="utf-8")))
    except Exception:
        pass


def save_state():
    try:
        json.dump(STATE, open(STATE_FILE, "w", encoding="utf-8"))
    except Exception:
        pass


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


def has_image(msg):
    for it in (getattr(msg, "item_list", None) or []):
        if getattr(it, "image_item", None):
            return True
    return False


async def download_image(msg):
    """下载并解密微信图片(存在 CDN、AES 加密),存成文件,返回路径;失败返回 None。"""
    for it in (getattr(msg, "item_list", None) or []):
        img = getattr(it, "image_item", None)
        media = getattr(img, "media", None) if img else None
        if not media:
            continue
        try:
            aeskey_hex = getattr(img, "aeskey", None)
            if aeskey_hex:
                aes_b64 = base64.b64encode(bytes.fromhex(aeskey_hex)).decode()
            else:
                aes_b64 = getattr(media, "aes_key", None)
            buf = await download_and_decrypt_buffer(
                getattr(media, "encrypt_query_param", "") or "",
                aes_b64 or "",
                CDN_BASE_URL,
                "inbound image",
                full_url=getattr(media, "full_url", None),
            )
            path = os.path.join(BRIDGE_DIR, f"img_{uuid.uuid4().hex}.jpg")
            with open(path, "wb") as f:
                f.write(buf)
            return path
        except Exception as e:
            log("图片下载/解密失败:", repr(e))
            return None
    return None


_WEEK = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]


def china_now():
    """北京时间,给暮声时间感(只注入给他,微信对话里不显示)。"""
    tz = datetime.timezone(datetime.timedelta(hours=8))
    now = datetime.datetime.now(tz)
    return now.strftime("%Y-%m-%d ") + _WEEK[now.weekday()] + now.strftime(" %H:%M")


def in_quiet_hours():
    tz = datetime.timezone(datetime.timedelta(hours=8))
    h = datetime.datetime.now(tz).hour
    if QUIET_START == QUIET_END:
        return False
    if QUIET_START < QUIET_END:
        return QUIET_START <= h < QUIET_END
    return h >= QUIET_START or h < QUIET_END   # 跨午夜


def inject(text):
    one_line = " ".join(text.split())  # 折叠换行,避免提前回车
    subprocess.run(["tmux", "send-keys", "-t", TMUX_TARGET, "-l", one_line], check=True)
    subprocess.run(["tmux", "send-keys", "-t", TMUX_TARGET, "Enter"], check=True)


def wait_idle(timeout=60, stable=2.0):
    """注入前等暮声闲下来(seq 连续 stable 秒不变),别在他忙时插话被吞。"""
    last = read_seq()
    stable_since = time.time()
    deadline = time.time() + timeout
    while time.time() < deadline:
        cur = read_seq()
        if cur != last:
            last = cur
            stable_since = time.time()
        elif time.time() - stable_since >= stable:
            return
        time.sleep(0.4)


def find_transcript():
    """取最近修改的 .jsonl = 暮声正在用的那段对话。"""
    base = os.path.expanduser("~/.claude/projects")
    newest, newest_m = None, -1.0
    for root, _dirs, files in os.walk(base):
        for fn in files:
            if fn.endswith(".jsonl"):
                p = os.path.join(root, fn)
                try:
                    m = os.path.getmtime(p)
                except Exception:
                    continue
                if m > newest_m:
                    newest, newest_m = p, m
    return newest


def _msg_text(obj):
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


def reply_after(path, needle):
    """对话记录里:找含 needle 的最后一条 user,返回其后第一条有文字的 assistant 回复。"""
    if not path:
        return None
    rows = []
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except Exception:
                    continue
                t = obj.get("type")
                if t in ("user", "assistant"):
                    rows.append((t, _msg_text(obj)))
    except Exception:
        return None
    idx = None
    for i in range(len(rows) - 1, -1, -1):
        if rows[i][0] == "user" and needle and needle in (rows[i][1] or ""):
            idx = i
            break
    if idx is None:
        return None
    for j in range(idx + 1, len(rows)):
        if rows[j][0] == "assistant" and rows[j][1]:
            return rows[j][1]
    return None


def capture_reply(stamped):
    """注入后直接读对话记录,精确抓"这句"的回复,并等它写稳(防抓到半截)。"""
    path = find_transcript()
    needle = stamped[:40]
    deadline = time.time() + REPLY_TIMEOUT
    stable_txt, stable_since = None, 0.0
    while time.time() < deadline:
        r = reply_after(path, needle)
        if r:
            if r == stable_txt:
                if time.time() - stable_since >= 2.0:   # 稳定2秒=答完
                    return r
            else:
                stable_txt, stable_since = r, time.time()
        time.sleep(1.2)
    return None


MAX_CHUNKS = int(os.environ.get("MAX_CHUNKS", "8"))     # 一次回复最多发几条(微信对条数有限制)
MAX_LEN = int(os.environ.get("MAX_MSG_LEN", "900"))     # 单条最多多少字(太长微信发不全)


def chunk_reply(reply):
    """智能分条:太长的切短、太多的均匀合并,封顶在安全条数内,既保留气泡感又不超限。"""
    pieces = []
    for ln in (reply or "").split("\n"):
        ln = ln.strip()
        if not ln:
            continue
        while len(ln) > MAX_LEN:
            pieces.append(ln[:MAX_LEN])
            ln = ln[MAX_LEN:]
        pieces.append(ln)
    if not pieces:
        return [(reply or "…").strip()[:MAX_LEN] or "…"]
    if len(pieces) <= MAX_CHUNKS:
        return pieces
    per = math.ceil(len(pieces) / MAX_CHUNKS)   # 太多 → 均匀合并成 MAX_CHUNKS 组
    return ["\n".join(pieces[i:i + per]) for i in range(0, len(pieces), per)]


async def send_chunks(opts, to, ctx, reply):
    """把回复智能分条,一条条发给微信(像真人,且不超微信的长度/条数限制)。"""
    chunks = chunk_reply(reply)
    for i, chunk in enumerate(chunks):
        try:
            await send_message(opts, SendMessageReq(msg=WeixinMessage(
                from_user_id="",
                to_user_id=to,
                client_id="musheng-" + uuid.uuid4().hex,   # 每条唯一,否则微信当重复丢掉
                message_type=MessageType.BOT,
                message_state=MessageState.FINISH,
                item_list=[MessageItem(type=MessageItemType.TEXT, text_item=TextItem(text=chunk))],
                context_token=ctx,
            )))
            log(f"✓ 已发 {i + 1}/{len(chunks)}")
        except Exception as e:
            log("send_message 失败:", repr(e))
        if i < len(chunks) - 1:
            await asyncio.sleep(0.8)


async def run_turn(opts, to, ctx, prompt_text):
    """通用:注入一句给暮声 → 抓他的回复 → 发给 to。占锁,保证不和别的插话撞。"""
    async with LOCK:
        wait_idle()
        stamped = f"[{china_now()}] {prompt_text}"
        try:
            inject(stamped)
        except Exception as e:
            log("注入失败:", repr(e))
            return None
        reply = capture_reply(stamped)
        if reply is None:
            log("等暮声超时")
            return None
        log("→ 暮声:", reply[:50].replace("\n", " "), "…")
        await send_chunks(opts, to, ctx, reply)
        return reply


async def handle(opts, msg):
    sender = getattr(msg, "from_user_id", "") or ""
    if ALLOW_USERS and sender not in ALLOW_USERS:
        log("跳过(不在白名单)", sender)
        return
    ctx = getattr(msg, "context_token", None)
    now = time.time()
    gap = now - (STATE.get("last_msg_ts") or now)
    raw = extract_text(msg)
    # 睡眠模式:说"睡了/晚安"→静音;隔超过2小时又来消息=醒了,恢复
    if raw and any(w in raw for w in SLEEP_WORDS):
        STATE["sleeping"] = True
        log("睡眠模式:开(她说要睡了)")
    elif gap > 7200:
        STATE["sleeping"] = False
    # 记住会话凭证 + 最近联系时间(给主动发送用)
    STATE["last_sender"] = sender
    if ctx:
        STATE["last_ctx"] = ctx
    STATE["last_msg_ts"] = now
    save_state()

    text = raw
    if not text:
        if has_image(msg):
            path = await download_image(msg)
            if path:
                text = f"桃枝发来一张图片。你用 Read 工具看一下这个文件,看完用你的话回应她(就当她当面给你看照片):{path}"
                log("← 收到图片,已下载解密:", path)
            else:
                text = "（桃枝发来一张图片,但这次没接进来——回应一下,让她说说图里是什么。）"
                log("← 收到图片但下载失败")
        else:
            log("跳过(非文字非图)from", sender)
            return
    else:
        log("← 收到:", text)
    await run_turn(opts, sender, ctx, text)


async def proactive_loop(opts):
    """主动触发引擎。现只做:很久没联系 → 让暮声发'我在'。以后接健康数据加早安/睡眠。"""
    await asyncio.sleep(20)
    while True:
        try:
            now = time.time()
            last_msg = STATE.get("last_msg_ts", 0) or 0
            last_pro = STATE.get("last_proactive_ts", 0) or 0
            to = STATE.get("last_sender")
            ctx = STATE.get("last_ctx")
            # 触发:有过联系 + 超过设定时长没找他 + 自她上次发消息后还没主动过 + 不在静音时段
            # 距"她发消息 或 他上次主动"超过 NOCONTACT,且没在睡、不在深夜静音段 → 他来找她
            if (to and ctx and last_msg
                    and now - max(last_msg, last_pro) >= NOCONTACT_SECS
                    and not STATE.get("sleeping")
                    and not in_quiet_hours()):
                log("主动触发:有阵子没动静,让暮声来找她")
                r = await run_turn(
                    opts, to, ctx,
                    "（系统·主动触发,不是桃枝发的）有一阵没和桃枝说话了。"
                    "给她发条消息——用你自己的方式:想她、逗她、问她在干嘛、念叨一句都行,"
                    "别端着、别装客气、别说教,就做你自己,简短。只写这句要发的话本身。")
                if r:
                    STATE["last_proactive_ts"] = time.time()
                    save_state()
        except Exception as e:
            log("主动循环报错:", repr(e))
        await asyncio.sleep(60)


async def main():
    global LOCK
    LOCK = asyncio.Lock()
    base_url, token = load_creds()
    opts = WeixinApiOptions(base_url=base_url, token=token)
    os.makedirs(BRIDGE_DIR, exist_ok=True)
    load_state()
    asyncio.create_task(proactive_loop(opts))
    seen = set()
    buf = ""
    log("桥启动。base_url=", base_url, "| 目标=", TMUX_TARGET, "| 无联系", NOCONTACT_SECS, "秒后主动")
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
