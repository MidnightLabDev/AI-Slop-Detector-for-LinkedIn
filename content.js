(() => {
  if(globalThis.__aiSlopDetectorLoaded)return;globalThis.__aiSlopDetectorLoaded=true;
  const records=new Map();const queue=[];
  let active=0,epoch=0,timer,settings={enabled:false},lastError='',pausedUntil=0,lastPath=location.pathname;
  let ready=false,settingsRevision=0,loadingSettings=false,layout='Waiting for posts',cards=0;
  const supported=()=>SlopPolicy.supports(location.pathname);
  function send(message){return new Promise(resolve=>{
    const timeout=setTimeout(()=>resolve({ok:false,message:'The extension did not respond. Reload LinkedIn and try again.'}),15000);
    const finish=response=>{clearTimeout(timeout);resolve(response);};
    try{chrome.runtime.sendMessage(message,response=>{if(chrome.runtime.lastError)finish({ok:false,message:'Reload LinkedIn to reconnect the extension.'});else finish(response||{ok:false,message:'Detection is unavailable.'});});}
    catch{finish({ok:false,message:'Reload LinkedIn to reconnect the extension.'});}
  });}
  function cleanup(record){record.host?.remove();record.host=null;if(record.node && record.opacity!==undefined){record.node.style.opacity=record.opacity;record.opacity=undefined;}}
  function clearAll(){epoch++;queue.length=0;for(const record of records.values()){cleanup(record);observer?.unobserve(record.root);}records.clear();cards=0;layout='Waiting for posts';}
  function local(record,label){cleanup(record);record.status='skipped';render(record,{kind:'uncertain',label,reasons:[]});}
  function render(record,decision){
    cleanup(record);record.decision=decision;
    const host=document.createElement('span');host.className='ai-slop-detector-host';host.setAttribute('data-ai-slop-detector-ui','');
    const shadow=host.attachShadow({mode:'open'}),style=document.createElement('style');
    style.textContent=`:host{display:block;position:relative;margin:10px 0 3px;z-index:2;font-family:Arial,sans-serif;clear:both}*{box-sizing:border-box}.row{display:flex;flex-wrap:wrap;align-items:center;gap:7px;line-height:1.4}.badge{font-size:11px;font-weight:700;border-radius:5px;padding:4px 7px;background:#f0ece5;color:#726757;border:1px solid #e4dfd5;cursor:help}.slop{color:#a7261f;background:#fff0ed;border-color:#e9bcb6}.clear{color:#326347;background:#edf5ee;border-color:#cbdccc}.note{font-size:10px;color:#746c61}.stamp{position:absolute;left:50%;bottom:62px;transform:translateX(-50%) rotate(-11deg);font-family:Arial Black,Arial,sans-serif;font-size:clamp(34px,5vw,60px);font-weight:900;letter-spacing:6px;color:#b83228;border:6px solid #b83228;outline:2px solid #b83228;outline-offset:4px;padding:0 13px;line-height:1.17;pointer-events:none;opacity:.93;user-select:none;white-space:nowrap}button{border:0;background:transparent;color:#746c61;font:11px Arial,sans-serif;text-decoration:underline;cursor:pointer;padding:3px}button:focus-visible{outline:2px solid #b83228;outline-offset:2px}.detail{font-size:11px;color:#746c61;margin-top:5px;line-height:1.5}`;
    shadow.append(style);
    const row=document.createElement('div');row.className='row';
    const badge=document.createElement('span');badge.className='badge '+decision.kind;badge.textContent=`${decision.label}${decision.score!==undefined?' · '+decision.score+'% slop score':''}`;badge.title='Jev’s model score for low substance writing. This is not proof of AI authorship.';row.append(badge);
    if(decision.experimental){const note=document.createElement('span');note.className='note';note.textContent='Experimental language';row.append(note);}
    const why=document.createElement('button');why.type='button';why.textContent='Why?';why.hidden=decision.kind==='pending';why.setAttribute('aria-expanded','false');row.append(why);
    const detail=document.createElement('div');detail.className='detail';detail.hidden=true;detail.textContent=(decision.reasons.length?decision.reasons.join(' · ')+'. ':'')+'Writing patterns only. AI authorship is unknown.';
    why.addEventListener('click',()=>{detail.hidden=!detail.hidden;why.setAttribute('aria-expanded',String(!detail.hidden));});
    shadow.append(row,detail);
    if(decision.kind==='slop' && settings.showStamp && !record.revealed){
      const stamp=document.createElement('div');stamp.className='stamp';stamp.textContent='SLOP';stamp.setAttribute('aria-hidden','true');shadow.append(stamp);
      record.opacity=record.node.style.opacity;record.node.style.opacity='.38';
      const reveal=document.createElement('button');reveal.type='button';reveal.textContent='Show post';reveal.addEventListener('click',()=>{record.revealed=true;render(record,decision);});row.append(reveal);
    }
    record.node.insertAdjacentElement('afterend',host);record.host=host;
  }
  function enqueue(record){
    if(!settings.enabled || !settings.connected || document.hidden || !record.visible || record.status!=='new' || !record.node.isConnected)return;
    if(record.text.length<40){local(record,'Too little text');return;}
    if(record.text.length>6000){local(record,'Post exceeds text limit');return;}
    record.status='queued';render(record,{kind:'pending',label:'Checking…',reasons:[]});queue.push(record);pump();
  }
  async function pump(){
    while(active<2 && queue.length && settings.enabled && !document.hidden && supported()){
      const record=queue.shift();if(!record.root.isConnected || !record.visible || record.status!=='queued'){if(record.status==='queued'){record.status='new';cleanup(record);record.decision=null;}continue;}
      if(pausedUntil>Date.now()){record.status='error';render(record,{kind:'uncertain',label:'Checks paused',reasons:[lastError]});continue;}
      const generation=epoch,original=record.text;record.status='loading';active++;
      send({type:'CLASSIFY',text:original}).then(response=>{
        if(generation!==epoch || !settings.enabled || !supported() || !record.node.isConnected || SlopFeed.read(record.node)!==original || record.text!==original || records.get(record.root)!==record)return;
        if(!response.ok){record.status='error';lastError=response.message||'Detection unavailable.';if(response.retryAfter)pausedUntil=Date.now()+response.retryAfter*1000;render(record,{kind:'uncertain',label:response.error==='daily_limit'?'Daily limit reached':'Check unavailable',reasons:[]});return;}
        record.status='done';record.result=response.result;
        if(![...records.values()].some(r=>r.status==='error'))lastError='';
        render(record,SlopPolicy.decide(response.result,settings));
      }).catch(()=>{record.status='error';lastError='Could not display a result. Reload LinkedIn and try again.';}).finally(()=>{active--;pump();});
    }
  }
  const observer=typeof IntersectionObserver==='function'?new IntersectionObserver(entries=>{for(const entry of entries){const record=records.get(entry.target);if(record){record.visible=entry.isIntersecting && SlopFeed.visible(record.node);if(record.visible)enqueue(record);}}},{threshold:0}):null;
  function scan(){
    if(location.pathname!==lastPath){clearAll();lastPath=location.pathname;}
    if(!supported() || !settings.enabled){if(records.size)clearAll();return;}
    const found=SlopFeed.discover(document),present=new Set(found.posts.map(post=>post.root));
    layout=found.layout;cards=found.cards;
    for(const [root,record] of records)if(!present.has(root)){cleanup(record);observer?.unobserve(root);records.delete(root);}
    for(const {root,node} of found.posts){
      const text=SlopFeed.read(node);let record=records.get(root);
      if(record && (record.text!==text || record.node!==node)){cleanup(record);record.text=text;record.node=node;record.result=null;record.decision=null;record.status='new';record.revealed=false;}
      if(!record){record={root,node,text,status:'new',visible:false,revealed:false};records.set(root,record);observer?.observe(root);}
      record.visible=SlopFeed.visible(node);
      // LinkedIn may replace our annotation while keeping the post text.
      if(record.decision && !record.host?.isConnected)render(record,record.decision);
      enqueue(record);
    }
    pump();
  }
  function safeScan(){try{scan();}catch{lastError='Could not read this LinkedIn layout. Reload the page and check Feed details.';}}
  // A bounded throttle: continuous page mutations must not postpone discovery forever.
  function schedule(){if(timer)return;timer=setTimeout(()=>{timer=null;safeScan();},240);}
  new MutationObserver(mutations=>{
    if(mutations.some(m=>m.type==='characterData' || [...m.addedNodes,...m.removedNodes].some(n=>n.nodeType!==1 || !n.matches?.('.ai-slop-detector-host'))))schedule();
  }).observe(document.documentElement,{childList:true,subtree:true,characterData:true});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)safeScan();});
  window.addEventListener('popstate',schedule);
  window.addEventListener('scroll',schedule,{passive:true,capture:true});
  window.addEventListener('resize',schedule,{passive:true});
  // Also recover from late feed hydration, recycled cards and missed observer events.
  setInterval(()=>{if(!document.hidden && (settings.enabled || location.pathname!==lastPath))schedule();},2000);
  chrome.runtime.onMessage.addListener((message,sender,reply)=>{
    if(message.type==='SETTINGS_CHANGED'){
      const was=settings.enabled;settings=message.settings;ready=true;settingsRevision++;if(message.reset)clearAll();
      if(!settings.enabled)clearAll();else{if(!was){lastError='';pausedUntil=0;}for(const r of records.values())if(r.result)render(r,SlopPolicy.decide(r.result,settings));safeScan();}
      reply({ok:true});
    }
    if(message.type==='STATS'){
      const all=[...records.values()];
      reply({ok:true,version:'0.3.0',ready,enabled:settings.enabled,supported:supported(),layout,cards,found:all.length,visible:all.filter(r=>r.visible).length,scanned:all.filter(r=>r.status==='done').length,flagged:all.filter(r=>r.decision?.kind==='slop').length,queued:all.filter(r=>['queued','loading'].includes(r.status)).length,skipped:all.filter(r=>r.status==='skipped').length,failed:all.filter(r=>r.status==='error').length,error:lastError});
    }
    if(message.type==='RESCAN'){
      epoch++;queue.length=0;lastError='';pausedUntil=0;
      for(const r of records.values()){cleanup(r);r.status='new';r.result=null;r.decision=null;}
      loadSettings().then(()=>{safeScan();reply({ok:true,supported:supported()});});return true;
    }
  });
  async function loadSettings(attempt=0){
    if(loadingSettings)return;
    loadingSettings=true;const revision=settingsRevision;
    const response=await send({type:'GET_SETTINGS'});loadingSettings=false;
    if(revision!==settingsRevision)return;
    if(response.ok){settings=response.settings;ready=true;lastError='';safeScan();}
    else{lastError=response.message;if(attempt<2)setTimeout(()=>loadSettings(attempt+1),1000);}
  }
  loadSettings();
})();
