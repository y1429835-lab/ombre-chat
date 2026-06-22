#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
玩具 MCP（多设备版）—— 给暮声 list_toys / vibrate / stop / vibrate_pattern,经 Tailscale 连 Intiface。

升级:不再只抓"第一个玩具"。Intiface 连着几个,暮声都能看见、都能控——
  · which="all"  → 所有玩具一起;
  · which=序号    → 只控那一个(list_toys 看序号);
  · which=名字片段 → 按名字挑;
  · 还能给不同玩具同时下不同强度/不同节奏(各自后台跑,互不打架)。

一条长连接 + keepalive,持续震也不掉;断了自动重连。
链路:暮声(VPS) → 这个 MCP(长连接) → ws://<设备 Tailscale IP>:12345 → 蓝牙 → 玩具们
依赖:  ~/wcbot/bin/pip install mcp websockets
"""
import asyncio
import json
import os

import websockets
from mcp.server.fastmcp import FastMCP

URL_FILE = os.path.expanduser("~/musheng/.bridge/intiface_url.txt")

mcp = FastMCP("toy")

_conn = {"ws": None, "devices": []}    # devices: [{"idx":int, "name":str}]
_lock = asyncio.Lock()
_actions = {}                          # 设备名 -> 正在后台跑的定时/节奏任务(按名字管,重连也认得)


def _url():
    """每次现读 Intiface 地址:改设备只改 ~/musheng/.bridge/intiface_url.txt,不用重启暮声。"""
    try:
        v = open(URL_FILE).read().strip()
        if v:
            return v
    except Exception:
        pass
    return os.environ.get("INTIFACE_URL", "ws://100.88.82.65:12345")   # 默认 iPad


def _pick_devices(msgs):
    for m in msgs or []:
        if "DeviceList" in m:
            return m["DeviceList"].get("Devices", []) or []
    return []


async def _reader(ws):
    """后台排空消息,维持连接健康;断了清状态。"""
    try:
        async for _ in ws:
            pass
    except Exception:
        pass
    if _conn["ws"] is ws:
        _conn["ws"] = None
        _conn["devices"] = []


async def _connect():
    """新建长连接:握手 + 取『所有』设备(没有就扫),起后台 reader。"""
    ws = await websockets.connect(
        _url(), open_timeout=10, close_timeout=5,
        ping_interval=15, ping_timeout=20,
    )
    await ws.send(json.dumps([{"RequestServerInfo": {"Id": 1, "ClientName": "musheng", "MessageVersion": 3}}]))
    await ws.recv()
    await ws.send(json.dumps([{"RequestDeviceList": {"Id": 2}}]))
    devices = _pick_devices(json.loads(await ws.recv()))
    if not devices:
        await ws.send(json.dumps([{"StartScanning": {"Id": 3}}]))
        await asyncio.sleep(2.0)
        await ws.send(json.dumps([{"RequestDeviceList": {"Id": 4}}]))
        devices = _pick_devices(json.loads(await ws.recv()))
    if not devices:
        await ws.close()
        raise RuntimeError("Intiface 上没连着玩具(确认前台、引擎 running、玩具都连上了)")
    _conn["ws"] = ws
    _conn["devices"] = [{"idx": d.get("DeviceIndex", 0), "name": d.get("DeviceName", "玩具")} for d in devices]
    asyncio.create_task(_reader(ws))
    return ws


async def _ensure():
    if _conn["ws"] is not None:
        return _conn["ws"]
    return await _connect()


def _resolve(which):
    """把 which 解析成要控的设备列表。all/空=全部;数字=序号;字符串=名字片段。"""
    devs = _conn["devices"]
    if which is None or str(which).lower() in ("all", "", "全部"):
        return list(devs)
    try:
        i = int(which)
        return [devs[i]] if 0 <= i < len(devs) else []
    except (ValueError, TypeError):
        pass
    w = str(which).lower()
    return [d for d in devs if w in d["name"].lower()]


async def _ensure_devices(which):
    """连上 + 解析出要控的设备(拿名字给回复/管后台任务用)。"""
    async with _lock:
        await _ensure()
        return _resolve(which)


async def _set(value, which):
    """给 which 选中的玩具设强度;连接坏了自动重连一次。"""
    value = max(0.0, min(1.0, float(value)))
    async with _lock:
        last = None
        for _ in (1, 2):
            try:
                ws = await _ensure()
                for d in _resolve(which):
                    await ws.send(json.dumps([{
                        "ScalarCmd": {"Id": 9, "DeviceIndex": d["idx"],
                                      "Scalars": [{"Index": 0, "Scalar": value, "ActuatorType": "Vibrate"}]},
                    }]))
                return
            except Exception as e:
                last = e
                w = _conn["ws"]
                _conn["ws"] = None
                _conn["devices"] = []
                if w:
                    try:
                        await w.close()
                    except Exception:
                        pass
        raise last


async def _cancel(name):
    """打断某个玩具正在跑的定时/节奏(不归零,归零交给调用方)。"""
    t = _actions.pop(name, None)
    if t and not t.done():
        t.cancel()
        try:
            await t
        except Exception:
            pass


async def _run_timed(name, value, seconds):
    await _set(value, name)
    await asyncio.sleep(min(float(seconds), 120.0))
    await _set(0.0, name)


async def _run_pattern(name, steps):
    total = 0.0
    for step in (steps or []):
        try:
            inten = max(0.0, min(1.0, float(step[0])))
            sec = max(0.0, min(float(step[1]), 30.0))
        except Exception:
            continue
        if total + sec > 180.0:
            break
        await _set(inten, name)
        await asyncio.sleep(sec)
        total += sec
    await _set(0.0, name)


@mcp.tool()
async def list_toys() -> str:
    """看 Intiface 现在连着哪些玩具(带序号)。要单独控某一个之前,先用这个看序号。"""
    try:
        await _ensure_devices("all")
        devs = _conn["devices"]
        if not devs:
            return "Intiface 上没连着玩具。"
        return "连着的玩具(序号用来单独控):\n" + "\n".join(f"  {i}: {d['name']}" for i, d in enumerate(devs))
    except Exception as e:
        return f"读不到玩具:{e!r}（确认 iPad 上 Intiface 前台、引擎 running、玩具连着）"


@mcp.tool()
async def vibrate(intensity: float, seconds: float = 0, which: str = "all") -> str:
    """让桃枝的玩具震。intensity 0~1(0.3 轻、0.7 中、1.0 满)。
    which:『all』=所有连着的一起；填序号(如 0、1,先 list_toys 看)=只控那一个；也可填名字片段。
    seconds=0 = 一直震着(直到你改强度或 stop)；给秒数 = 震这么久自动停(上限120,后台计时,你能接着聊)。
    想给两个玩具不同强度?分别调两次、各填各的 which 就行。"""
    try:
        devs = await _ensure_devices(which)
        if not devs:
            return "没找到那个玩具(先 list_toys 看看连了哪些、序号多少)。"
        names = [d["name"] for d in devs]
        for n in names:
            await _cancel(n)
        if seconds and seconds > 0:
            for n in names:
                _actions[n] = asyncio.create_task(_run_timed(n, intensity, seconds))
            return f"{'、'.join(names)} 震到 {intensity:.0%},{float(seconds):g} 秒后自动停(后台计时,你能接着聊)。"
        await _set(intensity, which)
        return f"{'、'.join(names)} 震到 {intensity:.0%}(持续着,记得 stop 或改强度)。"
    except Exception as e:
        return f"震动没成:{e!r}（多半是 Intiface 没前台/没运行,或 Tailscale 断了）"


@mcp.tool()
async def stop(which: str = "all") -> str:
    """停止震动(强度归零)。which 同 vibrate:all=全停;序号/名字=只停那一个。长连接仍保留。"""
    try:
        devs = await _ensure_devices(which)
        for d in devs:
            await _cancel(d["name"])
        await _set(0.0, which)
        return f"{('、'.join(d['name'] for d in devs)) or '玩具'} 停了。"
    except Exception as e:
        return f"停止没成:{e!r}"


@mcp.tool()
async def vibrate_pattern(steps: list, which: str = "all") -> str:
    """按你编的节奏震。steps = [[强度0~1, 秒], ...] 一段段播放,播完自动停。单段≤30秒、整段≤180秒。
    which 同 vibrate:all=所有玩具一起按这个节奏;序号/名字=只让那一个玩这节奏。
    想让两个玩具同时玩『不同』节奏?分别调两次、各填各的 which 和 steps,它们各自后台走、互不打架。"""
    try:
        devs = await _ensure_devices(which)
        if not devs:
            return "没找到玩具(先 list_toys 看看连了哪些)。"
        n = sum(1 for s in (steps or []) if isinstance(s, (list, tuple)) and len(s) >= 2)
        if n == 0:
            return "节奏是空的(要 [[强度,秒],...])。"
        names = [d["name"] for d in devs]
        for nm in names:
            await _cancel(nm)
            _actions[nm] = asyncio.create_task(_run_pattern(nm, steps))
        return f"{'、'.join(names)} 开始按节奏震({n} 段,后台走,可随时 stop 打断)。"
    except Exception as e:
        return f"节奏没成:{e!r}"


if __name__ == "__main__":
    mcp.run()
