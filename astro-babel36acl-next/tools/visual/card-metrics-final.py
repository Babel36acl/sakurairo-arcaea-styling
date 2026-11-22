from PIL import Image
import numpy as np
from pathlib import Path
r=Path('reports/visual/phase2');a=np.asarray(Image.open(r/'mobile-390-reference-card-v5.png').convert('RGB')).astype(int);b=np.asarray(Image.open(r/'mobile-390-candidate-card-v6.png').convert('RGB')).astype(int);d=np.abs(a-b);print('mean',round(float(d.mean()),3),'pct<2',round(float((d.max(2)<2).mean()*100),2),'pct<5',round(float((d.max(2)<5).mean()*100),2),'pct<10',round(float((d.max(2)<10).mean()*100),2));Image.fromarray(np.abs(a-b).clip(0,255).astype('uint8')).save(r/'mobile-390-diff-v6.png')
