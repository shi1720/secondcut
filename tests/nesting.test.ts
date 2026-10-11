import test from 'node:test';import assert from 'node:assert/strict';import {encodeMask,decodeMask,conservativeResize,erodeMask,applyExclusions,nestPatterns,planSvg,type BinaryMask,type Pattern} from '../lib/nesting';
const rect=(w:number,h:number):BinaryMask=>({width:w,height:h,data:new Uint8Array(w*h).fill(1)});const p:Pattern={id:'p',name:'Pocket',widthMm:30,heightMm:20,quantity:6,value:100,shape:'rectangle',rotate:true};
test('RLE roundtrips foreground-first, empty and alternating masks; rejects malformed payloads',()=>{for(const data of [new Uint8Array(12),new Uint8Array(12).fill(1),Uint8Array.from({length:12},(_,i)=>i%2)]){const m={width:4,height:3,data};assert.deepEqual(decodeMask(encodeMask(m)),m);}assert.throws(()=>decodeMask({width:4,height:3,runs:[13]}));assert.throws(()=>decodeMask({width:4,height:3,runs:[-1,13]}));});
test('conservative resize preserves tiny excluded defects',()=>{const m=rect(20,20);m.data[10*20+10]=0;const out=conservativeResize(m,10);assert.equal(out.data[5*10+5],0);});
test('clearance erodes outside borders and exclusion holes',()=>{const m=applyExclusions(rect(40,40),[{x:.5,y:.5,r:.1}]);const e=erodeMask(m,2);assert.equal(e.data[0],0);assert.equal(e.data[20*40+20],0);assert.equal(e.data[5*40+5],1);assert.equal(e.data[20*40+14],0);});
test('all rectangle placements respect holes, edges and pairwise non-overlap',async()=>{const m=applyExclusions(rect(120,100),[{x:.5,y:.5,r:.15}]);const r=await nestPatterns(m,120,[{...p,quantity:12}],3,4);assert.ok(r.placements.length>0);for(const a of r.placements){assert.ok(a.xMm>=3&&a.yMm>=3);assert.ok(a.xMm+a.widthMm<=117&&a.yMm+a.heightMm<=97);for(let y=Math.floor(a.yMm);y<Math.ceil(a.yMm+a.heightMm);y++)for(let x=Math.floor(a.xMm);x<Math.ceil(a.xMm+a.widthMm);x++)assert.equal(m.data[y*m.width+x],1);for(const b of r.placements)if(a!==b)assert.ok(a.xMm+a.widthMm<=b.xMm||b.xMm+b.widthMm<=a.xMm||a.yMm+a.heightMm<=b.yMm||b.yMm+b.heightMm<=a.yMm);}assert.ok(r.placements.length>=r.baselineCount);});
test('oversized requests stay unplaced; invalid dimensions and counts fail visibly',async()=>{const r=await nestPatterns(rect(50,50),50,[{...p,widthMm:60}],2,2);assert.equal(r.placements.length,0);assert.equal(r.unplaced[0].count,6);await assert.rejects(nestPatterns(rect(50,50),NaN,[p],2,2));await assert.rejects(nestPatterns(rect(50,50),100,[{...p,quantity:0}],2,2));});
test('grain lock prohibits rotation and deterministic layouts repeat exactly',async()=>{const args:[BinaryMask,number,Pattern[],number,number]=[rect(100,80),100,[{...p,rotate:false}],2,2];const a=await nestPatterns(...args),b=await nestPatterns(...args);assert.deepEqual(a.placements,b.placements);assert.ok(a.placements.every(p=>p.rotation===0));});
test('SVG uses physical units and escapes untrusted titles',async()=>{const m=rect(100,100),r=await nestPatterns(m,100,[p],2,2);const svg=planSvg(r,100,100,m,'<script>');assert.ok(svg.includes('width="100mm"'));assert.ok(svg.includes('&lt;script&gt;'));assert.ok(!svg.includes('<script>'));assert.ok(svg.includes('50 mm'));});
test('portrait downsampling keeps physical Y scale and mixed shapes inside reviewed material',async()=>{
 const source=rect(105,512);for(let y=180;y<300;y++)for(let x=35;x<70;x++)source.data[y*105+x]=0;
 const r=await nestPatterns(source,105,[{...p,widthMm:20,heightMm:35,quantity:12},{...p,id:'e',shape:'ellipse',widthMm:30,heightMm:40,quantity:8}],3,3);
 assert.ok(r.placements.length>0);
 const inside=(a:typeof r.placements[number],x:number,y:number)=>a.shape==='rectangle'?x>a.xMm&&x<a.xMm+a.widthMm&&y>a.yMm&&y<a.yMm+a.heightMm:((x-a.xMm-a.widthMm/2)/(a.widthMm/2))**2+((y-a.yMm-a.heightMm/2)/(a.heightMm/2))**2<1;
 for(let y=.5;y<512;y++)for(let x=.5;x<105;x++){
 const hits=r.placements.filter(a=>inside(a,x,y));assert.ok(hits.length<=1,'mixed shapes overlap');if(hits.length){assert.equal(source.data[Math.floor(y)*105+Math.floor(x)],1,'piece crosses excluded area');assert.ok(x>=3&&x<=102&&y>=3&&y<=509,'piece violates physical margin');}}
 for(const a of r.placements)assert.ok(a.yMm+a.heightMm<=512);
});
test('subpixel exclusions remove every intersected raster cell and malformed mask dimensions fail',()=>{const out=applyExclusions(rect(10,10),[{x:.5,y:.5,r:.001}]);for(const i of [44,45,54,55])assert.equal(out.data[i],0);assert.throws(()=>decodeMask({width:1.5,height:8,runs:[12]}));assert.throws(()=>decodeMask({width:4096,height:1,runs:[4096]}));assert.throws(()=>applyExclusions(rect(10,10),[{x:NaN,y:.5,r:.1}]));});
test('wide shallow ellipses cannot cross an excluded strip between sampled row centers',async()=>{
 const m=rect(240,20);for(let y=0;y<20;y++)m.data[y*240+224]=0;
 const result=await nestPatterns(m,600,[{...p,shape:'ellipse',widthMm:570,heightMm:5,quantity:1,rotate:false}],0,0);
 assert.equal(result.placements.length,0,'continuous ellipse crosses strip despite center-row silhouette');
});
test('invalid raster controls fail rather than silently corrupting geometry',()=>{
 for(const size of [0,NaN,Infinity,2.5])assert.throws(()=>conservativeResize(rect(10,10),size));
 for(const radius of [-1,NaN,.5])assert.throws(()=>erodeMask(rect(10,10),radius));
});
test('SVG preserves calibrated physical aspect independently of rounded mask dimensions',async()=>{
 const m=rect(100,50),r=await nestPatterns(m,100,[p],2,2);
 assert.throws(()=>planSvg(r,100,NaN,m,'Invalid height'));
 assert.ok(planSvg(r,100,100,m,'Scaled aspect').includes('v2.000'));
 assert.ok(planSvg(r,100,50,m,'Correct aspect').includes('height="85mm"'));
});

test('explicit physical photo height governs packing Y geometry after rounded mask resize',async()=>{
 const m=rect(100,50);const result=await nestPatterns(m,100,[{...p,widthMm:20,heightMm:70,quantity:1,rotate:false}],0,0,undefined,100);
 assert.equal(result.placements.length,1);assert.ok(result.placements[0].yMm+70<=100);
 const defaultResult=await nestPatterns(m,100,[{...p,widthMm:20,heightMm:70,quantity:1,rotate:false}],0,0);assert.equal(defaultResult.placements.length,0);
});

test('extremely shallow photos and oversized pieces stay bounded rather than creating huge footprints',async()=>{
 const result=await nestPatterns(rect(240,1),50,[{...p,widthMm:3000,heightMm:3000}],0,0,undefined,50/2048);
 assert.equal(result.placements.length,0);
 await assert.rejects(nestPatterns(rect(240,1),50,[p],0,0,undefined,1e-300));
});
