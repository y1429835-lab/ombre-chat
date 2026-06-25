# Musheng PC-Eye  —— 暮声的"电脑眼"
# 盯着桃枝电脑上当前在用哪个程序(Steam/微信/浏览器…),一换就告诉 VPS 的感知接口。
# 标成 PC-XX,跟手机的活动区分开。Windows 自带 PowerShell,不用装任何东西。
# 用法:把下面 $TOKEN 改成你的暗号 -> 双击同目录的 "启动电脑眼.bat"(或右键本文件 Run with PowerShell)。
# 关掉那个窗口 = 收工。

# ===== 改这一行:填你的感知暗号(和手机那个一样,/root/musheng/.bridge/activity_token.txt 里那串)=====
$TOKEN   = "PUT-YOUR-TOKEN-HERE"

$VPS     = "207.148.113.28"
$PORT    = 8787
$IDLEMAX = 300    # 超过 5 分钟没碰键鼠 = 你走开了,不上报
$REFRESH = 240    # 待在同一个程序里,每 4 分钟刷新一次"在场"

Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Diagnostics;
public static class Win {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("kernel32.dll")] public static extern uint GetTickCount();
  [StructLayout(LayoutKind.Sequential)] public struct LII { public uint cbSize; public uint dwTime; }
  [DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LII p);
  public static uint IdleMs() { LII l = new LII(); l.cbSize=(uint)Marshal.SizeOf(typeof(LII)); GetLastInputInfo(ref l); return GetTickCount()-l.dwTime; }
  public static string Fg() { IntPtr h=GetForegroundWindow(); uint pid; GetWindowThreadProcessId(h, out pid); try { return Process.GetProcessById((int)pid).ProcessName; } catch { return null; } }
}
"@

# 进程名 -> 好认的名字(没列到的就用原始进程名)
$map = @{
  "steam"="Steam"; "wechat"="WeChat"; "weixin"="WeChat"; "qq"="QQ"; "tim"="TIM";
  "chrome"="Browser"; "msedge"="Browser"; "firefox"="Browser";
  "code"="VSCode"; "windowsterminal"="Terminal"; "powershell"="Terminal";
  "explorer"="Files"; "douyin"="Douyin"; "cloudmusic"="Music"; "qqmusic"="Music";
  "wpsoffice"="WPS"; "winword"="Word"; "excel"="Excel"; "powerpnt"="PPT";
  "potplayer"="Video"; "obs64"="OBS"; "photoshop"="PS"
}

$last = ""; $lastPing = 0
Write-Host "电脑眼开了，默默盯着你在用啥… (关掉这个窗口 = 收工)"
while ($true) {
  Start-Sleep -Seconds 20
  if ([Win]::IdleMs() -gt ($IDLEMAX * 1000)) { continue }     # 你走开了,不上报
  $p = [Win]::Fg(); if (-not $p) { continue }
  $k = $p.ToLower()
  if ($map.ContainsKey($k)) { $app = $map[$k] } else { $app = $p }
  $now = [int][DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
  if ($app -ne $last -or ($now - $lastPing) -gt $REFRESH) {
    $u = "http://${VPS}:${PORT}/a?token=${TOKEN}&app=" + [uri]::EscapeDataString("PC-$app")
    try { Invoke-RestMethod -Uri $u -TimeoutSec 8 | Out-Null; Write-Host ("  -> 上报: PC-$app") } catch {}
    $last = $app; $lastPing = $now
  }
}
