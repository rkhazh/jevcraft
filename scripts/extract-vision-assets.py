"""Extract local client block assets for private bot-eye rendering; never downloads."""
import argparse,json,zipfile
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--client-jar',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
with zipfile.ZipFile(a.client_jar) as z:
 version=json.loads(z.read('version.json'))['id']
 if version!='1.21.11':raise SystemExit('Only verified 1.21.11 client assets supported')
 wanted=[n for n in z.namelist() if n.startswith(('assets/minecraft/textures/block/','assets/minecraft/models/block/','assets/minecraft/blockstates/')) and n.endswith(('.json','.png'))]
 if len(wanted)>20000 or sum(z.getinfo(n).file_size for n in wanted)>100_000_000:raise SystemExit('Asset bounds exceeded')
 a.output.mkdir(parents=True,exist_ok=True)
 for n in wanted:
  if '..' in Path(n).parts:raise SystemExit('Invalid asset path')
  dest=a.output/n;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(z.read(n))
 (a.output/'manifest.json').write_text(json.dumps({'version':version,'source':'installed Minecraft client assets','files':len(wanted)}))
 print(f'Extracted {len(wanted)} local block assets for {version}')
