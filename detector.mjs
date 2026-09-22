import { MODEL, RUBRIC, MAX_TEXT, requestBody, parseModelResponse } from './classifier.mjs';

const ENDPOINT='https://api.typesafe.ai/v1/systemone';
const DEFAULTS={enabled:false,threshold:85,showStamp:true,dailyLimit:300};
const TEST_TEXT='We removed two approval steps from our onboarding process. In 40 test accounts, median setup time fell from nine days to six. Complex accounts still took longer. We will review the change next month.';
const fail=(code,message,retryAfter=0)=>Object.assign(new Error(message),{code,retryAfter});
const publicError=error=>({ok:false,error:error?.code||'unavailable',message:error?.code?error.message:'The check could not be completed. Try again.',retryAfter:error?.retryAfter||0});

export function createDetector(chrome,{fetcher=fetch,now=Date.now,timeoutMs=10000}={}){
  let serial=Promise.resolve(),generation=0;
  const active=new Map();
  const ready=Promise.all([
    chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'}),
    chrome.storage.session.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'})
  ]);
  const locked=fn=>{const task=serial.then(()=>ready).then(fn);serial=task.catch(()=>{});return task;};
  async function state(){
    await ready;
    const [local,session]=await Promise.all([chrome.storage.local.get(['settings','savedKey','keyStatus','usage']),chrome.storage.session.get(['sessionKey','cooldown'])]);
    const apiKey=session.sessionKey||local.savedKey||'';
    const settings={...DEFAULTS,...local.settings};
    settings.enabled=!!apiKey&&settings.enabled;
    return {apiKey,settings,keyStatus:apiKey?(local.keyStatus||'untested'):'missing',keyMode:apiKey?(session.sessionKey?'session':'device'):'none',usage:local.usage,cooldown:session.cooldown||0};
  }
  function dayUsage(value){const day=new Date(now()).toISOString().slice(0,10);return value?.day===day?value:{day,requests:0,inputTokens:0,minute:Math.floor(now()/60000),minuteRequests:0};}
  function safeSettings(s){return {enabled:s.settings.enabled,connected:!!s.apiKey,showStamp:s.settings.showStamp,threshold:s.settings.threshold};}
  async function status(){const s=await state();return {ok:true,settings:{...safeSettings(s),dailyLimit:s.settings.dailyLimit},hasKey:!!s.apiKey,keyMode:s.keyMode,keyStatus:s.keyStatus,usage:dayUsage(s.usage),model:MODEL};}
  async function broadcast(reset=false){
    const settings=safeSettings(await state());const tabs=await chrome.tabs.query({url:'https://www.linkedin.com/*'});
    await Promise.allSettled(tabs.map(tab=>chrome.tabs.sendMessage(tab.id,{type:'SETTINGS_CHANGED',settings,reset})));
  }
  function abortAll(){for(const request of active.values())request.controller.abort();}
  async function saveKey(raw,remember){
    if(typeof raw!=='string')throw fail('invalid_key','Paste your Jev API key first.');
    const key=raw.trim().replace(/^Bearer\s+/i,'');
    if(key.length<8 || key.length>2048 || /[^\x21-\x7e]/.test(key))throw fail('invalid_key','The key must be a single line without spaces.');
    await locked(async()=>{
      generation++;abortAll();
      const s=await state();
      // Remove the previous copy before changing retention mode.
      await chrome.storage.local.remove('savedKey');
      await chrome.storage.session.remove(['sessionKey','cache','cooldown']);
      if(remember===true)await chrome.storage.local.set({savedKey:key});
      else await chrome.storage.session.set({sessionKey:key});
      await chrome.storage.local.set({settings:{...s.settings,enabled:false},keyStatus:'untested'});
    });
    await broadcast(true);return status();
  }
  async function removeKey(){
    await locked(async()=>{
      generation++;abortAll();const s=await state();
      await chrome.storage.local.remove(['savedKey','keyStatus']);
      await chrome.storage.session.remove(['sessionKey','cache','cooldown']);
      await chrome.storage.local.set({settings:{...s.settings,enabled:false}});
    });
    await broadcast(true);return status();
  }
  async function updateSettings(input={}){
    await locked(async()=>{
      const s=await state(),next={...s.settings};
      for(const key of ['enabled','showStamp'])if(typeof input[key]==='boolean')next[key]=input[key];
      if(Number.isFinite(input.threshold))next.threshold=Math.max(60,Math.min(98,Math.round(input.threshold)));
      if(Number.isFinite(input.dailyLimit))next.dailyLimit=Math.max(10,Math.min(10000,Math.round(input.dailyLimit)));
      if(next.enabled && !s.apiKey)throw fail('missing_key','Save your Jev API key first.');
      if(next.enabled && s.keyStatus==='invalid')throw fail('invalid_key','Replace or successfully test your key before scanning.');
      if(!next.enabled && s.settings.enabled){generation++;abortAll();}
      await chrome.storage.local.set({settings:next});
    });
    await broadcast();return status();
  }
  async function classify(text,{test=false}={}){
    if(typeof text!=='string' || text.trim().length<40 || text.length>MAX_TEXT)throw fail('text_length','Post text must contain between 40 and 6,000 characters.');
    text=text.trim();
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(MODEL+'\n'+RUBRIC+'\n'+text)))).map(b=>b.toString(16).padStart(2,'0')).join('');
    const reservation=await locked(async()=>{
      const s=await state();
      if(!s.apiKey)throw fail('missing_key','Add your Jev API key in AI Slop Detector for LinkedIn®.');
      if(!test && !s.settings.enabled)throw fail('disabled','Scanning is off.');
      const slot=`${generation}:${test?'test':'post'}:${hash}`;
      if(active.has(slot))return {work:active.get(slot).work};
      if(!test){const {cache={}}=await chrome.storage.session.get('cache');if(cache[hash]?.expires>now())return {result:cache[hash].result};}
      if(s.cooldown>now())throw fail('paused','Jev checks are paused briefly. Try again after the cooldown.',Math.ceil((s.cooldown-now())/1000));
      if(active.size>=2)throw fail('busy','Two checks are running. Try again shortly.',3);
      const usage=dayUsage(s.usage),minute=Math.floor(now()/60000);
      if(usage.requests>=s.settings.dailyLimit)throw fail('daily_limit','Your local daily request limit has been reached. Adjust it in the popup or wait until tomorrow UTC.',Math.ceil((Date.parse(usage.day+'T00:00:00Z')+86400000-now())/1000));
      if(usage.minute!==minute){usage.minute=minute;usage.minuteRequests=0;}
      if(usage.minuteRequests>=30)throw fail('rate_limit','Your local limit is 30 requests per minute. Try again shortly.',Math.ceil(((minute+1)*60000-now())/1000));
      usage.requests++;usage.minuteRequests++;
      // Persist the attempt before the request, including failed or timed out calls.
      await chrome.storage.local.set({usage});
      const controller=new AbortController(),epoch=generation;
      const work=callJev({text,key:s.apiKey,hash,test,controller,epoch,day:usage.day});
      active.set(slot,{work,controller});
      work.finally(()=>active.delete(slot)).catch(()=>{});
      return {work};
    });
    return reservation.work || {ok:true,result:reservation.result,cached:true};
  }
  async function callJev({text,key,hash,test,controller,epoch,day}){
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{
      let response;
      try{response=await fetcher(ENDPOINT,{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify(requestBody(text)),credentials:'omit',cache:'no-store',redirect:'error',signal:controller.signal});}
      catch{if(epoch!==generation)throw fail('cancelled','The check was cancelled.');throw fail('network_error','Jev could not be reached or the request timed out. No automatic retry was made.',30);}
      if(response.status===401 || response.status===403)throw fail('invalid_key','Jev rejected this key. Check it in the popup.');
      if(response.status===402)throw fail('billing_required','Jev requires available credit or billing on this API account.',60);
      if(response.status===429 || response.status===529){const value=response.headers.get('Retry-After');const seconds=/^\d+$/.test(value||'')?Number(value):Math.ceil((Date.parse(value)-now())/1000);throw fail('provider_busy','Jev is busy or has reached its rate limit. Try again later.',Math.max(30,Math.min(3600,Number.isFinite(seconds)?seconds:30)));}
      if(!response.ok)throw fail('provider_error',`Jev returned HTTP ${response.status}. The post was not classified.`,30);
      let parsed;try{parsed=parseModelResponse(await response.json());}catch{throw fail('invalid_response','Jev returned an unexpected result. The post was not classified.',30);}
      await locked(async()=>{
        const s=await state();
        // A late response must never change a replacement key or repopulate its cache.
        if(epoch!==generation || s.apiKey!==key)throw fail('cancelled','The check was cancelled.');
        const usage=dayUsage(s.usage);if(usage.day===day){usage.inputTokens+=parsed.inputTokens;await chrome.storage.local.set({usage});}
        await chrome.storage.local.set({keyStatus:'verified'});
        if(!test){const {cache={}}=await chrome.storage.session.get('cache');const entries=Object.entries(cache).filter(([,v])=>v.expires>now()).slice(-299);await chrome.storage.session.set({cache:{...Object.fromEntries(entries),[hash]:{result:parsed.result,expires:now()+3600000}}});}
      });
      return test?{ok:true,tested:true,model:MODEL,inputTokens:parsed.inputTokens}:{ok:true,result:parsed.result,cached:false};
    }catch(error){
      let changed=false;
      await locked(async()=>{
        const s=await state();if(epoch!==generation || s.apiKey!==key)return;
        if(error.code==='invalid_key'){await chrome.storage.local.set({keyStatus:'invalid',settings:{...s.settings,enabled:false}});generation++;abortAll();changed=true;}
        else if(error.retryAfter)await chrome.storage.session.set({cooldown:now()+error.retryAfter*1000});
      });
      if(changed)await broadcast();
      throw error;
    }finally{clearTimeout(timer);}
  }
  function install(){
    chrome.runtime.onMessage.addListener((message,sender,reply)=>{
      if(sender.id!==chrome.runtime.id || !message || typeof message!=='object')return;
      const internal=sender.url===chrome.runtime.getURL('popup.html');
      let source;try{source=new URL(sender.url);}catch{return;}
      const linkedin=!!sender.tab && source.origin==='https://www.linkedin.com';
      const content=linkedin && /^\/(feed(?:\/|$)|posts\/|in\/[^/]+\/recent-activity(?:\/|$))/.test(source.pathname);
      if(!internal && !linkedin)return;
      (async()=>{
        if(message.type==='GET_SETTINGS')return {ok:true,settings:safeSettings(await state())};
        if(message.type==='CLASSIFY' && content){if(Object.keys(message).some(k=>!['type','text'].includes(k)))throw fail('invalid_request','Only post text is accepted.');return classify(message.text);}
        if(!internal)throw fail('forbidden','This action is available only in the extension popup.');
        if(message.type==='GET_STATUS')return status();
        if(message.type==='SAVE_KEY')return saveKey(message.apiKey,message.remember);
        if(message.type==='REMOVE_KEY')return removeKey();
        if(message.type==='TEST_KEY')return classify(TEST_TEXT,{test:true});
        if(message.type==='UPDATE_SETTINGS')return updateSettings(message.settings);
        throw fail('invalid_request','Unknown request.');
      })().then(reply,error=>reply(publicError(error)));
      return true;
    });
  }
  return {install};
}
