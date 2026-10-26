import {afterEach,expect,it,vi} from 'vitest';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {HistoryStore} from '../electron/storage/history';
import {NoteStore} from '../electron/storage/store';
import {defaultSettings} from '../src/shared/defaults';
const fault=vi.hoisted(()=>({index:'',pending:''}));
vi.mock('node:fs/promises',async original=>{const fs=await original<typeof import('node:fs/promises')>();return {...fs,rename:async(from:string,to:string)=>{if(to===fault.index||to===fault.pending) throw Error('generated index commit failure');return fs.rename(from,to)}}});
const dirs:string[]=[];const stores:NoteStore[]=[];
afterEach(async()=>{fault.index='';fault.pending='';vi.restoreAllMocks();for(const store of stores.splice(0))await store.dispose();for(const dir of dirs.splice(0))await rm(dir,{recursive:true,force:true});});
async function fixture(){const dir=await mkdtemp(path.join(os.tmpdir(),'yuanjian-history-review-'));dirs.push(dir);const root=path.join(dir,'notes');await mkdir(root);const file=path.join(root,'note.md');await writeFile(file,'initial');const store=new NoteStore(path.join(dir,'data'));stores.push(store);await store.initialize();await store.approveDirectory(root);await store.saveSettings({...store.getSettings(),roots:[root]});return {store,file,root,dir};}
it('review prune failure must keep the committed in-memory history index',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'yuanjian-prune-review-'));dirs.push(dir);const file=path.join(dir,'note.md');await writeFile(file,'later');let now=1800000000000;
 const make=()=>new HistoryStore({directory:dir,settings:()=>({...defaultSettings,historyDays:1}),now:()=>now,resolveAsset:async()=>{throw Error('no images')}});
 const history=make();await history.initialize();await history.snapshot(file,'old','first');now+=2*86400000;await history.snapshot(file,'later','second');const before=history.list(file).map(e=>e.id);fault.index=path.join(dir,'history','index.json');await expect(history.prune()).rejects.toThrow('generated index commit failure');
 const reopened=make();await reopened.initialize();console.info('prune-failure-observation',JSON.stringify({memory:history.list(file).length,disk:reopened.list(file).length}));expect(history.list(file).map(e=>e.id)).toEqual(before);
});
it('review delayed history retry must not reorder an older save ahead of a later committed save',async()=>{
 const {store,file}=await fixture();const note=(await store.openFile(file))!;const real=store.history.snapshot.bind(store.history);const spy=vi.spyOn(store.history,'snapshot').mockImplementation(async(...args)=>{if(args[2]==='编辑后')throw Error('generated history failure');return real(...args)});
 const first=await store.saveFile({...note,baseContent:note.content,content:'first-saved-version'});spy.mockRestore();const next=(await store.openFile(file))!;await store.saveFile({...next,baseContent:next.content,content:'second-saved-version'});await store.retryHistoryWork(first.historyRetryId!);const entries=await store.listHistory(file);const latest=(await store.readHistory(entries[0].id)).content;console.info('retry-order-observation',JSON.stringify({body:await readFile(file,'utf8'),latestHistory:latest}));expect(latest).toBe('second-saved-version');
});
it('review captured-image commit failure preserves frozen bytes after a restart control',async()=>{
 const {store,file,root,dir}=await fixture();const image=path.join(root,'image.png');await writeFile(image,'image-at-save');const note=(await store.openFile(file))!;const real=store.history.snapshot.bind(store.history);const spy=vi.spyOn(store.history,'snapshot').mockImplementation(async(...args)=>{if(args[2]==='编辑后')fault.index=path.join(dir,'data','history','index.json');try{return await real(...args)}finally{fault.index=''}});
 const outcome=await store.saveFile({...note,baseContent:note.content,content:'saved ![image](image.png)'});spy.mockRestore();await store.dispose();await writeFile(image,'later-image-version');const reopened=new NoteStore(path.join(dir,'data'));stores.push(reopened);await reopened.initialize();await reopened.retryHistoryWork(outcome.historyRetryId!);const entry=(await reopened.listHistory(file)).find(e=>e.reason==='编辑后')!;const copies=await reopened.history.imageCopies(entry.id);console.info('prepared-persistence-control',JSON.stringify({actual:copies[0]?.bytes.toString()}));expect(copies[0].bytes.toString()).toBe('image-at-save');
});
