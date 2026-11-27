/* Account requests and opt-in AI rewrites are sent only by the extension background. */
const hosts=['chatgpt.com','www.kimi.com','www.kimi.ai','chat.qwen.ai','v0.app','v0.dev','elevenlabs.io','suno.com','app.runwayml.com','pika.art','chat.mistral.ai','www.perplexity.ai','perplexity.ai','chat.z.ai','character.ai','www.character.ai','higgsfield.ai','www.higgsfield.ai','claude.ai','gemini.google.com','grok.com','x.ai','manus.im','lovable.dev','bolt.new','replit.com','platform.openai.com','console.anthropic.com','aistudio.google.com','platform.deepseek.com','console.x.ai','console.mistral.ai','console.groq.com','cloud.together.ai','fireworks.ai','app.fireworks.ai','openrouter.ai','modelstudio.console.alibabacloud.com','dashscope.console.aliyun.com','bigmodel.cn','www.bigmodel.cn','z.ai','www.z.ai','platform.moonshot.ai','platform.moonshot.cn','dashboard.cohere.com'];
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
 if(!['pe-authorize','pe-rewrite'].includes(message?.type))return;
 let host;try{host=new URL(sender.tab?.url||'').hostname;}catch{reply({ok:false,error:'invalid_sender'});return;}
 if(!sender.tab||!sender.tab.url.startsWith('https://')||(!hosts.includes(host)&&host!=='town.com'&&!host.endsWith('.town.com'))){reply({ok:false,error:'invalid_sender'});return;}
 chrome.storage.local.get('cap_session',async data=>{
  try{
   const session=JSON.parse(data.cap_session||'null');if(!session?.token){reply({ok:false,error:'sign_in_required'});return;}
   const rewrite=message.type==='pe-rewrite';
   if(rewrite&&(message.consent!==true||message.adult!==true||typeof message.text!=='string'||message.text.length>32000)){reply({ok:false,error:'consent_required'});return;}
   const mode=['shorter','clearer','more_specific'].includes(message.mode)?message.mode:'shorter';
   const payload=rewrite?{requestId:message.requestId,text:message.text,consent:true,adult:true,mode}:{requestId:message.requestId};
   const result=await fetch('https://promptefficiently.com/api/'+(rewrite?'rewrite':'usage'),{method:'POST',headers:{Authorization:'Bearer '+session.token,'Content-Type':'application/json'},body:JSON.stringify(payload)});
   reply({...await result.json(),ok:result.ok});
  }catch{reply({ok:false,error:'connection_required'});}
 });return true;
});
