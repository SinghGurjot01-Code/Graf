import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicWrite, now, id } from '../utils.js';

const empty = () => ({ schemaVersion: 2, repository: {}, nodes: {}, edges: {}, files: {}, notes: {}, memories: {}, pins: {}, changes: [], versions: [], proposals: {}, aliases: {}, branchStates: {}, groups: {}, ignoreRules: [], usage: [], usageTotals: {}, updatedAt: now() });
const clone = value => JSON.parse(JSON.stringify(value));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

// Merge a stale process's in-memory map with the most recently committed map.
// Local edits win for keys this process actually changed; unrelated external
// edits survive. This prevents the MCP watch process from restoring old
// pending memories after the CLI has approved them.
function mergeRecordMap(base = {}, local = {}, remote = {}) {
  const merged = { ...remote };
  const keys = new Set([...Object.keys(base), ...Object.keys(local)]);
  for (const key of keys) {
    const before = base[key];
    const current = local[key];
    if (same(current, before)) continue;
    if (current === undefined) delete merged[key];
    else merged[key] = clone(current);
  }
  return merged;
}

function mergeArray(base = [], local = [], remote = []) {
  const keyOf = item => item && typeof item === 'object' && item.id
    ? `id:${item.id}`
    : `value:${JSON.stringify(item)}`;
  const baseMap = new Map(base.map(item => [keyOf(item), item]));
  const localMap = new Map(local.map(item => [keyOf(item), item]));
  const merged = new Map(remote.map(item => [keyOf(item), item]));
  for (const key of new Set([...baseMap.keys(), ...localMap.keys()])) {
    const before = baseMap.get(key);
    const current = localMap.get(key);
    if (same(current, before)) continue;
    if (current === undefined) merged.delete(key);
    else merged.set(key, clone(current));
  }
  return [...merged.values()];
}

function mergeState(base, local, remote) {
  const merged = clone(remote || empty());
  for (const key of Object.keys(empty())) {
    const before = base?.[key];
    const current = local?.[key];
    const latest = remote?.[key];
    if (isRecord(before) && isRecord(current) && isRecord(latest)) {
      merged[key] = mergeRecordMap(before, current, latest);
    } else if (Array.isArray(before) && Array.isArray(current) && Array.isArray(latest)) {
      merged[key] = mergeArray(before, current, latest);
      if (key === 'changes') merged[key].sort((a, b) => (a.seq || 0) - (b.seq || 0)).splice(10000);
      if (key === 'versions') merged[key].sort((a, b) => (a.number || 0) - (b.number || 0));
      if (key === 'usage') { merged[key].sort((a, b) => String(a.ts).localeCompare(String(b.ts))); if (merged[key].length > 3500) merged[key].splice(0, merged[key].length - 3500); }
    } else if (!same(current, before)) {
      merged[key] = current === undefined ? undefined : clone(current);
    }
  }
  return merged;
}


/** Local graph persistence. SQLite is the primary store when node:sqlite exists;
 * graph.json is maintained as a readable recovery/export mirror and fallback. */
export class GraphStore {
  constructor(root) { this.root=root;this.dir=path.join(root,'.graf');this.file=path.join(this.dir,'graph.json');this.dbFile=path.join(this.dir,'graph.db');this.humanFile=path.join(this.dir,'human.json');this.lockFile=path.join(this.dir,'.write.lock');this.data=empty();this.db=null;this.backend='json';this.baseline=null; }
  async open(){
    await fs.mkdir(this.dir,{recursive:true});
    try {
      const {DatabaseSync}=await import('node:sqlite');
      this.db=new DatabaseSync(this.dbFile);
      this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; CREATE TABLE IF NOT EXISTS graf_state (id INTEGER PRIMARY KEY CHECK (id=1), schema_version INTEGER NOT NULL, payload TEXT NOT NULL, updated_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS nodes(id TEXT PRIMARY KEY,kind TEXT NOT NULL,path TEXT,name TEXT NOT NULL,summary TEXT,provenance TEXT,record_json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS edges(src TEXT NOT NULL,dst TEXT NOT NULL,type TEXT NOT NULL,provenance TEXT,confidence REAL,record_json TEXT NOT NULL,PRIMARY KEY(src,dst,type)); CREATE TABLE IF NOT EXISTS files(path TEXT PRIMARY KEY,hash TEXT,mtime REAL,language TEXT,parse_ok INTEGER); CREATE TABLE IF NOT EXISTS notes(id TEXT PRIMARY KEY,node_id TEXT,text TEXT,author TEXT,approved INTEGER,record_json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS memories(id TEXT PRIMARY KEY,title TEXT,content TEXT,status TEXT,source TEXT,record_json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS pins(node_id TEXT PRIMARY KEY,weight INTEGER); CREATE TABLE IF NOT EXISTS snapshots(id TEXT PRIMARY KEY,version_number INTEGER,label TEXT,created_at TEXT,record_json TEXT NOT NULL); CREATE INDEX IF NOT EXISTS idx_edges_dst ON edges(dst); CREATE INDEX IF NOT EXISTS idx_nodes_name ON nodes(name);`);
      try { this.db.exec('CREATE VIRTUAL TABLE IF NOT EXISTS node_search USING fts5(id UNINDEXED,name,path,summary)'); } catch {}
      const row=this.db.prepare('SELECT payload FROM graf_state WHERE id=1').get();
      if(row?.payload)this.data=JSON.parse(row.payload);
      else {this.data=await this.readJsonFallback();this.persistSqlite();}
      this.backend='sqlite';
    } catch(error) {
      try { this.db?.close(); } catch {} this.db=null;
      this.backend='json';this.data=await this.readJsonFallback();
    }
    const defaults=empty();for(const key of Object.keys(defaults))if(this.data[key]===undefined)this.data[key]=defaults[key];
    this.baseline=clone(this.data);
    await this.save();return this;
  }
  async readJsonFallback(){try{return JSON.parse(await fs.readFile(this.file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw new Error(`Cannot read Graf database: ${e.message}`);return empty();}}
  persistSqlite(){if(!this.db)return;const payload=JSON.stringify(this.data);this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('INSERT INTO graf_state(id,schema_version,payload,updated_at) VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET schema_version=excluded.schema_version,payload=excluded.payload,updated_at=excluded.updated_at').run(this.data.schemaVersion||2,payload,this.data.updatedAt||now());
      for(const table of ['nodes','edges','files','notes','memories','pins','snapshots'])this.db.exec(`DELETE FROM ${table}`);
      try { this.db.exec('DELETE FROM node_search'); } catch {}
      const node=this.db.prepare('INSERT INTO nodes VALUES(?,?,?,?,?,?,?)');const fts=this.db.prepare('INSERT INTO node_search(id,name,path,summary) VALUES(?,?,?,?)');for(const n of Object.values(this.data.nodes)){node.run(n.id,n.kind,n.path||null,n.name,n.summary||null,n.provenance||null,JSON.stringify(n));try{fts.run(n.id,n.name,n.path||'',n.summary||'');}catch{}}
      const edge=this.db.prepare('INSERT INTO edges VALUES(?,?,?,?,?,?)');for(const e of Object.values(this.data.edges))edge.run(e.src,e.dst,e.type,e.provenance||null,e.confidence??1,JSON.stringify(e));
      const file=this.db.prepare('INSERT INTO files VALUES(?,?,?,?,?)');for(const f of Object.values(this.data.files))file.run(f.path,f.hash,f.mtime||null,f.language||null,f.parseOk?1:0);
      const note=this.db.prepare('INSERT INTO notes VALUES(?,?,?,?,?,?)');for(const n of Object.values(this.data.notes))note.run(n.id,n.nodeId||null,n.text,n.author,n.approved?1:0,JSON.stringify(n));
      const memory=this.db.prepare('INSERT INTO memories VALUES(?,?,?,?,?,?)');for(const m of Object.values(this.data.memories))memory.run(m.id,m.title,m.content,m.status,m.source,JSON.stringify(m));
      const pin=this.db.prepare('INSERT INTO pins VALUES(?,?)');for(const p of Object.values(this.data.pins))pin.run(p.nodeId,p.weight||1);
      const snapshot=this.db.prepare('INSERT INTO snapshots VALUES(?,?,?,?,?)');for(const v of this.data.versions)snapshot.run(v.id,v.number,v.label,v.createdAt,JSON.stringify(v));
      this.db.exec('COMMIT');
    } catch(error) { this.db.exec('ROLLBACK'); throw error; }}
  async readLatestPersisted(){
    if(this.db){
      const row=this.db.prepare('SELECT payload FROM graf_state WHERE id=1').get();
      if(row?.payload)return JSON.parse(row.payload);
    }
    return this.readJsonFallback();
  }
  async withWriteLock(callback){
    await fs.mkdir(this.dir,{recursive:true});
    const token=id('lock'),deadline=Date.now()+15000;
    while(true){
      let handle;
      try{
        handle=await fs.open(this.lockFile,'wx');
        await handle.writeFile(JSON.stringify({token,pid:process.pid,createdAt:now()}));
        await handle.close();
        break;
      }catch(error){
        try{await handle?.close();}catch{}
        if(error.code!=='EEXIST')throw error;
        try{
          const raw=await fs.readFile(this.lockFile,'utf8');
          const lock=JSON.parse(raw);
          let ownerAlive=true;
          if(Number.isInteger(lock.pid)){
            try{process.kill(lock.pid,0);}catch(e){if(e.code==='ESRCH')ownerAlive=false;}
          }
          const age=Date.now()-(await fs.stat(this.lockFile)).mtimeMs;
          if(!ownerAlive||(!Number.isInteger(lock.pid)&&age>120000)){await fs.unlink(this.lockFile).catch(()=>{});continue;}
        }catch(e){if(e.code==='ENOENT')continue;}
        if(Date.now()>deadline)throw new Error('Timed out waiting for Graf database write lock. Another Graf process may be stuck.');
        await new Promise(resolve=>setTimeout(resolve,25));
      }
    }
    try{return await callback();}
    finally{
      try{const lock=JSON.parse(await fs.readFile(this.lockFile,'utf8'));if(lock.token===token)await fs.unlink(this.lockFile);}catch{}
    }
  }
  async refreshExternal(){
    return this.withWriteLock(async()=>{
      const latest=await this.readLatestPersisted();
      if(!latest)return false;
      this.data=mergeState(this.baseline||latest,this.data,latest);
      this.baseline=clone(latest);
      return true;
    });
  }
  async save(){
    return this.withWriteLock(async()=>{
      const latest=await this.readLatestPersisted();
      if(latest)this.data=mergeState(this.baseline||latest,this.data,latest);
      this.data.updatedAt=now();
      if(this.db)this.persistSqlite();
      await atomicWrite(this.file,JSON.stringify(this.data,null,2));
      this.baseline=clone(this.data);
    });
  }
  record(cause,entity,entityId,before,after,source='system'){
    this.data.changes.push({seq:(this.data.changes.at(-1)?.seq||0)+1,id:id('chg'),ts:now(),cause,entity,entityId,before:before??null,after:after??null,source});
    if(this.data.changes.length>10000)this.data.changes=this.data.changes.slice(-10000);
  }
  upsertNode(node,cause='index'){
    const old=this.data.nodes[node.id];this.data.nodes[node.id]={...old,...node,updatedAt:now(),deletedAt:null};
    if(!old||JSON.stringify(old)!==JSON.stringify(this.data.nodes[node.id]))this.record(cause,'node',node.id,old,this.data.nodes[node.id],node.provenance||'verified');
  }
  upsertEdge(edge,cause='index'){
    const key=`${edge.src}|${edge.type}|${edge.dst}`,old=this.data.edges[key];this.data.edges[key]={...old,...edge,id:key};
    if(!old||JSON.stringify(old)!==JSON.stringify(this.data.edges[key]))this.record(cause,'edge',key,old,this.data.edges[key],edge.provenance||'inferred');
  }
  close(){
    const db=this.db;
    if(!db)return;
    // Detach first so repeated close calls are harmless, even if SQLite throws.
    this.db=null;
    try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch {}
    try { db.close(); } catch (error) {
      throw error;
    }
  }
  async exportHuman(){const human={notes:this.data.notes,memories:this.data.memories,pins:this.data.pins,aliases:this.data.aliases,customEdges:Object.fromEntries(Object.entries(this.data.edges).filter(([,e])=>e.provenance==='manual')),groups:this.data.groups,ignoreRules:this.data.ignoreRules};await atomicWrite(this.humanFile,JSON.stringify(human,null,2));return human;}
  async importHuman(input){const parsed=typeof input==='string'?JSON.parse(input):input;for(const key of ['notes','memories','pins','aliases','groups','ignoreRules'])if(parsed[key])this.data[key]=key==='ignoreRules'?[...new Set([...(this.data[key]||[]),...parsed[key]])]:{...this.data[key],...parsed[key]};for(const edge of Object.values(parsed.customEdges||{}))this.upsertEdge({...edge,provenance:'manual'},'human-import');await this.save();return {imported:true};}
}
