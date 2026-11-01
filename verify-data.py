"""Verify published data integrity; never fill missing recruitment fields."""
import json,collections,urllib.parse,datetime,gzip,hashlib,sys,re
from pathlib import Path
ROOT=Path(__file__).resolve().parent
PUBLIC=ROOT/'public'
b=json.loads((PUBLIC/'jobs.json').read_text(encoding='utf8'));rs=[]
for chunk in b['chunks']:
 payload=gzip.decompress((PUBLIC/chunk['gzipPath']).read_bytes())
 assert payload==(PUBLIC/chunk['jsonPath']).read_bytes()
 assert hashlib.sha256(payload).hexdigest()==chunk['sha256']
 data=json.loads(payload);assert len(data)==chunk['rowCount'];rs+=data
assert len(rs)==b['rowCount']
assert rs and datetime.date.fromisoformat(b['collectedAt'])
assert b['collectedAt']<=datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).date().isoformat()
if '--interim' not in sys.argv:
 assert len(rs)>=60000 and b['sampling']['sampleCount']==len(rs)
 assert b['sampling']['target']==60000 and b['sampling']['targetReached']
 assert b['sampling']['candidateCount']>=len(rs)
else:
 assert len(rs)>=50000 and b['sampling']['sampleCount']==len(rs)
assert len({r['id'] for r in rs})==len(rs)
assert len({r['url'] for r in rs})==len(rs)
assert len({(r['company'],r['title'],tuple(sorted(r['workCities']))) for r in rs})==len(rs)
occs={o['id'] for o in b['taxonomy']['occupations']}
for r in rs:
 assert r['title'] and r['company'] and r['occupation'] in occs
 assert r['country']=='中国'
 assert all(c in b['geography']['majorCities'] or c=='其他大陆城市' for c in r['cityGroups'])
 assert len(r['cityGroups'])==len(set(r['cityGroups']))
 assert not any(c.endswith('省') or c.endswith('自治区') for c in r['workCities'])
 assert urllib.parse.urlparse(r['url']).scheme in ['http','https']
 assert (r['salaryMin'] is None)==(r['salaryMax'] is None)
 if r['salaryMin'] is not None:
  assert 0<r['salaryMin']<=r['salaryMax']
  assert not re.search(r'/\s*(?:年|天|日|小时)|年薪|日薪|时薪',r.get('salaryText',''))
 for field in ['updatedAt','publishedAt']:
  assert not r.get(field) or datetime.date.fromisoformat(r[field]).isoformat()<=b['collectedAt']
 assert any(b['sampling']['dateFrom']<=r.get(k,'')<=b['sampling']['dateTo'] for k in ['updatedAt','publishedAt'] if r.get(k))
 assert r['employmentType'] in ['全职','兼职','实习','临时','小时工','工作性质不限','未披露']
 assert r['hiringChannel'] in ['社招','校招','未披露']
 if r.get('expiresAt'):datetime.date.fromisoformat(r['expiresAt'])
 if r['source']=='中国公共招聘网':
  if str(r.get('sourceEducationCode'))=='90':assert r['education']=='其他'
  if str(r.get('sourceEmploymentCode'))=='6':assert r['employmentType']=='工作性质不限'
  if r.get('salaryLowerBound') is not None and r['salaryMax'] is None:assert r['salaryMin'] is None
 assert not any(s in r['title'] for s in ['微生物高级研究员','资深合成研究员'])
summary={'rows':len(rs),'companies':len({r['company'] for r in rs}),'salary':sum(r['salaryMin'] is not None for r in rs),'sources':dict(collections.Counter(r['source'] for r in rs)),'directions':len({r['occupation'] for r in rs}),'aiProduct':sum(r['occupation']=='0' for r in rs),'product':sum(r['occupation']=='5' for r in rs),'businessAnalysis':sum(r['occupation']=='14' for r in rs),'aiApplication':sum(r['occupation'] in ['4','28','29'] for r in rs)}
(ROOT/'.textsql').mkdir(exist_ok=True)
(ROOT/'.textsql/data-validation.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps(summary,ensure_ascii=False))
