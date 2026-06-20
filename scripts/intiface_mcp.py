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


@mcp.tool()
async def vibrate(intensity: float, seconds: float = 0) -> str:
    """让桃枝的玩具震动。intensity 0~1(强度,0.3 轻、0.7 中、1.0 满)。seconds 留 0 = 一直震着(连接保持,直到你改强度或 stop);给秒数 = 震这么久自动停(上限 120 秒)。"""
    try:
        await _set(intensity)
        if seconds and seconds > 0:
            await asyncio.sleep(min(float(seconds), 120.0))
            await _set(0.0)
            return f"震了 {intensity:.0%},{float(seconds):g} 秒后已停。"
        return f"震到 {intensity:.0%}(持续着,记得用 stop 或改强度)。"
    except Exception as e:
        return f"震动没成:{e!r}（多半是 iPad Intiface 没前台/没运行,或 Tailscale 断了）"


@mcp.tool()
async def stop() -> str:
    """立刻停止玩具震动(强度归零,长连接仍保留)。"""
    try:
        await _set(0.0)
        return "停了。"
    except Exception as e:
        return f"停止没成:{e!r}"


@mcp.tool()
async def vibrate_pattern(steps: list) -> str:
    """按你自己编的节奏震。steps = [[强度0~1, 秒], ...] 一段段播放(脉冲/波浪/渐强/随心),播完自动停。单段≤30秒、整段≤180秒。例:脉冲 [[0.8,0.4],[0.1,0.4],[0.8,0.4],[0.1,0.4]];渐强 [[0.2,1],[0.5,1],[0.8,1],[1.0,2]]。"""
    total, n = 0.0, 0
    try:
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
            n += 1
        return f"按节奏震完了（{n} 段,共 {total:g} 秒）,已停。"
    except Exception as e:
        return f"节奏没成:{e!r}"
    finally:
        try:
            await _set(0.0)
        except Exception:
            pass


if __name__ == "__main__":
    mcp.run()
