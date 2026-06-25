# Musheng PC-Eye : report the foreground app to the presence endpoint as PC-<name>.
# Setup: put your token in $TOKEN below, save, then run via the .bat. Close window to stop.

$TOKEN   = "PUT-YOUR-TOKEN-HERE"
$VPS     = "207.148.113.28"
$PORT    = 8787
$IDLEMAX = 300    # away after 5 min with no keyboard/mouse -> don't report
$REFRESH = 240    # same app staying -> refresh presence every 4 min

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
  public static uint IdleMs(){ LII l=new LII(); l.cbSize=(uint)Marshal.SizeOf(typeof(LII)); GetLastInputInfo(ref l); return GetTickCount()-l.dwTime; }
  public static string Fg(){ IntPtr h=GetForegroundWindow(); uint pid; GetWindowThreadProcessId(h,out pid); try{ return Process.GetProcessById((int)pid).ProcessName; }catch{ return null; } }
}
"@

$map = @{
  "steam"="Steam"; "wechat"="WeChat"; "weixin"="WeChat"; "qq"="QQ"; "tim"="TIM";
  "chrome"="Browser"; "msedge"="Browser"; "firefox"="Browser";
  "code"="VSCode"; "windowsterminal"="Terminal"; "powershell"="Terminal";
  "explorer"="Files"; "douyin"="Douyin"; "cloudmusic"="Music"; "qqmusic"="Music";
  "wpsoffice"="WPS"; "winword"="Word"; "excel"="Excel"; "powerpnt"="PPT";
  "potplayer"="Video"; "obs64"="OBS"; "photoshop"="PS"
}

if ($TOKEN -eq "PUT-YOUR-TOKEN-HERE") {
  Write-Host "ERROR: open this file and set your token first (the `$TOKEN line)."
  Write-Host "Press Enter to exit."; Read-Host; exit
}

$last = ""; $lastPing = 0
Write-Host "PC-Eye running. Watching the foreground app. Close this window to stop."
while ($true) {
  Start-Sleep -Seconds 20
  if ([Win]::IdleMs() -gt ($IDLEMAX * 1000)) { continue }
  $p = [Win]::Fg(); if (-not $p) { continue }
  $k = $p.ToLower()
  if ($map.ContainsKey($k)) { $app = $map[$k] } else { $app = $p }
  $now = [int][DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
  if ($app -ne $last -or ($now - $lastPing) -gt $REFRESH) {
    $u = "http://${VPS}:${PORT}/a?token=${TOKEN}&app=" + [uri]::EscapeDataString("PC-$app")
    try {
      Invoke-RestMethod -Uri $u -TimeoutSec 8 | Out-Null
      Write-Host ("  -> sent  PC-" + $app)
    } catch {
      Write-Host ("  -> send FAILED: " + $_.Exception.Message)
    }
    $last = $app; $lastPing = $now
  }
}
