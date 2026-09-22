(() => {
  const names = {formulaic:'Formulaic filler',engagement:'Engagement bait',motivation:'Generic motivation',jargon:'Empty business jargon',pseudoInsight:'Pseudo insight'};
  function decide(result,settings={}) {
    if(!result || !Number.isFinite(result.likelihood) || !Number.isFinite(result.confidence) || !['flag','clear','uncertain'].includes(result.verdict) || !result.categories) return {kind:'uncertain',label:'No reliable result',reasons:[]};
    const experimental = ['ar','tr','mixed'].includes(result.language);
    const threshold = Math.max(Number(settings.threshold || 85)/100,experimental?0.95:0.5);
    const strongContext = result.context === 'ordinary' && result.contextConfidence >= 0.6;
    const reasons = Object.entries(result.categories).filter(([k,v])=>names[k] && v>=0.7).sort((a,b)=>b[1]-a[1]).map(([k])=>names[k]);
    const score = Math.round(result.likelihood*100);
    if(result.language === 'other' || result.languageConfidence < 0.5 || result.context === 'insufficient' || result.verdict === 'uncertain') return {kind:'uncertain',label:'Needs context',reasons,score,experimental};
    if(result.context === 'critique') return {kind:result.contextConfidence>=0.65?'clear':'uncertain',label:result.contextConfidence>=0.65?'Context matters':'Needs context',reasons:[],score,experimental};
    if(result.verdict === 'flag' && result.likelihood >= threshold && result.confidence >= (experimental?0.65:0.6) && strongContext && reasons.length) return {kind:'slop',label:'Slop',reasons,score,experimental};
    if(result.verdict === 'clear' && result.confidence >= 0.6) return {kind:'clear',label:'Not flagged',reasons:[],score,experimental};
    return {kind:'uncertain',label:'Mixed signals',reasons,score,experimental};
  }
  function supports(pathname){return /^\/(feed(?:\/|$)|posts\/|in\/[^/]+\/recent-activity(?:\/|$))/.test(pathname);}
  globalThis.SlopPolicy = {decide,supports};
})();
