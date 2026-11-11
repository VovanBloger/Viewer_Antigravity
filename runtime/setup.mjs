import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const launch=path.join(root,'runtime','launch.mjs');
const db=path.join(root,'.viewer-live','agent-queue.db');
const servers=Object.fromEntries(['agents','browser'].map(service=>[`viewer_${service}`,{type:'stdio',command:process.execPath,args:[launch,service],env:{VIEWER_QUEUE_DB:db}}]));
const json=JSON.stringify({mcpServers:servers},null,2)+'\n';
const toml=Object.entries(servers).map(([name,s])=>`[mcp_servers.${name}]\ncommand = ${JSON.stringify(s.command)}\nargs = ${JSON.stringify(s.args)}\ncwd = ${JSON.stringify(root)}\nstartup_timeout_sec = 20\ntool_timeout_sec = 660\n\n[mcp_servers.${name}.env]\nVIEWER_QUEUE_DB = ${JSON.stringify(db)}\n`).join('\n');
const files=[[path.join(root,'.mcp.json'),json],[path.join(root,'.codex','config.toml'),toml]];
// Never silently overwrite another MCP setup, including a partial configuration.
for(const [file,content] of files) if(fs.existsSync(file)&&fs.readFileSync(file,'utf8')!==content) throw new Error(`EXISTING_CONFIG_REQUIRES_REVIEW: ${file}`);
for(const [file,content] of files){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,content,'utf8');console.log(file);}
