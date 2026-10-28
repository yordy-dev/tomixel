Add-Type -AssemblyName System.Drawing

$projectRoot = Split-Path -Parent $PSScriptRoot
$buildDirectory = Join-Path $projectRoot 'build'
$publicDirectory = Join-Path $projectRoot 'public'
New-Item -ItemType Directory -Force -Path $buildDirectory,$publicDirectory | Out-Null

function New-TomixelBitmap([int]$size) {
  $bitmap = [System.Drawing.Bitmap]::new($size,$size,[System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.Clear([System.Drawing.Color]::Transparent)

  $scale = $size / 256.0
  $margin = [float](8 * $scale)
  $corner = [float](60 * $scale)
  $diameter = [float](2 * $corner)
  $edge = [float]($size - $margin)
  $shape = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $shape.AddArc($margin,$margin,$diameter,$diameter,180,90)
  $shape.AddArc($edge - $diameter,$margin,$diameter,$diameter,270,90)
  $shape.AddArc($edge - $diameter,$edge - $diameter,$diameter,$diameter,0,90)
  $shape.AddArc($margin,$edge - $diameter,$diameter,$diameter,90,90)
  $shape.CloseFigure()

  $coral = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#F56549'))
  $graphics.FillPath($coral,$shape)

  $lineWidth = [float][Math]::Max(1.35,18 * $scale)
  $capturePen = [System.Drawing.Pen]::new([System.Drawing.Color]::White,$lineWidth)
  $capturePen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $capturePen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $capturePen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $p60 = [float](60 * $scale); $p68 = [float](68 * $scale); $p96 = [float](96 * $scale)
  $p160 = [float](160 * $scale); $p188 = [float](188 * $scale); $p196 = [float](196 * $scale)
  $graphics.DrawLine($capturePen,$p60,$p96,$p60,$p68)
  $graphics.DrawLine($capturePen,$p60,$p68,$p96,$p68)
  $graphics.DrawLine($capturePen,$p160,$p68,$p196,$p68)
  $graphics.DrawLine($capturePen,$p196,$p68,$p196,$p96)
  $graphics.DrawLine($capturePen,$p60,$p160,$p60,$p188)
  $graphics.DrawLine($capturePen,$p60,$p188,$p96,$p188)
  $graphics.DrawLine($capturePen,$p160,$p188,$p196,$p188)
  $graphics.DrawLine($capturePen,$p196,$p188,$p196,$p160)

  $recordBrush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#C9362F'))
  $recordPen = [System.Drawing.Pen]::new([System.Drawing.Color]::White,[float][Math]::Max(1.2,9 * $scale))
  $recordX = [float](98 * $scale); $recordSize = [float](60 * $scale)
  $graphics.FillEllipse($recordBrush,$recordX,$recordX,$recordSize,$recordSize)
  $graphics.DrawEllipse($recordPen,$recordX,$recordX,$recordSize,$recordSize)

  $recordPen.Dispose()
  $recordBrush.Dispose()
  $capturePen.Dispose()
  $coral.Dispose()
  $shape.Dispose()
  $graphics.Dispose()
  return $bitmap
}

# Electron uses this PNG for the window and tray. A 512 px master keeps the
# source crisp while Chromium/Windows select their own display size.
$publicBitmap = New-TomixelBitmap 512
$publicBitmap.Save((Join-Path $publicDirectory 'icon.png'),[System.Drawing.Imaging.ImageFormat]::Png)
$publicBitmap.Dispose()

# Windows icons need real small-size frames. Supplying only a 256 px PNG makes
# the shell rescale it and produces the pixelated result reported by the user.
$sizes = @(16,20,24,32,40,48,64,128,256)
$entries = @()
foreach ($size in $sizes) {
  $bitmap = New-TomixelBitmap $size
  $memory = [System.IO.MemoryStream]::new()
  $bitmap.Save($memory,[System.Drawing.Imaging.ImageFormat]::Png)
  $entries += [pscustomobject]@{ Size = $size; Bytes = $memory.ToArray() }
  $memory.Dispose()
  $bitmap.Dispose()
}

$iconStream = [System.IO.File]::Create((Join-Path $buildDirectory 'icon.ico'))
$writer = [System.IO.BinaryWriter]::new($iconStream)
$writer.Write([uint16]0)
$writer.Write([uint16]1)
$writer.Write([uint16]$entries.Count)
$offset = 6 + (16 * $entries.Count)
foreach ($entry in $entries) {
  $dimension = if ($entry.Size -ge 256) { [byte]0 } else { [byte]$entry.Size }
  $writer.Write($dimension)
  $writer.Write($dimension)
  $writer.Write([byte]0)
  $writer.Write([byte]0)
  $writer.Write([uint16]1)
  $writer.Write([uint16]32)
  $writer.Write([uint32]$entry.Bytes.Length)
  $writer.Write([uint32]$offset)
  $offset += $entry.Bytes.Length
}
foreach ($entry in $entries) { $writer.Write([byte[]]$entry.Bytes) }
$writer.Dispose()
