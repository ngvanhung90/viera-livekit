"""Rebuild original sample assets. Build-time only: Python + Pillow + FFmpeg."""
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path
import math, wave, struct, subprocess, argparse

args=argparse.ArgumentParser();args.add_argument('--ffmpeg',default='ffmpeg');opts=args.parse_args()
root=Path(__file__).resolve().parent.parent
assets=root/'assets';frames=root/'work'/'dance-frames';frames.mkdir(parents=True,exist_ok=True)
font_dir=Path('C:/Windows/Fonts')
font=lambda n:ImageFont.truetype(str(font_dir/'arialbd.ttf'),n)
W,H=960,540
palette={'thanks-card':('#20223c','#c6f176','YOU MAKE IT SHINE','Thank you for being here'), 'laugh-card':('#30213d','#ff9bbf','PLOT TWIST','Every stream needs a little chaos'), 'victory-card':('#1f2940','#a899ff','SMALL WIN. BIG ENERGY.','A moment worth celebrating'), 'community-card':('#182f30','#c6f176','YOU BELONG HERE','Welcome to the community')}
for name,(bg,accent,title,sub) in palette.items():
 im=Image.new('RGB',(W,H),bg);d=ImageDraw.Draw(im)
 for x in range(20,W,80):d.line((x,0,x,H),fill='#35384a',width=1)
 for y in range(20,H,80):d.line((0,y,W,y),fill='#35384a',width=1)
 d.rounded_rectangle((55,55,905,485),radius=30,outline=accent,width=3)
 d.text((W/2,225),title,font=font(44),anchor='mm',fill=accent)
 d.text((W/2,300),sub,font=font(25),anchor='mm',fill='white')
 d.text((W/2,420),'VIERA LIVEKIT',font=font(17),anchor='mm',fill='#a8abba')
 im.save(assets/(name+'.png'))

sr=48000
for name in ['chime','boing','levelup','pop']:
 samples=[];phase=0
 for i in range(sr*2):
  t=i/sr
  if name=='boing':
   freq=90+560*math.exp(-3*t);env=math.exp(-3*t)*min(1,t*50);amp=math.sin(phase)*env
  elif name=='pop':
   local=t%0.4;freq=300+900*math.exp(-18*local);amp=math.sin(phase)*math.exp(-20*local)*min(1,local*200)
  else:
   notes=[523.25,659.25,783.99,1046.5] if name=='chime' else [392,493.88,587.33,783.99,987.77]
   step=.27;index=min(int(t/step),len(notes)-1);local=t-index*step;freq=notes[index]
   env=math.exp(-5*local)*min(1,local*100) if t<step*len(notes) else 0
   amp=(math.sin(phase)+.22*math.sin(phase*2))*env
  phase+=2*math.pi*freq/sr;samples.append(struct.pack('<h',int(max(-1,min(1,amp*.23))*32767)))
 with wave.open(str(assets/(name+'.wav')),'wb') as wav:wav.setparams((1,2,sr,0,'NONE','not compressed'));wav.writeframes(b''.join(samples))

for index in range(180):
 t=index/30;im=Image.new('RGB',(W,H),'#1b1932');d=ImageDraw.Draw(im)
 for j in range(22):
  x=(j*137+math.sin(t+j)*35)%W;y=(j*83+t*35)%H
  d.ellipse((x,y,x+5,y+5),fill=['#c6f176','#a899ff','#ff9bbf'][j%3])
 bounce=math.sin(t*6)*18;cx=480+math.sin(t*3)*70;cy=270+bounce
 d.ellipse((cx-35,cy-90,cx+35,cy-20),fill='#c6f176')
 d.line((cx,cy-15,cx,cy+70),fill='#a899ff',width=24)
 for side in [-1,1]:
  swing=math.sin(t*6+side)*45
  d.line((cx,cy+5,cx+side*90,cy-30+swing),fill='#ff9bbf',width=17)
  d.line((cx,cy+65,cx+side*65,cy+140+side*math.sin(t*6)*25),fill='#a899ff',width=19)
 d.text((W/2,65),'VICTORY DANCE',font=font(40),anchor='mm',fill='white')
 d.text((W/2,475),'A tiny dance. A shared win.',font=font(25),anchor='mm',fill='#c6f176')
 im.save(frames/f'{index:04}.png')
subprocess.run([opts.ffmpeg,'-hide_banner','-loglevel','error','-y','-framerate','30','-i',str(frames/'%04d.png'),'-i',str(assets/'chime.wav'),'-af','apad','-t','6','-c:v','libx264','-pix_fmt','yuv420p','-preset','fast','-c:a','aac','-movflags','+faststart',str(assets/'victory-dance.mp4')],check=True)
print('Created 1 original MP4, 4 WAV sounds and 4 PNG cards; cosmic MP4 is generated separately.')
