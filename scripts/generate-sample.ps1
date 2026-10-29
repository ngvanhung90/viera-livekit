param([string]$Ffmpeg = 'ffmpeg')
$ErrorActionPreference = 'Stop'
$assetPath = Join-Path $PSScriptRoot '..\assets\cosmic-thanks.mp4'
$videoFilter = "drawgrid=w=80:h=80:t=1:c=0x2b3050,drawbox=x=100:y=90:w=760:h=360:c=0x35335d:t=4,drawtext=fontfile='C\:/Windows/Fonts/arialbd.ttf':text='YOU MADE IT SHINE':fontcolor=0xc6f176:fontsize=52:x=(w-tw)/2:y=200+30*sin(t*3),drawtext=fontfile='C\:/Windows/Fonts/arial.ttf':text='VIERA LIVEKIT':fontcolor=white:fontsize=26:x=(w-tw)/2:y=310,fade=t=in:d=0.4,fade=t=out:st=5.3:d=0.7"
& $Ffmpeg -hide_banner -loglevel error -y -f lavfi -i 'color=c=0x151729:s=960x540:r=30:d=6' -f lavfi -i 'sine=frequency=523.25:sample_rate=48000:duration=6' -vf $videoFilter -af 'volume=2,afade=t=in:d=0.1,afade=t=out:st=1:d=1' -c:v libx264 -pix_fmt yuv420p -preset fast -c:a aac -movflags +faststart $assetPath
if ($LASTEXITCODE -ne 0) { throw 'Sample generation failed' }
