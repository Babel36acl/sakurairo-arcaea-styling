from PIL import Image,ImageChops
import numpy as np
for pair in [('desktop-1272-reference-card-v3.png','desktop-1272-candidate-card-v3.png')]:
 a=np.asarray(Image.open('reports/visual/phase2/v2/'+pair[0]).convert('RGB')).astype(int);b=np.asarray(Image.open('reports/visual/phase2/v2/'+pair[1]).convert('RGB')).astype(int);d=np.abs(a-b);print('mean',d.mean(),'pct<2',((d.max(2)<2).mean()*100),'pct<5',((d.max(2)<5).mean()*100),'pct<10',((d.max(2)<10).mean()*100));Image.fromarray(np.abs(a-b).clip(0,255).astype('uint8')).save('reports/visual/phase2/v2/desktop-1272-diff-v3.png')
