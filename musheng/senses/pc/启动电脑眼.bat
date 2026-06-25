@echo off
rem Double-click = start PC-Eye. The window stays open (shows status / errors). Close it = stop.
powershell -NoExit -ExecutionPolicy Bypass -File "%~dp0pc-eye.ps1"
