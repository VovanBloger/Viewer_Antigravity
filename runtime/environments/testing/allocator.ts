import { EnvironmentManager } from '../manager.ts';

const [root,prefix]=process.argv.slice(2);
const manager=new EnvironmentManager(root,id=>({id,path:root}),{min:4000,max:4099});
process.send?.({ready:true});
process.once('message',()=>{
  try {
    manager.registerBot('shared','test');
    let wonShared=false;
    try { manager.allocate({id:`shared-${prefix}`,projectId:'viewer',branch:`shared/${prefix}`,network:'test',botId:'shared'});wonShared=true; }
    catch(error) { if(!(error instanceof Error) || error.message!=='RESOURCE_BUSY') throw error; }
    for(let i=0;i<10;i++) {
      const id=`${prefix}-${i}`;manager.registerBot(id,'test');
      manager.allocate({id,projectId:'viewer',branch:`parallel/${id}`,network:'test',botId:id});
    }
    manager.close();process.send?.({done:true,wonShared});process.disconnect();
  } catch(error) { process.send?.({error:error instanceof Error?error.message:'ALLOCATOR_FAILED'});process.exitCode=1;process.disconnect(); }
});
