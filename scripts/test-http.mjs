/** Local development integration checks. Creates/deletes only its own disposable test records. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const base=process.env.SECONDCUT_TEST_ORIGIN||'http://127.0.0.1:5175';
if(!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base))throw new Error('Integration checks are restricted to a local disposable preview.');
const auth={cookie:'__sites_local_auth=1'};let ids=[],photo;const checks=[];
async function call(path,init={}){return fetch(base+path,init);}
async function expect(name,path,init,status){const r=await call(path,init);assert.equal(r.status,status,`${name}: ${await r.clone().text()}`);checks.push(name);return r;}
const write=body=>({method:'POST',headers:{...auth,origin:base,'content-type':'application/json'},body:JSON.stringify(body)});
try{
 await expect('anonymous project access denied','/api/projects',{},401);
 await expect('forged identity headers stripped','/api/projects',{headers:{'oai-authenticated-user-id':'attacker','oai-authenticated-user-email':'attacker@example.test'}},401);
 await expect('cross-origin writes denied','/api/projects',{method:'POST',headers:{...auth,origin:'https://attacker.example','content-type':'application/json'},body:'{}'},403);
 await expect('malformed project rejected','/api/projects',write({name:'invalid'}),400);
 await expect('oversized project rejected','/api/projects',{...write({}),body:JSON.stringify({name:'x'.repeat(100001)})},413);
 await expect('non-image uploads rejected','/api/photos',{method:'POST',headers:auth,body:'not an image'},415);
 const upload=await expect('real PNG upload stored','/api/photos',{method:'POST',headers:auth,body:await readFile(new URL('../public/demo/leather.png',import.meta.url))},201);photo=(await upload.json()).url;
 await expect('anonymous photograph access denied',photo,{},401);
 const image=await expect('owner photograph readable',photo,{headers:auth},200);assert.match(image.headers.get('cache-control'),/private, no-store/);assert.equal(image.headers.get('x-content-type-options'),'nosniff');
 await expect('foreign photograph namespace denied','/api/photos/'+'0'.repeat(64)+'_00000000-0000-4000-8000-000000000000',{headers:auth},404);
 const document={name:'Integration '+crypto.randomUUID(),image:photo,widthMm:300,clearanceMm:3,gapMm:3,mask:{width:32,height:32,runs:[0,1024]},exclusions:[],patterns:[{id:'p',name:'Test blank',widthMm:30,heightMm:30,quantity:1,value:0,shape:'rectangle',rotate:false}],reviewed:true,model:'integration fixture, not model validation',points:[{x:.5,y:.5,label:1}],currency:'INR'};
 for(let i=0;i<2;i++){const saved=await expect('owner project snapshot saved','/api/projects',write(document),201);ids.push((await saved.json()).project.id);}
 const listing=await expect('owner project list available','/api/projects',{headers:auth},200);assert.equal((await listing.json()).projects.filter(p=>ids.includes(p.id)).length,2);
 await expect('referenced photograph deletion guarded',photo,{method:'DELETE',headers:auth},409);
 await expect('delete one project','/api/projects?id='+ids.shift(),{method:'DELETE',headers:auth},200);
 await expect('shared source retained',photo,{headers:auth},200);
 await expect('delete final project','/api/projects?id='+ids.shift(),{method:'DELETE',headers:auth},200);
 await expect('unreferenced source removed',photo,{headers:auth},404);photo=undefined;
 console.log(JSON.stringify({passed:checks.length,checks,origin:base,date:new Date().toISOString(),limits:'Local simulated sign-in; production OAuth and independent-account isolation need hosted verification.'},null,2));
}finally{for(const id of ids)await call('/api/projects?id='+id,{method:'DELETE',headers:auth});if(photo)await call(photo,{method:'DELETE',headers:auth});}
