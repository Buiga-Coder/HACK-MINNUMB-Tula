import io,csv,hashlib,json,subprocess,sys,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
class ImportTests(unittest.TestCase):
    def test_source_preservation_and_reproducibility(self):
        output=ROOT/'demo-v2/js/data.js'
        before=output.read_bytes()
        subprocess.run([sys.executable,str(ROOT/'tools/import_social_objects.py')],check=True,capture_output=True)
        self.assertEqual(before,output.read_bytes())
        data=json.loads(output.read_text().split('window.TULA_DATA=',1)[1].rstrip(';\n'))
        source=list(csv.reader(io.StringIO((ROOT/'data/source/social-objects.csv').read_text(encoding='utf-8-sig')),delimiter=';'))
        records={r[0]:r for r in source if len(r)==35 and r[0].isdigit() and r[2]!='3'}
        self.assertEqual(len(data['oks']),95)
        self.assertEqual(len({o['id'] for o in data['oks']}),95)
        self.assertEqual(sum(o['lat'] is not None for o in data['oks']),95)
        self.assertEqual(sum(o['status']=='commissioned' for o in data['oks']),53)
        for o in data['oks']:
            raw=records[o['sourceId']]
            self.assertEqual([f['value'] for f in o['archiveFields']],raw)
            self.assertEqual(o['name'],raw[2].strip())
            self.assertFalse(o['demo'])
            self.assertEqual(o['media'],[])
            self.assertEqual(o['contracts'],[])
            self.assertNotIn('satisfaction',o)
            if raw[5] and raw[6]:self.assertEqual([o['lat'],o['lon']],[float(raw[5]),float(raw[6])])
            else:
                self.assertTrue(o['geocoding']['requiresVerification'])
                self.assertTrue(any('требуется проверка' in w for w in o['qualityWarnings']))
        self.assertEqual(data['analytics'],{})
        conflict=next(o for o in data['oks'] if o['id']=='archive-007')
        self.assertNotEqual(conflict['district'],conflict['sourceDistrict'])
        self.assertTrue(any('не совпадает' in w for w in conflict['qualityWarnings']))
if __name__=='__main__':unittest.main()
