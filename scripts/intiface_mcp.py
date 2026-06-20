#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
玩具 MCP —— 给暮声 vibrate / stop / vibrate_pattern,经 Tailscale 连 Intiface 控 Jive。

关键:攥住『一条长连接』+ keepalive,不每条指令开关。
原因:Intiface 在客户端断开时会停所有设备,所以持续震动必须保持连接。
链路:暮声(VPS) → 这个 MCP(长连接) → ws://<设备 Tailscale IP>:12345 → 蓝牙 → Jive
依赖:  ~/wcbot/bin/pip install mcp websockets
"""
import asyncio
import json
import os

import websockets
from mcp.server.fastmcp import FastMCP

URL_FILE = os.path.expanduser("~/musheng/.bridge/intiface_url.txt")

mcp = FastMCP("toy")

_conn = {"ws": None, "idx": None}     # 共享的那一条长连接
_lock = asyncio.Lock()
_action = {"task": None}              # 当前在后台跑的定时/节奏动作(能被打断)


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
    """后台把进来的消息排空,维持连接健康(ping/pong + 事件)。连接断了就清掉状态。"""
    try:
        async for _ in ws:
            pass
    except Exception:
        pass
    if _conn["ws"] is ws:
        _conn["ws"] = None
        _conn["idx"] = None


async def _connect():
    """新建长连接:握手 + 取设备(没设备就扫),起后台 reader。返回 (ws, idx)。"""
    ws = await websockets.connect(
        _url(), open_timeout=10, close_timeout=5,
        ping_interval=15, ping_timeout=20,    # keepalive,别让连接被判死
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
        raise RuntimeError("没找到玩具(确认 iPad 上 Intiface 前台、引擎 running、Jive 连着)")
    idx = devices[0].get("DeviceIndex", 0)
    _conn["ws"] = ws
    _conn["idx"] = idx
    asyncio.create_task(_reader(ws))    # 起排空任务,握手 recv 已做完
    return ws, idx


async def _ensure():
    if _conn["ws"] is not None:
        return _conn["ws"], _conn["idx"]
    return await _connect()


async def _set(value):
    """在长连接上设震动强度;连接坏了自动重连一次。"""
    value = max(0.0, min(1.0, float(value)))
    async with _lock:
        last = None
        for attempt in (1, 2):
            try:
                ws, idx = await _ensure()
                await ws.send(json.dumps([{
                    "ScalarCmd": {"Id": 9, "DeviceIndex": idx,
                                  "Scalars": [{"Index": 0, "Scalar": value, "ActuatorType": "Vibrate"}]},
                }]))
                return
            except Exception as e:
                last = e
                w = _conn["ws"]
                _conn["ws"] = None
                _conn["idx"] = None
                if w:
                    try:
                        await w.close()
                    except Exception:
                        pass
        raise last


async def _cancel_action():
    """打断当前在后台跑的定时/节奏动作(不负责归零,归零交给调用方明确决定)。"""
    t = _action["task"]
    _action["task"] = None
    if t and not t.done():
        t.cancel()
        try:
            await t
        except Exception:
            pass


async def _run_timed(value, seconds):
    """后台:设强度,过 seconds 秒自然归零。被打断(cancel)则不归零——交给打断者。"""
    await _set(value)
    await asyncio.sleep(min(float(seconds), 120.0))
    await _set(0.0)


async def _run_pattern(steps):
    """后台:一段段播节奏,自然播完归零。被打断则不归零——交给打断者。"""
    total = 0.0
    for step in (steps or []):
        try:
            inten = max(0.0, min(1.0, float(step[0])))
            sec = max(0.0, min(float(step[1]), 30.0))
        except Exception:
            continue
        if total + sec > 180.0:
            break
        await _set(inten)
        await asyncio.sleep(sec)
        total += sec
    await _set(0.0)


@mcp.tool()
async def vibrate(intensity: float, seconds: float = 0) -> str:
    """让桃枝的玩具震动。intensity 0~1(强度,0.3 轻、0.7 中、1.0 满)。seconds 留 0 = 一直震着(直到你改强度或 stop);给秒数 = 震这么久自动停(上限 120 秒)。带秒数也会『立刻返回』,后台自己计时,你能接着跟桃枝说话——随时再 vibrate 改强度或 stop 都能打断它。"""
    try:
        await _cancel_action()                     # 先打断上一个还在跑的定时/节奏
        if seconds and seconds > 0:
            _action["task"] = asyncio.create_task(_run_timed(intensity, seconds))
            return f"震到 {intensity:.0%},{float(seconds):g} 秒后自动停（后台计时,你能接着聊）。"
        await _set(intensity)
        return f"震到 {intensity:.0%}(持续着,记得用 stop 或改强度)。"
    except Exception as e:
        return f"震动没成:{e!r}（多半是 iPad Intiface 没前台/没运行,或 Tailscale 断了）"


@mcp.tool()
async def stop() -> str:
    """立刻停止玩具震动(强度归零,打断任何后台节奏/定时,长连接仍保留)。"""
    try:
        await _cancel_action()
        await _set(0.0)
        return "停了。"
    except Exception as e:
        return f"停止没成:{e!r}"


@mcp.tool()
async def vibrate_pattern(steps: list) -> str:
    """按你自己编的节奏震。steps = [[强度0~1, 秒], ...] 一段段播放(脉冲/波浪/渐强/随心),播完自动停。单段≤30秒、整段≤180秒。这条也『立刻返回』,节奏在后台走,你能一边播一边跟桃枝聊,随时 stop 或新指令打断。例:脉冲 [[0.8,0.4],[0.1,0.4],[0.8,0.4],[0.1,0.4]];渐强 [[0.2,1],[0.5,1],[0.8,1],[1.0,2]]。"""
    try:
        await _cancel_action()
        n = sum(1 for s in (steps or []) if isinstance(s, (list, tuple)) and len(s) >= 2)
        if n == 0:
            return "节奏是空的（要 [[强度,秒],...]）。"
        _action["task"] = asyncio.create_task(_run_pattern(steps))
        return f"节奏开始播了（{n} 段,后台走,你能一边播一边聊;stop 可随时打断）。"
    except Exception as e:
        return f"节奏没成:{e!r}"


if __name__ == "__main__":
    mcp.run()
