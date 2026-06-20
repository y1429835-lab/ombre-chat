#!/bin/bash
# 开工:双击我,小红书工位就起来了。看完直接关掉这个终端窗口 = 收工。
cd "$(dirname "$0")" || exit 1
export XHS_TOKEN="taozhi-musheng-xhs-2026"   # 暗号,VPS 那头要填一样的;想改就两边一起改
export XHS_PORT="8848"
echo "==> 启动小红书工位… 头一次记得在弹出的浏览器里扫码登一下小红书。"
node station.mjs
