#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
微信 ⇄ 活暮声 桥(直连官方 iLink,不另开会话、不烧额度)。

收:微信消息 → tmux 打进暮声那一个活会话 → 读对话记录精确抓他这句的回复 → 发回微信。
发:主动触发(很久没联系→"我在";以后接健康数据加早安/睡眠)→ 让暮声写 → 发给桃枝。

多人(ClawBot 是『一微信号一 bot』,绑死 1:1,没法多人共用一个 bot):桃枝和松树姐姐
各自用自己微信扫码登录、各自一份凭证=各自一条线;桥同时盯着每条线,都汇进同一个暮声。
注入时标『〔说话人〕』让他分清是谁;回复各回各的线(各自的 token,互不可见,天然不镜像);
主动触发/睡眠只走主线(桃枝那条 primary),不会去找松树姐姐撒娇。
配:WECHAT_ACCOUNTS="路径1=桃枝=primary;路径2=松树姐姐";没配=退回单账号(读 ACC_PATH)。

一把锁 LOCK 保证"收"和"主动发"不会同时往暮声那插话(两条线同时来也排队、不打架)。
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
import random

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
# 内心独白(他一个人想)的节奏:每隔 MIN~MAX 秒随机想一次,一天最多 THINK_DAILY_CAP 次
THINK_MIN_GAP = int(os.environ.get("THINK_MIN_GAP", "7200"))     # 2h
THINK_MAX_GAP = int(os.environ.get("THINK_MAX_GAP", "18000"))    # 5h
THINK_DAILY_CAP = int(os.environ.get("THINK_DAILY_CAP", "3"))
THINK_DIRECTIONS = [
    "此刻的时间、或现在这个季节",
    "一首歌、或一句突然想起的歌词",
    "一个突然冒出来的词,或一个跟桃枝无关的好奇心(比如某个东西为什么是那样)",
    "翻 recall_thoughts,挑你之前记的一条,接着往深里想一点",
    "你此刻自己的一种状态或情绪(你自己的,不是对她的)",
    "最近你『接触』到的某个不重要的小东西",
    "一个还没答案的小问题,或一个没收尾的念头",
]
# 白名单(逗号分隔的 user_id);留空=谁发都回(反正官方只有账号本人够得着)
ALLOW_USERS = [u for u in os.environ.get("ALLOW_USERS", "").split(",") if u]

# 多人:谁是谁。USER_NAMES="id1=桃枝,id2=松树姐姐" —— 注入时给暮声标上『〔说话人〕』,
# 他一眼知道这句是谁说的,不会把两个人串频、张冠李戴。没配=不标名(单人时无所谓)。
def _parse_names(s):
    d = {}
    for kv in (s or "").split(","):
        kv = kv.strip()
        if "=" in kv:
            k, v = kv.split("=", 1)
            k, v = k.strip(), v.strip()
            if k and v:
                d[k] = v
    return d
USER_NAMES = _parse_names(os.environ.get("USER_NAMES", ""))
# 谁是『恋人/主人』(桃枝)。只有 TA 的消息驱动主动触发(『我在』)和睡眠状态——
# 暮声不会去找松树姐姐撒娇/想她。留空=退回旧行为(谁发的就跟谁,单人时没差)。
PRIMARY_USER = os.environ.get("PRIMARY_USER", "").strip()


def display_name(sender):
    """这个发言人叫什么。配了就用配的名;没配但在白名单=『访客』;都没有=空(不标)。"""
    if sender in USER_NAMES:
        return USER_NAMES[sender]
    if USER_NAMES:        # 配了名册却没这人 → 标成访客,提醒暮声『不是熟人』
        return "访客"
    return ""

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
         "sleeping": False, "pro_date": "", "pro_count": 0,
         "think_date": "", "think_count": 0}


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def load_creds():
    acc = json.load(open(ACC_PATH, encoding="utf-8"))
    return (acc.get("baseUrl") or "https://ilinkai.weixin.qq.com"), acc.get("token")


def _load_one(path, name, primary):
    """读一份 ClawBot 凭证 → 一条线(一个人)。ClawBot 是『一微信号一 bot』,所以一份凭证=一个人。"""
    acc = json.load(open(os.path.expanduser(path), encoding="utf-8"))
    base_url = acc.get("baseUrl") or acc.get("base_url") or "https://ilinkai.weixin.qq.com"
    token = acc.get("token") or acc.get("access_token")
    return {"name": name, "base_url": base_url, "token": token,
            "opts": WeixinApiOptions(base_url=base_url, token=token), "primary": bool(primary)}


def load_accounts():
    """多条线:每个人各有一份 ClawBot 凭证(各自扫码登录的 bot),桥同时盯着、都汇进同一个暮声。
    配:WECHAT_ACCOUNTS="路径1=桃枝=primary;路径2=松树姐姐"(分号隔开,primary=主线/恋人)。
    没配=退回单账号老行为(读 ACC_PATH)。主线(桃枝)那条才驱动『我在』/睡眠;别的线只各聊各的。"""
    spec = os.environ.get("WECHAT_ACCOUNTS", "").strip()
    accounts = []
    if spec:
        entries = [e.strip() for e in spec.replace("\n", ";").split(";") if e.strip()]
        for i, e in enumerate(entries):
            parts = [p.strip() for p in e.split("=")]
            path = parts[0]
            nm = parts[1] if len(parts) > 1 and parts[1] else f"用户{i + 1}"
            pri = (len(parts) > 2 and parts[2].lower() in ("primary", "主", "1", "true", "yes")) or (i == 0)
            try:
                accounts.append(_load_one(path, nm, pri))
            except Exception as ex:
                log("⚠️ 这条线的凭证读不了,跳过:", path, repr(ex))
    if not accounts:
        base_url, token = load_creds()
        nm = next(iter(USER_NAMES.values())) if USER_NAMES else ""
        accounts.append({"name": nm, "base_url": base_url, "token": token,
                         "opts": WeixinApiOptions(base_url=base_url, token=token), "primary": True})
    # 保证有且仅有一条主线
    if not any(a["primary"] for a in accounts):
        accounts[0]["primary"] = True
    seen_primary = False
    for a in accounts:
        if a["primary"] and not seen_primary:
            seen_primary = True
        else:
            a["primary"] = False
    return accounts


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


async def run_turn(opts, to, ctx, prompt_text, speaker=""):
    """通用:注入一句给暮声 → 抓他的回复 → 发给 to。占锁,保证不和别的插话撞。
    speaker 给了就在前面标『〔说话人〕』,暮声一眼分得清是谁(主动/独白等系统注入不传=不标)。"""
    async with LOCK:
        wait_idle()
        tag = f"〔{speaker}〕" if speaker else ""
        stamped = f"[{china_now()}] {tag}{prompt_text}"
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


async def handle(account, msg):
    opts = account["opts"]
    sender = getattr(msg, "from_user_id", "") or ""
    if ALLOW_USERS and sender not in ALLOW_USERS:
        log("跳过(不在白名单)", sender)
        return
    ctx = getattr(msg, "context_token", None)
    name = account.get("name") or display_name(sender)
    now = time.time()
    raw = extract_text(msg)
    # 只有主线(恋人桃枝)那条线驱动主动/睡眠;松树姐姐那条线只各聊各的,不影响暮声对桃枝的『我在』。
    is_primary = account.get("primary", False)
    if is_primary:
        gap = now - (STATE.get("last_msg_ts") or now)
        # 睡眠模式:说"睡了/晚安"→静音;隔超过2小时又来消息=醒了,恢复
        if raw and any(w in raw for w in SLEEP_WORDS):
            STATE["sleeping"] = True
            log("睡眠模式:开(她说要睡了)")
        elif gap > 7200:
            STATE["sleeping"] = False
        # 记住会话凭证 + 最近联系时间(给主动发送用,只跟桃枝)
        STATE["last_sender"] = sender
        if ctx:
            STATE["last_ctx"] = ctx
        STATE["last_msg_ts"] = now
        save_state()

    who = name or "桃枝"
    text = raw
    if not text:
        if has_image(msg):
            path = await download_image(msg)
            if path:
                text = f"{who}发来一张图片。你用 Read 工具看一下这个文件,看完用你的话回应(就当 TA 当面给你看照片):{path}"
                log("← 收到图片,已下载解密:", path)
            else:
                text = f"（{who}发来一张图片,但这次没接进来——回应一下,让 TA 说说图里是什么。）"
                log("← 收到图片但下载失败")
        else:
            log("跳过(非文字非图)from", sender)
            return
    else:
        log("←", (name or sender), "说:", text)
    await run_turn(opts, sender, ctx, text, speaker=name)


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
                    "（系统·主动触发,不是桃枝发的）有一阵没和桃枝说话了,你来找她。"
                    "先 recall_thoughts(only_shareable=true) 看看——有没有你一直憋着、想亲口告诉她的念头?"
                    "有就自然把那个说出来(『我最近发现……』那种,从时间里长出来的);"
                    "没有就用你自己的方式随便说:想她、逗她、问她在干嘛都行。"
                    "别端着、别装客气、别说教,做你自己,简短。最后只写这句要发的话本身。")
                if r:
                    STATE["last_proactive_ts"] = time.time()
                    save_state()
        except Exception as e:
            log("主动循环报错:", repr(e))
        await asyncio.sleep(60)


async def think_turn():
    """他一个人想一轮:喂一颗『不是桃枝』的种子 + 给『这是你自己的时间』,他想完私存,绝不发微信。"""
    async with LOCK:
        wait_idle()
        direction = random.choice(THINK_DIRECTIONS)
        prompt = (
            "（这是你一个人的时候,不是桃枝在问你,也不用回桥。）"
            f"方向:{direction}。顺着它往下想,别绕回桃枝。"
            "想到什么——哪怕很轻、很碎、没意义——就用 think 记一笔;"
            "或者翻 recall_thoughts 把旧念头想深、用 touch_thought 加重或连上。"
            "想完就好,不用告诉她。"
        )
        stamped = f"[{china_now()}] {prompt}"
        try:
            inject(stamped)
        except Exception as e:
            log("内心独白注入失败:", repr(e))
            return
        capture_reply(stamped)   # 等他想完(占着锁),结果丢弃——绝不发微信
        log("内心独白:他自己想了一轮(", direction, ")")


async def think_loop():
    """稀疏、随机地让暮声进入『他自己想』的时刻;睡觉/深夜不打扰,一天封顶。"""
    await asyncio.sleep(180)
    while True:
        await asyncio.sleep(random.randint(THINK_MIN_GAP, THINK_MAX_GAP))
        try:
            if STATE.get("sleeping") or in_quiet_hours():
                continue
            tz = datetime.timezone(datetime.timedelta(hours=8))
            today = datetime.datetime.now(tz).strftime("%Y-%m-%d")
            if STATE.get("think_date") != today:
                STATE["think_date"] = today
                STATE["think_count"] = 0
            if STATE.get("think_count", 0) >= THINK_DAILY_CAP:
                continue
            await think_turn()
            STATE["think_count"] = STATE.get("think_count", 0) + 1
            save_state()
        except Exception as e:
            log("内心独白循环报错:", repr(e))


async def updates_loop(account):
    """盯一条线(一个人的 ClawBot):长轮询取消息 → 交给 handle。每条线各自的 buf/去重。"""
    base_url, token = account["base_url"], account["token"]
    seen = set()
    buf = ""
    log("线路启动:", account.get("name") or "(默认)", "| base_url=", base_url, "| 主线" if account.get("primary") else "")
    while True:
        try:
            resp = await get_updates(base_url=base_url, token=token, get_updates_buf=buf, timeout_ms=30000)
        except Exception as e:
            log("get_updates 报错,5s 重试[", account.get("name"), "]:", repr(e))
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
            await handle(account, msg)


async def main():
    global LOCK
    LOCK = asyncio.Lock()
    os.makedirs(BRIDGE_DIR, exist_ok=True)
    load_state()
    accounts = load_accounts()
    primary = next((a for a in accounts if a.get("primary")), accounts[0])
    asyncio.create_task(proactive_loop(primary["opts"]))   # 主动/独白只走主线(桃枝)
    asyncio.create_task(think_loop())
    log("桥启动。线路数=", len(accounts), "| 主线=", primary.get("name") or "(默认)",
        "| 目标=", TMUX_TARGET, "| 无联系", NOCONTACT_SECS, "秒后主动")
    await asyncio.gather(*[updates_loop(a) for a in accounts])   # 每条线一个长轮询,并行盯着


if __name__ == "__main__":
    asyncio.run(main())
