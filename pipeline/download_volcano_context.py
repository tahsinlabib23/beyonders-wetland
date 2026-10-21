"""Cache the attributed NASA Earth Observatory event images used by the viewer."""
import hashlib
import io
import json
from pathlib import Path
import requests
from PIL import Image
from network_retry import remote_call

ROOT=Path(__file__).resolve().parent.parent
DEST=ROOT/'public/volcanoes/imagery'
SOURCE='https://science.nasa.gov/earth/earth-observatory/hayli-gubbis-explosive-first-impression/'
PREFIX='https://assets.science.nasa.gov/dynamicimage/assets/science/esd/eo/images/iotd/2025/hayli-gubbi%E2%80%99s-explosive-first-impression/'
IMAGES=[('hayli-gubbi-modis-before-2025-11-15.jpg','ethiopia_hayligubbi_amo_20251115_lrg.jpg?crop=faces%2Cfocalpoint&fit=clip&h=960&w=1440','2025-11-15','Aqua MODIS'),
        ('hayli-gubbi-modis-eruption-2025-11-23.jpg','ethiopia_hayligubbi_amo_20251123_lrg.jpg?crop=faces%2Cfocalpoint&fit=clip&h=960&w=1440','2025-11-23','Aqua MODIS'),
        ('hayli-gubbi-landsat-2025-11-24.jpg','ethiopia_hayligubbi_oli2_20251124_lrg.jpg?crop=faces%2Cfocalpoint&fit=clip&h=2142&w=2631','2025-11-24','Landsat 9 OLI-2')]

def main():
    DEST.mkdir(parents=True,exist_ok=True)
    records=[]
    for filename,path,date,sensor in IMAGES:
        target=DEST/filename
        if not target.exists():
            def download():
                response=requests.get(PREFIX+path,timeout=60)
                response.raise_for_status()
                with Image.open(io.BytesIO(response.content)) as image:
                    image.verify()
                return response.content
            payload=remote_call(download)
            temporary=target.with_suffix('.tmp')
            temporary.write_bytes(payload)
            temporary.replace(target)
        records.append({'file':filename,'date':date,'sensor':sensor,'source_url':SOURCE,'asset_url':PREFIX+path,
                        'credit':'NASA Earth Observatory images by Michala Garrison; MODIS NASA EOSDIS LANCE/GIBS; Landsat USGS',
                        'role':'EVENT_CONTEXT_NOT_DEFORMATION_TRUTH','sha256':hashlib.sha256(target.read_bytes()).hexdigest()})
        print(filename,target.stat().st_size,flush=True)
    (DEST/'provenance.json').write_text(json.dumps(records,indent=2),encoding='utf-8')

if __name__=='__main__':
    main()
