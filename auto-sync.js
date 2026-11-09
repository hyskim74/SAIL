// Margin Reader: automatic story-start discovery and progressive word sync.
// Browser-only. No user-supplied audio timestamps. Large media uses streamed capture.
export const CLIP=28,SEARCH_STEP=14;
const norm=s=>String(s||'').normalize('NFKC').replace(/[‘’´\x60]/g,"'").toLowerCase().replace(/[^a-z0-9]/g,'');
export function tokensOf(text){return [...String(text).matchAll(/\S+/g)].map(m=>({text:m[0],word:norm(m[0]),startChar:m.index,endChar:m.index+m[0].length})).filter(w=>w.word);}
export function matchingWords(text,chunks,maxCells=1200000){
  const a=tokensOf(text),b=(chunks||[]).map(c=>({word:norm(c.text),start:Number(c.timestamp?.[0]),end:Number(c.timestamp?.[1])})).filter(w=>w.word&&Number.isFinite(w.start)&&Number.isFinite(w.end)&&w.end>w.start);
  const n=a.length,m=b.length;if(!n||!m||n*m>maxCells)return {words:[],coverage:0,recognized:m,total:n};
  const stride=m+1,dp=new Uint16Array((n+1)*stride);
  for(let i=n-1;i>=0;i--)for(let j=m-1;j>=0;j--){const p=i*stride+j;dp[p]=a[i].word===b[j].word?dp[p+stride+1]+1:Math.max(dp[p+stride],dp[p+1]);}
  const words=[];let i=0,j=0;
  while(i<n&&j<m){if(a[i].word===b[j].word){words.push({startChar:a[i].startChar,endChar:a[i].endChar,start:b[j].start,end:b[j].end,quality:'automatic-asr'});i++;j++;}
  else if(dp[(i+1)*stride+j]>=dp[i*stride+j+1])i++;else j++;}
  return {words,coverage:words.length/n,recognized:m,total:n};
}
export function identifyAnchor(text,chunks){
  const t=tokensOf(text).slice(0,26);if(t.length<8)return null;
  const sample=text.slice(0,t.at(-1).endChar),r=matchingWords(sample,chunks);
  const significant=r.words.filter(w=>norm(sample.slice(w.startChar,w.endChar)).length>=5).length;
  if(r.words.length<Math.min(12,Math.ceil(t.length*.58))||r.coverage<.58||significant<3||!r.words.length||
     r.words[0].startChar>t[Math.min(5,t.length-1)].startChar)return null;
  return {...r,audioStart:r.words[0].start};
}
export function alignNextWindow(text,bodyStart,cursor,chunks,clipStart){
  const from=Math.max(bodyStart,cursor-110),to=Math.min(text.length,Math.max(cursor+2300,from+1800)),m=matchingWords(text.slice(from,to),chunks);
  if(m.words.length<Math.min(7,Math.max(3,Math.floor(m.recognized*.28)))||m.words.length/Math.max(1,m.recognized)<.29)return {words:[],cursor};
  const words=m.words.map(w=>({...w,startChar:w.startChar+from,endChar:w.endChar+from,start:w.start+clipStart,end:w.end+clipStart}));
  return {words,cursor:Math.max(cursor,...words.map(w=>w.endChar))};
}
export function mergeAutomaticWords(oldWords,newWords){
  const map=new Map((oldWords||[]).filter(w=>Number.isFinite(w.start)).map(w=>[w.startChar+'-'+w.endChar,w]));
  for(const w of newWords){const k=w.startChar+'-'+w.endChar;if(!map.has(k)||(map.get(k).quality==='automatic-asr'&&w.start<map.get(k).start))map.set(k,w);}
  return [...map.values()].sort((a,b)=>a.startChar-b.startChar);
}
function check(signal){if(signal?.aborted)throw new DOMException('자동 싱크가 중단되었습니다.','AbortError');}
function resample(pcm,rate){
  const out=new Float32Array(Math.max(1,Math.round(pcm.length*16000/rate)));
  for(let i=0;i<out.length;i++){const p=i*rate/16000,a=Math.min(pcm.length-1,Math.floor(p)),b=Math.min(pcm.length-1,a+1),r=p-a;out[i]=pcm[a]*(1-r)+pcm[b]*r;}
  return out;
}
function fromBuffer(buffer,start,end){
  const rate=buffer.sampleRate,a=Math.floor(start*rate),b=Math.min(buffer.length,Math.ceil(end*rate)),out=new Float32Array(Math.max(0,b-a));
  for(let c=0;c<buffer.numberOfChannels;c++){const channel=buffer.getChannelData(c);for(let i=0;i<out.length;i++)out[i]+=channel[a+i]/buffer.numberOfChannels;}
  return resample(out,rate);
}
export class BrowserAudioSampler{
  constructor(blob,signal){this.blob=blob;this.signal=signal;this.media=null;this.url=null;this.ctx=null;this.decoder=null;this.processor=null;this.pendingStop=null;}
  async open(){
    check(this.signal);
    const m=document.createElement(/^video\//.test(this.blob.type)?'video':'audio');
    this.media=m;m.preload='metadata';m.playsInline=true;this.url=URL.createObjectURL(this.blob);m.src=this.url;
    await new Promise((resolve,reject)=>{
      const ok=()=>{clean();resolve();},err=()=>{clean();reject(new Error('음원 파일 또는 코덱을 읽을 수 없습니다.'));};
      const clean=()=>{m.removeEventListener('loadedmetadata',ok);m.removeEventListener('error',err);};
      m.addEventListener('loadedmetadata',ok);m.addEventListener('error',err);if(m.readyState>=1)ok();
    });
    this.duration=m.duration;
    if(!Number.isFinite(this.duration)||this.duration<=0)throw new Error('음원의 재생 길이를 확인할 수 없습니다.');
    if(this.blob.size<=28*1024*1024&&this.duration<=780){
      let ctx;try{ctx=new (window.AudioContext||window.webkitAudioContext)();this.decoder=await ctx.decodeAudioData(await this.blob.arrayBuffer());}
      catch{this.decoder=null;}finally{if(ctx)await ctx.close().catch(()=>{});}
    }
    if(!this.decoder){
      this.ctx=new (window.AudioContext||window.webkitAudioContext)();
      const node=this.ctx.createMediaElementSource(m);
      this.processor=this.ctx.createScriptProcessor(4096,2,1);
      const silent=this.ctx.createGain();silent.gain.value=0;
      node.connect(this.processor);this.processor.connect(silent);silent.connect(this.ctx.destination);
    }
    return this.duration;
  }
  async clip(start,end){
    check(this.signal);start=Math.max(0,start);end=Math.min(this.duration,end);
    if(end<=start)throw new Error('음원 끝에 도달했습니다.');
    if(this.decoder)return fromBuffer(this.decoder,start,end);
    const m=this.media,ctx=this.ctx,proc=this.processor;
    m.pause();
    await new Promise((resolve,reject)=>{
      if(Math.abs(m.currentTime-start)<.03)return resolve();
      const done=()=>{clean();resolve();},fail=()=>{clean();reject(new Error('음원 자동 탐색 중 seek 실패'));};
      const clean=()=>{m.removeEventListener('seeked',done);m.removeEventListener('error',fail);};
      m.addEventListener('seeked',done);m.addEventListener('error',fail);m.currentTime=start;
    });
    await ctx.resume();
    return new Promise((resolve,reject)=>{
      const pieces=[];let size=0,finished=false;
      let tick,timer;
      const finish=error=>{
        if(finished)return;finished=true;clearInterval(tick);clearTimeout(timer);proc.onaudioprocess=null;m.pause();this.pendingStop=null;
        if(error)return reject(error);
        if(size<1600)return reject(new Error('이 미디어에서 음성 샘플을 추출하지 못했습니다.'));
        const pcm=new Float32Array(size);let at=0;for(const p of pieces){pcm.set(p,at);at+=p.length;}
        resolve(resample(pcm,ctx.sampleRate));
      };
      this.pendingStop=()=>finish(new DOMException('자동 싱크 중단','AbortError'));
      proc.onaudioprocess=e=>{
        if(finished||m.paused||m.seeking)return;
        const input=e.inputBuffer,buf=new Float32Array(input.length);
        for(let ch=0;ch<input.numberOfChannels;ch++){const values=input.getChannelData(ch);for(let i=0;i<buf.length;i++)buf[i]+=values[i]/input.numberOfChannels;}
        pieces.push(buf);size+=buf.length;
        if(m.currentTime>=end-.1)finish();
      };
      tick=setInterval(()=>{
        if(this.signal?.aborted)finish(new DOMException('자동 싱크 중단','AbortError'));
        else if(m.ended||m.currentTime>=end-.05)finish();
      },120);
      timer=setTimeout(()=>finish(new Error('음원 분석이 중단됐습니다. 브라우저 탭을 활성화하고 다시 시도하세요.')),(end-start+25)*1000);
      m.play().catch(e=>finish(new Error('브라우저가 음원 자동 재생을 차단했습니다. 재생 버튼을 한 번 누른 후 다시 시도해 주세요: '+e.message)));
    });
  }
  async close(){this.pendingStop?.();this.media?.pause();if(this.processor)this.processor.onaudioprocess=null;try{await this.ctx?.close();}catch{}if(this.url)URL.revokeObjectURL(this.url);this.media?.removeAttribute('src');this.media?.load();}
}
export async function discoverAndSync({text,bodyStart,tracks,loadBlob,transcribe,progress=()=>{},save=async()=>{},signal,startingState=null}){
  const anchor=tokensOf(text.slice(bodyStart)).slice(0,26);
  if(anchor.length<8)throw new Error('본문 시작 표시 뒤에 최소 8개 이상의 영어 단어가 필요합니다.');
  const anchorText=text.slice(bodyStart,bodyStart+anchor.at(-1).endChar);
  let found=Boolean(startingState?.found),cursor=startingState?.cursor??bodyStart;
  let foundTrack=startingState?.trackId??null,foundAt=startingState?.audioStart??null,aligned=0;
  const first=found?Math.max(0,tracks.findIndex(t=>t.id===foundTrack)):0;
  for(let index=first;index<tracks.length;index++){
    check(signal);const track=tracks[index],blob=await loadBlob(track);
    if(!blob){progress('이 기기에 오디오 파일이 없습니다: '+track.name+' · Private Data에서 복원하세요.');continue;}
    const sampler=new BrowserAudioSampler(blob,signal);
    try{
      const duration=await sampler.open();
      let pos=found&&track.id===foundTrack?(startingState?.nextAudio??0):0;
      const step=found?CLIP-3:SEARCH_STEP;
      while(pos<duration-.2){
        check(signal);
        const end=Math.min(duration,pos+CLIP);
        progress((found?'단어 정렬: ':'본문 시작 자동 검색: ')+track.name+' · '+Math.floor(pos)+' / '+Math.floor(duration)+'초');
        const wave=await sampler.clip(pos,end);check(signal);
        const result=await transcribe(wave);check(signal);
        const chunks=Array.isArray(result)?result:(result?.chunks||[]);
        if(!found){
          const hit=identifyAnchor(anchorText,chunks);
          if(hit){found=true;foundTrack=track.id;foundAt=pos+hit.audioStart;cursor=bodyStart;
            progress('본문 시작 발견: '+track.name+' · '+foundAt.toFixed(1)+'초. 자동 정렬 시작.');
          }
        }
        if(found){
          const matched=alignNextWindow(text,bodyStart,cursor,chunks,pos);
          cursor=Math.max(cursor,matched.cursor);aligned+=matched.words.length;
          await save({trackId:track.id,words:matched.words,scan:{found:true,trackId:track.id,audioStart:foundAt,nextAudio:Math.max(pos+step,end-3),cursor,updatedAt:new Date().toISOString(),complete:false}});
          if(cursor>=text.length-2){
            await save({trackId:track.id,words:[],scan:{found:true,trackId:track.id,audioStart:foundAt,nextAudio:end,cursor,updatedAt:new Date().toISOString(),complete:true}});
            return {found,foundTrack,foundAt,cursor,aligned,complete:true};
          }
        }
        pos+=found?CLIP-3:SEARCH_STEP;
      }
      if(found)await save({trackId:track.id,words:[],scan:{found:true,trackId:track.id,audioStart:foundAt,nextAudio:duration,cursor,updatedAt:new Date().toISOString(),complete:cursor>=text.length-2}});
    }finally{await sampler.close();}
  }
  if(!found)throw new Error('표시한 본문 시작 문장을 자동으로 찾지 못했습니다. 원서와 Audiobook이 같은 판본인지 확인하세요.');
  return {found,foundTrack,foundAt,cursor,aligned,complete:false};
}
