export function startWatcher(engine,{interval=900,quiet=true}={}){
 let busy=false,stopped=false,last='';
 const tick=async()=>{if(busy||stopped)return;busy=true;try{const result=await engine.sync();const stamp=JSON.stringify([result.indexed,result.errors.length,result.updatedAt]);if(!quiet&&stamp!==last&&result.indexed)process.stderr.write(`[graf] indexed ${result.indexed} file(s)\n`);last=stamp;}catch(e){process.stderr.write(`[graf] watcher: ${e.message}\n`);}finally{busy=false;}};
 const timer=setInterval(tick,interval);timer.unref?.();return {stop(){stopped=true;clearInterval(timer);},sync:tick};
}
