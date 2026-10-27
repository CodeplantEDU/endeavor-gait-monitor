// Secrets travel through stdin into sensitive server variables, never through argv or public files.
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
import {randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),stage=resolve(root,'vercel_site');
const link=JSON.parse(readFileSync(resolve(stage,'.vercel/project.json'),'utf8'));
if(link.projectId!=='prj_6lWTHVMT6QyJtfHEUzlZaf4RfEV0'||link.orgId!=='team_1Xl5yVWzbAjaUusySEisORU2')throw Error('Unexpected Vercel project');
if(!process.env.OPENAI_API_KEY?.startsWith('sk-'))throw Error('Existing OPENAI_API_KEY is unavailable');
const codePath=resolve(root,'output/AI_ACCESS_CODE.txt');mkdirSync(dirname(codePath),{recursive:true});
const code=existsSync(codePath)?readFileSync(codePath,'utf8').trim():randomBytes(24).toString('hex');
if(!/^[a-f0-9]{48}$/.test(code))throw Error('Invalid existing access code file');
if(!existsSync(codePath))writeFileSync(codePath,code+'\n',{mode:0o600,flag:'wx'});
const cli=resolve(process.env.APPDATA,'npm/node_modules/vercel/dist/index.js');
for(const[name,value]of [['OPENAI_API_KEY',process.env.OPENAI_API_KEY],['EARLYBIRD_AI_ACCESS_CODE',code],['OPENAI_MODEL','gpt-6.1-terra']]){
 const child=spawnSync(process.execPath,[cli,'env','add',name,'production','--sensitive','--force','--yes','--cwd',stage,'--scope','codeplantedus-projects'],{input:value,encoding:'utf8',timeout:120000,windowsHide:true});
 if(child.status!==0)throw Error('Vercel environment update failed for '+name+' (exit '+child.status+'). No secret was printed.');
 console.log(name+' configured as sensitive production variable');
}
console.log('AI access code saved at '+codePath);
