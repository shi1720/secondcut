import test from 'node:test';import assert from 'node:assert/strict';import {calibratePhotoWidth} from '../lib/calibration';
test('reference scale handles horizontal and diagonal marks using image aspect',()=>{assert.ok(Math.abs(calibratePhotoWidth({x:.2,y:.5},{x:.7,y:.5},100,1000,500)-200)<1e-9);assert.equal(calibratePhotoWidth({x:.5,y:0},{x:.5,y:1},100,1000,500),200);assert.ok(Math.abs(calibratePhotoWidth({x:0,y:0},{x:.3,y:.8},100,1000,500)-200)<1e-9);});
test('nearby marks, out-of-frame points and impossible scale fail visibly',()=>{assert.throws(()=>calibratePhotoWidth({x:.5,y:.5},{x:.51,y:.5},100,1000,1000));assert.throws(()=>calibratePhotoWidth({x:-.1,y:0},{x:.5,y:.5},100,1000,1000));assert.throws(()=>calibratePhotoWidth({x:0,y:0},{x:1,y:0},5000,1000,1000));});
test('reference measurement is symmetric and rejects fractional image dimensions',()=>{
 const a={x:.12,y:.23},b={x:.82,y:.67};assert.equal(calibratePhotoWidth(a,b,120,1024,768),calibratePhotoWidth(b,a,120,1024,768));
 assert.throws(()=>calibratePhotoWidth(a,b,120,1024.5,768));
});
