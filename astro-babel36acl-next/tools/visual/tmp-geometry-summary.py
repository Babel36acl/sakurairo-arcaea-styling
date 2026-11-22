import json
from pathlib import Path
for line in Path('reports/visual/phase2/phase2b-geometry-final.jsonl').read_text().splitlines():
 d=json.loads(line); print('\n',d['viewport'])
 for s in ['#content','#primary','#main','.main-title','.post-list-thumb','.post-thumb','.post-date','.post-meta','.post-title','.post-excerpt','#pagination']:
  a=d['reference'].get(s,[]);b=d['candidate'].get(s,[])
  if a and b:
   print(s,'ref',a[0],'cand',b[0],'delta', {k:round(b[0][k]-a[0][k],3) for k in ['x','y','w','h']})
