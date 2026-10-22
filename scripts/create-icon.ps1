param([switch]$Preview)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Add-Type -AssemblyName System.Drawing

$projectDirectory = Split-Path -Parent $PSScriptRoot
$sourcePath = Join-Path $projectDirectory 'public/yuanjian.png'
$pngPath = Join-Path $projectDirectory 'public/app-icon.png'
$icoPath = Join-Path $projectDirectory 'build/icon.ico'
$sourceHash = (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash
$approvedHash = '6C9E3D537E9B1FA911ED2263EE4B9FE3444A4A63A10470E23B4F94FE6EFFFAE9'
if ($sourceHash -ne $approvedHash) { throw 'The approved iris source PNG has changed.' }
$sizes = @(16, 20, 24, 32, 40, 48, 64, 128, 256)
$frames = @{}
$sourceBitmap = [System.Drawing.Bitmap]::new($sourcePath)
try {
    if ($sourceBitmap.Width -ne $sourceBitmap.Height) { throw 'Expected a square source PNG.' }
    # Match the approved prototype's 47px image in a centered 31px viewport.
    $cropSize = [single]($sourceBitmap.Width * 31 / 47)
    $cropOffset = [single](($sourceBitmap.Width - $cropSize) / 2)
    $sourceRectangle = [System.Drawing.RectangleF]::new($cropOffset, $cropOffset, $cropSize, $cropSize)
    foreach ($size in $sizes) {
        $bitmap = [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        $attributes = [System.Drawing.Imaging.ImageAttributes]::new()
        $stream = [System.IO.MemoryStream]::new()
        try {
            $graphics.Clear([System.Drawing.Color]::Transparent)
            $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
            $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
            $attributes.SetWrapMode([System.Drawing.Drawing2D.WrapMode]::TileFlipXY)
            # A small transparent inset keeps the approved petal tips clear of icon edges.
            $inset = [int][Math]::Max(1, [Math]::Round($size * 0.03))
            $destination = [System.Drawing.Rectangle]::new($inset, $inset, $size - 2 * $inset, $size - 2 * $inset)
            $graphics.DrawImage($sourceBitmap, $destination, $sourceRectangle.X, $sourceRectangle.Y, $sourceRectangle.Width, $sourceRectangle.Height, [System.Drawing.GraphicsUnit]::Pixel, $attributes)
            $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
            $frames[$size] = $stream.ToArray()
        } finally {
            $stream.Dispose()
            $attributes.Dispose()
            $graphics.Dispose()
            $bitmap.Dispose()
        }
    }
} finally { $sourceBitmap.Dispose() }

[System.IO.File]::WriteAllBytes($pngPath, $frames[256])
$writer = [System.IO.BinaryWriter]::new([System.IO.File]::Create($icoPath))
try {
    $writer.Write([uint16]0)
    $writer.Write([uint16]1)
    $writer.Write([uint16]$sizes.Count)
    $offset = 6 + 16 * $sizes.Count
    foreach ($size in $sizes) {
        $dimension = if ($size -eq 256) { 0 } else { $size }
        $writer.Write([byte]$dimension)
        $writer.Write([byte]$dimension)
        $writer.Write([byte]0)
        $writer.Write([byte]0)
        $writer.Write([uint16]1)
        $writer.Write([uint16]32)
        $writer.Write([uint32]$frames[$size].Length)
        $writer.Write([uint32]$offset)
        $offset += $frames[$size].Length
    }
    foreach ($size in $sizes) { $writer.Write([byte[]]$frames[$size]) }
} finally { $writer.Dispose() }

# Check the actual ICO directory and embedded images, rather than only its filename.
$reader = [System.IO.BinaryReader]::new([System.IO.File]::OpenRead($icoPath))
try {
    if ($reader.ReadUInt16() -ne 0 -or $reader.ReadUInt16() -ne 1 -or $reader.ReadUInt16() -ne $sizes.Count) { throw 'Invalid ICO header.' }
    foreach ($size in $sizes) {
        $width = $reader.ReadByte()
        $height = $reader.ReadByte()
        if ($width -eq 0) { $width = 256 }
        if ($height -eq 0) { $height = 256 }
        $null = $reader.ReadUInt16()
        $planes = $reader.ReadUInt16()
        $bits = $reader.ReadUInt16()
        $length = $reader.ReadUInt32()
        $frameOffset = $reader.ReadUInt32()
        if ($width -ne $size -or $height -ne $size -or $planes -ne 1 -or $bits -ne 32) { throw "Invalid ICO entry: $size" }
        $directoryPosition = $reader.BaseStream.Position
        $reader.BaseStream.Position = $frameOffset
        $frameStream = [System.IO.MemoryStream]::new($reader.ReadBytes($length))
        $frameBitmap = [System.Drawing.Bitmap]::new($frameStream)
        try {
            if ($frameBitmap.Width -ne $size -or $frameBitmap.Height -ne $size) { throw "Invalid embedded PNG: $size" }
            if ($frameBitmap.GetPixel(0, 0).A -ne 0 -or $frameBitmap.GetPixel($size - 1, 0).A -ne 0 -or $frameBitmap.GetPixel(0, $size - 1).A -ne 0 -or $frameBitmap.GetPixel($size - 1, $size - 1).A -ne 0) { throw "Opaque ICO corner: $size" }
            if ($frameBitmap.GetPixel([int]($size / 2), [int]($size / 2)).A -lt 128) { throw "Empty ICO center: $size" }
        } finally { $frameBitmap.Dispose(); $frameStream.Dispose() }
        $reader.BaseStream.Position = $directoryPosition
    }
} finally { $reader.Dispose() }
if ((Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash -ne $sourceHash) { throw 'Source PNG was modified.' }

if ($Preview) {
    $previewPath = Join-Path $projectDirectory 'artifacts/icon-sizes-preview.png'
    $null = New-Item -ItemType Directory -Path (Split-Path -Parent $previewPath) -Force
    $previewBitmap = [System.Drawing.Bitmap]::new(944, 700)
    $previewGraphics = [System.Drawing.Graphics]::FromImage($previewBitmap)
    $labelFont = [System.Drawing.Font]::new('Segoe UI', 11)
    $headingFont = [System.Drawing.Font]::new('Segoe UI', 15)
    try {
        foreach ($mode in @('light', 'dark')) {
            $top = if ($mode -eq 'light') { 0 } else { 350 }
            $background = if ($mode -eq 'light') { '#FCFCFC' } else { '#191919' }
            $foreground = if ($mode -eq 'light') { '#202020' } else { '#EEEEEE' }
            $backgroundBrush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml($background))
            $foregroundBrush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml($foreground))
            try {
                $previewGraphics.FillRectangle($backgroundBrush, 0, $top, 944, 350)
                $previewGraphics.DrawString("Yuanjian / $mode / original iris, native pixel sizes", $headingFont, $foregroundBrush, 20, $top + 15)
                $left = 20
                foreach ($size in $sizes) {
                    $frameStream = [System.IO.MemoryStream]::new([byte[]]$frames[$size])
                    $frameBitmap = [System.Drawing.Bitmap]::new($frameStream)
                    try {
                        $previewGraphics.DrawImageUnscaled($frameBitmap, $left + 12, $top + 52 + [int]((256 - $size) / 2))
                        $previewGraphics.DrawString("${size}px", $labelFont, $foregroundBrush, $left + 4, $top + 319)
                    } finally { $frameBitmap.Dispose(); $frameStream.Dispose() }
                    $left += $size + 28
                }
            } finally { $backgroundBrush.Dispose(); $foregroundBrush.Dispose() }
        }
        $previewBitmap.Save($previewPath, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally { $headingFont.Dispose(); $labelFont.Dispose(); $previewGraphics.Dispose(); $previewBitmap.Dispose() }
}

[PSCustomObject]@{ Png = $pngPath; Ico = $icoPath; Sizes = $sizes; SourceSha256 = $sourceHash; Preview = if ($Preview) { $previewPath } else { $null } }
