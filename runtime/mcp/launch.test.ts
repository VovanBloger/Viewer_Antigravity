import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('stdio launcher resolves both services from a different client working directory', {timeout:20000}, async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'viewer-launch-'));
  try {
    for (const service of ['agents','browser']) {
      const client=new Client({name:'launch-test',version:'1'});
      const transport=new StdioClientTransport({command:process.execPath,args:[path.resolve('runtime/launch.mjs'),service],cwd:dir,env:{...process.env,VIEWER_QUEUE_DB:path.join(dir,'queue.db'),VIEWER_BROWSER_ROOT:path.join(dir,'browser')},stderr:'pipe'});
      // Consume diagnostic stderr so a long-running client never blocks on a full pipe.
      transport.stderr?.on('data',()=>{});
      try {
        await client.connect(transport);
        const tools=await client.listTools();
        assert.ok(tools.tools.some(t=>t.name===(service==='agents'?'submit_agent_task':'browser_snapshot')));
        const response=await client.callTool({name:service==='agents'?'list_projects':'list_browser_sessions',arguments:{}});
        assert.notEqual(response.isError,true);
      } finally { await client.close(); await transport.close(); }
    }
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
