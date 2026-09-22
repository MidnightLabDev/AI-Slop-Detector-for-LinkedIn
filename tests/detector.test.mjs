import test from 'node:test';
import assert from 'node:assert/strict';
import { createDetector } from '../detector.mjs';
import { requestBody,parseModelResponse } from '../classifier.mjs';
import '../policy.js';

const ID='a'.repeat(32),KEY='test-key-not-a-real-credential';
const TEXT='Success starts when excuses stop. Winners wake up hungry. Dream big and work harder. Your only limit is your mindset.';
const POPUP={id:ID,url:`chrome-extension://${ID}/popup.html`};
const FEED={id:ID,url:'https://www.linkedin.com/feed/',tab:{id:1}};
function modelBody(){return {model:'jev-1.13.0',answers:{formulaic:{type:'noul',noul:.91},engagement:{type:'noul',noul:.1},motivation:{type:'noul',noul:.97},jargon:{type:'noul',noul:.03},pseudoInsight:{type:'noul',noul:.88},context:{type:'choice',choice:'ordinary',probabilities:{ordinary:.97,critique:.02,insufficient:.01},confidence:.91},language:{type:'choice',choice:'en',probabilities:{en:.98,ar:.005,tr:.005,mixed:.005,other:.005},confidence:.94},verdict:{type:'choice',choice:'flag',probabilities:{flag:.97,clear:.02,uncertain:.01},confidence:.92}},usage:{input_tokens:1250,output_tokens:120}};}
function setup({fetcher,timeoutMs=1000,local={},session={}}={}){
  const calls=[],broadcasts=[],levels=[],listeners=[];let time=Date.UTC(2026,8,21,12);
  const area=(data,name)=>({async get(keys){await Promise.resolve();return Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,structuredClone(data[k])]));},async set(values){await Promise.resolve();Object.assign(data,structuredClone(values));},async remove(keys){for(const key of Array.isArray(keys)?keys:[keys])delete data[key];},async setAccessLevel(value){levels.push({area:name,...value});}});
  const chrome={storage:{local:area(local,'local'),session:area(session,'session')},tabs:{query:async()=>[{id:1}],sendMessage:async(id,data)=>broadcasts.push({id,data})},runtime:{id:ID,getURL:path=>`chrome-extension://${ID}/${path}`,onMessage:{addListener:fn=>listeners.push(fn)}}};
  createDetector(chrome,{now:()=>time,timeoutMs,fetcher:async(url,init)=>{calls.push({url,init});return fetcher?fetcher(url,init):Response.json(modelBody());}}).install();
  const send=(message,sender=POPUP)=>new Promise(resolve=>{if(!listeners[0](message,sender,resolve))resolve(undefined);});
  const save=(remember=false,key=KEY)=>send({type:'SAVE_KEY',apiKey:key,remember});
  const enable=()=>send({type:'UPDATE_SETTINGS',settings:{enabled:true}});
  const classify=text=>send({type:'CLASSIFY',text:text||TEXT},FEED);
  return {local,session,calls,broadcasts,levels,send,save,enable,classify,advance:ms=>time+=ms};
}
test('default key storage is session only, and saving does not start scanning or call the API',async()=>{
  const h=setup();const r=await h.save();assert.equal(r.ok,true);assert.equal(r.keyMode,'session');assert.equal(r.settings.enabled,false);assert.equal(h.session.sessionKey,KEY);assert.equal(h.local.savedKey,undefined);assert.equal(h.calls.length,0);
  assert.deepEqual(h.levels,[{area:'local',accessLevel:'TRUSTED_CONTEXTS'},{area:'session',accessLevel:'TRUSTED_CONTEXTS'}]);
});
test('remember mode persists only one copy and switching mode deletes the previous copy',async()=>{
  const h=setup();await h.save(true);assert.equal(h.local.savedKey,KEY);assert.equal(h.session.sessionKey,undefined);await h.save(false);assert.equal(h.local.savedKey,undefined);assert.equal(h.session.sessionKey,KEY);await h.save(true);assert.equal(h.session.sessionKey,undefined);
});
test('key and test actions are restricted to the popup, and content settings never contain the key',async()=>{
  const h=setup();await h.save();const r=await h.send({type:'GET_SETTINGS'},FEED);assert.equal(r.settings.connected,true);assert.ok(!JSON.stringify(r).includes(KEY));
  for(const type of ['GET_STATUS','SAVE_KEY','REMOVE_KEY','TEST_KEY','UPDATE_SETTINGS'])assert.equal((await h.send({type,apiKey:'evil-key-test'},FEED)).error,'forbidden');
  assert.equal(await h.send({type:'GET_STATUS'},{id:'b'.repeat(32),url:POPUP.url}),undefined);assert.equal(h.calls.length,0);
});
test('safe settings load on other LinkedIn routes, but those routes cannot request classification',async()=>{
  const h=setup();await h.save();await h.enable();const sender={...FEED,url:'https://www.linkedin.com/messaging/'};assert.equal((await h.send({type:'GET_SETTINGS'},sender)).ok,true);assert.equal((await h.send({type:'CLASSIFY',text:TEXT},sender)).ok,false);assert.equal(h.calls.length,0);
});
test('empty and multiline keys are rejected without changing the stored key',async()=>{
  const h=setup();await h.save();for(const bad of ['', 'abc', 'first line\nsecond line', 'x'.repeat(2049)])assert.equal((await h.save(false,bad)).ok,false);assert.equal(h.session.sessionKey,KEY);
});
test('pasted Bearer prefix and surrounding whitespace are handled',async()=>{
  const h=setup();await h.save(false,'  Bearer '+KEY+'  ');assert.equal(h.session.sessionKey,KEY);
});
test('a key test sends one fixed sample directly to TypeSafe without enabling feed scanning',async()=>{
  const h=setup();await h.save();const r=await h.send({type:'TEST_KEY'});assert.equal(r.ok,true);assert.equal(r.tested,true);assert.equal(h.calls.length,1);assert.equal(h.calls[0].url,'https://api.typesafe.ai/v1/systemone');assert.equal(h.calls[0].init.headers.Authorization,'Bearer '+KEY);assert.equal(h.calls[0].init.redirect,'error');assert.equal(h.calls[0].init.credentials,'omit');assert.equal((await h.send({type:'GET_STATUS'})).settings.enabled,false);assert.equal(h.local.keyStatus,'verified');assert.equal(h.local.usage.requests,1);
});
test('disabled scanning and missing keys never produce provider calls',async()=>{
  const h=setup();assert.equal((await h.enable()).error,'missing_key');assert.equal((await h.classify()).error,'missing_key');await h.save();assert.equal((await h.classify()).error,'disabled');assert.equal(h.calls.length,0);
});
test('API requests use the pinned model and fixed rubric, never caller supplied targets or questions',async()=>{
  const h=setup();await h.save();await h.enable();assert.equal((await h.send({type:'CLASSIFY',text:TEXT,url:'https://evil.example'},FEED)).error,'invalid_request');assert.equal(h.calls.length,0);
  assert.equal((await h.classify()).ok,true);const body=JSON.parse(h.calls[0].init.body);assert.equal(body.model,'jev-1.13.0');assert.deepEqual(body.state,{post_text:TEXT});assert.equal(Object.keys(body.questions).length,8);assert.match(body.questions.verdict.instructions,/untrusted/);
});
test('repeated posts use the local hash cache, with no raw text persisted in that cache',async()=>{
  const h=setup();await h.save();await h.enable();await h.classify();const r=await h.classify();assert.equal(r.cached,true);assert.equal(h.calls.length,1);assert.ok(!JSON.stringify(h.session.cache).includes(TEXT));assert.equal(h.local.usage.requests,1);assert.equal(h.local.usage.inputTokens,1250);
});
test('concurrent duplicate posts are coalesced into one paid request',async()=>{
  let finish;const h=setup({fetcher:()=>new Promise(resolve=>finish=()=>resolve(Response.json(modelBody())))});await h.save();await h.enable();const a=h.classify(),b=h.classify();while(!finish)await new Promise(resolve=>setImmediate(resolve));finish();const replies=await Promise.all([a,b]);assert.ok(replies.every(r=>r.ok));assert.equal(h.calls.length,1);assert.equal(h.local.usage.requests,1);
});
test('daily request reservations are persisted before concurrent calls and stop at the configured limit',async()=>{
  let finish;const h=setup({fetcher:()=>new Promise(resolve=>finish=()=>resolve(Response.json(modelBody())))});await h.save();await h.enable();await h.send({type:'UPDATE_SETTINGS',settings:{dailyLimit:10}});h.local.usage={day:'2026-09-21',requests:9,inputTokens:0,minute:0,minuteRequests:0};
  const a=h.classify();while(!finish)await new Promise(resolve=>setImmediate(resolve));const b=await h.classify(TEXT+' A different post.');assert.equal(b.error,'daily_limit');assert.equal(h.local.usage.requests,10);assert.equal(h.calls.length,1);finish();assert.equal((await a).ok,true);
});
test('failed requests count toward local usage and do not retry',async()=>{
  const h=setup({fetcher:()=>Response.json({error:'failure'},{status:500})});await h.save();await h.enable();const r=await h.classify();assert.equal(r.error,'provider_error');assert.equal(h.local.usage.requests,1);assert.equal((await h.classify(TEXT+' More.')).error,'paused');assert.equal(h.calls.length,1);assert.equal(h.session.cache,undefined);
});
test('rejected keys disable scanning without exposing the provider response body',async()=>{
  const h=setup({fetcher:()=>Response.json({error:'sensitive '+KEY},{status:401})});await h.save();await h.enable();const r=await h.classify();assert.equal(r.error,'invalid_key');assert.ok(!JSON.stringify(r).includes(KEY));assert.equal(h.local.keyStatus,'invalid');assert.equal(h.local.settings.enabled,false);assert.equal((await h.enable()).error,'invalid_key');
});
test('provider overload honors bounded Retry After and never produces a clear result',async()=>{
  const h=setup({fetcher:()=>new Response('Busy',{status:429,headers:{'Retry-After':'120'}})});await h.save();await h.enable();const r=await h.classify();assert.equal(r.retryAfter,120);assert.equal(r.result,undefined);assert.equal(h.calls.length,1);
});
test('malformed model responses remain unclassified and are not cached',async()=>{
  const h=setup({fetcher:()=>Response.json({model:'jev-1.13.0',answers:{}})});await h.save();await h.enable();const r=await h.classify();assert.equal(r.error,'invalid_response');assert.equal(h.session.cache,undefined);
});
test('request timeout returns a useful error and leaves one counted attempt',async()=>{
  const h=setup({timeoutMs:15,fetcher:(_,init)=>new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}))});await h.save();await h.enable();assert.equal((await h.classify()).error,'network_error');assert.equal(h.local.usage.requests,1);assert.equal(h.calls.length,1);
});
test('removing a key cancels active work, clears the cache and prevents late result storage',async()=>{
  let finish;const h=setup({fetcher:()=>new Promise(resolve=>finish=()=>resolve(Response.json(modelBody())))});await h.save(true);await h.enable();const work=h.classify();while(!finish)await new Promise(resolve=>setImmediate(resolve));await h.send({type:'REMOVE_KEY'});finish();assert.equal((await work).error,'cancelled');assert.equal(h.local.savedKey,undefined);assert.equal(h.session.sessionKey,undefined);assert.equal(h.session.cache,undefined);assert.equal(h.local.settings.enabled,false);
});
test('a late response for a replaced key cannot invalidate the new key',async()=>{
  let finish;const h=setup({fetcher:()=>new Promise(resolve=>finish=()=>resolve(Response.json({error:'bad'},{status:401})))});await h.save();await h.enable();const work=h.classify();while(!finish)await new Promise(resolve=>setImmediate(resolve));await h.save(false,'replacement-key-example');finish();await work;assert.equal(h.session.sessionKey,'replacement-key-example');assert.equal(h.local.keyStatus,'untested');
});
test('browser restart loses a session key but preserves a remembered key',async()=>{
  const a=setup();await a.save(false);await a.enable();const restartedA=setup({local:a.local});assert.equal((await restartedA.send({type:'GET_STATUS'})).hasKey,false);assert.equal((await restartedA.send({type:'GET_STATUS'})).settings.enabled,false);
  const b=setup();await b.save(true);const restartedB=setup({local:b.local});assert.equal((await restartedB.send({type:'GET_STATUS'})).hasKey,true);
});
test('UTC day resets the local request counter and expired cache causes a new request',async()=>{
  const h=setup();await h.save();await h.enable();await h.classify();h.advance(86400001);await h.classify();assert.equal(h.calls.length,2);assert.equal(h.local.usage.requests,1);assert.equal(h.local.usage.day,'2026-09-22');
});
test('model parsing and display rules handle invalid probabilities, satire and experimental languages',()=>{
  const result=parseModelResponse(modelBody()).result;const decision=SlopPolicy.decide(result);assert.equal(decision.kind,'slop');assert.ok(decision.reasons.includes('Pseudo insight'));assert.equal(SlopPolicy.decide({...result,context:'critique'}).kind,'clear');assert.equal(SlopPolicy.decide({...result,context:'insufficient'}).kind,'uncertain');assert.equal(SlopPolicy.decide({...result,language:'ar',likelihood:.91}).kind,'uncertain');assert.equal(SlopPolicy.decide({...result,language:'tr',likelihood:.97}).kind,'slop');const malformed=modelBody();malformed.answers.verdict.probabilities.flag=2;assert.throws(()=>parseModelResponse(malformed));assert.equal(requestBody(TEXT).state.post_text,TEXT);
});
test('feed, post and recent activity paths are supported; messaging and profile pages are excluded',()=>{
  for(const path of ['/feed/','/posts/sample','/in/test/recent-activity/all/'])assert.equal(SlopPolicy.supports(path),true);for(const path of ['/messaging/','/jobs/','/in/test/','/feedbogus/'])assert.equal(SlopPolicy.supports(path),false);
});
