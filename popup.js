const $=id=>document.getElementById(id);let current,tab,pending=false;
function note(message,success=false){$('notice').textContent=message;$('notice').dataset.kind=success?'success':'error';}
async function send(message){try{return await chrome.runtime.sendMessage(message);}catch{return {ok:false,message:'Reload the extension and try again.'};}}
function buttons(){const hasKey=!!current?.hasKey;$('testKey').disabled=pending||!hasKey||!!$('apiKey').value;$('saveKey').disabled=pending||!$('apiKey').value.trim();$('removeKey').hidden=!hasKey;$('removeKey').disabled=pending;$('enabled').disabled=pending||!hasKey||current?.keyStatus==='invalid';$('scan').disabled=pending||!hasKey||current?.keyStatus==='invalid';}
async function refresh(){
  const response=await send({type:'GET_STATUS'});if(!response?.ok){note(response?.message||'Could not load the extension.');return;}
  current=response;
  const settings=response.settings;
  $('enabled').checked=settings.enabled;$('showStamp').checked=settings.showStamp;
  if(document.activeElement!==$('threshold')){$('threshold').value=settings.threshold;$('thresholdLabel').textContent=settings.threshold+'%';}
  if(document.activeElement!==$('dailyLimit'))$('dailyLimit').value=settings.dailyLimit;
  $('statusTitle').textContent=settings.enabled?'Scanning is on':'Scanning is off';
  $('dailyUsage').textContent=`${response.usage.requests} of ${settings.dailyLimit} requests today`;
  const label={missing:'No key saved',untested:'Saved, not tested',verified:'Key verified',invalid:'Key rejected'}[response.keyStatus]||'Key saved';
  $('keyStatus').textContent=label;
  $('apiKey').placeholder=response.hasKey?'Paste a replacement key':'Paste your Jev API key';
  $('scan').textContent=settings.enabled?'Check visible posts':'Start scanning';
  buttons();
  for(const id of ['found','scanned','flagged'])$(id).textContent='0';
  $('feedDetails').textContent='No feed connection yet.';
  [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  if(!/^https:\/\/www\.linkedin\.com\//.test(tab?.url||'')){$('feedStatus').textContent='Open your LinkedIn feed to check posts.';return;}
  try{
    const stats=await chrome.tabs.sendMessage(tab.id,{type:'STATS'});
    if(stats?.version!=='0.3.0'){$('feedStatus').textContent='Reload LinkedIn to activate the updated detector.';return;}
    $('found').textContent=stats.found;$('scanned').textContent=stats.scanned;$('flagged').textContent=stats.flagged;
    $('feedDetails').textContent=`Detector ${stats.version} · ${stats.layout}\n${stats.cards} card containers · ${stats.found} post bodies\n${stats.visible} visible · ${stats.queued} pending\n${stats.skipped} outside text limits · ${stats.failed} failed`;
    $('feedStatus').textContent=
      !stats.supported?'Open the LinkedIn home feed or a post page.':
      stats.error?stats.error:
      !stats.ready?'Connecting to your saved settings…':
      !settings.enabled?'Scanning is off. Start scanning to find posts.':
      !stats.enabled?'The feed has not received your settings. Click Check visible posts.':
      !stats.found?'No post text found yet. Scroll until posts appear, then click Check visible posts.':
      stats.queued?`Checking ${stats.queued} visible ${stats.queued===1?'post':'posts'}…`:
      !stats.visible?'Posts found. Scroll a post into view to check it.':
      stats.scanned?`${stats.scanned} checked. ${stats.flagged} flagged. Scroll to check more posts.`:
      stats.skipped?'Visible posts are outside the 40 to 6,000 character text limit.':
      'Posts found. Click Check visible posts to check them.';
  }catch{$('feedStatus').textContent='Feed disconnected. Reload LinkedIn to activate AI Slop Detector for LinkedIn®.';}
}
async function perform(message,success){
  pending=true;buttons();let result;
  try{result=await send(message);note(result?.ok?success:result?.message||'Could not complete the action.',!!result?.ok);return result;}
  finally{pending=false;await refresh();}
}
$('apiKey').addEventListener('input',buttons);
$('showKey').addEventListener('click',()=>{const reveal=$('apiKey').type==='password';$('apiKey').type=reveal?'text':'password';$('showKey').textContent=reveal?'Hide':'Show';$('showKey').setAttribute('aria-label',reveal?'Hide typed API key':'Show typed API key');});
$('remember').addEventListener('change',()=>{$('retentionNote').textContent=$('remember').checked?'Saved on this device until removed. This is not an encrypted password vault.':'Unchecked: cleared when Chrome restarts or the extension reloads.';});
$('keyForm').addEventListener('submit',async event=>{
  event.preventDefault();const response=await perform({type:'SAVE_KEY',apiKey:$('apiKey').value,remember:$('remember').checked},'Key saved. Test it or start scanning.');
  if(response?.ok){$('apiKey').value='';$('apiKey').type='password';$('showKey').textContent='Show';$('showKey').setAttribute('aria-label','Show typed API key');buttons();}
});
$('testKey').addEventListener('click',async()=>{note('Testing your key with one small Jev request…');await perform({type:'TEST_KEY'},'Your Jev key works. You can start scanning.');});
$('removeKey').addEventListener('click',async()=>{await perform({type:'REMOVE_KEY'},'Key removed. Scanning is off.');$('apiKey').value='';buttons();});
$('enabled').addEventListener('change',()=>perform({type:'UPDATE_SETTINGS',settings:{enabled:$('enabled').checked}},$('enabled').checked?'Scanning is on.':'Scanning is off.'));
$('showStamp').addEventListener('change',()=>perform({type:'UPDATE_SETTINGS',settings:{showStamp:$('showStamp').checked}},'Stamp preference saved.'));
$('threshold').addEventListener('input',()=>$('thresholdLabel').textContent=$('threshold').value+'%');
$('threshold').addEventListener('change',()=>perform({type:'UPDATE_SETTINGS',settings:{threshold:Number($('threshold').value)}},'Sensitivity saved.'));
$('saveLimit').addEventListener('click',()=>{if(!$('dailyLimit').reportValidity())return;perform({type:'UPDATE_SETTINGS',settings:{dailyLimit:Number($('dailyLimit').value)}},'Daily limit saved.');});
$('scan').addEventListener('click',async()=>{
  if(!current.settings.enabled){const r=await perform({type:'UPDATE_SETTINGS',settings:{enabled:true}},'Scanning is on.');if(!r?.ok)return;}
  try{const response=await chrome.tabs.sendMessage(tab.id,{type:'RESCAN'});if(response?.ok && response.supported)note('Checking visible posts.',true);else note('Open your LinkedIn home feed first.');}catch{note('Open LinkedIn and reload the page first.');}
  await refresh();
});
await refresh();if(current?.hasKey)$('remember').checked=current.keyMode==='device';$('remember').dispatchEvent(new Event('change'));
setInterval(()=>{if(!pending)refresh();},2000);
