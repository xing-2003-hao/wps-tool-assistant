# ============================================================
# WPS Tool Assistant - app icon generator
# Produces assets/app.ico (multi-size) + site/favicon.ico + server/favicon.ico
# Usage: powershell -ExecutionPolicy Bypass -File scripts/make-icon.ps1
# NOTE: keep this file ASCII-only (Windows PowerShell 5.1 reads no-BOM as ANSI)
# ============================================================
Add-Type -AssemblyName System.Drawing

$root = $PSScriptRoot | Split-Path -Parent
$assets = Join-Path $root 'assets'
New-Item -ItemType Directory -Force -Path $assets | Out-Null

$sizes = @(256, 128, 64, 48, 32, 16)

function New-RoundedPath([single]$w, [single]$h, [single]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = [single]($r * 2)
  $p.AddArc(0, 0, $d, $d, 180, 90)
  $p.AddArc(($w - $d), 0, $d, $d, 270, 90)
  $p.AddArc(($w - $d), ($h - $d), $d, $d, 0, 90)
  $p.AddArc(0, ($h - $d), $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

function New-IconPng([int]$s, [string]$outFile) {
  $bmp = New-Object System.Drawing.Bitmap($s, $s, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.Clear([System.Drawing.Color]::Transparent)

  $path = New-RoundedPath $s $s ([single]($s * 0.225))

  # base gradient: light blue -> deep blue (matches admin UI #185fa5)
  $c1 = [System.Drawing.Color]::FromArgb(255, 62, 148, 224)
  $c2 = [System.Drawing.Color]::FromArgb(255, 16, 71, 124)
  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.Point(0, 0)),
    (New-Object System.Drawing.Point($s, $s)), $c1, $c2)
  $g.FillPath($brush, $path)

  # top gloss for depth (full height fade -> no hard edge)
  $glossRect = New-Object System.Drawing.Rectangle(0, 0, $s, $s)
  $gTop = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    $glossRect,
    [System.Drawing.Color]::FromArgb(58, 255, 255, 255),
    [System.Drawing.Color]::FromArgb(0, 255, 255, 255),
    [System.Drawing.Drawing2D.LinearGradientMode]::Vertical)
  $gTop.SetSigmaBellShape([single]0.35, [single]1.0)
  $oldClip = $g.Clip
  $g.SetClip($path)
  $g.FillRectangle($gTop, $glossRect)
  $g.Clip = $oldClip

  # letter W
  $fs = [single]($s * 0.62)
  if ($s -le 32) { $fs = [single]($s * 0.70) }
  $font = New-Object System.Drawing.Font("Segoe UI", $fs, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $sf = New-Object System.Drawing.StringFormat
  $sf.Alignment = [System.Drawing.StringAlignment]::Center
  $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
  $rect = New-Object System.Drawing.RectangleF(0, [single]($s * 0.02), [single]$s, [single]$s)
  $g.DrawString("W", $font, [System.Drawing.Brushes]::White, $rect, $sf)

  $font.Dispose(); $brush.Dispose(); $gTop.Dispose(); $g.Dispose()
  $bmp.Save($outFile, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}

# render pngs
$tmp = Join-Path $env:TEMP 'wta-icon'
if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

$entries = @()
foreach ($s in $sizes) {
  $f = Join-Path $tmp ("icon-$s.png")
  New-IconPng $s $f
  $entries += [pscustomobject]@{ Size = $s; File = $f; Bytes = [System.IO.File]::ReadAllBytes($f) }
}

# pack ICO (PNG-compressed entries, Vista+)
$icoPath = Join-Path $assets 'app.ico'
$fsIco = [System.IO.File]::Create($icoPath)
$bw = New-Object System.IO.BinaryWriter($fsIco)
$bw.Write([UInt16]0); $bw.Write([UInt16]1); $bw.Write([UInt16]$entries.Count)
$offset = 6 + 16 * $entries.Count
foreach ($e in $entries) {
  if ($e.Size -ge 256) { $dim = [byte]0 } else { $dim = [byte]$e.Size }
  $bw.Write($dim); $bw.Write($dim)
  $bw.Write([byte]0); $bw.Write([byte]0)
  $bw.Write([UInt16]1); $bw.Write([UInt16]32)
  $bw.Write([UInt32]$e.Bytes.Length); $bw.Write([UInt32]$offset)
  $offset += $e.Bytes.Length
}
foreach ($e in $entries) { $bw.Write($e.Bytes) }
$bw.Flush(); $bw.Close(); $fsIco.Close()

# favicons (16+32+48 ico is enough, reuse the same packed ico)
Copy-Item $icoPath (Join-Path $root 'site\favicon.ico') -Force
Copy-Item $icoPath (Join-Path $root 'server\favicon.ico') -Force
# png preview / apple-touch icon
Copy-Item (Join-Path $tmp 'icon-256.png') (Join-Path $assets 'icon-256.png') -Force
Copy-Item (Join-Path $tmp 'icon-256.png') (Join-Path $root 'site\icon-256.png') -Force

$kb = [math]::Round((Get-Item $icoPath).Length / 1KB, 1)
Write-Host "[OK] assets/app.ico ($kb KB, $($entries.Count) sizes)"
Write-Host "[OK] site/favicon.ico, server/favicon.ico, site/icon-256.png"
