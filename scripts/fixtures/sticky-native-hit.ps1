# The parent fixture provides only its own HWND, PID, and known DOM point coordinates.
$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class StickyHitAudit {
 [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
 [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint process);
 [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
 [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT rect);
 [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT point);
 [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr SendMessageTimeout(IntPtr h, uint message, IntPtr wp, IntPtr lp, uint flags, uint timeout, out UIntPtr result);
}
"@
$ownWindow = [IntPtr]$OwnWindowHandle
[uint32]$actualProcess = 0
[void][StickyHitAudit]::GetWindowThreadProcessId($ownWindow, [ref]$actualProcess)
if ($actualProcess -ne $ExpectedProcess) { throw 'HWND does not belong to this fixture' }
if ([StickyHitAudit]::IsWindowVisible($ownWindow)) { throw 'Fixture must stay invisible' }
$geometry = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($FixtureGeometry)) | ConvertFrom-Json
# Use physical client pixels even when this monitor uses Windows display scaling.
$previousDpi = [StickyHitAudit]::SetThreadDpiAwarenessContext([IntPtr](-4))
if ($previousDpi -eq [IntPtr]::Zero) { throw 'Could not establish physical client coordinates' }
try {
  $client = New-Object StickyHitAudit+RECT
  if (-not [StickyHitAudit]::GetClientRect($ownWindow, [ref]$client)) { throw 'Missing client geometry' }
  $results = foreach ($sample in $geometry.points) {
    [void][StickyHitAudit]::GetWindowThreadProcessId($ownWindow, [ref]$actualProcess)
    if ($actualProcess -ne $ExpectedProcess) { throw 'HWND ownership changed' }
    if ([StickyHitAudit]::IsWindowVisible($ownWindow)) { throw 'Fixture became visible' }
    $point = New-Object StickyHitAudit+POINT
    $point.X = [Math]::Round($sample.x * ($client.Right - $client.Left) / $geometry.width)
    $point.Y = [Math]::Round($sample.y * ($client.Bottom - $client.Top) / $geometry.height)
    if (-not [StickyHitAudit]::ClientToScreen($ownWindow, [ref]$point)) { throw 'Missing client origin' }
    $packed = ([long]($point.Y -band 65535) -shl 16) -bor ($point.X -band 65535)
    [UIntPtr]$hit = [UIntPtr]::Zero
    $ok = [StickyHitAudit]::SendMessageTimeout($ownWindow, 0x84, [IntPtr]::Zero, [IntPtr]$packed, 2, 3000, [ref]$hit)
    [pscustomobject]@{
      name = $sample.name
      hit = $hit.ToUInt64()
      callSucceeded = $ok -ne [IntPtr]::Zero
      visible = [StickyHitAudit]::IsWindowVisible($ownWindow)
      owner = $actualProcess
    }
  }
  $results | ConvertTo-Json -Depth 3
} finally {
  [void][StickyHitAudit]::SetThreadDpiAwarenessContext($previousDpi)
}
