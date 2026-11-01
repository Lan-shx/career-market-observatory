import {mkdir,writeFile,open} from 'node:fs/promises';
import {readSnapshot} from './import-jobs.mjs';

const snapshot=await readSnapshot();
await mkdir('.textsql/managed-upload',{recursive:true});
await writeFile('.textsql/managed-upload/metadata.json',JSON.stringify(snapshot.dataset));
const output=await open('.textsql/managed-upload/batches.jsonl','w');
try{for(let offset=0;offset<snapshot.rows.length;offset+=32){const records=snapshot.rows.slice(offset,offset+32).map(r=>JSON.parse(r.raw_json));await output.write(JSON.stringify({action:'batch',dataset:snapshot.dataset.id,offset,records})+'\n');}}
finally{await output.close();}
console.log(JSON.stringify({dataset:snapshot.dataset.id,rows:snapshot.rows.length,batches:Math.ceil(snapshot.rows.length/32)}));
