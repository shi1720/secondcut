import test from 'node:test';
import assert from 'node:assert/strict';
import { assessMask, fitDimensions, largestPromptComponent, maskArea, paintDisk, resizeMaskNearest, selectBestMask, selectPromptConsistentMask, subtractMask, type Mask } from '../lib/mask';
const m=(rows:string[]):Mask=>({width:rows[0].length,height:rows.length,data:Uint8Array.from(rows.join(''),c=>c==='1'?1:0)});
test('tensor candidate slicing selects actual highest predicted IoU, not the first channel',()=>{
 const result=selectBestMask([0,0,0,0,1,0,0,1,1,1,1,1],[1,3,2,2],[.5,.9,.7]);
 assert.equal(result.candidate,1);assert.deepEqual([...result.mask.data],[1,0,0,1]);assert.equal(result.score,.9);
 assert.throws(()=>selectBestMask([1],[1,1,2,2],[.9]));assert.throws(()=>selectBestMask([1],[1,1,1,1],[NaN]));
});
test('prompted component excludes larger disconnected background islands',()=>{
 const a=m(['110000','110011','000011','000011']);
 const out=largestPromptComponent(a,[{x:.1,y:.1,label:1}]);
 assert.equal(maskArea(out),4);assert.equal(out.data[4],0);assert.equal(maskArea(a),10);
});
test('component preserves holes and uses four-connectivity rather than diagonal bridges',()=>{
 const a=m(['11100','10100','11100','00010']);
 const out=largestPromptComponent(a,[{x:.1,y:.1,label:1}]);
 assert.equal(maskArea(out),8);assert.equal(out.data[6],0);assert.equal(out.data[18],0);
 assert.throws(()=>largestPromptComponent(a,[{x:.8,y:.8,label:1}]));
});
test('quality gates reject full-frame selection and contradictory prompts',()=>{
 assert.ok(assessMask(m(['11','11']),[{x:0,y:0,label:1}]).some(s=>s.includes('entire image')));
 const a=m(['1100','1100','0000','0000']);
 assert.ok(assessMask(a,[{x:.1,y:.1,label:0}]).some(s=>s.includes('background')));
 assert.ok(assessMask(a,[{x:.9,y:.9,label:1}]).some(s=>s.includes('foreground')));
});
test('immutable brush and exclusions cannot reintroduce a hole',()=>{
 const a=m(['00000','00000','00000','00000','00000']);
 const b=paintDisk(a,.5,.5,1,1);assert.equal(maskArea(a),0);assert.equal(maskArea(b),5);
 const c=paintDisk(b,.5,.5,.1,0);assert.equal(maskArea(c),4);
 assert.equal(maskArea(subtractMask(b,m(['00000','00000','00100','00000','00000']))),4);
 assert.throws(()=>paintDisk(a,2,0,1,1));assert.throws(()=>subtractMask(a,m(['1'])));
});
test('nearest resize preserves binary values and aspect fit never exceeds512',()=>{
 assert.deepEqual(fitDimensions(1600,1200),{width:512,height:384});
 assert.deepEqual(fitDimensions(100,50),{width:100,height:50});
 const out=resizeMaskNearest(m(['10','01']),4,4);
 assert.equal(maskArea(out),8);assert.deepEqual([...new Set(out.data)].sort(),[0,1]);
 assert.throws(()=>fitDimensions(0,100));
});


test('prompt filtering rejects an inconsistent highest score and ranks valid alternatives',()=>{
 const full=new Uint8Array(64).fill(1),small=new Uint8Array(64),larger=new Uint8Array(64);
 small[9]=small[10]=small[17]=small[18]=1;
 larger.set(small);larger[11]=larger[19]=1;
 const data=Uint8Array.from([...full,...small,...larger]);
 const points=[{x:.15,y:.15,label:1 as const},{x:.95,y:.95,label:0 as const}];
 const result=selectPromptConsistentMask(data,[1,3,8,8],[.99,.92,.88],points);
 assert.equal(result.candidate,1);assert.equal(maskArea(result.mask),4);
 assert.equal(result.score,.92);
});
test('all-invalid model candidates fail visibly and never become threshold masks',()=>{
 const points=[{x:.5,y:.5,label:1 as const},{x:.05,y:.05,label:0 as const}];
 assert.throws(()=>selectPromptConsistentMask(new Uint8Array(64).fill(1),[1,1,8,8],[.99],points),/No model candidate passed/);
 assert.throws(()=>selectPromptConsistentMask(new Uint8Array(64),[1,1,8,8],[.99],points),/No model candidate passed/);
});
