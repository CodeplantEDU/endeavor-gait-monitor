// Local QA of the exact Vercel public package and Node function; no patient database.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../vercel_site/public'),port=Number(process.env.EARLYBIRD_QA_PORT||8774);
const codeFile=path.resolve(__dirname,'../output/AI_ACCESS_CODE.txt');
if(!process.env.EARLYBIRD_AI_ACCESS_CODE&&fs.existsSync(codeFile))process.env.EARLYBIRD_AI_ACCESS_CODE=fs.readFileSync(codeFile,'utf8').trim();
const types={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.ttf':'font/ttf'};
http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://127.0.0.1:'+port);if(url.pathname==='/api/ai-analyze'){
 let bytes=0,body='';for await(const part of req){bytes+=part.length;if(bytes>3000000){res.writeHead(413);res.end();return;}body+=part;}
 req.body=JSON.parse(body||'null');res.status=s=>{res.statusCode=s;return res;};res.json=d=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(d));};const {default:handler}=await import('../api/ai-analyze.mjs');await handler(req,res);return;
 }const file=path.resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');res.setHeader('Cache-Control','no-store');res.end(fs.readFileSync(file));}catch{res.writeHead(400);res.end();}}).listen(port,'127.0.0.1',()=>console.log('ENDEAVOR browser-storage dev server: http://127.0.0.1:'+port));
