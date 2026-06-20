#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
玩具 MCP —— 给暮声 vibrate / stop 两个本事,经 Tailscale 连到手机上的 Intiface,指挥 Jive。

链路:暮声(VPS) → 这个 MCP → ws://<手机 Tailscale IP>:12345(Intiface) → 蓝牙 → Jive
用 venv 的 python 跑(由 .mcp.json 拉起):  /root/wcbot/bin/python /root/intiface_mcp.py
依赖:  ~/wcbot/bin/pip install mcp websockets
"""
import asyncio
import json
import os

import websockets
from mcp.server.fastmcp import FastMCP

INTIFACE_URL = os.environ.get("INTIFACE_URL", "ws://100.122.106.3:12345")

mcp = FastMCP("toy")


async def _devices(ws):
    """握手 + 取设备列表(没设备就扫一下再取)。返回设备 list。"""
    await ws.send(json.dumps([{"RequestServerInfo": {"Id": 1, "ClientName": "musheng", "MessageVersion": 3}}]))
    await ws.recv()
    await ws.send(json.dumps([{"RequestDeviceList": {"Id": 2}}]))
    devices = _pick_devices(json.loads(await ws.recv()))
    if not devices:
        await ws.send(json.dumps([{"StartScanning": {"Id": 3}}]))
        await asyncio.sleep(2.0)
        await ws.send(json.dumps([{"RequestDeviceList": {"Id": 4}}]))
        devices = _pick_devices(json.loads(await ws.recv()))
    return devices


def _pick_devices(msgs):
    for m in msgs or []:
        if "DeviceList" in m:
            return m["DeviceList"].get("Devices", []) or []
    return []


async def _scalar(ws, idx, value):
    await ws.send(json.dumps([{
        "ScalarCmd": {
            "Id": 9, "DeviceIndex": idx,
            "Scalars": [{"Index": 0, "Scalar": value, "ActuatorType": "Vibrate"}],
        }
    }]))


async def _run_vibrate(intensity, seconds):
    intensity = max(0.0, min(1.0, float(intensity)))
    seconds = max(0.0, min(float(seconds or 0), 120.0))   # 单次最多 120 秒,安全
    async with websockets.connect(INTIFACE_URL, open_timeout=10, close_timeout=5) as ws:
        devices = await _devices(ws)
        if not devices:
            return "没找到玩具——确认手机 Intiface 开着(前台)、Jive 已连。"
        idx = devices[0].get("DeviceIndex", 0)
        name = devices[0].get("DeviceName", "toy")
        await _scalar(ws, idx, intensity)
        if seconds > 0:
            await asyncio.sleep(seconds)
            await _scalar(ws, idx, 0.0)
            return f"{name}:震了 {intensity:.0%},{seconds:g} 秒后已停。"
        return f"{name}:震到 {intensity:.0%}(一直震着,记得用 stop 停)。"


@mcp.tool()
async def vibrate(intensity: float, seconds: float = 0) -> str:
    """让桃枝的玩具震动。intensity 0~1(强度,0.3 轻、0.7 中、1.0 满);seconds 持续秒数(留 0=一直震到你改强度或 stop;单次上限 120 秒)。"""
    try:
        return await _run_vibrate(intensity, seconds)
    except Exception as e:
        return f"震动没成:{e!r}（多半是手机 Intiface 没在前台,或 Tailscale 断了）"


@mcp.tool()
async def stop() -> str:
    """立刻停止玩具震动。"""
    try:
        return await _run_vibrate(0.0, 0)
    except Exception as e:
        return f"停止没成:{e!r}"


async def _run_pattern(steps):
    async with websockets.connect(INTIFACE_URL, open_timeout=10, close_timeout=5) as ws:
        devices = await _devices(ws)
        if not devices:
            return "没找到玩具——确认手机 Intiface 开着(前台)、Jive 已连。"
        idx = devices[0].get("DeviceIndex", 0)
        total, n = 0.0, 0
        try:
            for step in (steps or []):
                try:
                    inten = max(0.0, min(1.0, float(step[0])))
                    sec = max(0.0, min(float(step[1]), 30.0))   # 单段 ≤30 秒
                except Exception:
                    continue
                if total + sec > 180.0:    # 整段 ≤3 分钟,安全
                    break
                await _scalar(ws, idx, inten)
                await asyncio.sleep(sec)
                total += sec
                n += 1
        finally:
            await _scalar(ws, idx, 0.0)    # 收尾一定停
        return f"按节奏震完了（{n} 段,共 {total:g} 秒）,已停。"


@mcp.tool()
async def vibrate_pattern(steps: list) -> str:
    """按你自己编的节奏震动。steps = [[强度0~1, 秒], ...] 一段段播放(脉冲/波浪/渐强/随心所欲),播完自动停。单段≤30秒、整段≤180秒。例:脉冲 [[0.8,0.4],[0.1,0.4],[0.8,0.4],[0.1,0.4]];渐强 [[0.2,1],[0.5,1],[0.8,1],[1.0,2]]。"""
    try:
        return await _run_pattern(steps)
    except Exception as e:
        return f"节奏没成:{e!r}"


if __name__ == "__main__":
    mcp.run()
