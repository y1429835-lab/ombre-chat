@echo off
chcp 65001 >nul
rem 双击我 = 启动电脑眼(后台默默跑)。关掉弹出的窗口 = 收工。
powershell -ExecutionPolicy Bypass -WindowStyle Minimized -File "%~dp0pc-eye.ps1"
