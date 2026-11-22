from PIL import Image
import numpy as np
from pathlib import Path
r=Path('reports/visual/phase2/v2')
a=np.asarray(Image.open(r/'desktop-1272-reference-card-v4.png').convert('RGB')).astype(int);b=np.asarray(Image.open(r/'desktop-1272-candidate-card-v4.png').convert('RGB')).astype(int);d=np.abs(a-b);print(a.shape,'mean',d.mean(),'pct<2',((d.max(2)<2).mean()*100),'pct<5',((d.max(2)<5).mean()*100),'pct<10',((d.max(2)<10).mean()*100));Image.fromarray(np.abs(a-b).clip(0,255).astype('uint8')).save(r/'desktop-1272-diff-v4.png')
