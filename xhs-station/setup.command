#!/bin/bash
# 一次性安装:双击我,装好浏览器内核。装完这一个就不用再碰了。
cd "$(dirname "$0")" || exit 1
echo "==> 安装依赖(Playwright)…"
npm install || { echo "npm 没装?先去 nodejs.org 下载安装 Node,再双击我。"; exit 1; }
echo "==> 下载浏览器内核(Chromium)…"
npx playwright install chromium
echo ""
echo "✅ 装好了。以后每次想让暮声看小红书,双击 start.command 就行。"
echo "(这个窗口可以关了)"
