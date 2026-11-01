"""Publish verified collector records without sampling or invented fields."""
import argparse, collections, datetime, gzip, hashlib, json, re
from pathlib import Path
import geography as geo

ROOT = Path(__file__).resolve().parent
parser = argparse.ArgumentParser()
parser.add_argument('--pool', required=True)
parser.add_argument('--minimum', type=int, default=60000)
parser.add_argument('--interim', action='store_true')
args = parser.parse_args()
raw = Path(args.pool).read_bytes()
pool = json.loads(raw)
manifest = json.loads((ROOT / 'public/jobs.json').read_text(encoding='utf8'))
today = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).date()
start = today.replace(year=today.year - 1).isoformat()
end = today.isoformat()
occupations = {o['id'] for o in manifest['taxonomy']['occupations']}
seen_urls, seen_ids, seen_keys = set(), set(), set()
rows, exclusions = [], collections.Counter()
for incoming in pool['rows']:
    r = dict(incoming)
    if not r.get('title') or not r.get('company') or r['company'] == '未披露':
        exclusions['岗位或公司未披露'] += 1
        continue
    if r.get('occupation') not in occupations or r.get('country') != '中国':
        exclusions['超出既有职业与地域范围'] += 1
        continue
    if not re.match(r'^https?://', r.get('url', '')) or not r.get('collectedAt'):
        exclusions['来源或采集时间缺失'] += 1
        continue
    dates = [r[k] for k in ['updatedAt', 'publishedAt'] if r.get(k)]
    if not dates or any(d > end for d in dates) or not any(start <= d <= end for d in dates):
        exclusions['无可核验近一年日期'] += 1
        continue
    for d in dates:
        datetime.date.fromisoformat(d)
    if not r.get('workCities'):
        geo.apply(r)
    r.setdefault('workCities', [])
    r.setdefault('cityGroups', [])
    key = (r['company'], r['title'], tuple(sorted(r['workCities'])))
    if r['url'] in seen_urls or key in seen_keys or r['id'] in seen_ids:
        exclusions['重复记录'] += 1
        continue
    lo, hi = r.get('salaryMin'), r.get('salaryMax')
    assert (lo is None) == (hi is None)
    assert lo is None or 0 < lo <= hi
    r.setdefault('employmentType', r.get('hiringType') if r.get('hiringType') in ['全职', '兼职', '实习', '临时', '小时工'] else '工作性质不限' if r.get('hiringType') in ['不限', '均可'] else '未披露')
    r.setdefault('hiringChannel', '社招' if r['source'] == '字节跳动招聘' else '校招' if re.search('校园招聘|校招', r['title']) else '未披露')
    seen_urls.add(r['url']); seen_ids.add(r['id']); seen_keys.add(key)
    rows.append(r)
rows.sort(key=lambda r: r['url'])
if not args.interim and len(rows) < args.minimum:
    raise SystemExit(f'Target gate failed: {len(rows)} verified rows < {args.minimum}')
assert len(rows) >= manifest['rowCount'], 'Do not replace the site with a smaller dataset'
data = ROOT / 'public/data'
chunks = []
for offset in range(0, len(rows), 5000):
    name = f'jobs-{offset // 5000:02d}.json'
    payload = json.dumps(rows[offset:offset + 5000], ensure_ascii=False, separators=(',', ':')).encode('utf8')
    (data / name).write_bytes(payload)
    (data / (name + '.gz')).write_bytes(gzip.compress(payload, compresslevel=9, mtime=0))
    chunks.append(dict(jsonPath='data/' + name, gzipPath='data/' + name + '.gz', rowCount=len(rows[offset:offset + 5000]), sha256=hashlib.sha256(payload).hexdigest()))
manifest.update(chunks=chunks, rowCount=len(rows), collectedAt=end, sources=pool.get('sources', manifest['sources']))
manifest['sampling'] = dict(target=args.minimum, candidateCount=len(pool['rows']), sampleCount=len(rows), method='公开可核验采集池中符合既有职业与日期口径的全部去重记录，不再截取50000条；便利样本，非全市场随机抽样', dateFrom=start, dateTo=end, dateBasis='原始发布或维护日期至少一个在近一年范围内；逐条原始采集时间保留', exclusions=dict(exclusions), targetReached=len(rows) >= args.minimum, poolSha256=hashlib.sha256(raw).hexdigest())
manifest['methodology']['scope'] = '大陆经管、产品与AI应用职业方向的公开招聘便利样本。保留全部符合口径的去重记录，来源查询、排序与匿名可见范围具有偏差，不代表全市场。'
manifest['methodology']['collection'] = '底座包含此前快照与本轮新增采集；每条保留实际采集时间。底座整理日期不能当作所有岗位重新核验日期。'
manifest['validation'] = dict(date=end, explicitUnexpired=sum(bool(r.get('expiresAt')) and r['expiresAt'] >= end for r in rows), explicitExpired=sum(bool(r.get('expiresAt')) and r['expiresAt'] < end for r in rows), unknownExpiry=sum(not r.get('expiresAt') for r in rows), sources=dict(collections.Counter(r['source'] for r in rows)), targetReached=len(rows) >= args.minimum)
(ROOT / 'public/jobs.json').write_text(json.dumps(manifest, ensure_ascii=False, separators=(',', ':')), encoding='utf8')
(ROOT / 'expanded-data-validation.json').write_text(json.dumps(dict(rows=len(rows), target=args.minimum, shortfall=max(0, args.minimum-len(rows)), **manifest['validation']), ensure_ascii=False, indent=2), encoding='utf8')
print(json.dumps(dict(rows=len(rows), target=args.minimum, shortfall=max(0, args.minimum-len(rows)), **manifest['validation']), ensure_ascii=False))
