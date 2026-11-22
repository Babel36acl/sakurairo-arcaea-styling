from PIL import Image,ImageChops
from pathlib import Path
root=Path('reports/visual/phase2/v2')
for name in ['mobile-390','tablet-768','desktop-1272','desktop-1440']:
    a=Image.open(root/f'{name}-reference-card.png').convert('RGB'); b=Image.open(root/f'{name}-candidate-card.png').convert('RGB')
    print(name,a.size,b.size)
    if a.size==b.size:
      d=ImageChops.difference(a,b)
      import numpy as np
      ar=np.asarray(a).astype(int); br=np.asarray(b).astype(int); diff=np.abs(ar-br)
      print(' mean',diff.mean(),'pct<2',((diff.max(axis=2)<2).mean()*100),'pct<5',((diff.max(axis=2)<5).mean()*100),'max',diff.max())
      d.save(root/f'{name}-diff.png')
