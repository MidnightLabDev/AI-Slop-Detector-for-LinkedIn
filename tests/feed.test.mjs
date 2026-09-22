import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {parseHTML} from 'linkedom';

const sources = await Promise.all(['policy.js','feed-dom.js','content.js'].map(file => readFile(new URL('../'+file,import.meta.url),'utf8')));
const POST = 'We reduced setup time from nine days to six by removing two approval steps. The next review is in October.';
const OTHER = 'The new draft explains the change with measurements and lists the remaining limitations for the next review.';
const result = {likelihood:.12,confidence:.95,verdict:'clear',context:'ordinary',contextConfidence:.95,language:'en',languageConfidence:.99,categories:{formulaic:.1,engagement:.1,motivation:.1,jargon:.1}};
const card = (text=POST,attrs='') => `<div role="listitem" ${attrs}><a>Author name</a><p><span data-testid="expandable-text-box">${text}</span></p><button>Like</button></div>`;
const feed = items => `<main><div data-testid="mainFeed">${items}</div></main>`;
const flush = async () => {for(let i=0;i<4;i++)await new Promise(resolve=>setImmediate(resolve));};

function harness(html,{content=false,enabled=true,path='/feed/',deferred=false,settingsFailures=0}={}) {
  const {window,document} = parseHTML('<!doctype html><html><body>'+html+'</body></html>');
  window.innerWidth=1200;window.innerHeight=900;document.hidden=false;
  window.HTMLElement.prototype.getBoundingClientRect=function(){
    const top=Number(this.closest('[data-top]')?.getAttribute('data-top')||100);
    return {top,bottom:top+120,left:0,right:600,width:600,height:120};
  };
  const listeners=[],calls=[],responses=[],timers=new Map();let clock=0,nextTimer=1;
  const settings={enabled,connected:true,showStamp:true,threshold:85};
  const location={pathname:path};
  const timeout=(fn,ms,interval=false)=>{const id=nextTimer++;timers.set(id,{fn,due:clock+ms,ms,interval});return id;};
  const chrome={runtime:{lastError:null,onMessage:{addListener:fn=>listeners.push(fn)},sendMessage(message,reply){
    if(message.type==='GET_SETTINGS'){
      if(settingsFailures-- > 0)reply({ok:false,message:'Temporary startup failure.'});
      else reply({ok:true,settings:{...settings}});
    }
    if(message.type==='CLASSIFY'){
      calls.push(message);
      if(deferred)responses.push(reply);else reply({ok:true,result});
    }
  }}};
  const context=vm.createContext({window,document,location,chrome,console,MutationObserver:window.MutationObserver,
    // Deliberately never fires: fallback visibility must still start detection.
    IntersectionObserver:class{observe(){}unobserve(){}},
    setTimeout:(fn,ms)=>timeout(fn,ms),clearTimeout:id=>timers.delete(id),
    setInterval:(fn,ms)=>timeout(fn,ms,true),clearInterval:id=>timers.delete(id)});
  for(const source of sources.slice(0,content?3:2))vm.runInContext(source,context);
  const send=message=>new Promise(resolve=>listeners[0](message,{},resolve));
  async function advance(ms){
    await flush();const end=clock+ms;
    while(true){
      const next=[...timers.entries()].filter(([,v])=>v.due<=end).sort((a,b)=>a[1].due-b[1].due)[0];
      if(!next)break;const [id,timer]=next;clock=timer.due;
      if(timer.interval)timer.due+=timer.ms;else timers.delete(id);
      timer.fn();await flush();
    }
    clock=end;await flush();
  }
  return {document,window,settings,calls,responses,location,advance,send,stats:()=>send({type:'STATS'}),api:context.SlopFeed};
}

test('current React feed finds separate posts and excludes author and action text',()=>{
  const h=harness(feed(card()+card(OTHER)));
  const found=h.api.discover(h.document);
  assert.equal(found.layout,'Current feed');assert.equal(found.posts.length,2);
  assert.deepEqual(Array.from(found.posts,p=>h.api.read(p.node)),[POST,OTHER]);
});
test('classic nested wrappers produce only one check per post',()=>{
  const h=harness(`<div class="occludable-update"><div data-id="urn:li:activity:123"><div class="feed-shared-update-v2"><div class="feed-shared-update-v2__description"><span class="update-components-text">${POST}</span></div></div></div></div>`);
  const found=h.api.discover(h.document);assert.equal(found.posts.length,1);assert.equal(h.api.read(found.posts[0].node),POST);
});
test('feed card layout supports expandable bodies outside mainFeed',()=>{
  const h=harness(`<div data-view-name="feed-full-update"><p><span data-testid="expandable-text-box">${POST}</span></p></div>`);
  const found=h.api.discover(h.document);assert.equal(found.layout,'Feed cards');assert.equal(found.posts.length,1);
});
test('classic post URNs and public commentary remain supported',()=>{
  const h=harness(`<div data-urn="urn:li:activity:12"><p data-test-id="main-feed-activity-card__commentary">${POST}</p></div>`);
  assert.equal(h.api.discover(h.document).posts.length,1);
});
test('comments, nested list items, reshares, dialogs and sidebars are excluded',()=>{
  const comment=`<div data-testid="comments-list"><span data-testid="expandable-text-box">${OTHER}</span></div>`;
  const nested=`<div role="listitem"><span data-testid="expandable-text-box">${OTHER}</span></div>`;
  const reshare=`<div class="update-components-reshared-content"><div class="feed-shared-update-v2"><div class="update-components-text">${OTHER}</div></div></div>`;
  const h=harness(feed(`<div role="listitem"><span data-testid="expandable-text-box">${POST}</span>${comment}${nested}${reshare}</div>`)+`<aside>${feed(card(OTHER))}</aside><div role="dialog">${feed(card(OTHER))}</div>`);
  const posts=h.api.discover(h.document).posts;assert.equal(posts.length,1);assert.equal(h.api.read(posts[0].node),POST);
});
test('a post with only comments never submits its comments as a post',()=>{
  const h=harness(feed(`<div role="listitem"><div data-view-name="comments-thread"><span data-testid="expandable-text-box">${POST}</span></div><div role="listitem"><span data-testid="expandable-text-box">${OTHER}</span></div></div>`));
  assert.equal(h.api.discover(h.document).posts.length,0);
});
test('text cleanup preserves paragraph breaks and drops expand buttons and hidden duplicates',()=>{
  const h=harness(feed(card('First line<br>Second line<button data-testid="expandable-text-button">See more</button><span hidden>Hidden duplicate</span><span aria-hidden="true">Hidden copy</span>')));
  const node=h.api.discover(h.document).posts[0].node;assert.equal(h.api.read(node),'First line\nSecond line');
});
test('visible new feed posts start without any IntersectionObserver callback',async()=>{
  const h=harness(feed(card()),{content:true});await flush();
  assert.equal(h.calls.length,1);assert.equal(h.calls[0].text,POST);
  const stats=await h.stats();assert.equal(stats.found,1);assert.equal(stats.scanned,1);assert.equal(stats.failed,0);
  assert.equal(h.document.querySelector('.ai-slop-detector-host').shadowRoot.querySelector('.badge').textContent,'Not flagged · 12% slop score');
});
test('posts below the viewport wait until scrolling brings their text into view',async()=>{
  const h=harness(feed(card(POST,'data-top="2000"')),{content:true});await flush();
  assert.equal(h.calls.length,0);assert.equal((await h.stats()).found,1);
  h.document.querySelector('[data-top]').setAttribute('data-top','100');
  h.window.dispatchEvent(new h.window.Event('scroll'));await h.advance(250);
  assert.equal(h.calls.length,1);
});
test('late feed loading and continuous mutations cannot starve discovery',async()=>{
  const h=harness(feed(''),{content:true});await flush();
  h.document.querySelector('[data-testid="mainFeed"]').insertAdjacentHTML('beforeend',card());
  for(let i=0;i<7;i++){
    const tick=h.document.createElement('span');tick.textContent=String(i);h.document.body.append(tick);await h.advance(40);
  }
  assert.equal(h.calls.length,1);assert.equal((await h.stats()).scanned,1);
});
test('pending and failed checks remain visible and never look like clear results',async()=>{
  const h=harness(feed(card()),{content:true,deferred:true});await flush();
  assert.equal((await h.stats()).queued,1);assert.equal(h.document.querySelector('.ai-slop-detector-host').shadowRoot.querySelector('.badge').textContent,'Checking…');
  h.responses.shift()({ok:false,error:'provider_error',message:'Jev returned HTTP 500.',retryAfter:30});await flush();
  const stats=await h.stats();assert.equal(stats.scanned,0);assert.equal(stats.failed,1);assert.match(stats.error,/500/);
  assert.match(h.document.querySelector('.ai-slop-detector-host').shadowRoot.querySelector('.badge').textContent,/unavailable/);
});
test('manual rescan refreshes settings and retries a failed post',async()=>{
  const h=harness(feed(card()),{content:true,deferred:true});await flush();
  h.responses.shift()({ok:false,message:'Temporary error'});await flush();
  const rescan=await h.send({type:'RESCAN'});assert.equal(rescan.supported,true);assert.equal(h.calls.length,2);
  h.responses.shift()({ok:true,result});await flush();assert.equal((await h.stats()).scanned,1);
});
test('recycled post text is checked again and stale responses are discarded',async()=>{
  const h=harness(feed(card()),{content:true,deferred:true});await flush();
  h.document.querySelector('[data-testid="expandable-text-box"]').textContent=OTHER;
  h.responses.shift()({ok:true,result});await flush();assert.equal((await h.stats()).scanned,0);
  await h.advance(250);assert.equal(h.calls[1].text,OTHER);
  h.responses.shift()({ok:true,result});await flush();assert.equal((await h.stats()).scanned,1);
});
test('annotations removed by LinkedIn are restored without another API request',async()=>{
  const h=harness(feed(card()),{content:true});await flush();
  h.document.querySelector('.ai-slop-detector-host').remove();await h.advance(2300);
  assert.ok(h.document.querySelector('.ai-slop-detector-host'));assert.equal(h.calls.length,1);
});
test('unsupported routes, hidden tabs and paused scanning never classify',async()=>{
  for(const options of [{path:'/messaging/'},{enabled:false}]){
    const h=harness(feed(card()),{content:true,...options});await h.advance(3000);assert.equal(h.calls.length,0);
  }
  const h=harness(feed(''),{content:true});await flush();h.document.hidden=true;
  h.document.querySelector('[data-testid="mainFeed"]').insertAdjacentHTML('beforeend',card());await h.advance(3000);assert.equal(h.calls.length,0);
  h.document.hidden=false;h.document.dispatchEvent(new h.window.Event('visibilitychange'));await flush();assert.equal(h.calls.length,1);
});
test('route changes clear old posts and discover newly loaded feed content',async()=>{
  const h=harness(feed(card()),{content:true,path:'/in/someone/'});await flush();assert.equal(h.calls.length,0);
  h.location.pathname='/feed/';await h.advance(2300);assert.equal(h.calls.length,1);
  h.location.pathname='/messaging/';await h.advance(2300);assert.equal((await h.stats()).found,0);assert.equal(h.document.querySelectorAll('.ai-slop-detector-host').length,0);
});
test('short captions are reported as skipped without spending an API request',async()=>{
  const h=harness(feed(card('A short caption.')),{content:true});await flush();
  assert.equal(h.calls.length,0);assert.equal((await h.stats()).skipped,1);
});
test('a temporary settings startup failure recovers and is reported until recovery',async()=>{
  const h=harness(feed(card()),{content:true,settingsFailures:1});await flush();
  assert.match((await h.stats()).error,/startup/);assert.equal(h.calls.length,0);
  await h.advance(1100);assert.equal((await h.stats()).ready,true);assert.equal(h.calls.length,1);
});
test('switching scanning off removes stamps and restores original post opacity',async()=>{
  const h=harness(feed(card()),{content:true,deferred:true});await flush();
  h.responses.shift()({ok:true,result:{...result,verdict:'flag',likelihood:.98,categories:{formulaic:.98}}});await flush();
  assert.equal((await h.stats()).flagged,1);assert.equal(h.document.querySelector('[data-testid="expandable-text-box"]').style.opacity,'.38');
  await h.send({type:'SETTINGS_CHANGED',settings:{...h.settings,enabled:false}});
  assert.equal(h.document.querySelectorAll('.ai-slop-detector-host').length,0);assert.notEqual(h.document.querySelector('[data-testid="expandable-text-box"]').style.opacity,'.38');
});
