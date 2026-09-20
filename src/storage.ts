export interface StoredPhoto { id:string; dataUrl:string; caption:string }
export interface SessionData { version:1; address:string; hrsz:string; photos:StoredPhoto[]; updatedAt:number }
const DB='property-photosheet'; const STORE='sessions'; const KEY='current';
function openDb():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{const req=indexedDB.open(DB,1);req.onupgradeneeded=()=>req.result.createObjectStore(STORE);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}
export async function saveLocal(data:SessionData){const db=await openDb();await new Promise<void>((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).put(data,KEY);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error)});db.close()}
export async function loadLocal():Promise<SessionData|null>{const db=await openDb();const value=await new Promise<SessionData|undefined>((resolve,reject)=>{const req=db.transaction(STORE).objectStore(STORE).get(KEY);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)});db.close();return value??null}
