import { doc, getDoc, getDocs, collection, runTransaction as firebaseTransaction, type Transaction, writeBatch, setDoc } from 'firebase/firestore';
import { auth, database } from './firebase';
import { PROJECT_LIMITS, projectSchema, type ProjectRecord } from './project-schema';
async function runTransaction<T>(db: typeof database, action: (tx: Transaction) => Promise<T>): Promise<T> {
  for (let attempt=0;;attempt++) {
    try { return await firebaseTransaction(db, action); }
    catch (error) { if ((error as {code?:string}).code !== 'permission-denied' || attempt >= 3) throw error; await new Promise(resolve=>setTimeout(resolve,100*(attempt+1))); }
  }
}
const root = 'secondcutUsers';
const chunkLength = 500_000;
const cache = new Map<string, string>();
export function clearPhotoCache() { for (const url of cache.values()) URL.revokeObjectURL(url); cache.clear(); }
function owner() { const uid = auth.currentUser?.uid; if (!uid) throw new Error('Sign in or open a guest workspace to save your projects.'); return uid; }
const ref = (uid: string, kind: string, id: string) => doc(database, root, uid, kind, id);
const quotaRef = (uid: string) => ref(uid, 'meta', 'quota');
const emptyQuota = { projects: 0, photos: 0, bytes: 0, op: 'init', id: 'init', size: 0 };
async function photoId(uid: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(uid));
  return Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('') + '_' + crypto.randomUUID();
}
async function ownedPhoto(uid: string, image: string) {
  if (image === '/demo/leather.png' || image === '/demo/fabric.png') return;
  const id = image.slice('/api/photos/'.length), s = await getDoc(ref(uid, 'photos', id));
  if (!image.startsWith('/api/photos/') || !s.exists() || s.data().status !== 'ready') throw new Error('Source photograph is unavailable in this workspace.');
}
async function list(uid: string): Promise<ProjectRecord[]> {
  const docs = await getDocs(collection(database, root, uid, 'projects'));
  return docs.docs.map(s => ({ ...projectSchema.parse(s.data().payload), id: s.id, createdAt: s.data().createdAt, updatedAt: s.data().createdAt })).sort((a,b) => b.createdAt-a.createdAt);
}
async function createProject(uid: string, body: string) {
  if (new TextEncoder().encode(body).length > PROJECT_LIMITS.jsonBytes) throw new Error('Project exceeds the 100 KB save limit. Use a simpler mask.');
  const payload = projectSchema.parse(JSON.parse(body)); await ownedPhoto(uid, payload.image);
  const id = crypto.randomUUID(), createdAt = Date.now();
  await runTransaction(database, async tx => {
    const q = await tx.get(quotaRef(uid)), data = q.exists() ? q.data() : emptyQuota;
    const photo = payload.image.startsWith('/api/photos/') ? ref(uid, 'photos', payload.image.slice('/api/photos/'.length)) : null;
    const source = photo ? await tx.get(photo) : null;
    if (photo && (!source?.exists() || source.data().status !== 'ready')) throw new Error('Source photograph is unavailable.');
    if (data.projects >= PROJECT_LIMITS.projects) throw new Error('Your library holds 50 revisions. Export and remove an older revision before saving another.');
    tx.set(ref(uid, 'projects', id), { payload, createdAt });
    if (photo && source) tx.update(photo, { refs: [...source.data()!.refs, id] });
    tx.set(quotaRef(uid), { ...data, projects: data.projects+1, op: 'createProject', id, size: 0 });
  });
  return { ...payload, id, createdAt, updatedAt: createdAt };
}
async function removePhoto(uid: string, id: string) {
  const used = (await list(uid)).some(p => p.image === `/api/photos/${id}`);
  if (used) throw new Error('This photograph is used by another saved revision.');
  const p = await getDoc(ref(uid, 'photos', id)); if (!p.exists()) return;
  const data = p.data();
  await runTransaction(database, async tx => { const current = await tx.get(p.ref); if (!current.exists()) return; if (current.data().refs.length) throw new Error('This photograph is used by a saved revision.'); tx.update(p.ref, { status: 'deleting' }); });
  // Remove chunks before metadata; retry can safely resume incomplete deletions.
  const chunks = await getDocs(collection(database, root, uid, 'photos', id, 'chunks'));
  const batch = writeBatch(database); chunks.docs.forEach(s => batch.delete(s.ref)); await batch.commit();
  await runTransaction(database, async tx => {
    const [q, current] = await Promise.all([tx.get(quotaRef(uid)), tx.get(ref(uid,'photos',id))]);
    if (!current.exists()) return;
    const quota = q.data()!;
    tx.delete(ref(uid,'photos',id));
    tx.set(quotaRef(uid), { ...quota, photos: quota.photos-1, bytes: quota.bytes-data.bytes, op: 'deletePhoto', id, size: data.bytes });
  });
  const key = `${uid}:${id}`; if (cache.has(key)) URL.revokeObjectURL(cache.get(key)!); cache.delete(key);
}
async function removeProject(uid: string, id: string) {
  let image = '';
  await runTransaction(database, async tx => {
    const [q,p] = await Promise.all([tx.get(quotaRef(uid)), tx.get(ref(uid,'projects',id))]); if (!p.exists()) return;
    image = p.data().payload.image;
    const photo = image.startsWith('/api/photos/') ? ref(uid,'photos',image.slice('/api/photos/'.length)) : null;
    const source = photo ? await tx.get(photo) : null;
    if (photo && source?.exists()) tx.update(photo,{refs:source.data().refs.filter((value:string)=>value!==id)});
    tx.delete(ref(uid,'projects',id)); tx.set(quotaRef(uid), { ...q.data(), projects: q.data()!.projects-1, op: 'deleteProject', id, size: 0 });
  });
  if (image.startsWith('/api/photos/') && !(await list(uid)).some(p => p.image===image)) await removePhoto(uid,image.slice('/api/photos/'.length));
}
async function uploadPhoto(uid: string, body: Blob) {
  if (!(body instanceof Blob) || !['image/jpeg','image/png'].includes(body.type) || body.size > PROJECT_LIMITS.photoBytes || body.size < 8) throw new Error('Upload a JPEG or PNG photograph below 5 MB.');
  const bytes = new Uint8Array(await body.arrayBuffer());
  const jpeg = bytes[0]===255 && bytes[1]===216 && bytes[2]===255;
  const png = [137,80,78,71,13,10,26,10].every((n,i) => bytes[i]===n);
  if (!(body.type==='image/jpeg'?jpeg:png)) throw new Error('The photograph format does not match its contents.');
  let binary=''; for(let i=0;i<bytes.length;i+=32768) binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
  const encoded=btoa(binary), chunks=Math.ceil(encoded.length/chunkLength), id=await photoId(uid), photo=ref(uid,'photos',id);
  await runTransaction(database, async tx => {
    const q=await tx.get(quotaRef(uid)), data=q.exists()?q.data():emptyQuota;
    if(data.photos>=PROJECT_LIMITS.photos || data.bytes+body.size>PROJECT_LIMITS.storedPhotoBytes) throw new Error('Your photo storage is full. Remove unused projects before uploading more.');
    tx.set(photo,{bytes:body.size,type:body.type,chunks,status:'uploading',refs:[]});
    tx.set(quotaRef(uid),{...data,photos:data.photos+1,bytes:data.bytes+body.size,op:'createPhoto',id,size:body.size});
  });
  try {
    const batch=writeBatch(database);
    for(let i=0;i<chunks;i++) batch.set(doc(photo,'chunks',String(i)),{data:encoded.slice(i*chunkLength,(i+1)*chunkLength)});
    await batch.commit(); await setDoc(photo,{status:'ready'},{merge:true});
    return `/api/photos/${id}`;
  } catch(error) { try {await removePhoto(uid,id);}catch { /* Preserve the upload error; workspace erase can retry incomplete cleanup. */ } throw error; }
}
export async function resolvePhotoUrl(path: string) {
  if(!path.startsWith('/api/photos/')) return path;
  const uid=owner(), id=path.slice('/api/photos/'.length), key=`${uid}:${id}`;
  if(cache.has(key)) return cache.get(key)!;
  const photo=ref(uid,'photos',id), metadata=await getDoc(photo);
  if(!metadata.exists() || metadata.data().status!=='ready') throw new Error('This saved photograph is unavailable.');
  const data=metadata.data();
  const chunks=await Promise.all(Array.from({length:data.chunks},(_,i)=>getDoc(doc(photo,'chunks',String(i)))));
  if(chunks.some(s=>!s.exists())) throw new Error('This photograph did not finish uploading. Please upload it again.');
  const binary=atob(chunks.map(s=>s.data()!.data).join('')), bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
  if(bytes.byteLength!==data.bytes) throw new Error('Saved photograph is incomplete.');
  if(auth.currentUser?.uid!==uid) throw new Error('Your account changed. Open the photograph again.');
  const url=URL.createObjectURL(new Blob([bytes],{type:data.type})); cache.set(key,url); return url;
}
export async function apiFetch(path: string, options: RequestInit={}) {
  try {
    const uid=owner(), method=options.method||'GET', url=new URL(path,location.origin);
    if(url.origin!==location.origin) throw new Error('Invalid request destination.');
    let body: unknown, status=200;
    if(url.pathname==='/api/projects') {
      if(method==='GET') body={projects:await list(uid)};
      else if(method==='POST') { body={project:await createProject(uid,String(options.body))}; status=201; }
      else if(method==='DELETE') {
        const id=url.searchParams.get('id');
        if(id) await removeProject(uid,id);
        else {
          for(const p of await list(uid)) await removeProject(uid,p.id);
          const photos=await getDocs(collection(database,root,uid,'photos'));
          for(const photo of photos.docs) await removePhoto(uid,photo.id);
        }
        body={ok:true};
      } else throw new Error('Unsupported request.');
    } else if(url.pathname==='/api/photos' && method==='POST') { body={url:await uploadPhoto(uid,options.body as Blob)}; status=201; }
    else if(url.pathname.startsWith('/api/photos/') && method==='DELETE') { await removePhoto(uid,url.pathname.slice('/api/photos/'.length)); body={ok:true}; }
    else throw new Error('Unknown workspace request.');
    return Response.json(body,{status});
  } catch(e) {
    const error=e as Error & {code?:string};
    const message=error.code==='permission-denied' ? 'Your account could not access this saved data. Sign in again and retry.' : error.code==='unavailable' ? 'The workspace is offline. Your current draft is still here. Reconnect and retry.' : error.message || 'The workspace request could not finish.';
    return Response.json({error:message},{status:auth.currentUser?400:401});
  }
}
