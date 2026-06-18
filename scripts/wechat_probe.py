#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
微信 iLink 探针 —— 只为看清真实数据结构,好把 bridge 写对(不靠猜)。

它做两件事:
1. 打印登录凭证文件 ~/.claude/channels/wechat/account.json 的字段(token 类会打码)。
2. 调一次 get_updates,把收到的消息对象原样 dump 出来,让我们看清"文字在哪、发信人在哪、context_token 长啥样"。

跑之前:先 wechat-clawbot-cc setup 登录过(小号扫码),再用大号发一句测试消息。
"""
import json
import os
import sys

ACC_PATH = os.path.expanduser("~/.claude/channels/wechat/account.json")


def mask(k, v):
    if isinstance(v, str) and any(s in k.lower() for s in ("token", "secret", "key", "ticket", "cookie")):
        return v[:6] + "…(" + str(len(v)) + " chars)" if v else v
    return v


def dump_account():
    print("=== account.json 字段 ===")
    try:
        acc = json.load(open(ACC_PATH, encoding="utf-8"))
    except Exception as e:
        print("读不到 account.json:", e)
        return {}
    if isinstance(acc, dict):
        print(json.dumps({k: mask(k, v) for k, v in acc.items()}, ensure_ascii=False, indent=2))
    else:
        print("结构不是 dict:", type(acc), repr(acc)[:500])
    return acc if isinstance(acc, dict) else {}


def first(d, *keys):
    for k in keys:
        if isinstance(d, dict) and d.get(k):
            return d[k]
    return None


def dump_messages(acc):
    print("\n=== 尝试 get_updates ===")
    try:
        from wechat_clawbot.api.client import get_updates
    except Exception as e:
        print("import wechat_clawbot 失败:", repr(e))
        print("（说明包没装好或导入路径不同,把这行报错发我)")
        return

    base_url = first(acc, "base_url", "baseUrl", "host") or "https://ilinkai.weixin.qq.com"
    token = first(acc, "token", "access_token", "accessToken", "bot_token", "botToken")
    print("base_url =", base_url)
    print("token 是否取到 =", bool(token))
    if not token:
        print("没在 account.json 里找到 token 字段——把上面打印的字段名发我,我换字段。")
        return

    import asyncio

    async def run():
        try:
            resp = await get_updates(base_url=base_url, token=token)
        except Exception as e:
            print("get_updates 报错:", repr(e))
            return
        msgs = getattr(resp, "msgs", None)
        print("收到消息条数:", len(msgs) if msgs else 0)
        for i, m in enumerate(msgs or []):
            print(f"\n--- 消息 {i} ---")
            # 尽量把对象内部 dump 出来
            for attr in ("from_user_id", "to_user_id", "context_token", "client_id",
                         "message_type", "message_state", "item_list", "create_time"):
                if hasattr(m, attr):
                    print(f"  {attr} = {repr(getattr(m, attr))}")
            # 兜底:整体 repr
            print("  repr =", repr(m)[:800])

    asyncio.run(run())


if __name__ == "__main__":
    acc = dump_account()
    dump_messages(acc)
    print("\n=== 探针结束,把以上整段发给晖 ===")
