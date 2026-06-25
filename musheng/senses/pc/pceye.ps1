# Musheng PC-Eye (token pre-filled, pure ASCII, no editing needed).
# Run it from a PowerShell window. Close the window to stop.

$TOKEN   = "_aDShLYi3IcrdA3GKGxS9A"
$VPS     = "207.148.113.28"
$PORT    = 8787
$IDLEMAX = 300
$REFRESH = 240

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
  public static string Fg(){ try{ IntPtr h=GetForegroundWindow(); uint pid; GetWindowThreadProcessId(h,out pid); if(pid==0) return ""; return Process.GetProcessById((int)pid).ProcessName; }catch{ return ""; } }
}
"@

$map = @{
  "steam"="Steam"; "wechat"="WeChat"; "weixin"="WeChat"; "qq"="QQ"; "tim"="TIM";
  "chrome"="Browser"; "msedge"="Browser"; "firefox"="Browser";
  "code"="VSCode"; "explorer"="Files"; "cloudmusic"="Music"; "qqmusic"="Music";
  "winword"="Word"; "excel"="Excel"; "powerpnt"="PPT"; "wpsoffice"="WPS";
  "potplayer"="Video"; "obs64"="OBS"; "photoshop"="PS"
}

$last = ""; $lastPing = 0
Write-Host "PC-Eye running. Close this window to stop."
while ($true) {
  Start-Sleep -Seconds 15
  if ([Win]::IdleMs() -gt ($IDLEMAX * 1000)) { continue }
  $p = [string]([Win]::Fg())
  if ([string]::IsNullOrEmpty($p)) { continue }
  $k = $p.ToLower()
  if ($map.ContainsKey($k)) { $app = $map[$k] } else { $app = $p }
  $now = [int][DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
  if ($app -ne $last -or ($now - $lastPing) -gt $REFRESH) {
    $u = "http://${VPS}:${PORT}/a?token=${TOKEN}&app=" + [uri]::EscapeDataString("PC-$app")
    try { Invoke-RestMethod -Uri $u -TimeoutSec 8 | Out-Null; Write-Host ("  sent  PC-" + $app) }
    catch { Write-Host ("  FAILED: " + $_.Exception.Message) }
    $last = $app; $lastPing = $now
  }
}
