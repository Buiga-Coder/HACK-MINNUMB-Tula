"""One-time, sequential Nominatim lookup. Cached; max one request per second.
Only explicit --fetch permits network. Results are candidates, never verified locations.
"""
import argparse,json,time,urllib.request,urllib.parse
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('--fetch',action='store_true');args=p.parse_args()
queries=json.loads((ROOT/'data/geocoding-queries.json').read_text())
cachefile=ROOT/'data/geocoding-cache.json'
cache=json.loads(cachefile.read_text()) if cachefile.exists() else {}
out={};last=0
for rid,variants in queries.items():
    for query in variants:
        if query not in cache:
            if not args.fetch:continue
            time.sleep(max(0,1.1-(time.monotonic()-last)))
            url='https://nominatim.openstreetmap.org/search?'+urllib.parse.urlencode({'q':query,'format':'jsonv2','limit':3,'countrycodes':'ru','viewbox':'35.89,54.86,38.96,52.94','bounded':1,'addressdetails':1})
            request=urllib.request.Request(url,headers={'User-Agent':'TulaHackathonMap/1.0 (one-time archive geocoding)','Accept-Language':'ru'})
            try:
                last=time.monotonic()
                with urllib.request.urlopen(request,timeout=20) as response:cache[query]=json.load(response)
            except Exception as e:
                print('ERROR',rid,query,str(e),flush=True);continue
            cachefile.write_text(json.dumps(cache,ensure_ascii=False,indent=2)+'\n')
        found=[r for r in cache[query] if 'Тульская область' in r.get('display_name','')]
        if not found:continue
        r=found[0];rank=r.get('place_rank',0)
        precision='адрес/объект' if rank>=28 else 'улица/территория' if rank>=22 else 'населённый пункт/район'
        out['archive-'+rid]={'lat':float(r['lat']),'lon':float(r['lon']),'query':query,'displayName':r['display_name'],'precision':precision,'osmType':r['osm_type'],'osmId':r['osm_id'],'url':f'https://www.openstreetmap.org/{r["osm_type"]}/{r["osm_id"]}','source':'OpenStreetMap / Nominatim','retrievedAt':'2026-09-13','requiresVerification':True,'candidateCount':len(found)}
        print(rid,precision,r['display_name'],flush=True);break
    (ROOT/'data/geocoding-candidates.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n')
print('Candidates:',len(out),'of',len(queries),flush=True)
