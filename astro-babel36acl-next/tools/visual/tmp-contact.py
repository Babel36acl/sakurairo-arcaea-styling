from PIL import Image,ImageDraw
from pathlib import Path
p=Path('public/assets/gallery'); files=[f for f in p.iterdir() if f.suffix.lower() in ['.jpg','.png']]
thumbs=[]
for f in files:
 im=Image.open(f).convert('RGB'); im.thumbnail((200,100)); thumbs.append((f.name,im.copy()))
out=Image.new('RGB',(600,((len(thumbs)+2)//3)*140),(30,30,30)); d=ImageDraw.Draw(out)
for i,(name,im) in enumerate(thumbs): x=(i%3)*200;y=(i//3)*140;out.paste(im,(x,y));d.text((x+4,y+105),name,fill='white')
out.save('reports/visual/phase2/gallery-contact.jpg')
