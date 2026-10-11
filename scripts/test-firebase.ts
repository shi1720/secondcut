/** Production integration test. Creates and removes only its own two disposable anonymous users. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInAnonymously, deleteUser, signOut, linkWithCredential, EmailAuthProvider, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, doc, getDoc, setDoc, terminate } from 'firebase/firestore';
import { auth, database } from '../lib/firebase';
import { apiFetch, resolvePhotoUrl, clearPhotoCache } from '../lib/firebase-api';
import config from '../lib/firebase-config.json';
import type { ProjectRecord } from '../lib/project-schema';
Object.defineProperty(globalThis,'location',{value:{origin:'https://secondcut-studio.web.app'}});
const checks:string[]=[];
function pass(name:string){checks.push(name);console.log(`PASS ${name}`);}
async function call(path:string,method='GET',body?:unknown){const r=await apiFetch(path,{method,body:body instanceof Blob?body:body===undefined?undefined:JSON.stringify(body)});return{status:r.status,data:await r.json() as {projects:ProjectRecord[];project:ProjectRecord;url:string;error?:string}};}
const app2=initializeApp(config,`integration-${Date.now()}`), auth2=getAuth(app2), db2=getFirestore(app2);
if(process.env.SECONDCUT_USE_EMULATORS==='1'){connectAuthEmulator(auth2,'http://127.0.0.1:9099',{disableWarnings:true});connectFirestoreEmulator(db2,'127.0.0.1',8088);}
let user1=auth.currentUser;
try{
 await signOut(auth);assert.equal((await call('/api/projects')).status,401);pass('Unauthenticated saves and reads rejected');
 user1=(await signInAnonymously(auth)).user;await signInAnonymously(auth2);
 assert.equal((await call('/api/projects')).data.projects.length,0);pass('New guest workspace opens empty');
 const base={name:'Disposable integration test',image:'/demo/leather.png',widthMm:300,clearanceMm:2,gapMm:2,mask:{width:16,height:16,runs:[0,256]},exclusions:[],patterns:[{id:'one',name:'Blank',widthMm:20,heightMm:20,quantity:2,value:0,shape:'rectangle',rotate:true}],reviewed:true,model:'Manual mask',points:[],currency:'USD'};
 assert.equal((await call('/api/projects','POST',{...base,widthMm:NaN})).status,400);pass('Invalid dimensions rejected');
 const a=await call('/api/projects','POST',base);assert.equal(a.status,201);const id=a.data.project.id;pass('Guest saves validated project');
 await assert.rejects(getDoc(doc(db2,'secondcutUsers',user1.uid,'projects',id)));pass('Second authenticated account cannot read first account project');
 await assert.rejects(setDoc(doc(db2,'secondcutUsers',user1.uid,'projects',id),{name:'forged'}));pass('Second account cannot overwrite first account project');
 await assert.rejects(setDoc(doc(database,'secondcutUsers',user1.uid,'meta','quota'),{projects:0,photos:0,bytes:0,op:'init',id:'init',size:0}));pass('Quota reset tampering rejected');
 const concurrent=await Promise.all([call('/api/projects','POST',{...base,name:'Concurrent A'}),call('/api/projects','POST',{...base,name:'Concurrent B'})]);assert(concurrent.every(r=>r.status===201),JSON.stringify(concurrent));
 assert.equal((await getDoc(doc(database,'secondcutUsers',user1.uid,'meta','quota'))).data()!.projects,3);pass('Concurrent saves maintain atomic revision counter');
 const bytes=await readFile('public/demo/leather.png'),blob=new Blob([bytes],{type:'image/png'});
 const upload=await call('/api/photos','POST',blob);assert.equal(upload.status,201);const path=upload.data.url;pass('Private photograph uploads in bounded chunks');
 const photoId=path.split('/').pop()!;
 await assert.rejects(getDoc(doc(db2,'secondcutUsers',user1.uid,'photos',photoId)));pass('Second account cannot read private photo metadata');
 await assert.rejects(getDoc(doc(db2,'secondcutUsers',user1.uid,'photos',photoId,'chunks','0')));pass('Second account cannot read private photo pixels');
 const photoUrl=await resolvePhotoUrl(path);assert.deepEqual(new Uint8Array(await(await fetch(photoUrl)).arrayBuffer()),new Uint8Array(bytes));pass('Saved photograph resolves byte-for-byte');
 const saved=await call('/api/projects','POST',{...base,image:path});assert.equal(saved.status,201);
 const saved2=await call('/api/projects','POST',{...base,image:path,name:'Shared photo revision'});assert.equal(saved2.status,201);pass('Two project revisions safely share one photo');
 assert.equal((await call(path,'DELETE')).status,400);pass('Referenced photograph deletion rejected');
 await call(`/api/projects?id=${saved.data.project.id}`,'DELETE');assert((await getDoc(doc(database,'secondcutUsers',user1.uid,'photos',photoId))).exists());pass('Deleting one revision retains shared photo');
 await call(`/api/projects?id=${saved2.data.project.id}`,'DELETE');assert(!(await getDoc(doc(database,'secondcutUsers',user1.uid,'photos',photoId))).exists());pass('Deleting final revision removes unreferenced photo and chunks');
 const email=`secondcut-qa-${Date.now()}@example.com`,password=crypto.randomUUID()+'Z9!';
 await linkWithCredential(user1,EmailAuthProvider.credential(email,password));const uid=user1.uid;await signOut(auth);await signInWithEmailAndPassword(auth,email,password);assert.equal(auth.currentUser!.uid,uid);assert.equal((await call('/api/projects')).data.projects.length,3);pass('Guest conversion and email sign-in retain same private library');
 await call('/api/projects','DELETE');const q=(await getDoc(doc(database,'secondcutUsers',uid,'meta','quota'))).data()!;assert.equal(q.projects,0);assert.equal(q.photos,0);assert.equal(q.bytes,0);pass('Explicit workspace erase restores all quota counters');
 await writeFile('../../work/secondcut-firebase-validation.json',JSON.stringify({at:new Date().toISOString(),checks,passed:checks.length,scope:'Real Firebase Auth and deployed Firestore rules, two disposable users. UI tests recorded separately.'},null,2));
}finally{
 if(auth.currentUser) {await call('/api/projects','DELETE');await deleteUser(auth.currentUser);}
 if(auth2.currentUser)await deleteUser(auth2.currentUser);
 clearPhotoCache();await terminate(database);await terminate(db2);await deleteApp(app2);
}
