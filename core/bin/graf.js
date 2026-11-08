#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GrafEngine } from '../src/engine.js';
import { McpServer } from '../src/mcp/server.js';
import { startWatcher } from '../src/watcher.js';
import { parseArgs, safeRepoPath } from '../src/utils.js';

const args=parseArgs(process.argv.slice(2)), command=args._[0]||'help', root=path.resolve(args.root||process.cwd());
const engine=new GrafEngine(root);
const print=x=>process.stdout.write((typeof x==='string'?x:JSON.stringify(x,null,2))+'\n');
async function main(){
 let watcher;
 try {
 if(command==='help'||command==='--help'||command==='-h'){print(`Graf - local-first project graph\n\nUsage: graf <command> [options]\n\nCommands:\n  init [--root PATH]                 Initialize and index a project\n  sync [--full]                      Incrementally update the graph\n  status                             Show graph freshness and counts\n  overview [--depth 1]               Print project digest\n  search <query> [--kind function]   Search graph nodes\n  node <node-id>                     Show a node and relationships\n  read <node-id>                     Read exact source context\n  note <text> [--node ID]            Add a human note\n  memory <title> <content>           Add semantic project memory
  memory list                        List non-deleted memories
  memory approve <memory-id>         Approve a pending agent memory
  memory archive <memory-id>         Archive a memory
  memory delete <memory-id>          Soft-delete a memory\n  pin <node-id> [--weight 10]        Pin a node in overview\n  snapshot [label]                   Create a version snapshot\n  diff <version|label>               Diff current graph against version\n  restore <version|label>            Restore version (creates safety versions)\n  export [--format json|jsonl|markdown] [--out FILE]\n  import <human.json>                Import human layer after preview\n  proposals                          List agent proposals\n  approve <proposal-id>              Apply supported human-layer proposal changes\n  serve                              Run MCP stdio server with live sync\n  watch                              Run background polling indexer\n  rebuild                            Rebuild derived graph from source
  pointer [--file AGENTS.md]         Write/update an agent orientation pointer\n\nNode.js >=22.5. Graf data is stored in .graf/.`);return;}
 await engine.init();
 switch(command){
  case 'init': {const result=await engine.sync({full:true});const pointer=args.pointer?await engine.writePointer(args.file||'AGENTS.md'):null;print({initialized:true,root,...result,pointer});break;}
  case 'sync':case 'rebuild':print(await engine.sync({full:command==='rebuild'||!!args.full}));break;
  case 'status':await engine.sync();print(engine.syncStatus());break;
  case 'pointer':print(await engine.writePointer(args.file||'AGENTS.md'));break;
  case 'overview':print(await engine.overview(Number(args.depth)||0));break;
  case 'search':print(engine.search(args._.slice(1).join(' '),args.kind));break;
  case 'node':print(engine.getNode(args._[1]));break;
  case 'impact':print(engine.impactOf(args._[1]));break;
  case 'read':print(await engine.readNode(args._[1],Number(args.context_lines??3)));break;
  case 'note':{const note=engine.addNote({text:args._.slice(1).join(' '),nodeId:args.node,author:'human',approved:true});await engine.store.save();print(note);break;}
  case 'memory':{
    const action=args._[1];
    if(action==='list'&&args._.length===2){print(engine.listMemories());break;}
    if(action==='approve'){if(!args._[2])throw new Error('Usage: graf memory approve <memory-id>');const item=engine.approveMemory(args._[2]);await engine.store.save();print(item);break;}
    if(action==='archive'){if(!args._[2])throw new Error('Usage: graf memory archive <memory-id>');const item=engine.archiveMemory(args._[2]);await engine.store.save();print(item);break;}
    if(action==='delete'){if(!args._[2])throw new Error('Usage: graf memory delete <memory-id>');const result=engine.deleteMemory(args._[2]);await engine.store.save();print(result);break;}
    const title=action,content=args._.slice(2).join(' ');
    if(!title||!content)throw new Error('Usage: graf memory <title> <content> | list | approve <id> | archive <id> | delete <id>');
    const memory=engine.addMemory({title,content,source:'developer'});await engine.store.save();print(memory);break;
  }
  case 'pin':{const n=engine.getNode(args._[1]);engine.store.data.pins[n.id]={nodeId:n.id,weight:Number(args.weight)||10,createdAt:new Date().toISOString()};engine.store.record('pin','pin',n.id,null,engine.store.data.pins[n.id],'human');await engine.store.save();print({pinned:n.id});break;}
  case 'snapshot':print(await engine.snapshot(args._.slice(1).join(' ')||'manual'));break;
  case 'diff':print(engine.diffSince(args._[1]));break;
  case 'restore':print(await engine.restore(args._[1],{scope:args.scope||'all',modulePath:args.module}));break;
  case 'export':{const data=await engine.exportBundle(args.format||'json');if(args.out){const out=safeRepoPath(root,args.out);await fs.writeFile(out,data);print({exported:out});}else print(data);break;}
  case 'import':{const input=await fs.readFile(safeRepoPath(root,args._[1]),'utf8');const preview=JSON.parse(input);print({preview:{notes:Object.keys(preview.notes||{}).length,memories:Object.keys(preview.memories||{}).length,pins:Object.keys(preview.pins||{}).length,customEdges:Object.keys(preview.customEdges||{}).length},message:'Review this preview, then rerun with --confirm.'});if(args.confirm){await engine.store.importHuman(preview);print({imported:true});}break;}
  case 'edge':{if(args._[1]!=='add')throw new Error('Usage: graf edge add <src> <dst> [--type custom]');const edge=engine.addCustomEdge({src:args._[2],dst:args._[3],type:args.type||'custom',confidence:Number(args.confidence??1)});await engine.store.save();print(edge);break;}
  case 'summary':{if(args._[1]!=='set')throw new Error('Usage: graf summary set <node-id> <summary>');const node=engine.setSummary(args._[2],args._.slice(3).join(' '));await engine.store.save();print(node);break;}
  case 'unpin':print(engine.unpin(args._[1]));await engine.store.save();break;
  case 'hide':case 'show':print(engine.setHidden(args._[1],command==='hide'));await engine.store.save();break;
  case 'alias':print(engine.renameAlias(args._[1],args._[2]));await engine.store.save();break;
  case 'group':print(engine.assignGroup(args._[1],args._.slice(2)));await engine.store.save();break;
  case 'history':print(engine.store.data.versions.map(v=>({id:v.id,number:v.number,label:v.label,branch:v.branch,commit:v.commit,createdAt:v.createdAt})));break;
  case 'proposals':print(Object.values(engine.store.data.proposals));break;
  case 'approve':{const p=engine.store.data.proposals[args._[1]];if(!p)throw new Error('Proposal not found');if(p.status!=='pending')throw new Error('Proposal is not pending');for(const c of p.changes){if(c.type==='add_note')engine.addNote({text:c.text,nodeId:c.node_id,author:'human',approved:true});else if(c.type==='add_memory')engine.addMemory({title:c.title,content:c.content,source:'developer',linkedNodes:c.linked_nodes||[]});else if(c.type==='pin'){const n=engine.getNode(c.node_id);engine.store.data.pins[n.id]={nodeId:n.id,weight:c.weight||10};}else throw new Error(`Unsupported proposal change type: ${c.type}`);}p.status='approved';p.approvedAt=new Date().toISOString();engine.store.record('proposal-approve','proposal',p.id,null,p,'human');await engine.store.save();print({approved:p.id});break;}
  case 'serve':{watcher=startWatcher(engine,{quiet:true});const stop=()=>process.stdin.destroy();process.once('SIGINT',stop);process.once('SIGTERM',stop);try{await new McpServer(engine).run();}finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}break;}
  case 'watch':{print({watching:root,intervalMs:900});watcher=startWatcher(engine,{quiet:false});await new Promise(resolve=>{const stop=()=>resolve();process.once('SIGINT',stop);process.once('SIGTERM',stop);});break;}
  default:throw new Error(`Unknown command: ${command}. Run graf help.`);
 }
 } finally {
  try { watcher?.stop(); } catch {}
  try { engine.close(); } catch (error) { process.stderr.write(`graf shutdown warning: ${error.message}\n`); }
 }
}
main().catch(e=>{process.stderr.write(`graf: ${e.message}\n`);process.exitCode=1;});
