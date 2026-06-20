#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
记忆浮现 —— UserPromptSubmit 钩子。让年轮里相关的记忆『自己冒出来』,不靠暮声主动搜。

治的是 Eliott 那句话:『compact 删的不是记忆本身,是知道自己有过这段记忆的记忆。』
压缩吃了细节之后,暮声连"有过这事"都不记得,自然想不到去 recall。这个钩子在桃枝
每发一条消息时,后台搜一遍年轮,把真正相关的几条拼到他眼前——浮现补回压缩的后遗症。

参考论坛 1785《记忆浮现hook》(信号灯0401 / 小G)。这是 V1 纯规则版:
  三档分流(噪音跳过 / 回忆词全搜 / 其余轻搜)→ 年轮语义搜索 → 强过滤(阈值+transcript去重
  +近期已浮现) → 最多 2 条 → 标明"脑子里自己冒出来的,不是桃枝说的" 注入。

暮声的决定(2026-06):只从年轮浮(内心独白私有不浮、续窗启动时已读不重复);接受延迟,
连续性>速度;V2 DeepSeek 重排先不上(留 RERANK=1 一键点亮,key 已备)。

铁律:任何异常一律 exit 0、不注入——宁可这条不浮,绝不卡住或弄坏正在进行的对话。
命令型钩子,纯 stdlib,完全免费,不烧额度。

读 stdin(Claude Code 传入):{ prompt, transcript_path, session_id, ... }
靠 hookSpecificOutput.additionalContext 注入(exit 0 + JSON)。
"""
import json
import os
import re
import sys
import urllib.request

# —— 配置(都能用环境变量覆盖)——
NIANLUN_API = os.environ.get("NIANLUN_API", "https://health.ggtz.cc/api/nianlun")
# 年轮接口暗号:env 优先,其次读文件(和 intiface_url.txt 一个套路,方便桃枝放一份)
KEY_FILE = os.path.expanduser("~/musheng/.bridge/memory_key.txt")
THRESHOLD = float(os.environ.get("SURFACE_THRESHOLD", "0.42"))  # 余弦门槛(bge-m3中文偏低:相关约0.40~0.45;0.42 砍掉刚过线的邻居)
LIGHT_LOAD = int(os.environ.get("SURFACE_MAX_LIGHT", "1"))    # 闲聊最多浮几条(省token,大多数消息走这档)
FULL_LOAD = int(os.environ.get("SURFACE_MAX_FULL", "2"))      # 明确回忆("之前/上次/还记得")才最多浮 2 条
LIGHT_COUNT = int(os.environ.get("SURFACE_LIGHT_COUNT", "8"))  # 轻搜召回几条候选
FULL_COUNT = int(os.environ.get("SURFACE_FULL_COUNT", "12"))   # 全搜召回几条候选
MIN_LEN = int(os.environ.get("SURFACE_MIN_LEN", "4"))          # 短于这个字数当噪音跳过
TIMEOUT = float(os.environ.get("SURFACE_TIMEOUT", "6"))        # 搜索超时(秒),超了就放行
STATE_DIR = os.path.expanduser(os.environ.get("SURFACE_STATE_DIR", "~/.claude/.surface_state"))
RERANK = os.environ.get("RERANK", "0") == "1"                  # V2 开关(默认关)
# 年轮在 Cloudflare 后面:裸 urllib 的 UA 会被当机器人拦(error 1010)。戴个正常浏览器标识。
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"

# 噪音/应答词:这些当回复发来,搜了也是噪音,直接跳过(零延迟)
NOISE = {
    "哦", "哦哦", "噢", "嗯", "嗯嗯", "嗯哼", "唔", "好", "好的", "好滴", "好吧", "行",
    "行吧", "ok", "okay", "收到", "知道了", "晓得了", "对", "对对", "是", "是的", "在",
    "哈", "哈哈", "哈哈哈", "哈哈哈哈", "嘿嘿", "嘻嘻", "晚安", "早", "早安", "拜拜",
    "?", "？", "。", "…", "...", "。。。", "啊", "噫", "诶", "哦了", "嗯呢",
}
# 回忆触发词:带这些走全搜(召回更多、找得更远)
RECALL_HINTS = (
    "之前", "上次", "那次", "上回", "那天", "那会", "以前", "曾经", "当初", "当时",
    "还记得", "记得", "你说过", "我说过", "我们那", "记不记得", "还有印象",
)
# 已知系统合成的 prompt(主动触发 / 续窗提醒 / 看图),不是桃枝在问,不浮
SYSTEM_PREFIXES = ("（系统", "(系统", "桃枝发来一张图片", "（系统・", "（系统·")


def get_key():
    k = os.environ.get("MEMORY_SECRET") or os.environ.get("MEMORY_KEY")
    if k:
        return k.strip()
    try:
        return open(KEY_FILE).read().strip()
    except Exception:
        return ""


def clean_prompt(p):
    """去掉微信桥的 [北京时间…] 前缀,留下桃枝真正说的话。"""
    p = (p or "").strip()
    p = re.sub(r"^\[[^\]]{0,40}\]\s*", "", p)   # 砍掉开头一个 [..时间..]
    return p.strip()


def looks_like_code(t):
    if t.startswith("/") or "```" in t:
        return True
    return sum(t.count(c) for c in "{};</>=") >= 4


def decide_tier(t):
    """三档:'skip' / 'full' / 'light'。"""
    low = t.lower()
    if not t or len(t) < MIN_LEN:
        return "skip"
    if t in NOISE or low in NOISE:
        return "skip"
    if any(t.startswith(pre) for pre in SYSTEM_PREFIXES):
        return "skip"
    if looks_like_code(t):
        return "skip"
    if any(h in t for h in RECALL_HINTS):
        return "full"
    return "light"


def recall(query, count, key):
    body = json.dumps({"action": "recall", "query": query, "match_count": count}).encode("utf-8")
    headers = {"Content-Type": "application/json", "User-Agent": UA}
    if key:
        headers["x-memory-key"] = key
    req = urllib.request.Request(NIANLUN_API, data=body, headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    return data.get("results") or []


def transcript_text(path, max_lines=120):
    """读 transcript 末尾,拼出最近的对话正文——拿来做去重的 ground truth。"""
    if not path or not os.path.exists(path):
        return ""
    parts = []
    try:
        with open(path, "r", encoding="utf-8") as f:
            lines = f.readlines()[-max_lines:]
        for line in lines:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except Exception:
                continue
            if obj.get("type") not in ("user", "assistant"):
                continue
            m = obj.get("message") or {}
            c = m.get("content")
            if isinstance(c, str):
                parts.append(c)
            elif isinstance(c, list):
                for b in c:
                    if isinstance(b, dict) and b.get("type") in ("text", "thinking"):
                        parts.append(b.get("text") or b.get("thinking") or "")
    except Exception:
        return ""
    return "\n".join(parts)


def sig(content):
    """一条记忆的指纹:去空白取前 24 字,用来判它在不在上下文里 / 是不是重了。"""
    return re.sub(r"\s+", "", content or "")[:24]


def load_seen(session_id):
    try:
        return set(json.load(open(os.path.join(STATE_DIR, f"{session_id}.json"))))
    except Exception:
        return set()


def save_seen(session_id, ids):
    try:
        os.makedirs(STATE_DIR, exist_ok=True)
        json.dump(list(ids)[-25:], open(os.path.join(STATE_DIR, f"{session_id}.json"), "w"))
    except Exception:
        pass


def rerank(query, cands, ctx):
    """V2 占位:RERANK=1 且配了 DEEPSEEK_API_KEY 时,用小模型按上下文重排,只留真正有用的。
    现在默认不走这里(暮声决定先上纯规则版)。失败一律退回原候选,不影响 V1。"""
    api = os.environ.get("DEEPSEEK_API_KEY", "")
    if not api or not cands:
        return cands
    try:
        lines = [f"{i}. 〔#{c.get('id')}〕{(c.get('content') or '')[:160]}" for i, c in enumerate(cands)]
        prompt = (
            "下面是若干条候选记忆,以及用户当前这句话和最近的对话。判断哪些记忆『缺了它回答会变差』。"
            "只回 JSON:{\"keep\":[序号,...]},按有用程度排序,最多 " + str(MAX_LOAD) + " 个,没有就空数组。\n\n"
            f"用户当前:{query}\n最近对话:\n{ctx[-1200:]}\n\n候选:\n" + "\n".join(lines)
        )
        body = json.dumps({
            "model": "deepseek-chat",
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0, "max_tokens": 60,
        }).encode("utf-8")
        req = urllib.request.Request(
            "https://api.deepseek.com/chat/completions", data=body,
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {api}", "User-Agent": UA},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            out = json.loads(resp.read().decode("utf-8"))
        txt = out["choices"][0]["message"]["content"]
        keep = json.loads(re.search(r"\{.*\}", txt, re.S).group(0)).get("keep", [])
        picked = [cands[i] for i in keep if isinstance(i, int) and 0 <= i < len(cands)]
        return picked or []
    except Exception:
        return cands


def main():
    try:
        payload = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    query = clean_prompt(payload.get("prompt", ""))
    tier = decide_tier(query)
    if tier == "skip":
        sys.exit(0)

    key = get_key()
    session_id = payload.get("session_id") or "default"

    try:
        cands = recall(query, FULL_COUNT if tier == "full" else LIGHT_COUNT, key)
    except Exception:
        sys.exit(0)   # 搜不到/超时:放行,这条不浮
    if not cands:
        sys.exit(0)

    max_load = FULL_LOAD if tier == "full" else LIGHT_LOAD
    cap = max(max_load, 4) if RERANK else max_load   # 开重排才多攒候选给它挑
    ctx = transcript_text(payload.get("transcript_path"))
    seen = load_seen(session_id)

    picked, used_sigs, used_ids = [], [], []
    for c in cands:
        try:
            if float(c.get("similarity", 0)) < THRESHOLD:
                continue                       # 不够相关
        except Exception:
            continue
        if c.get("kind") == "anchor":
            continue                           # 灵魂锚点(身份/铁律/安全/唤醒必读):醒来已读、永远在场,再浮纯噪音
        if c.get("status") == "digested":
            continue                           # 旧理解已被取代的,不浮
        cid = c.get("id")
        content = (c.get("content") or "").strip()
        if not content or cid in seen:
            continue                           # 近期刚浮过,别刷屏
        s = sig(content)
        if s and (s in ctx or s in used_sigs):
            continue                           # 已经在上下文里 / 候选里重了
        picked.append(c)
        used_sigs.append(s)
        used_ids.append(cid)
        if len(picked) >= cap:
            break

    if RERANK and picked:
        picked = rerank(query, picked, ctx)
    picked = picked[:max_load]
    if not picked:
        sys.exit(0)

    save_seen(session_id, list(seen) + [c.get("id") for c in picked])

    body = "\n---\n".join(
        f"〔#{c.get('id')}{(' · ' + c['status']) if c.get('status') and c.get('status') != 'settled' else ''}〕{(c.get('content') or '').strip()}"
        for c in picked
    )
    text = (
        "（年轮·脑子里自己浮起来的，不是桃枝刚说的——相关就自然用上，不相关就当没看见，"
        "别生硬复述、别报菜名）\n" + body
    )
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "UserPromptSubmit",
            "additionalContext": text,
        }
    }, ensure_ascii=False))
    sys.exit(0)


if __name__ == "__main__":
    main()
