import os, subprocess, sys
from PIL import Image
S='/tmp/claude-0/-home-claude/b6658191-c3ae-5f7e-87a8-9f7f1f240d76/scratchpad/zz/'
G='/tmp/claude-0/-home-claude/b6658191-c3ae-5f7e-87a8-9f7f1f240d76/scratchpad/gs/node_modules/gifsicle/vendor/gifsicle'
pre,out=sys.argv[1],sys.argv[2]
fr=[Image.open(S+f'{pre}{i}.png').convert('RGB') for i in range(1,6)]
W,H=fr[0].size; n=len(fr); hold=[3000]+[3500]*(n-1)
blank=Image.new('RGB',(W,H),'white'); border=fr[1]; bw=max(1,W//234)
def wb(img):
    o=img.copy()
    for box in [(0,0,W,bw),(0,H-bw,W,H),(0,0,bw,H),(W-bw,0,W,H)]: o.paste(border.crop(box),box[:2])
    return o
frames=[];durs=[]
for i,f in enumerate(fr):
    frames.append(f); durs.append(hold[i]); nxt=fr[(i+1)%n]
    for k in range(1,7): frames.append(wb(Image.blend(f,blank,k/6))); durs.append(40)
    for k in range(1,6): frames.append(wb(Image.blend(blank,nxt,k/6))); durs.append(40)
# own 256-colour palette for EVERY frame (GIF local colour tables): the
# still frames keep their exact text edges instead of sharing one palette
# with all the fade steps
q=[f.quantize(colors=256,method=Image.Quantize.MEDIANCUT,dither=Image.Dither.NONE) for f in frames]
q[0].save(S+'_t.gif',save_all=True,append_images=q[1:],duration=durs,loop=0,optimize=False,disposal=1)
subprocess.run([G,'-O2',S+'_t.gif','-o',S+out],check=True)
print(out,Image.open(S+out).size,os.path.getsize(S+out),sum(durs))
