"""Reproducible local import; source values preserved; candidate geocoding is a separate, unverified layer."""
import csv, hashlib, json, re
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
APP=ROOT/'demo-v2'
SOURCE=ROOT/'data/source/social-objects.csv'

def normalized(s): return re.sub(r'[^а-яa-z0-9]', '', s.lower().replace('ё','е'))
def point_in_ring(lon,lat,ring):
    inside=False
    for (x,y),(xx,yy) in zip(ring,ring[1:]+ring[:1]):
        if (y>lat)!=(yy>lat) and lon < (xx-x)*(lat-y)/(yy-y)+x: inside=not inside
    return inside

def contains(f,lon,lat):
    polys=[f['geometry']['coordinates']] if f['geometry']['type']=='Polygon' else f['geometry']['coordinates']
    return any(point_in_ring(lon,lat,p[0]) and not any(point_in_ring(lon,lat,r) for r in p[1:]) for p in polys)

def clean(v): return None if v.strip() in ('','0','-') else v.strip()
def year(v): return int(v) if re.fullmatch(r'20\d{2}',v.strip()) else None

def main():
    geo=json.loads((APP/'geo/municipalities.geojson').read_text())
    dic=json.loads((APP/'js/catalog-dictionaries.json').read_text())
    rows=list(csv.reader(SOURCE.open(encoding='utf-8-sig',newline=''),delimiter=';'))
    heads=[s.strip() for s in rows[0]]
    heads[5:7]=['Широта','Долгота'];heads[29:33]=['ЗОС: дата','ЗОС: номер','Акт ввода: дата','Акт ввода: номер']
    names={f['properties']['id']:f['properties']['name'] for f in geo['features']}
    stems={'aleksinsky':'алексин','arsenyevsky':'арсеньев','belyovsky':'белев','bogoroditsky':'богородиц','venyovsky':'венев','volovsky':'волов','dubensky':'дубен','yefremovsky':'ефрем','zaoksky':'заок','kamensky':'камен','kimovsky':'кимов','kireyevsky':'киреев','kurkinsky':'куркин','odoyevsky':'одоев','plavsky':'плав','suvorovsky':'суворов','teplo_ogaryovsky':'тепло','uzlovsky':'узлов','chernsky':'черн','shchekinsky':'щекин','yasnogorsky':'ясногор','tula':'гтула','novomoskovsk':'новомосков','donskoy':'донской','novogurovsky':'новогур','slavny':'славн'}
    dic['sectors'].update({'construction':'Строительство','social':'Социальная политика','communications':'Связь и информатика','unknown':'Отрасль не указана'})
    dic['statuses']['unknown']='Статус требует уточнения'
    dic['ownership'].update({'state':'Государственная (уровень не указан)','unknown':'Не указана'})
    dic['stages']['unknown']='Этап не указан'
    sectors={'образование':'edu','здравоохранение':'health','физическаякультураиспорт':'sport','энергетика':'energy','культура':'culture','жилищнокоммунальноехозяйство':'infra','строительство':'construction','социальнаяполитика':'social','связьиинформатика':'communications'}
    candidates=json.loads((ROOT/'data/geocoding-candidates.json').read_text()) if (ROOT/'data/geocoding-candidates.json').exists() else {}
    objects=[];issues=[];seen=set()
    for line,r in enumerate(rows,1):
        if len(r)<3 or not r[0].isdigit() or r[2]=='3':continue
        if len(r)!=35:raise ValueError(f'Row {line}: expected 35 columns, got {len(r)}')
        rid=r[0]; assert rid not in seen, f'Duplicate source id {rid}'; seen.add(rid)
        flags=[];lat=lon=None
        try:
            lat,lon=float(r[5].replace(',','.')),float(r[6].replace(',','.'))
            if not (52<lat<56 and 35<lon<40):lat=lon=None;flags.append('Координаты вне ожидаемого региона; точка не нанесена')
        except ValueError:flags.append('В источнике нет координат; объект доступен в каталоге')
        original_coordinates={'lat':lat,'lon':lon}
        candidate=candidates.get('archive-'+rid.zfill(3)) if lat is None else None
        if candidate:
            lat,lon=candidate['lat'],candidate['lon']
            flags=[f for f in flags if 'нет координат' not in f]
            flags.append('Координаты подобраны приблизительно ('+candidate['precision']+'); требуется проверка положения объекта. В исходном файле координат нет.')
            if rid=='89': flags.append('Название Каменка неоднозначно: выбран вариант в Узловском районе. Муниципалитет необходимо подтвердить.')
        amo=clean(r[10]);source_district=next((k for k,v in stems.items() if amo and v in normalized(amo)),None)
        geo_district=next((f['properties']['id'] for f in geo['features'] if lat is not None and contains(f,lon,lat)),None)
        if lat is not None and not geo_district:flags.append('Координаты не попадают в муниципальные границы OSM; требуют проверки')
        if geo_district and source_district and geo_district!=source_district:flags.append('Муниципалитет по координатам не совпадает с АМО источника; координаты сохранены без исправления')
        district=geo_district or source_district or 'unknown'
        if district=='unknown':flags.append('Муниципалитет не указан и не определён по координатам')
        status_text=normalized(r[8]);status={'введенвэксплуатацию':'commissioned','смр':'building','пир':'planned','пирсмр':'building','подготовкаэлектронногоаукционаэа':'planned','бюджетныеинвестиции':'unknown'}.get(status_text,'unknown')
        sector=sectors.get(normalized(r[7]),'unknown')
        if sector=='unknown':flags.append('Отрасль не указана в источнике')
        cap=None
        try: cap=float(r[16].replace('\xa0','').replace(' ','').replace(',','.')) or None
        except ValueError:pass
        obj={'id':'archive-'+rid.zfill(3),'sourceId':rid,'name':r[2].strip(),'district':district,'sourceDistrict':source_district,'sector':sector,'typeLabel':dic['sectors'][sector],
            'status':status,'stage':{'commissioned':'operation','building':'construction','planned':'design'}.get(status,'unknown'),
            'ownership':{'Муниципальная':'municipal','Государственная':'state'}.get(r[9].strip(),'unknown'),
            'address':clean(r[4]) or 'Адрес не указан','amo':amo,'amoNote':'Значение АМО сохранено из исходного файла',
            'customer':clean(r[11]),'contractor':clean(r[25]),'yearPlanned':year(r[19]),'yearCommissioned':year(r[33]) if status=='commissioned' else None,
            'capacity':cap,'capacityUnit':'мест (поле источника)','accessibility':None,'lat':lat,'lon':lon,
            'source':{'name':'Архив социальных объектов — файл владельца проекта','file':SOURCE.name,'row':line,'sha256':hashlib.sha256(SOURCE.read_bytes()).hexdigest(),'dataDate':None,'updated':None,'importedAt':'2026-09-13'},
            'demo':False,'description':'Объект из предоставленного архива социальных объектов. Сведения не проверены по внешним реестрам.',
            'geocoding':candidate,'sourceCoordinates':original_coordinates,'media':[],'contracts':[],'history':None,'qualityWarnings':flags,'archiveFields':[{'name':h,'value':v} for h,v in zip(heads,r)],'rawStatus':r[8],'rawStage':r[3],'rawSector':r[7]}
        objects.append(obj)
        if flags:issues.append({'id':obj['id'],'sourceRow':line,'name':obj['name'],'issues':flags})
    data={'districts':geo,'oks':objects,'pois':[],'analytics':{},'streets':{},'dicts':dic,'meta':{'source':'data/source/social-objects.csv','sha256':hashlib.sha256(SOURCE.read_bytes()).hexdigest(),'count':len(objects),'mapped':sum(o['lat'] is not None for o in objects),'sourceCoordinates':sum(o['sourceCoordinates']['lat'] is not None for o in objects),'approximateCoordinates':sum(o['geocoding'] is not None for o in objects),'importedAt':'2026-09-13'}}
    (APP/'js/data.js').write_text('// Generated by tools/import_social_objects.py; source values preserved.\nwindow.TULA_DATA='+json.dumps(data,ensure_ascii=False,separators=(',',':'))+';\n')
    (ROOT/'data/import-report.json').write_text(json.dumps({'summary':data['meta'],'issues':issues},ensure_ascii=False,indent=2)+'\n')
    print(data['meta'])
if __name__=='__main__':main()
