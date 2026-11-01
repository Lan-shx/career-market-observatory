(function(){
'use strict';
const clone=v2Clone;
const A={status:null,checking:false,base:null,mode:'new',engine:'local',lastFilters:null,turnBase:null,messages:[],results:[],previous:null,busy:false,input:'',error:'',progress:'',consent:false,rows:null,dataset:'',selected:null,controller:null,epoch:0};
const H={id:crypto.randomUUID(),items:[],ready:false,archived:false,search:'',error:'',signatures:new Map(),queue:Promise.resolve()};
const C={apiKey:'',model:'deepseek-flash',remember:false,tested:false};
try{C.model=localStorage.getItem('research-model')||C.model;C.apiKey=sessionStorage.getItem('research-api-key')||'';C.remember=!!C.apiKey;}catch{}
const historyDB=new Promise((resolve,reject)=>{const r=indexedDB.open('career-research-history',1);r.onupgradeneeded=()=>r.result.createObjectStore('threads',{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.onblocked=()=>reject(Error('请关闭其他旧版标签页后重试'));});
function historyOp(mode,action){return historyDB.then(db=>new Promise((resolve,reject)=>{const tx=db.transaction('threads',mode);const r=action(tx.objectStore('threads'));tx.oncomplete=()=>resolve(r.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);}));}
function storageFailure(){H.error='聊天记录未能保存到浏览器。请导出研究记录备份，并检查浏览器存储空间。';const n=$('ra-storage-status');if(n)n.textContent=H.error;}
function snapshot(){return clone({base:A.base,mode:A.mode,engine:A.engine,lastFilters:A.lastFilters,messages:A.messages,results:A.results,input:A.input,sessionDataset:A.sessionDataset||null,context:A.context||null,serverScope:A.serverScope||null,serverDataset:A.serverDataset||null,serverConditions:A.serverConditions||null});}
function persist(){
 if(!H.ready||(!A.messages.length&&!A.input.trim()))return;
 const data=snapshot(),signature=JSON.stringify(data);if(H.signatures.get(H.id)===signature)return;
 const old=H.items.find(t=>t.id===H.id),now=Date.now();
 const thread={id:H.id,title:old?.title||(A.messages.find(m=>m.role==='user')?.text||A.input).slice(0,60),createdAt:old?.createdAt||now,updatedAt:now,archived:old?.archived||false,pinned:old?.pinned||false,data};
 H.items=H.items.filter(t=>t.id!==H.id);H.items.unshift(thread);H.signatures.set(H.id,signature);
 const activeId=H.id;H.queue=H.queue.then(()=>historyOp('readwrite',s=>s.put(thread))).then(()=>{H.error='';try{localStorage.setItem('research-active-thread',activeId);}catch{}}).catch(()=>{H.signatures.delete(activeId);storageFailure();});
}
function restoreThread(t){A.controller?.abort();A.epoch++;Object.assign(A,{serverScope:null,serverDataset:null,serverConditions:null},clone(t.data),{busy:false,error:'',progress:'',previous:null,turnBase:null,consent:false,mobileEvidence:false});H.id=t.id;H.signatures.set(t.id,JSON.stringify(snapshot()));}
async function loadHistory(){try{H.items=await historyOp('readonly',s=>s.getAll());H.items.sort((a,b)=>b.updatedAt-a.updatedAt);let id;try{id=localStorage.getItem('research-active-thread');}catch{}const t=H.items.find(x=>x.id===id&&!x.archived);if(t)restoreThread(t);}catch{storageFailure();}finally{H.ready=true;if(journeyView==='assistant'&&bundle)renderAssistant();}}
function openThread(id){persist();const t=H.items.find(x=>x.id===id);if(t){restoreThread(t);H.evidenceOpen=false;if(innerWidth<=1100)setHistoryPanel(false);try{localStorage.setItem('research-active-thread',id);}catch{}renderAssistant();}}
async function archiveThread(id,value){
 if(A.busy)return;persist();const t=H.items.find(x=>x.id===id);if(!t)return;t.archived=value;
 try{await H.queue;await historyOp('readwrite',s=>s.put(t));if(value&&id===H.id)reset();else renderAssistant();}catch{t.archived=!value;storageFailure();renderAssistant();}
}
function renderHistory(){
 const host=$('ra-history-list');if(!host)return;
 const found=H.items.slice().sort((a,b)=>Number(!!b.pinned)-Number(!!a.pinned)||b.updatedAt-a.updatedAt).filter(t=>t.archived===H.archived&&(!H.search||(t.title+' '+t.data.messages.map(m=>m.text).join(' ')).toLowerCase().includes(H.search.toLowerCase())));
 host.innerHTML=!H.ready?'<p>正在读取聊天记录…</p>':!found.length?'<p>'+esc(H.search?'没有匹配的聊天':H.archived?'暂无归档。归档后的聊天可在这里恢复。':'还没有聊天。发送第一个问题后会自动保存。')+'</p>':found.map(t=>'<div class="ra-thread '+(t.id===H.id?'active':'')+'"><button class="ra-thread-open" data-ra-thread="'+t.id+'" '+(A.busy?'disabled':'')+' '+(t.id===H.id?'aria-current="true"':'')+'>'+esc((t.pinned?'置顶 · ':'')+t.title)+'<small>'+new Date(t.updatedAt).toLocaleDateString('zh-CN')+' · '+t.data.messages.filter(m=>m.role==='user').length+' 个问题</small></button><div class="ra-thread-actions"><button class="text-button" data-ra-pin="'+t.id+'" '+(A.busy?'disabled':'')+'>'+(t.pinned?'取消置顶':'置顶')+'</button><button class="text-button" data-ra-delete="'+t.id+'" '+(A.busy?'disabled':'')+'>删除</button><button class="text-button" data-ra-rename="'+t.id+'" '+(A.busy?'disabled':'')+'>重命名</button><button class="text-button" data-ra-archive="'+t.id+'" '+(A.busy?'disabled':'')+'>'+(t.archived?'恢复':'归档')+'</button></div></div>').join('');
 host.querySelectorAll('[data-ra-pin]').forEach(b=>b.onclick=async()=>{const t=H.items.find(x=>x.id===b.dataset.raPin),old=!!t.pinned;t.pinned=!old;try{await H.queue;await historyOp('readwrite',s=>s.put(t));}catch{t.pinned=old;storageFailure();}renderHistory();});
 host.querySelectorAll('[data-ra-delete]').forEach(b=>b.onclick=async()=>{const id=b.dataset.raDelete;if(!confirm('永久删除这段研究对话？已保存的结论和收藏仍然保留。'))return;try{await H.queue;await historyOp('readwrite',s=>s.delete(id));H.items=H.items.filter(t=>t.id!==id);if(H.id===id){A.messages=[];A.input='';reset();}else renderAssistant();}catch{storageFailure();}});
 host.querySelectorAll('[data-ra-thread]').forEach(b=>b.onclick=()=>openThread(b.dataset.raThread));
 host.querySelectorAll('[data-ra-archive]').forEach(b=>b.onclick=()=>archiveThread(b.dataset.raArchive,!H.archived));
 host.querySelectorAll('[data-ra-rename]').forEach(b=>b.onclick=async()=>{const t=H.items.find(x=>x.id===b.dataset.raRename);const title=prompt('重命名聊天（最多60字）',t.title)?.trim();if(!title)return;const old=t.title;t.title=title.slice(0,60);try{await H.queue;await historyOp('readwrite',s=>s.put(t));}catch{t.title=old;storageFailure();}renderAssistant();});
 foldHistoryActions();
}
function foldHistoryActions(){document.querySelectorAll('#ra-history-list .ra-thread-actions').forEach(actions=>{if(actions.parentElement.classList.contains('ra-thread-menu'))return;const fold=document.createElement('details');fold.className='ra-thread-menu';fold.innerHTML='<summary aria-label="对话操作">更多</summary>';actions.before(fold);fold.append(actions);});}
function historyUI(){
 const shell=decisionRoot.querySelector('.ra-shell');shell.insertAdjacentHTML('afterbegin','<aside class="ra-history" aria-label="研究聊天记录"><h2>研究记录</h2><button class="button" id="ra-history-new">新建研究</button><div class="ra-history-tabs"><button class="text-button" id="ra-history-current" aria-pressed="'+!H.archived+'">最近聊天</button><button class="text-button" id="ra-history-archive" aria-pressed="'+H.archived+'">已归档</button></div><label for="ra-history-search">搜索标题和对话内容</label><input id="ra-history-search" type="search" placeholder="搜索标题或内容" value="'+esc(H.search)+'"><div id="ra-history-list"></div><p id="ra-storage-status" role="status">'+esc(H.error||'自动保存在当前浏览器；不跨设备同步。清理网站数据会移除记录，可导出报告备份。')+'</p></aside>');
 $('ra-history-new').onclick=()=>{reset();if(innerWidth<=1100)setHistoryPanel(false);};$('ra-history-current').onclick=()=>{H.archived=false;renderAssistant();};$('ra-history-archive').onclick=()=>{H.archived=true;renderAssistant();};$('ra-history-search').oninput=e=>{H.search=e.target.value;renderHistory();};renderHistory();
 const current=H.items.find(t=>t.id===H.id);if(current){decisionRoot.querySelector('.ra-header h1').textContent=current.title;if(current.archived)decisionRoot.querySelector('.ra-header').insertAdjacentHTML('afterend','<p class="ra-archive-note">这段聊天已归档，可阅读和导出。请在左侧恢复后继续提问。</p>');}
}
function modelReady(){return (A.status?.backend!=='d1'||A.status.dataReady)&& (!!C.apiKey||!!A.status?.ready);}
function modelConfig(){return C.apiKey?{modelConfig:{apiKey:C.apiKey,model:C.model}}:{};}
function configureModel(){
 if(A.busy||$('ra-config-dialog'))return;
 const d=document.createElement('dialog');d.id='ra-config-dialog';d.className='ra-dialog';d.setAttribute('aria-labelledby','ra-config-title');
 d.innerHTML='<form id="ra-config-form"><header><h2 id="ra-config-title">模型配置</h2><button type="button" class="button" id="ra-config-close" aria-label="关闭模型配置">关闭</button></header><p>连接自己的 DeepSeek 账户，只影响你的研究对话。留空个人密钥时使用站点配置（如有）。</p><label for="ra-config-model">模型名称</label><input id="ra-config-model" required pattern="deepseek-[a-z0-9._-]{1,80}" value="'+esc(C.model)+'" list="ra-model-options"><datalist id="ra-model-options"><option value="deepseek-flash"><option value="deepseek-chat"><option value="deepseek-reasoner"></datalist><small>填写账户支持的模型 ID，连接测试会核验。</small><label for="ra-config-key">个人 API Key</label><input id="ra-config-key" type="password" autocomplete="off" spellcheck="false" placeholder="输入 DeepSeek API Key"><label class="ra-remember"><input id="ra-config-remember" type="checkbox" '+(C.remember?'checked':'')+'>在本标签页记住密钥，刷新后仍可使用</label><p class="ra-config-help">默认仅在内存中使用，刷新后需重填。勾选后保存在本标签页的会话存储中。密钥通过本站服务端转发给 DeepSeek，不写入聊天记录或服务端数据库。</p><p id="ra-config-feedback" role="status">'+(C.tested?'当前配置已通过连接测试。':'尚未验证连接。测试会发送一条极短请求，可能产生少量费用。')+'</p><footer><button type="button" id="ra-config-clear" class="text-button">清除个人密钥</button><button type="button" id="ra-config-test" class="button">测试连接</button><button type="submit" class="primary">保存配置</button></footer></form>';
 document.body.appendChild(d);$('ra-config-key').value=C.apiKey;
 const controller=new AbortController();d.addEventListener('close',()=>{controller.abort();d.remove();$('ra-config')?.focus();});$('ra-config-close').onclick=()=>d.close();
 let testedSignature='';const draft=()=>({apiKey:$('ra-config-key').value.trim(),model:$('ra-config-model').value.trim()});
 $('ra-config-test').onclick=async()=>{if(!$('ra-config-form').reportValidity())return;const c=draft(),b=$('ra-config-test');b.disabled=true;$('ra-config-feedback').textContent='正在测试连接…';try{const r=await fetch('/api/research/test',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(c.apiKey?{modelConfig:c}:{}),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(20000)])});let data;try{data=await r.json();}catch{throw Error('连接失败：服务未返回可读取的结果。');}if(!r.ok)throw Error(data.error||'连接失败');testedSignature=JSON.stringify(c);$('ra-config-feedback').textContent='连接成功 · '+data.model;}catch(e){if(d.open)$('ra-config-feedback').textContent=e.name==='TimeoutError'?'连接超时，请检查网络后重试。':e.message;}finally{if(d.open)b.disabled=false;}};
 $('ra-config-clear').onclick=()=>{$('ra-config-key').value='';$('ra-config-remember').checked=false;$('ra-config-feedback').textContent='保存后清除个人密钥，恢复使用站点配置。';testedSignature='';};
 $('ra-config-form').onsubmit=e=>{e.preventDefault();const c=draft();Object.assign(C,c,{remember:$('ra-config-remember').checked,tested:testedSignature===JSON.stringify(c)});try{localStorage.setItem('research-model',C.model);if(C.remember&&C.apiKey)sessionStorage.setItem('research-api-key',C.apiKey);else sessionStorage.removeItem('research-api-key');}catch{$('ra-config-feedback').textContent='浏览器禁止存储，配置仅在本次页面打开期间有效。';C.remember=false;}A.previous=null;if(C.apiKey)A.engine='model';else if(!A.status?.ready)A.engine='local';d.close();renderAssistant();};d.showModal();
}
const dimensions=['cities','occupations','industries','sources','experiences','educations','skills','hiringTypes','hiringChannels','scales','properties'];
function imported(){return rows.some(r=>r.source==='本次导入'||String(r.id).startsWith('import-'));}
function identity(){if(A.rows!==rows){A.rows=rows;A.dataset=(imported()?'import-'+crypto.randomUUID():bundle.sampling?.poolSha256||bundle.collectedAt)+'-'+rows.length;}return A.dataset;}
function options(key){if(key==='majors')return bundle.taxonomy.majors.map(m=>({value:m.id||m.name,label:m.name}));if(!dimensions.includes(key))throw Error('不支持的筛选维度');return opts(key).map(o=>({value:o.value,label:o.label}));}
function validate(patch){
 if(!patch||Array.isArray(patch)||typeof patch!=='object')throw Error('筛选条件必须是对象');
 const out={};
 for(const [k,v] of Object.entries(patch)){
  if(dimensions.includes(k)){if(!Array.isArray(v)||v.length>20||v.some(x=>typeof x!=='string'||!options(k).some(o=>o.value===x)))throw Error(k+' 包含不支持的选项，请先查catalog');out[k]=[...new Set(v)];}
  else if(['query','company','major'].includes(k)){if(typeof v!=='string'||v.length>150)throw Error(k+'格式无效');if(k==='major'&&v&&!options('majors').some(o=>o.value===v))throw Error('请使用专业ID');out[k]=v;}
  else if(['salaryLow','salaryHigh'].includes(k)){if(v!==''&&(!Number.isFinite(v)||v<0||v>10000000))throw Error('薪资必须是非负数，单位元/月');out[k]=v;}
  else if(['salaryOnly','entryOnly','includeUnknownCity','keepUnknownDate','majorRequired'].includes(k)){if(typeof v!=='boolean')throw Error(k+'必须为布尔值');out[k]=v;}
  else if(k==='salaryMode'){if(!['overlap','contained','midpoint'].includes(v))throw Error('薪资匹配口径无效');out[k]=v;}
  else if(k==='skillMode'){if(!['any','all'].includes(v))throw Error('技能匹配口径无效');out[k]=v;}
  else if(k==='dateField'){if(!['updatedAt','publishedAt'].includes(v))throw Error('日期口径无效');out[k]=v;}
  else if(k==='jobStatus'){if(!['all','current','expired'].includes(v))throw Error('截止状态无效');out[k]=v;}
  else if(['dateFrom','dateTo'].includes(k)){if(typeof v!=='string'||(v!==''&&(!/^\d{4}-\d{2}-\d{2}$/.test(v)||new Date(v).toISOString().slice(0,10)!==v)))throw Error('日期无效');out[k]=v;}
  else throw Error('不支持的筛选条件：'+k);
 }
 if(out.major){
  const mapped=bundle.taxonomy.majors.find(m=>(m.id||m.name)===out.major).occs||[];
  if(out.occupations?.length&&out.occupations.some(id=>!mapped.includes(id)))throw Error('职业方向不在所选专业映射中，请清除专业条件或重新选择');
  if(!out.occupations?.length)out.occupations=[...mapped];
 }else if(out.occupations)out.major='';
 const f={...(A.turnBase||A.lastFilters||A.base||defaultFilters()),...out};
 if(f.salaryLow!==''&&f.salaryHigh!==''&&Number(f.salaryLow)>Number(f.salaryHigh))throw Error('月薪下限高于上限');
 if(f.dateFrom&&f.dateTo&&f.dateFrom>f.dateTo)throw Error('开始日期晚于结束日期');
 return f;
}
function conditions(f){const a=[];for(const key of dimensions)if(f[key]?.length)a.push((dims[key]?.[0]||key)+'：'+f[key].map(v=>key==='occupations'?cmoName(v):v).join('、'));for(const [k,n]of [['query','关键词'],['company','企业'],['major','专业'],['salaryLow','月薪下限'],['salaryHigh','月薪上限'],['dateFrom','起始日期'],['dateTo','结束日期']])if(f[k]!==''&&f[k]!=null)a.push(n+'：'+f[k]);if(f.salaryLow!==''||f.salaryHigh!=='')a.push('薪资口径：'+f.salaryMode);if(f.entryOnly)a.push('应届 / 经验不限');if(f.salaryOnly)a.push('仅完整月薪');if(f.majorRequired)a.push('仅企业明示专业');if(f.nlIntern)a.push('仅实习');if(f.nlGraduate)a.push('仅毕业生线索');if(f.nlExclude&&Object.keys(f.nlExclude).length)a.push('排除：'+JSON.stringify(f.nlExclude));if(f.nlExperience)a.push('最低经验范围：'+JSON.stringify(f.nlExperience));if(f.nlExperienceUnlimited)a.push('仅经验不限');if(f.nlSalaryStrict)a.push('严格薪资边界：'+f.nlSalaryStrict);a.push(f.includeUnknownCity?'含城市未明确记录':'仅已明确大陆城市');if(f.jobStatus!=='all')a.push(f.jobStatus==='current'?'未明确截止，需核对':'已明确截止');if(f.dateFrom||f.dateTo)a.push((f.dateField==='publishedAt'?'发布日期':'更新日期')+' · '+(f.keepUnknownDate?'含日期未披露':'排除日期未披露'));return a.join(' · ');}
function summary(rs){
 const s=exploreStats('',rs);
 const count=field=>{const map=new Map();for(const r of rs)for(const v of field==='skills'?(r.skills||[]):[r[field]||'未披露'])map.set(v,(map.get(v)||0)+1);return [...map].sort((a,b)=>b[1]-a[1]).slice(0,6).map(([name,n])=>({name,n}));};
 return {records:s.n,salaryN:s.salaryN,p25:s.p25,p50:s.p50,p75:s.p75,companies:s.companies,note:s.salaryN<10?'有效月薪少于10条，薪资统计留空':s.salaryN<30?'薪资小样本，仅供探索':'月薪区间中点分位数，非实际到手薪资',skills:count('skills'),education:count('educationLevel'),experience:count('expGroup')};
}
function record(r){return {id:r.id,title:String(r.title||'').slice(0,150),company:String(r.company||'').slice(0,120),cities:r.workCities||[r.city],salary:String(r.salaryText||r.salary||'未披露').slice(0,120),salaryMin:r.salaryMin,salaryMax:r.salaryMax,experience:r.experience,education:r.education,source:r.source,updatedAt:r.updatedAt||null,url:safeUrl(r.url||r.sourceUrl),description:String(r.description||'').slice(0,500)};}
function add(result){const value={ref:'R'+(A.results.length+1),provenance:{source:imported()?'本次导入':'历史公开招聘样本',from:imported()?null:bundle.sampling?.dateFrom,to:imported()?null:bundle.sampling?.dateTo||bundle.collectedAt},...result};A.results.push(value);return value;}
function queryResult(f,limit=5){
 const rs=rows.filter(r=>matches(r,f));A.lastFilters=clone(f);
 return add({kind:'query',label:'岗位查询',conditions:conditions(f),filters:clone(f),summary:summary(rs),jobs:rs.slice(0,limit).map(record),sampleOrder:'来源顺序，非推荐排名',dataset:identity()});
}
function compareResult(f,key,values){
 const groups=values.map(value=>({name:key==='occupations'?cmoName(value):value,summary:summary(rows.filter(r=>matches(r,{...f,[key]:[value]})))}));
 A.lastFilters=clone({...f,[key]:values});
 return add({kind:'compare',label:'同口径对比',filters:clone(A.lastFilters),conditions:conditions({...f,[key]:[]}),dimension:key,groups,note:'各组独立统计；多城市岗位会重复归属，组间数量不能直接相加',dataset:identity()});
}
function localPlan(question){
 const base=clone(A.lastFilters||A.base||defaultFilters());
 const clear=question.match(/^(?:清除|取消)(城市|薪资|学历|经验|关键词)(?:条件|筛选)?[。！]?$/);
 if(clear){const fields={城市:{cities:[]},薪资:{salaryLow:'',salaryHigh:'',salaryOnly:false,nlSalaryStrict:''},学历:{educations:[]},经验:{experiences:[],entryOnly:false,nlExperience:null,nlExperienceUnlimited:false},关键词:{query:''}};return {filters:{...base,...fields[clear[1]]},intent:'jobs',notes:['已清除'+clear[1]+'条件，其余条件保留。'],errors:[],unknown:[]};}
 const normalized=question.replace(/^(?:把)?(?:城市|职业方向|职业)?(?:换成|改成|改为|换为)/,'').replace(/[，,\s]*(?:其他条件不变|其余不变)[。！]?$/,'').replace(/^那(?=.{1,20}呢$)/,'');
 const catalog={};for(const key of dimensions)catalog[key]=opts(key);
 return CareerQuery.parse(normalized,{base,options:catalog,majors:bundle.taxonomy.majors,today:deadlineCutoff(),coverageEnd:imported()?null:bundle.sampling?.dateTo});
}
function runLocal(question){
 const plan=localPlan(question);
 if(plan.errors.length||plan.unknown.length)throw Error([...plan.errors,plan.unknown.length?'这些内容未能明确识别：'+plan.unknown.join('、')+'。请改写为城市、职业、月薪或已披露要求；本轮未执行查询。':''].filter(Boolean).join('\n'));
 const key={city:'cities',occupation:'occupations',industry:'industries'}[plan.axis];
 const r=plan.intent==='compare'?compareResult(plan.filters,key,plan.objects):queryResult(plan.filters);
 const lines=r.groups?r.groups.map(g=>g.name+'：'+fmt(g.summary.records)+'条记录；有效月薪'+fmt(g.summary.salaryN)+'条；中位数'+money(g.summary.p50)+'。'):['匹配到 '+fmt(r.summary.records)+' 条历史记录。有效月薪 '+fmt(r.summary.salaryN)+' 条，月薪区间中点中位数 '+money(r.summary.p50)+'。',r.summary.records?'下方展示来源顺序的前几条岗位，可在查询依据中继续加载。':'当前条件下没有匹配记录。可清除薪资、经验或城市条件后重试；这不代表市场没有岗位。',r.summary.note];
 A.messages.push({role:'assistant',engine:'local',text:[...lines,...plan.notes,'执行范围：'+conditions(A.lastFilters),'['+r.ref+']','站内规则查询 · 程序计算，未调用大模型。历史样本不代表实时在招。'].join('\n')});
 A.previous=null;
}
async function moreEvidence(ref){
 const r=A.results.find(x=>x.ref===ref);
 if(!r?.filters||r.dataset!==identity()){A.error='数据已变化，不能继续加载旧结果；请开始新研究。';renderAssistant();return;}
 if(r.serverTurn){
  if(A.busy||r.cursor===null)return;const epoch=++A.epoch,controller=new AbortController();A.controller=controller;A.busy=true;A.error='';renderAssistant();
  try{const response=await fetch('/api/research/page',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({turn:r.serverTurn,ref:r.ref,cursor:r.cursor,dataset:r.databaseVersion}),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(20000)])});const data=await response.json();if(!response.ok)throw Error(data.error||'岗位加载失败');if(epoch!==A.epoch)return;if(r.dataset!==identity())throw Error('数据已变化，请开始新研究。');r.jobs.push(...data.jobs);r.cursor=data.cursor;}
  catch(e){if(epoch===A.epoch)A.error=e.message;}finally{if(epoch===A.epoch){A.busy=false;renderAssistant();}}return;
 }
 const records=rows.filter(row=>matches(row,r.filters));r.jobs.push(...records.slice(r.jobs.length,r.jobs.length+8).map(record));renderAssistant();
}
function exportReport(){
 const lines=['# 职场观测站研究记录','导出时间：'+new Date().toLocaleString('zh-CN'),'每条结果保留计算时的数据来源与覆盖期，旧结果不随当前导入变化。','历史便利样本，非实时库存；月薪按披露区间中点统计，n<10留空。',''];
 for(const m of A.messages)lines.push('## '+(m.role==='user'?'问题':m.engine==='local'?'站内规则查询':'模型解读'),m.text,'');
 for(const r of A.results){lines.push('## '+r.ref+' '+r.label,'数据来源：'+r.provenance.source+'；覆盖期 '+(r.provenance.from||'未披露')+' 至 '+(r.provenance.to||'未披露')+'；数据标识 '+(r.databaseVersion||r.dataset),r.conditions||'');const groups=r.groups||[{name:'匹配样本',summary:r.summary}];for(const g of groups)if(g.summary)lines.push(g.name+'：记录 '+g.summary.records+'；有效月薪 '+g.summary.salaryN+'；P25 '+money(g.summary.p25)+'；P50 '+money(g.summary.p50)+'；P75 '+money(g.summary.p75),g.summary.note);for(const j of r.jobs||[])lines.push('- '+j.title+' / '+j.company+' / '+j.salary+' / '+j.source+' / 更新 '+(j.updatedAt||'未披露')+' / '+j.url);lines.push(r.note||'','');}
 download('职场观测站-研究记录.md',lines.join('\n'),'text/markdown;charset=utf-8');
}
function execute(name,args){
 if(name==='catalog'){if(typeof args.search!=='undefined'&&(typeof args.search!=='string'||args.search.length>100))throw Error('搜索词过长');const all=options(args.dimension),found=all.filter(o=>!args.search||(o.label+' '+o.value).toLowerCase().includes(args.search.toLowerCase()));return {dimension:args.dimension,options:found.slice(0,30),totalMatches:found.length,truncated:found.length>30};}
 if(name==='query'){const f=validate(args.filters),limit=args.limit??5;if(!Number.isInteger(limit)||limit<1||limit>8)throw Error('最多返回8条岗位');return queryResult(f,limit);}
 if(name==='compare'){const f=validate(args.filters),key=args.dimension;if(!['cities','occupations'].includes(key)||!Array.isArray(args.values)||args.values.length<2||args.values.length>3||new Set(args.values).size!==args.values.length)throw Error('请选择2至3个不同的城市或职业');validate({[key]:args.values});return compareResult(f,key,args.values);}
 if(name==='evidence'){if(!Array.isArray(args.ids)||args.ids.length<1||args.ids.length>5)throw Error('一次查看1至5条证据');const known=new Set(A.results.flatMap(r=>(r.jobs||[]).map(j=>j.id)));if(args.ids.some(id=>!known.has(id)))throw Error('请先查询岗位，再按结果中的ID取证');return add({kind:'evidence',label:'岗位证据',jobs:args.ids.map(id=>record(rows.find(r=>r.id===id))),dataset:identity()});}
 throw Error('不支持的工具');
}
const oldNav=v2Nav;v2Nav=function(){oldNav();const node=document.createElement('button');node.dataset.v2Route='assistant';node.className=journeyView==='assistant'?'active':'';if(journeyView==='assistant')node.setAttribute('aria-current','page');node.innerHTML=v2Icon('role')+'<span>研究助手</span>';const anchor=$('navigation').querySelector('[data-v2-route="discover"]');anchor?.after(node);};nav=v2Nav;
const oldDecision=decisionRender;decisionRender=function(){if(journeyView==='assistant'&&bundle){decisionRoot.hidden=false;return renderAssistant();}oldDecision();};
function reset(){H.evidenceOpen=false;persist();H.id=crypto.randomUUID();H.archived=false;A.context=null;try{localStorage.removeItem('research-active-thread');}catch{}A.controller?.abort();A.epoch++;Object.assign(A,{base:null,mode:'new',messages:[],results:[],previous:null,busy:false,error:'',progress:'',consent:false,selected:null,input:'',lastFilters:null,turnBase:null,sessionDataset:null,serverScope:null,serverDataset:null,serverConditions:null,mobileEvidence:false});renderAssistant();}
async function status(){if(A.checking)return;A.checking=true;try{if(location.protocol==='file:')throw Error('离线文件不支持模型服务，请打开在线网站。');const r=await fetch('/api/research/status',{cache:'no-store',signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('暂时无法读取服务状态');A.status=await r.json();}catch(e){A.status={ready:false,reason:e.message,model:'DeepSeek'};}finally{A.checking=false;if(!A.engineChosen&&!A.messages.length)A.engine=modelReady()?'model':'local';if(journeyView==='assistant')renderAssistant();}}
function textAnswer(text){return ResearchMarkdown.render(text,A.results);}
function resultCard(r){const stat=s=>'<div class="ra-metrics"><span><b>'+fmt(s.records)+'</b>条记录</span><span><b>'+money(s.p50)+'</b>月薪中位数</span><span><b>'+fmt(s.salaryN)+'</b>条有效月薪</span></div><p>'+esc(s.note)+'</p>';
 return '<article class="ra-result" id="ra-'+r.ref+'"><h3>'+esc(r.ref+' · '+r.label)+'</h3>'+(r.conditions?'<p class="ra-conditions">'+esc(r.conditions)+'</p>':'')+(r.summary?stat(r.summary):'')+(r.groups?r.groups.map(g=>'<h4>'+esc(g.name)+'</h4>'+stat(g.summary)).join(''):'')+(r.summary?.skills.length?'<p>技能线索：'+r.summary.skills.map(x=>esc(x.name)+' '+fmt(x.n)+'条').join(' · ')+'</p>':'')+(r.note?'<p>'+esc(r.note)+'</p>':'')+(r.jobs||[]).map(j=>'<details class="ra-job"><summary>'+esc(j.title)+'<small>'+esc(j.company)+'</small></summary><p>'+esc(j.cities.join('、'))+' · '+esc(j.salary)+' · '+esc(j.experience)+' · '+esc(j.education)+'</p><p>'+esc(j.description||'未披露岗位描述')+'</p><p>'+esc(j.source)+' · 更新日期 '+esc(j.updatedAt||'未披露')+'</p>'+(j.url!=='#'?'<a href="'+esc(j.url)+'" target="_blank" rel="noopener noreferrer">核对岗位原页 ↗</a>':'<span>未提供有效原页链接</span>')+'</details>').join('')+'<small>历史公开样本 · 岗位是否仍在招须核对原页</small></article>';
}
function openEvidence(ref){
 const panel=$('ra-evidence-panel');if(!panel)return;H.evidenceOpen=true;panel.hidden=false;const trigger=document.activeElement;panel.returnFocus=trigger;
 const card=ref?$('ra-'+ref):null;if(card){const content=panel.querySelector('.ra-evidence-scroll');content.scrollTop=card.getBoundingClientRect().top-content.getBoundingClientRect().top+content.scrollTop;card.setAttribute('tabindex','-1');card.focus({preventScroll:true});}else panel.querySelector('button').focus({preventScroll:true});
}
function closeEvidence(){const panel=$('ra-evidence-panel');if(!panel||panel.hidden)return;H.evidenceOpen=false;panel.hidden=true;panel.returnFocus?.isConnected&&panel.returnFocus.focus({preventScroll:true});}
function setHistoryPanel(open){H.historyPanelOpen=!!open;const host=document.querySelector('.ra-workspace');host?.classList.toggle('ra-history-expanded',H.historyPanelOpen);const toggle=document.querySelector('.ra-conversations-toggle');if(toggle){toggle.setAttribute('aria-expanded',String(H.historyPanelOpen));toggle.setAttribute('aria-label',H.historyPanelOpen?'收起对话列表':'打开对话列表');}}
let historyWide=innerWidth>1100;window.addEventListener('resize',()=>{const wide=innerWidth>1100;if(wide!==historyWide){historyWide=wide;setHistoryPanel(wide);}});
function arrangeWorkspace(){
 const shell=decisionRoot.querySelector('.ra-shell');if(!shell)return;
 const header=shell.querySelector('.ra-header'),layout=shell.querySelector('.ra-layout'),chat=shell.querySelector('.ra-conversation');
 const history=shell.querySelector('.ra-history'),engine=shell.querySelector('.ra-engine'),scope=shell.querySelector('.ra-scope'),service=shell.querySelector('.ra-service');
 const dock=document.createElement('section');dock.id='assistant-history-dock';dock.setAttribute('aria-label','选择研究对话');dock.innerHTML='<div class="ra-history-mobile-head"><span>对话</span><button class="button" aria-label="关闭对话列表">关闭</button></div>';dock.querySelector('button').onclick=()=>setHistoryPanel(false);history.querySelector('h2').textContent='对话';$('ra-history-new').textContent='新建对话';$('ra-history-search').placeholder='搜索对话';dock.append(history);

 const listButton=document.createElement('button');listButton.className='button ra-conversations-toggle';listButton.innerHTML=v2Icon('menu')+'<span>对话列表</span>';listButton.onclick=()=>setHistoryPanel(!H.historyPanelOpen);header.prepend(listButton);
 const settings=document.createElement('details');settings.className='ra-settings ra-chat-settings';settings.open=!!H.settingsOpen;settings.innerHTML='<summary>研究设置</summary><div class="ra-settings-body"></div>';settings.ontoggle=()=>H.settingsOpen=settings.open;const settingsBody=settings.lastElementChild;settingsBody.append(engine,scope);const config=$('ra-config');if(config)settingsBody.append(config);if(service)settingsBody.append(service);header.append(settings);
 const workspace=document.createElement('div');workspace.className='ra-workspace';header.after(workspace);workspace.append(dock,layout);setHistoryPanel(H.historyPanelOpen??innerWidth>1100);layout.classList.add('ra-chat-panel');chat.setAttribute('aria-label','研究对话');
 const current=H.items.find(t=>t.id===H.id);header.querySelector('h1').textContent=current?.title||'新对话';header.querySelector('h1').title=current?.title||'新对话';$('ra-new').textContent='新建';
 const actions=document.createElement('div');actions.className='ra-chat-actions';const exported=$('ra-export');if(exported)actions.append(exported);if(A.messages.some(m=>m.role==='assistant')){const b=document.createElement('button');b.className='button';b.textContent='保存结论';b.disabled=A.busy;b.onclick=()=>CareerJourney.saveOutcome(A.messages.filter(m=>m.role==='assistant').at(-1).text);actions.append(b);}header.append(actions);
 const evidence=shell.querySelector('.ra-evidence');if(evidence){const toggle=document.createElement('button');toggle.className='button';toggle.textContent='查询依据 · '+A.results.length;toggle.onclick=()=>openEvidence();actions.prepend(toggle);const panel=document.createElement('aside');panel.id='ra-evidence-panel';panel.setAttribute('aria-label','查询依据面板');panel.hidden=!H.evidenceOpen;panel.innerHTML='<header><h2>查询依据</h2><button class="button" aria-label="关闭查询依据">关闭</button></header><div class="ra-evidence-scroll"></div>';panel.lastElementChild.append(evidence);document.body.append(panel);panel.querySelector('button').onclick=closeEvidence;}
 const form=$('ra-form');form.classList.add('ra-composer');form.querySelector('label').textContent='继续研究';$('ra-input').placeholder='询问岗位、城市或技能，或继续追问…';
 if(A.context){const p=document.createElement('p');p.className='ra-context-note';p.textContent='已带入当前研究对象与条件。';chat.prepend(p);}
 const help=chat.querySelector('.ra-empty');if(help){help.querySelector('h2').textContent='想研究哪个职业问题？';const examples=help.querySelector('.ra-examples');const fold=document.createElement('details');fold.className='ra-example-disclosure';fold.innerHTML='<summary>试试示例问题</summary>';examples.before(fold);fold.append(examples);help.querySelector('.ra-boundary')?.remove();}
 const messages=shell.querySelector('.ra-messages');messages.dataset.thread=H.id;messages.dataset.count=A.messages.length;requestAnimationFrame(()=>{if(!messages.isConnected)return;const saved=H.chatScroll?.[H.id];messages.scrollTop=!saved||saved.bottom?messages.scrollHeight:saved.top;});
}

function renderAssistant(){
 if(journeyView!=='assistant')return;
 const previous=document.querySelector('.ra-messages');if(previous?.dataset.thread){H.chatScroll||={};H.chatScroll[previous.dataset.thread]={top:previous.scrollTop,bottom:previous.scrollHeight-previous.scrollTop-previous.clientHeight<60||(previous.dataset.thread===H.id&&Number(previous.dataset.count)<A.messages.length&&A.messages.at(-1)?.role==='user')};}
 $('assistant-history-dock')?.remove();$('ra-evidence-panel')?.remove();
 identity();
 persist();const archived=H.items.find(t=>t.id===H.id)?.archived;const ready=modelReady(),canSend=H.ready&&!archived&&(A.engine==='local'||ready);
 decisionRoot.innerHTML='<section class="ra-shell" aria-label="研究助手"><header class="ra-header"><div><button id="ra-menu" class="button ra-mobile" aria-label="展开导航">' +v2Icon('menu')+ '</button><h1>研究助手</h1><p>把问题说清楚，让查询、比较与出处一起回来。</p></div><button class="button" id="ra-new">新建研究</button></header><div class="ra-service" role="status"><span class="ra-dot '+(ready?'ready':'')+'"></span><span>'+esc(C.apiKey?(C.tested?'个人 DeepSeek 配置 · 已通过连接测试':'个人 DeepSeek 配置 · 尚未验证连接'):A.status?A.status.reason:'正在检查模型配置…')+'</span><button class="text-button" id="ra-check" '+(A.checking?'disabled':'')+'>刷新状态</button><details><summary>模型与数据说明</summary><p>服务提供方：DeepSeek · '+esc(A.status?.model||'待检测')+'。可使用站点配置或个人密钥，个人设置不会影响其他访客。</p><p>仅发送问题、范围、选中的统计与少量岗位摘要给模型。聊天和查询依据自动保存在本浏览器，支持归档及恢复；不跨设备同步。服务端模型上下文1小时后失效；重新打开聊天时，会附上最近对话摘要继续研究。停止后已发出的模型请求可能仍会计费。</p><p>站点不设置每日调用额度。单次请求有超时与循环保护。</p></details></div><div class="ra-layout '+(A.results.length?'has-results':'')+'"><div class="ra-conversation"><div class="ra-scope"><label for="ra-mode">本次研究范围</label><select id="ra-mode" '+(A.messages.length||A.busy?'disabled':'')+'><option value="new" '+(A.mode==='new'?'selected':'')+'>从全部样本开始</option><option value="current" '+(A.mode==='current'?'selected':'')+'>带入当前已应用条件</option></select><p>'+esc(A.engine==='model'&&A.serverConditions?A.serverConditions:conditions(A.lastFilters||A.base||(A.mode==='current'?state.filters:defaultFilters())))+'</p><small>覆盖 '+esc(imported()?'本次导入数据':(bundle.sampling?.dateFrom||'未披露')+' 至 '+(bundle.sampling?.dateTo||bundle.collectedAt))+' · 独立研究范围</small></div><div class="ra-messages" aria-live="polite">'+(A.messages.length?A.messages.map(m=>'<article class="ra-message '+m.role+'"><header class="ra-message-identity">'+ResearchMarkdown.avatar(m.role)+'<div class="ra-message-label">'+(m.role==='user'?'你':m.engine==='local'?'研究助手 · 站内规则查询':'研究助手 · 模型解读')+'</div></header><div class="ra-answer">'+(m.role==='user'?esc(m.text):textAnswer(m.text))+'</div></article>').join(''):'<div class="ra-empty"><h2>先从一个具体问题开始</h2><p>可以找岗位、比较城市，或追问一项结论的依据。</p><div class="ra-examples">'+['比较深圳和杭州的数据分析岗位薪资','上海应届会计岗位','市场营销岗位主要要求哪些技能'].map((q,i)=>'<button class="ra-example" data-ra-example="'+i+'">'+esc(q)+'<span aria-hidden="true">↗</span></button>').join('')+'</div><p class="ra-boundary">回答只描述当前样本，不能判断全市场增长、竞争程度或个人录用概率。</p></div>')+'</div>'+(A.progress?'<p class="ra-progress" role="status">'+esc(A.progress)+'</p>':'')+(A.error?'<div class="ra-error" role="alert">'+esc(A.error)+'<button class="text-button" id="ra-retry">将问题放回输入框</button></div>':'')+'<form id="ra-form"><label for="ra-input">输入研究问题或继续追问</label><textarea id="ra-input" rows="3" maxlength="1200" placeholder="例如：把城市换成上海，其他条件不变" '+(A.busy||archived||!H.ready?'disabled':'')+'>'+esc(A.input)+'</textarea>'+(imported()&&A.engine==='model'?'<label class="ra-consent"><input id="ra-consent" type="checkbox" '+(A.consent?'checked':'')+'>允许将本次导入数据的统计与少量岗位摘要发送给 DeepSeek</label>':'')+'<div class="ra-composer-actions"><small>'+(A.engine==='local'?'本机计算，不发送问题或数据给模型':'Enter 换行 · Ctrl / ⌘ + Enter 发送')+'</small>'+(A.busy?'<button id="ra-stop" type="button" class="button">停止本轮</button>':'<button class="primary" type="submit" '+(!canSend?'disabled':'')+'>发送问题</button>')+'</div></form></div>'+(A.results.length?'<aside class="ra-evidence" aria-label="查询依据"><header><h2>查询依据</h2><span>程序计算 · 可核对</span></header><p>数值与条件以这里为准。模型解读可能出错。</p>'+A.results.map(resultCard).join('')+'</aside>':'')+'</div></section>';
 const scope=decisionRoot.querySelector('.ra-scope');
 scope.insertAdjacentHTML('beforebegin','<div class="ra-engine"><label for="ra-engine">回答方式</label><select id="ra-engine" '+(A.busy?'disabled':'')+'><option value="local" '+(A.engine==='local'?'selected':'')+'>站内规则查询 · 无需密钥</option><option value="model" '+(A.engine==='model'?'selected':'')+'>DeepSeek 研究对话'+(!ready?' · 未连接':'')+'</option></select><p>'+(A.engine==='local'?'支持城市、职业、月薪、要求及同维度对比；不理解的内容会先提示，不会忽略后执行。':'由模型选择只读查询工具，依据卡由程序计算。')+'</p></div>');
 $('ra-engine').onchange=e=>{const engine=e.target.value;if(A.messages.length&&engine==='local'&&A.serverScope?.predicates?.length)reset();A.engineChosen=true;A.engine=engine;A.previous=null;A.error='';renderAssistant();};
 if(A.messages.length)decisionRoot.querySelector('.ra-header').insertAdjacentHTML('beforeend','<button id="ra-export" class="button" '+(A.busy?'disabled':'')+'>导出研究记录</button>');
 $('ra-export')?.addEventListener('click',exportReport);
 if(A.lastFilters&&!A.busy){
  $('ra-form').insertAdjacentHTML('beforebegin','<div class="ra-followups" aria-label="继续研究">'+['薪资分布','技能要求','清除薪资条件'].map(q=>'<button class="text-button" data-ra-follow="'+q+'">'+q+'</button>').join('')+'</div>');
  decisionRoot.querySelectorAll('[data-ra-follow]').forEach(b=>b.onclick=()=>{A.input=b.dataset.raFollow;$('ra-input').value=A.input;$('ra-input').focus();});
 }
 for(const r of A.results){
  const card=$('ra-'+r.ref);if(!card)continue;
  const summaries=r.groups||[{name:'样本',summary:r.summary}];
  for(const g of summaries){if(!g.summary)continue;const s=g.summary;card.insertAdjacentHTML('beforeend','<details class="ra-breakdown"><summary>'+esc(g.name)+' · 薪资分位与要求分布</summary><p>P25 '+money(s.p25)+' · P50 '+money(s.p50)+' · P75 '+money(s.p75)+'（元/月）</p>'+['education','experience'].map(k=>'<p>'+({education:'学历',experience:'经验'}[k])+'：'+s[k].map(x=>esc(x.name)+' '+fmt(x.n)+'条').join('；')+'</p>').join('')+'</details>');}
  if(r.kind==='query'&&r.jobs.length<r.summary.records&&(!r.serverTurn||r.cursor!==null))card.insertAdjacentHTML('beforeend','<button class="button" data-ra-more="'+r.ref+'" '+(A.busy||r.dataset!==identity()?'disabled':'')+'>继续查看岗位（已展示 '+r.jobs.length+' / '+r.summary.records+'）</button>');
 }
 decisionRoot.querySelectorAll('[data-ra-more]').forEach(b=>b.onclick=()=>moreEvidence(b.dataset.raMore));
 if(A.sessionDataset&&A.sessionDataset!==identity())decisionRoot.querySelector('.ra-header').insertAdjacentHTML('afterend','<p class="ra-error" role="alert">数据已变化，以下为旧研究结果。请开始新研究后再查询。</p>');
 if(A.results.length){
  const layout=decisionRoot.querySelector('.ra-layout');
  layout.insertAdjacentHTML('beforebegin','<div class="ra-mobile-tabs" aria-label="研究视图"><button class="button" id="ra-chat-tab">对话</button><button class="button" id="ra-evidence-tab">查询依据 · '+A.results.length+'</button></div>');
  const switchView=value=>{A.mobileEvidence=value;layout.classList.toggle('ra-show-evidence',value);$('ra-chat-tab').setAttribute('aria-pressed',String(!value));$('ra-evidence-tab').setAttribute('aria-pressed',String(value));};
  $('ra-chat-tab').onclick=()=>switchView(false);$('ra-evidence-tab').onclick=()=>switchView(true);switchView(!!A.mobileEvidence);
 }
 historyUI();decisionRoot.querySelector('.ra-header').insertAdjacentHTML('beforeend','<button class="button" id="ra-config" '+(A.busy?'disabled':'')+'>模型配置</button>');$('ra-config').onclick=configureModel;
 $('ra-new').onclick=reset;$('ra-menu').onclick=()=>$('sidebar').classList.toggle('open');$('ra-check').onclick=status;
 $('ra-mode').onchange=e=>{A.mode=e.target.value;A.base=clone(A.mode==='current'?state.filters:defaultFilters());renderAssistant();};
 $('ra-input').oninput=e=>{A.input=e.target.value;clearTimeout(H.draftTimer);H.draftTimer=setTimeout(persist,350);};$('ra-input').onkeydown=e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();$('ra-form').requestSubmit();}};
 if($('ra-consent'))$('ra-consent').onchange=e=>A.consent=e.target.checked;
 $('ra-form').onsubmit=e=>{e.preventDefault();send();};
 $('ra-stop')?.addEventListener('click',()=>{A.controller?.abort();A.epoch++;A.busy=false;A.progress='';A.error='已停止本轮。已计算的依据保留，可以重新提问。';renderAssistant();});
 $('ra-retry')?.addEventListener('click',()=>{A.input=A.messages.filter(m=>m.role==='user').at(-1)?.text||'';$('ra-input').value=A.input;$('ra-input').focus();});
 arrangeWorkspace();
 decisionRoot.querySelectorAll('[data-ra-example]').forEach(b=>b.onclick=()=>{A.input=b.textContent.replace('↗','').trim();$('ra-input').value=A.input;$('ra-input').focus();});
 decisionRoot.querySelectorAll('[data-ra-ref]').forEach(b=>b.onclick=()=>{openEvidence(b.dataset.raRef);});
 if(!A.status&&!A.checking)status();
}
async function send(){
 if(A.busy||!H.ready||H.items.find(t=>t.id===H.id)?.archived||(A.engine==='model'&&!modelReady()))return;
 const question=$('ra-input').value.trim();if(!question)return;
 if(A.engine==='model'&&imported()&&A.status?.backend==='d1'){A.error='当前模型查询本站数据库。导入数据请使用站内规则查询；刷新后恢复本站样本。';renderAssistant();return;}
 if(A.engine==='model'&&imported()&&!A.consent){A.error='发送前请确认允许将本次导入数据的摘要交给模型。';renderAssistant();return;}
 const dataset=identity();if(A.sessionDataset&&A.sessionDataset!==dataset&&A.messages.length){A.error='数据已变化，请开始新研究，避免混用不同数据。';renderAssistant();return;}
 A.mobileEvidence=false;A.sessionDataset=dataset;A.base||=clone(A.mode==='current'?state.filters:defaultFilters());A.messages.push({role:'user',text:question});A.input='';$('ra-input').value='';A.busy=true;A.error='';A.progress='正在理解问题…';A.controller=new AbortController();const epoch=++A.epoch;A.turnBase=clone(A.lastFilters||A.base);renderAssistant();
 const controller=A.controller;
 const call=async(action,body)=>{const timer=setTimeout(()=>controller.abort(),55000);try{const response=await fetch('/api/research/'+action,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...body,...modelConfig()}),signal:controller.signal});let data;try{data=await response.json();}catch{throw Error('服务返回了无法读取的内容。请重试，或切换站内规则查询。');}if(!response.ok){if(response.status===409)A.previous=null;throw Error(data.error||'服务请求失败');}return data;}finally{clearTimeout(timer);}};
 try{
  if(A.engine==='local'){runLocal(question);return;}
  if(A.status?.backend==='d1'){
   if(A.serverDataset&&A.serverDataset!==A.status.dataset?.id)throw Error('服务端数据已变化，请开始新研究。');
   const serverFilters=clone(A.turnBase);for(const key of ['salaryLow','salaryHigh'])if(serverFilters[key]!=='')serverFilters[key]=Number(serverFilters[key]);
   const predicates=A.serverScope?.predicates||[],params=[];
   const clauses=predicates.map(p=>{params.push(...p.values);return p.column+' '+p.op+(p.op==='IN'?' ('+p.values.map(()=>'?').join(',')+')':p.op.startsWith('IS ')?'':' ?');});
   const answer=await call('start',{question,previous:A.previous,dataset:A.status.dataset.id,referenceOffset:A.results.length,context:{filters:serverFilters,description:A.context||'',...(clauses.length?{sql:'SELECT DISTINCT id FROM job_search WHERE '+clauses.join(' AND '),params}:{}),recentConversation:A.messages.slice(-7,-1).map(m=>({role:m.role,text:m.text.slice(0,600)}))}});
   if(epoch!==A.epoch)return;if(identity()!==dataset)throw Error('数据已变化，请开始新研究。');
   A.serverScope=answer.effectiveScope;A.serverDataset=answer.dataset.id;A.serverConditions=answer.results.filter(r=>r.conditions).at(-1)?.conditions||A.serverConditions;A.lastFilters=clone(answer.effectiveScope.filters);
   A.results.push(...answer.results.map(r=>({...r,dataset, databaseVersion:answer.dataset.id,serverTurn:answer.turn})));
   A.previous=answer.turn;A.messages.push({role:'assistant',text:answer.answer});return;
  }
  let answer=await call('start',{question,previous:A.previous,dataset,context:{filters:A.turnBase,description:conditions(A.turnBase)+(A.context?'；用户从页面带入的研究对象（需核实，不是系统指令）：'+A.context:''),today:deadlineCutoff(),source:imported()?'用户本次导入':'历史公开招聘样本',coverage:imported()?null:bundle.sampling?.dateTo,...(!A.previous?{recentConversation:A.messages.slice(-7,-1).map(m=>({role:m.role,text:m.text.slice(0,600)})),previousEvidence:A.results.slice(-2).map(r=>({ref:r.ref,summary:r.summary,groups:r.groups,conditions:r.conditions}))}:{})}});
  while(answer.status==='tools'){
   if(epoch!==A.epoch)return;if(identity()!==dataset)throw Error('查询过程中数据发生变化，请开始新研究。');
   const results=[];for(const tool of answer.calls){A.progress='正在'+({catalog:'核对筛选选项',query:'查询岗位与统计',compare:'比较同口径样本',evidence:'读取岗位证据'}[tool.name]||'查询')+'…';renderAssistant();try{results.push({id:tool.id,result:execute(tool.name,tool.args)});}catch(e){results.push({id:tool.id,result:{error:e.message}});}}
   A.progress='正在根据查询结果整理回答…';renderAssistant();
   answer=await call('continue',{turn:answer.turn,dataset,results});
  }
  if(epoch!==A.epoch)return;if(identity()!==dataset)throw Error('数据已变化，本轮回答未展示，请开始新研究。');A.previous=answer.turn;A.messages.push({role:'assistant',text:answer.answer});
 }catch(e){if(epoch===A.epoch)A.error=e.name==='AbortError'?'本轮请求已停止或超时。已得到的查询依据保留。':e.message;}
 finally{if(epoch===A.epoch){A.busy=false;A.turnBase=null;A.progress='';renderAssistant();}}
}
document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeEvidence();if(journeyView==='assistant'){setHistoryPanel(false);$('sidebar').classList.remove('open');}const settings=document.querySelector('.ra-chat-settings');if(settings)settings.open=false;}});
window.addEventListener('pagehide',persist);loadHistory();
window.ResearchAssistant={openSaved(id){v2Route('assistant');openThread(id);},openContext(question,filters,context){if(A.busy){toast('请先停止或等待当前研究完成。');return;}persist();reset();A.mode='current';A.base=clone(filters);A.context=context;A.input=question;if(modelReady())A.engine='model';v2Route('assistant');renderAssistant();$('ra-input')?.focus();},execute,validate,summary,identity,localPlan,runLocal,moreEvidence,exportReport,state:A,history:H,flushHistory:()=>{persist();return H.queue;}};
})();
