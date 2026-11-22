from PIL import Image
import numpy as np
from pathlib import Path
root=Path('reports/visual/phase2')
for n in ['mobile-390','tablet-768','desktop-1272','desktop-1440']:
 a=np.asarray(Image.open(root/f'{n}-reference-card-v4.png').convert('RGB')).astype(int);b=np.asarray(Image.open(root/f'{n}-candidate-card-v4.png').convert('RGB')).astype(int);d=np.abs(a-b);print(n,'mean',round(float(d.mean()),3),'pct<2',round(float((d.max(2)<2).mean()*100),2),'pct<5',round(float((d.max(2)<5).mean()*100),2),'pct<10',round(float((d.max(2)<10).mean()*100),2))
