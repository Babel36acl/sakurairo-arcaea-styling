import json
from pathlib import Path
for line in Path('reports/visual/phase2/phase2b-runtime-final2.jsonl').read_text().splitlines():
 label,raw=line.split(' ',1); data=json.loads(raw); print(label)
 for s in data:
  print(s['name'],[(i['class'],i['opacity'],i['contentVisibility'],i['animationName'],i['rect']['y']) for i in s['items']])
