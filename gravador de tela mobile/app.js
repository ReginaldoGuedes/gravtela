const $=s=>document.querySelector(s);
const MIME_TYPES=['video/mp4;codecs=avc1.640028,mp4a.40.2','video/mp4;codecs=avc1,mp4a.40.2','video/mp4','video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'];
const SUPPORTED_MIME=MIME_TYPES.find(m=>typeof MediaRecorder!=='undefined'&&typeof MediaRecorder.isTypeSupported==='function'&&MediaRecorder.isTypeSupported(m));
const MIME=SUPPORTED_MIME||'video/webm';
const EXT=MIME.startsWith('video/mp4')?'mp4':'webm';
const AudioContextCtor=window.AudioContext||window.webkitAudioContext;
const fmt=s=>{s=Math.floor(s);return[s/3600|0,(s%3600)/60|0,s%60].map(n=>String(n).padStart(2,'0')).join(':')};
const mb=b=>(b/1048576).toFixed(0)+' MB';
let db=null,mem=[],storageWrites=Promise.resolve();
const open=()=>new Promise(r=>{try{const q=indexedDB.open('gravador',1);q.onupgradeneeded=()=>q.result.createObjectStore('c',{autoIncrement:true});q.onsuccess=()=>r(q.result);q.onerror=()=>r(null)}catch(e){r(null)}});
const idb=(m,...a)=>new Promise((res,rej)=>{const t=db.transaction('c','readwrite'),q=t.objectStore('c')[m](...a);t.oncomplete=()=>res(q.result);t.onerror=()=>rej(t.error)});
function store(b){storageWrites=storageWrites.then(async()=>{if(db){try{await idb('add',b);return}catch(e){}}mem.push(b)});return storageWrites}
async function loadAll(){await storageWrites;return db?[...await idb('getAll'),...mem]:mem}

let rec,screenRec,cameraRec,captureRecorders=[],tracks=[],ctx,tick,wl,paused=false,t0=0,acc=0,bytes=0,blob;
let cameraEnabled=false,screenSourceVideo=null,cameraVideo=null,cameraStream=null,compositeCanvas=null,compositeCtx=null,drawFrameId=0;
let cameraLayout={x:.82,y:.2,sc:.26},cameraMotion=[],screenParts=[],cameraParts=[],rawScreenBlob=null,cameraBlob=null,cameraSize=null,cameraUrl=null,captureStopWaits=[];
const err=m=>$('#err').textContent=m||'';
function canRecordScreen(){
  return !!(window.isSecureContext&&navigator.mediaDevices&&typeof navigator.mediaDevices.getDisplayMedia==='function'&&typeof MediaRecorder!=='undefined'&&SUPPORTED_MIME&&AudioContextCtor);
}
function captureSupportMessage(){
  if(!window.isSecureContext)return 'A gravação de tela exige uma conexão segura. Acesse o app pelo endereço HTTPS.';
  if(!navigator.mediaDevices||typeof navigator.mediaDevices.getDisplayMedia!=='function')return 'Este navegador/dispositivo não permite que páginas da web capturem a tela. No iPhone/iPad e em alguns navegadores internos essa função não está disponível. Use o gravador de tela do sistema e depois escolha “Editar vídeo” para importar a gravação.';
  if(typeof MediaRecorder==='undefined'||!SUPPORTED_MIME)return 'Este navegador não consegue gravar vídeo neste formato. Atualize o navegador ou use outro compatível com captura de tela.';
  if(!AudioContextCtor)return 'Este navegador não oferece suporte ao áudio necessário para gravar. Atualize ou troque de navegador.';
  return '';
}
function updateCaptureSupport(){
  const message=captureSupportMessage(),supported=!message;
  for(const id of ['captureSupportHome','captureSupportSetup']){
    const notice=$('#'+id);
    notice.textContent=message;
    notice.hidden=supported;
  }
  $('#start').disabled=!supported;
}
function setCameraMode(enabled){
  cameraEnabled=enabled;
  $('#cameraDeviceField').hidden=!enabled;
  $('#start').textContent=enabled?'Escolher tela e câmera':'Escolher tela e iniciar';
}
function elapsed(){return acc+(paused?0:(Date.now()-t0)/1000)}

function askMic(){return new Promise(r=>{const d=$('#micq');d.oncancel=e=>e.preventDefault();$('#micYes').onclick=()=>{d.close();r(true)};$('#micNo').onclick=()=>{d.close();r(false)};d.showModal()})}
function listMics(){navigator.mediaDevices.enumerateDevices().then(ds=>{const s=$('#micdev'),cur=s.value;s.innerHTML='<option value="">Padrão do sistema</option>';ds.filter(d=>d.kind==='audioinput'&&d.deviceId&&d.deviceId!=='default'&&d.deviceId!=='communications').forEach(d=>{const o=document.createElement('option');o.value=d.deviceId;o.textContent=d.label||'Microfone';s.appendChild(o)});s.value=cur}).catch(()=>{})}
async function listCameras(){
  const s=$('#cameraDev'),selected=s.value;
  try{
    const ds=await navigator.mediaDevices.enumerateDevices();
    s.innerHTML='<option value="">Câmera padrão</option>';
    ds.filter(d=>d.kind==='videoinput').forEach((d,i)=>{const o=document.createElement('option');o.value=d.deviceId;o.textContent=d.label||'Câmera '+(i+1);s.appendChild(o)});
    if([...s.options].some(o=>o.value===selected))s.value=selected;
  }catch(e){err('Não foi possível listar as câmeras conectadas: '+e.message)}
}
async function start(){
  if(!canRecordScreen()){
    err(captureSupportMessage());
    return;
  }
  let wantMic=$('#mic').value==='on';
  if($('#mic').value==='ask')wantMic=await askMic();
  return run(wantMic);
}
async function run(wantMic){
  err('');
  let disp=null,mic=null,cam=null;
  try{
    rawScreenBlob=null;cameraBlob=null;cameraMotion=[];cameraLayout={x:.82,y:.2,sc:.26};
    db=await open(); if(db)await idb('clear'); mem=[]; bytes=0;
    const h=+$('#res').value;
    const source=document.querySelector('input[name="captureSource"]:checked').value;
    disp=await navigator.mediaDevices.getDisplayMedia({video:{height:{ideal:h},frameRate:{ideal:30},displaySurface:source},audio:$('#sys').checked});
    if(wantMic){const n=$('#ns').checked,id=$('#micdev').value;try{mic=await navigator.mediaDevices.getUserMedia({audio:{...(id?{deviceId:{exact:id}}:{}),noiseSuppression:n,echoCancellation:n,autoGainControl:true}})}catch(e){err('Microfone indisponível ('+e.name+'). Gravando sem microfone.')}}
    if(cameraEnabled){
      const deviceId=$('#cameraDev').value;
      cam=await navigator.mediaDevices.getUserMedia({video:{...(deviceId?{deviceId:{exact:deviceId}}:{}),width:{ideal:1280},height:{ideal:720},frameRate:{ideal:30}},audio:false});
      cameraStream=cam;
    }
    tracks=[...disp.getTracks(),...(mic?mic.getTracks():[]),...(cam?cam.getTracks():[])];
    if(mic)listMics();
    if(cam)await listCameras();
    if($('#sys').checked&&!disp.getAudioTracks().length)$('#msg').textContent='O som interno não foi capturado. No seletor do navegador, marque "Compartilhar áudio da aba" (ou "do sistema") e escolha uma aba ou, no Windows, a tela inteira.';
    if(cam)await setupCapturePreview(disp,cam);
    await countdown();
    if(!AudioContextCtor)throw new Error('Este navegador não oferece suporte à gravação de áudio. Abra o app em um navegador atualizado.');
    ctx=new AudioContextCtor();const dest=ctx.createMediaStreamDestination();let n=0;
    if(disp.getAudioTracks().length){ctx.createMediaStreamSource(new MediaStream(disp.getAudioTracks())).connect(dest);n++}
    if(mic){ctx.createMediaStreamSource(mic).connect(dest);n++}
    const audioTracks=n?dest.stream.getAudioTracks():[];
    const recordedVideo=cam?compositeCanvas.captureStream(30).getVideoTracks():disp.getVideoTracks();
    const out=new MediaStream([...recordedVideo,...audioTracks]);
    rec=new MediaRecorder(out,{mimeType:MIME,videoBitsPerSecond:{480:1.5e6,720:3e6,1080:6e6}[h]});
    rec.ondataavailable=e=>{if(e.data.size){bytes+=e.data.size;store(e.data)}};
    rec.onstop=finish;
    captureRecorders=[rec];
    screenParts=[];cameraParts=[];cameraMotion=[];
    if(cam){
      const rawScreen=new MediaStream([...disp.getVideoTracks(),...audioTracks]);
      screenRec=new MediaRecorder(rawScreen,{mimeType:MIME,videoBitsPerSecond:{480:1.5e6,720:3e6,1080:6e6}[h]});
      screenRec.ondataavailable=e=>{if(e.data.size)screenParts.push(e.data)};
      cameraRec=new MediaRecorder(new MediaStream(cam.getVideoTracks()),{mimeType:MIME,videoBitsPerSecond:1.5e6});
      cameraRec.ondataavailable=e=>{if(e.data.size)cameraParts.push(e.data)};
      captureRecorders.push(screenRec,cameraRec);
      cameraSize=cam.getVideoTracks()[0].getSettings();
      cameraMotion.push({t:0,...cameraLayout});
    }else{screenRec=null;cameraRec=null;rawScreenBlob=null;cameraBlob=null;cameraSize=null}
    disp.getVideoTracks()[0].onended=stop;
    captureStopWaits=captureRecorders.map(r=>new Promise(resolve=>r.addEventListener('stop',resolve,{once:true})));
    captureRecorders.forEach(r=>r.start(1000));
    try{wl=await navigator.wakeLock.request('screen')}catch(e){}
    paused=false;acc=0;t0=Date.now();
    tick=setInterval(()=>{$('#t').textContent=fmt(elapsed());document.title=(paused?'⏸ ':'● ')+fmt(elapsed());$('#info').textContent=mb(bytes)+' gravados'+(db?' (salvos em disco)':' (em memória)')},500);
    $('#setup').hidden=true;$('#recording').hidden=false;$('#live').hidden=false;$('#live').classList.add('live');
    $('#pause').disabled=false;$('#stop').disabled=false;
    window.onbeforeunload=e=>{e.preventDefault();e.returnValue=''};
  }catch(e){
    tracks.forEach(t=>t.stop());if(disp)disp.getTracks().forEach(t=>t.stop());if(mic)mic.getTracks().forEach(t=>t.stop());if(cam)cam.getTracks().forEach(t=>t.stop());
    stopCapturePreview();$('#setup').hidden=false;$('#recording').hidden=true;$('#live').hidden=true;
    err(e.name==='NotAllowedError'?'Seleção cancelada ou bloqueada. Confira as permissões para compartilhar a tela e acessar a câmera.':cameraEnabled&&!cam?'Não foi possível iniciar a câmera ('+e.name+'): '+e.message:'Não foi possível iniciar ('+e.name+'): '+e.message)
  }
}
function waitVideo(video){
  if(video.readyState>=1)return Promise.resolve();
  return new Promise((resolve,reject)=>{
    const ok=()=>{clean();resolve()},fail=()=>{clean();reject(new Error('Não foi possível iniciar a prévia da câmera ou da tela.'))};
    const clean=()=>{video.removeEventListener('loadedmetadata',ok);video.removeEventListener('error',fail)};
    video.addEventListener('loadedmetadata',ok,{once:true});video.addEventListener('error',fail,{once:true});
  });
}
async function setupCapturePreview(display,camera){
  screenSourceVideo=$('#screenPreview');cameraVideo=$('#cameraPreview');
  screenSourceVideo.srcObject=display;cameraVideo.srcObject=camera;
  screenSourceVideo.muted=cameraVideo.muted=true;
  await Promise.all([waitVideo(screenSourceVideo),waitVideo(cameraVideo)]);
  await Promise.all([screenSourceVideo.play(),cameraVideo.play()]);
  const width=screenSourceVideo.videoWidth,height=screenSourceVideo.videoHeight;
  compositeCanvas=document.createElement('canvas');compositeCanvas.width=width;compositeCanvas.height=height;compositeCtx=compositeCanvas.getContext('2d');
  const preview=$('#capturePreview'),ratio=width/height;
  preview.style.aspectRatio=width+'/'+height;preview.style.width='min(100%, '+(30*ratio)+'vh)';preview.hidden=false;
  const overlay=$('#cameraOverlay');overlay.hidden=false;
  overlay.style.aspectRatio=cameraVideo.videoWidth+'/'+cameraVideo.videoHeight;
  updateCameraOverlay();
  drawComposite();
  $('#cameraHint').hidden=false;
}
function drawComposite(){
  if(!compositeCtx||!screenSourceVideo||screenSourceVideo.readyState<2){drawFrameId=requestAnimationFrame(drawComposite);return}
  const w=compositeCanvas.width,h=compositeCanvas.height;
  compositeCtx.drawImage(screenSourceVideo,0,0,w,h);
  if(cameraVideo&&cameraVideo.readyState>=2){
    const cw=w*cameraLayout.sc,ch=cw*cameraVideo.videoHeight/cameraVideo.videoWidth;
    compositeCtx.drawImage(cameraVideo,cameraLayout.x*w-cw/2,cameraLayout.y*h-ch/2,cw,ch);
  }
  drawFrameId=requestAnimationFrame(drawComposite);
}
function updateCameraOverlay(){
  const overlay=$('#cameraOverlay'),video=cameraVideo;
  if(!overlay||!video||!video.videoWidth)return;
  const aspect=video.videoHeight/video.videoWidth;
  overlay.style.width=(cameraLayout.sc*100)+'%';
  overlay.style.left=((cameraLayout.x-cameraLayout.sc/2)*100)+'%';
  overlay.style.top=((cameraLayout.y-cameraLayout.sc*aspect/2)*100)+'%';
}
function rememberCameraPosition(){
  const t=elapsed(),last=cameraMotion[cameraMotion.length-1],point={t,...cameraLayout};
  if(last&&t<=last.t+.025)cameraMotion[cameraMotion.length-1]=point;
  else cameraMotion.push(point);
}
function stopCapturePreview(){
  if(drawFrameId)cancelAnimationFrame(drawFrameId);
  drawFrameId=0;
  for(const id of ['screenPreview','cameraPreview']){
    const video=$('#'+id);
    if(video){video.pause();video.srcObject=null}
  }
  $('#capturePreview').hidden=true;$('#cameraOverlay').hidden=true;$('#cameraHint').hidden=true;
  screenSourceVideo=null;cameraVideo=null;compositeCanvas=null;compositeCtx=null;cameraStream=null;
}
function dragCamera(e,resize){
  if(!cameraEnabled||!cameraVideo)return;
  e.preventDefault();e.stopPropagation();
  const host=$('#capturePreview'),rect=host.getBoundingClientRect(),start={...cameraLayout},x=e.clientX,y=e.clientY;
  const move=ev=>{
    if(resize){
      const dsc=(ev.clientX-x)/rect.width;
      cameraLayout.sc=Math.max(.12,Math.min(.65,start.sc+dsc));
    }else{
      const aspect=cameraVideo.videoHeight/cameraVideo.videoWidth,halfH=cameraLayout.sc*aspect/2;
      cameraLayout.x=Math.max(cameraLayout.sc/2,Math.min(1-cameraLayout.sc/2,start.x+(ev.clientX-x)/rect.width));
      cameraLayout.y=Math.max(halfH,Math.min(1-halfH,start.y+(ev.clientY-y)/rect.height));
    }
    updateCameraOverlay();rememberCameraPosition();
  };
  const up=()=>{removeEventListener('pointermove',move);removeEventListener('pointerup',up);rememberCameraPosition()};
  addEventListener('pointermove',move);addEventListener('pointerup',up);
}
$('#cameraOverlay').addEventListener('pointerdown',e=>dragCamera(e,false));
$('#cameraResize').addEventListener('pointerdown',e=>dragCamera(e,true));
function countdown(){return new Promise(r=>{const c=$('#cd');let n=5;c.style.display='grid';c.textContent=n;const i=setInterval(()=>{n--;if(n<=0){clearInterval(i);c.style.display='none';r()}else c.textContent=n},1000)})}
function pause(){
  if(rec.state==='recording'){captureRecorders.forEach(r=>{if(r.state==='recording')r.pause()});acc=elapsed();paused=true;$('#pause').textContent='Retomar'}
  else{captureRecorders.forEach(r=>{if(r.state==='paused')r.resume()});paused=false;t0=Date.now();$('#pause').textContent='Pausar'}
}
function stop(){
  if(rec&&rec.state!=='inactive'){
    if(!paused)acc=elapsed();
    captureRecorders.forEach(r=>{if(r.state!=='inactive')r.stop()});
  }
}
async function finish(){
  await Promise.all(captureStopWaits);
  if(screenRec)rawScreenBlob=new Blob(screenParts,{type:screenRec.mimeType||MIME});
  if(cameraRec)cameraBlob=new Blob(cameraParts,{type:cameraRec.mimeType||MIME});
  clearInterval(tick);tracks.forEach(t=>t.stop());ctx&&ctx.close();try{wl&&wl.release()}catch(e){}
  stopCapturePreview();
  window.onbeforeunload=null;document.title='Gravador de tela';
  $('#live').hidden=true;$('#recording').hidden=true;$('#setup').hidden=true;$('#home').hidden=false;
  $('#pause').disabled=true;$('#stop').disabled=true;$('#pause').textContent='Pausar';
  try{blob=new Blob(await loadAll(),{type:MIME})}
  catch(e){err('A gravação terminou, mas não foi possível recuperar o vídeo salvo: '+e.message);return}
  if(!blob.size){err('A gravação terminou sem gerar dados de vídeo. Tente novamente em um navegador compatível e mantenha esta página aberta.');return}
  err('');
  $('#ask').showModal();
}
$('#openSetup').onclick=()=>{setCameraMode(false);$('#home').hidden=true;$('#setup').hidden=false;err('')};
$('#openCameraSetup').onclick=async()=>{
  setCameraMode(true);cameraLayout={x:.82,y:.2,sc:.26};$('#home').hidden=true;$('#setup').hidden=false;err('');
  await listCameras();
};
$('#backHome').onclick=()=>{$('#setup').hidden=true;$('#home').hidden=false;setCameraMode(false);err('')};
$('#start').onclick=start;$('#pause').onclick=pause;$('#stop').onclick=stop;
$('#chooseEdit').onclick=()=>$('#editFile').click();
$('#editFile').onchange=async e=>{
  const f=e.target.files[0];e.target.value='';if(!f)return;
  if(!(f.type.startsWith('video/')||/\.(mp4|webm|mov|m4v|ogv)$/i.test(f.name))){err('Escolha um arquivo de vídeo compatível.');return}
  blob=f;rawScreenBlob=null;cameraBlob=null;cameraMotion=[];err('');
  try{await openEditor()}catch(ex){err('Não foi possível abrir este vídeo: '+ex.message)}
};

/* ---------- editor ---------- */
let url,dur=0;
function fixDur(v){return new Promise(r=>{const go=()=>{if(isFinite(v.duration))return r(v.duration);v.currentTime=1e101;v.ontimeupdate=()=>{v.ontimeupdate=null;v.currentTime=0;r(v.duration)}};v.readyState>=1?go():v.onloadedmetadata=go})}
const ROWS=3,NR=5,FRAME_RATE=30,cv=$('#cv'),g2=cv.getContext('2d'),mkEl=(t,c)=>{const e=document.createElement(t);if(c)e.className=c;return e};
let srcs=[],clips=[],texts=[],sel=null,selT=null,hist=[],fut=[],pps=60,T=0,playing=false,pt0=0,pT0=0,W=1280,H=720,endCb=null,nid=1,exporting=false;
const rt=new Map(),gb=new Float32Array(1024),mbuf=new Float32Array(1024),fl=new Set();
let AC,eq,hp,lp,an,gate,comp,mvol,spk,mt,exD,gi=null,floor=.02,gateOn=true;
const dw=e=>e.videoWidth||e.naturalWidth||e.width,dh=e=>e.videoHeight||e.naturalHeight||e.height,c01=v=>Math.max(0,Math.min(1,v));
const len=c=>(c.out-c.in)/c.spd,total=()=>Math.max(0,...clips.map(c=>c.start+len(c))),cur=()=>clips.find(x=>x.id===sel),curT=()=>texts.find(x=>x.id===selT);
const rowTr=r=>r<ROWS?ROWS-1-r:r;
const mk=o=>({id:nid++,kind:'v',tr:0,start:0,in:0,out:1,spd:1,vol:100,fi:0,fo:0,mute:false,x:.78,y:.22,sc:.4,src:0,...o});
const snap=()=>JSON.stringify({clips,texts,sel,selT});
const push=()=>{hist.push(snap());if(hist.length>80)hist.shift();fut=[]};
function restore(j){const o=JSON.parse(j);clips=o.clips;texts=o.texts;sel=o.sel;selT=o.selT;build();panel()}
const bad=c=>clips.some(x=>x!==c&&x.tr===c.tr&&c.start<x.start+len(x)-1e-6&&x.start<c.start+len(c)-1e-6);
const fade=c=>{const a=T-c.start,b=c.start+len(c)-T;return Math.max(0,Math.min(1,c.fi?a/c.fi:1,c.fo?b/c.fo:1))};
function layoutAt(c,t){
  const points=c.motion;
  if(!points||!points.length)return{x:c.x,y:c.y,sc:c.sc};
  if(t<=points[0].t)return points[0];
  for(let i=1;i<points.length;i++){
    const b=points[i];if(t>b.t)continue;
    const a=points[i-1],f=(t-a.t)/Math.max(.001,b.t-a.t);
    return{x:a.x+(b.x-a.x)*f,y:a.y+(b.y-a.y)*f,sc:a.sc+(b.sc-a.sc)*f};
  }
  return points[points.length-1];
}
function materializeLayout(c){
  const p=layoutAt(c,T);c.x=p.x;c.y=p.y;c.sc=p.sc;delete c.motion;
}
const endOf=tr=>Math.max(0,...clips.filter(x=>x.tr===tr).map(x=>x.start+len(x)));
function loadFont(n){if(!n||fl.has(n))return;fl.add(n);const l=mkEl('link');l.rel='stylesheet';l.href='https://fonts.googleapis.com/css2?family='+encodeURIComponent(n).replace(/%20/g,'+')+'&display=swap';l.onload=()=>document.fonts.load('40px "'+n+'"').catch(()=>{});document.head.appendChild(l)}

function initAudio(){
  if(AC)AC.close();rt.forEach(r=>r.img&&r.el.remove());rt.clear();clearInterval(gi);
  AC=new AudioContext();
  eq=['lowshelf','peaking','highshelf'].map((t,i)=>{const f=AC.createBiquadFilter();f.type=t;f.frequency.value=[200,1500,6000][i];return f});
  hp=AC.createBiquadFilter();hp.type='highpass';lp=AC.createBiquadFilter();lp.type='lowpass';
  an=AC.createAnalyser();an.fftSize=1024;gate=AC.createGain();comp=AC.createDynamicsCompressor();mvol=AC.createGain();
  spk=AC.createGain();mt=AC.createAnalyser();mt.fftSize=1024;exD=AC.createMediaStreamDestination();
  [...eq,hp,lp,an,gate,comp,mvol].reduce((a,b)=>(a.connect(b),b));
  mvol.connect(spk);spk.connect(AC.destination);mvol.connect(mt);mvol.connect(exD);
  floor=.02;audioParams();
  gi=setInterval(()=>{if(!gateOn)return;an.getFloatTimeDomainData(gb);let s=0;for(const x of gb)s+=x*x;const r=Math.sqrt(s/gb.length);
    floor=Math.min(r+.002,floor*1.002+.0002);const o=r>Math.max(.008,floor*2.5);
    gate.gain.setTargetAtTime(o?1:.1,AC.currentTime,o?.02:.2)},25);
}
function audioParams(){
  if(!AC)return;
  ['eb','em','ea'].forEach((id,i)=>{eq[i].gain.value=+$('#'+id).value;$('#'+id+'v').textContent=$('#'+id).value});
  const n=$('#dn').checked;hp.frequency.value=n?90:10;lp.frequency.value=n?11000:20000;gateOn=n;if(!n)gate.gain.value=1;
  const c=$('#nz').checked;comp.threshold.value=c?-24:0;comp.ratio.value=c?4:1;comp.knee.value=c?20:0;
  mvol.gain.value=$('#mute').checked?0:$('#vol').value/100;
}
['eb','em','ea','dn','nz','mute','vol'].forEach(id=>$('#'+id).addEventListener('input',audioParams));

function R(c){
  let r=rt.get(c.id);if(r)return r;const s=srcs[c.src];
  if(s.kind==='img'){
    const el=new Image();el.src=s.url;el.style.cssText='position:fixed;left:0;top:0;width:1px;height:1px;opacity:.01;pointer-events:none';document.body.appendChild(el);
    r={el,img:1,ok:true,f:1};rt.set(c.id,r);return r;
  }
  const el=document.createElement('video');el.src=s.url;el.playsInline=true;el.preload='auto';el.preservesPitch=true;
  const g=AC.createGain();g.gain.value=0;AC.createMediaElementSource(el).connect(g);g.connect(eq[0]);
  r={el,g,ok:false,f:1,last:null,lt:-1,want:null};rt.set(c.id,r);fixDur(el).then(()=>r.ok=true);
  el.addEventListener('seeked',()=>{
    if(el.readyState>=2&&el.videoWidth)cacheFrame(r);
    if(!playing&&r.want!=null&&Math.abs(el.currentTime-r.want)>.04)el.currentTime=r.want;
  });
  return r;
}
function cacheFrame(r){
  const v=r.el,l=r.last||(r.last=document.createElement('canvas'));
  if(l.width!==v.videoWidth){l.width=v.videoWidth;l.height=v.videoHeight}
  l.getContext('2d').drawImage(v,0,0);r.lt=v.currentTime;
}
function waitForDecodedFrame(r){
  const v=r.el;
  if(r.img||v.readyState>=2&&v.videoWidth&&!v.seeking){if(!r.img)cacheFrame(r);return Promise.resolve()}
  return new Promise((resolve,reject)=>{
    let timer;
    const clean=()=>{clearTimeout(timer);v.removeEventListener('loadeddata',check);v.removeEventListener('seeked',check);v.removeEventListener('error',fail)};
    const check=()=>{if(v.readyState>=2&&v.videoWidth&&!v.seeking){clean();cacheFrame(r);resolve()}};
    const fail=()=>{clean();reject(new Error('Não foi possível decodificar um quadro do vídeo.'))};
    v.addEventListener('loadeddata',check);v.addEventListener('seeked',check);v.addEventListener('error',fail);
    timer=setTimeout(()=>{clean();reject(new Error('Tempo esgotado ao decodificar um quadro do vídeo.'))},10000);
    check();
  });
}

async function openEditor(){
  $('#recwrap').hidden=true;$('#ed').hidden=false;$('#out').textContent='';
  if(url)URL.revokeObjectURL(url);if(cameraUrl)URL.revokeObjectURL(cameraUrl);
  const editorBlob=rawScreenBlob||blob;url=URL.createObjectURL(editorBlob);
  const v=document.createElement('video');v.src=url;dur=await fixDur(v);
  playing=false;T=0;initAudio();
  srcs=[{kind:'vid',url,dur,w:v.videoWidth,h:v.videoHeight}];
  clips=[mk({out:dur})];sel=clips[0].id;selT=null;texts=[];hist=[];fut=[];
  if(cameraBlob){
    cameraUrl=URL.createObjectURL(cameraBlob);
    const camVideo=document.createElement('video');camVideo.src=cameraUrl;
    const camDur=await fixDur(camVideo);
    srcs.push({kind:'vid',url:cameraUrl,dur:camDur,w:cameraSize&&cameraSize.width||camVideo.videoWidth,h:cameraSize&&cameraSize.height||camVideo.videoHeight,name:'Câmera'});
    const camClip=mk({src:1,tr:1,start:0,in:0,out:Math.min(dur,camDur),mute:true,sc:.26,x:.82,y:.2,motion:cameraMotion.map(p=>({...p}))});
    clips.push(camClip);sel=camClip.id;
  }
  cameraEnabled=false;
  setSize();build();panel();window.scrollTo(0,0);
}
function closeEditor(){stopP();$('#ed').hidden=true;$('#recwrap').hidden=false;$('#home').hidden=false;$('#setup').hidden=true;if(cameraUrl){URL.revokeObjectURL(cameraUrl);cameraUrl=null}window.scrollTo({top:0,behavior:'smooth'})}
function setSize(){
  const s=srcs[0],r=+$('#asp').value||s.w/s.h,wide=r>=s.w/s.h;
  W=wide?s.w:Math.round(s.h*r);H=wide?Math.round(s.w/r):s.h;W-=W%2;H-=H%2;cv.width=W;cv.height=H;
  $('#stage').style.width='min(100%,'+(42*W/H)+'vh)';$('#stage').style.aspectRatio=W/H;
  $('#bv').textContent=$('#br').value;$('#cv2').textContent=$('#co').value;$('#sv').textContent=$('#sa').value;
  syncEditorScroll();
}
function syncEditorScroll(){const f=$('#edFixed'),s=$('#edScroll');if(f&&s)s.style.paddingTop=f.offsetHeight+'px'}
if(window.ResizeObserver)new ResizeObserver(syncEditorScroll).observe($('#edFixed'));
addEventListener('resize',syncEditorScroll);
$('#edFixed').addEventListener('wheel',e=>{if(e.deltaY){$('#edScroll').scrollTop+=e.deltaY;e.preventDefault()}},{passive:false});
['asp','br','co','sa'].forEach(i=>$('#'+i).addEventListener('input',()=>srcs.length&&setSize()));

function loop(){
  if(!AC||!srcs.length)return;
  if(playing){T=pT0+(performance.now()-pt0)/1000;if(T>=total()){T=total();stopP()}}
  const A=[];
  clips.forEach(c=>{
    const r=R(c),a=T>=c.start&&T<c.start+len(c);
    if(r.img){if(a){r.f=fade(c);A.push(c)}return}
    const el=r.el;
    if(a&&r.ok){
      const want=c.in+(T-c.start)*c.spd;r.want=want;
      if(playing){if(el.paused){el.currentTime=want;el.playbackRate=c.spd;el.play().catch(()=>{})}else if(Math.abs(el.currentTime-want)>.3)el.currentTime=want}
      else{if(!el.paused)el.pause();if(!el.seeking&&Math.abs(el.currentTime-want)>.04)el.currentTime=want}
      r.f=fade(c);r.g.gain.value=(c.mute?0:c.vol/100)*r.f;if(c.kind!=='a')A.push(c);
    }else{
      if(!el.paused)el.pause();r.g.gain.value=0;r.want=null;
      if(r.ok&&c.start>T&&c.start-T<1&&Math.abs(el.currentTime-c.in)>.05)el.currentTime=c.in;
    }
  });
  render(A);needle();handles();
  mt.getFloatTimeDomainData(mbuf);let p=0;for(const x of mbuf)p=Math.max(p,Math.abs(x));
  const i=$('#mti');i.style.width=Math.min(100,p*100)+'%';i.className=p>.97?'hot':'';
}
setInterval(loop,33);
function tfont(x){return(x.bold?'700 ':'400 ')+(H*x.size/100)+'px "'+x.font+'",sans-serif'}
function drawText(x){
  const fs=H*x.size/100;g2.font=tfont(x);g2.textAlign='center';g2.textBaseline='middle';g2.fillStyle=x.color;g2.shadowColor='rgba(0,0,0,.7)';g2.shadowBlur=H*.01;
  g2.fillText(x.t,x.x*W,x.y*H,W*.96);g2.shadowBlur=0;
  if(x.id===selT&&!exporting){const w=Math.min(W*.96,g2.measureText(x.t).width);g2.strokeStyle='#fff';g2.setLineDash([8,6]);g2.lineWidth=H*.004;g2.strokeRect(x.x*W-w/2-8,x.y*H-fs*.65,w+16,fs*1.3);g2.setLineDash([])}
}
function render(A){
  g2.globalAlpha=1;g2.filter='none';g2.fillStyle='#000';g2.fillRect(0,0,W,H);
  g2.filter='brightness('+$('#br').value+'%) contrast('+$('#co').value+'%) saturate('+$('#sa').value+'%)';
  A.sort((a,b)=>a.tr-b.tr).forEach(c=>{
    const r=rt.get(c.id),v=r.el;let s=null;
    if(r.img){if(v.complete&&v.naturalWidth)s=v}
    else{
      if(v.readyState>=2&&v.videoWidth&&!v.seeking){
        s=v;
        if(!playing&&r.lt!==v.currentTime)cacheFrame(r);
      }else if(r.last)s=r.last;
    }
    if(!s)return;
    const sw=dw(s),sh=dh(s),layout=layoutAt(c,T);g2.globalAlpha=r.f;
    if(c.tr===0){const k=Math.max(W/sw,H/sh),w=sw*k,h=sh*k;g2.drawImage(s,(W-w)/2,(H-h)/2,w,h)}
    else{const w=W*layout.sc,h=w*sh/sw,x=layout.x*W-w/2,y=layout.y*H-h/2;g2.drawImage(s,x,y,w,h);g2.strokeStyle='#fff';g2.lineWidth=H*.004;g2.strokeRect(x,y,w,h)}
  });
  g2.globalAlpha=1;g2.filter='none';
  texts.filter(x=>T>=x.s&&T<x.e).forEach(drawText);
}
function handles(){
  const hs=$('#hs'),c=cur();
  if(!c||c.tr===0||c.kind==='a'||exporting||!(T>=c.start&&T<c.start+len(c))){hs.innerHTML='';return}
  const r=rt.get(c.id);if(!r||!dw(r.el))return;
  const layout=layoutAt(c,T),hf=layout.sc*W*dh(r.el)/(dw(r.el)*H);let box=hs.firstChild;
  if(!box){box=mkEl('div','hb');[[-1,-1],[1,-1],[-1,1],[1,1]].forEach(k=>{const p=mkEl('div','hp');p.style.cursor=k[0]*k[1]>0?'nwse-resize':'nesw-resize';p.style[k[0]<0?'left':'right']='-9px';p.style[k[1]<0?'top':'bottom']='-9px';p.onpointerdown=e=>resize(e,k);box.appendChild(p)});hs.appendChild(box)}
  box.style.left=(layout.x-layout.sc/2)*100+'%';box.style.top=(layout.y-hf/2)*100+'%';box.style.width=layout.sc*100+'%';box.style.height=hf*100+'%';
}
function resize(e,k){
  e.stopPropagation();e.preventDefault();
  const c=cur(),v=rt.get(c.id).el,rc=cv.getBoundingClientRect(),ar=dh(v)/dw(v),layout=layoutAt(c,T);push();
  c.x=layout.x;c.y=layout.y;c.sc=layout.sc;delete c.motion;
  const w0=c.sc*W,h0=w0*ar,ax=c.x*W-k[0]*w0/2,ay=c.y*H-k[1]*h0/2;
  const mv=ev=>{const px=(ev.clientX-rc.left)/rc.width*W,py=(ev.clientY-rc.top)/rc.height*H;
    const w=Math.max(.08*W,Math.min(1.5*W,Math.max(k[0]*(px-ax),k[1]*(py-ay)/ar))),h=w*ar;
    c.sc=w/W;c.x=(ax+k[0]*w/2)/W;c.y=(ay+k[1]*h/2)/H};
  const up=()=>{removeEventListener('pointermove',mv);removeEventListener('pointerup',up);panel()};
  addEventListener('pointermove',mv);addEventListener('pointerup',up);
}
function needle(){const n=$('#nd');if(n)n.style.left=T*pps+'px';$('#tc').textContent=fmt(T)+' / '+fmt(total());
  if(playing){const tl=$('#tl');if(T*pps>tl.scrollLeft+tl.clientWidth-30||T*pps<tl.scrollLeft)tl.scrollLeft=T*pps-60}}
function play(){if(!AC||!total()||exporting&&!endCb)return;AC.resume();if(T>=total()-.05)T=0;pT0=T;pt0=performance.now();playing=true;$('#pp').textContent='Pausar'}
function stopP(){playing=false;rt.forEach(r=>{if(!r.img)r.el.pause()});$('#pp').textContent='Reproduzir';if(endCb)endCb()}
$('#pp').onclick=()=>playing?stopP():play();
function setT(x){T=Math.max(0,Math.min(total(),Math.round(x*FRAME_RATE)/FRAME_RATE));if(playing){pT0=T;pt0=performance.now()}}
function scrub(e){
  if(exporting)return;e.preventDefault();if(playing)stopP();
  const I=$('#tli'),f=ev=>setT((ev.clientX-I.getBoundingClientRect().left)/pps);f(e);
  const up=()=>{removeEventListener('pointermove',f);removeEventListener('pointerup',up)};
  addEventListener('pointermove',f);addEventListener('pointerup',up);
}
const snp=(t,c)=>{const L=len(c),th=8/pps,cand=[0,T,...clips.filter(x=>x!==c).flatMap(x=>[x.start,x.start+len(x)])];
  for(const k of cand){if(Math.abs(t-k)<th)return k;if(Math.abs(t+L-k)<th)return k-L}return t};
function drag(e,c,mode){
  if(exporting)return;e.stopPropagation();e.preventDefault();
  sel=c.id;selT=null;panel();$('#d-clip').open=true;const o={...c},x0=e.clientX,I=$('#tli');let moved=false;
  const mv=ev=>{
    if(!moved){moved=true;const keep={...c};Object.assign(c,o);push();Object.assign(c,keep)}
    const dt=(ev.clientX-x0)/pps;
    if(mode==='m'){
      c.start=snp(Math.max(0,o.start+dt),c);
      const rr=Math.max(0,Math.min(NR-1,Math.floor((ev.clientY-I.getBoundingClientRect().top-24)/40)));let tr=rowTr(rr);
      if(c.kind==='a'){if(tr<ROWS)tr=ROWS}else if(tr>=ROWS)tr=0;
      if(o.tr===0&&tr>0){c.sc=1;c.x=.5;c.y=.5}
      c.tr=tr;
    }else if(mode==='l'){const d=Math.max(-o.in,-o.start*o.spd,Math.min(dt*o.spd,(o.out-o.in)-.2*o.spd));c.in=o.in+d;c.start=o.start+d/o.spd}
    else c.out=Math.max(o.in+.2*o.spd,Math.min(srcs[c.src].dur,o.out+dt*o.spd));
    build();
  };
  const up=()=>{removeEventListener('pointermove',mv);removeEventListener('pointerup',up);if(bad(c))Object.assign(c,o);build();panel()};
  addEventListener('pointermove',mv);addEventListener('pointerup',up);
}
function dragT(e,x){
  if(exporting)return;e.stopPropagation();e.preventDefault();
  selT=x.id;sel=null;panel();loadTx();
  const s0=x.s,d0=x.e-x.s,x0=e.clientX;let m=false;
  const mv=ev=>{if(!m){m=true;push()}x.s=Math.max(0,s0+(ev.clientX-x0)/pps);x.e=x.s+d0;build()};
  const up=()=>{removeEventListener('pointermove',mv);removeEventListener('pointerup',up);build()};
  addEventListener('pointermove',mv);addEventListener('pointerup',up);build();
}
function build(){
  const tot=Math.max(total()+8,20),I=$('#tli');I.innerHTML='';I.style.width=tot*pps+'px';
  const ru=mkEl('div','rul'),st=pps>=100?1:pps>=40?5:10;
  for(let s=0;s<tot;s+=st){const t=mkEl('span');t.style.cssText='position:absolute;top:4px;padding-left:3px;border-left:1px solid var(--line);left:'+s*pps+'px';t.textContent=fmt(s).slice(3);ru.appendChild(t)}
  ru.onpointerdown=scrub;I.appendChild(ru);
  for(let r=0;r<NR;r++){
    const tr=rowTr(r),row=mkEl('div','trk');
    row.onpointerdown=e=>{if(e.target===row){sel=null;selT=null;panel();build();scrub(e)}};
    clips.filter(c=>c.tr===tr).forEach(c=>{
      const d=mkEl('div','clip'+(c.kind==='a'?' au':tr?' o':'')+(c.id===sel?' sel':'')),l=mkEl('div','hd l'),rr=mkEl('div','hd r');
      d.style.left=c.start*pps+'px';d.style.width=Math.max(6,len(c)*pps)+'px';
      d.appendChild(document.createTextNode((srcs[c.src].name||(c.kind==='a'?'Áudio':'Gravação'))+(c.spd!==1?' · '+c.spd+'×':'')));d.append(l,rr);
      d.onpointerdown=e=>drag(e,c,'m');l.onpointerdown=e=>drag(e,c,'l');rr.onpointerdown=e=>drag(e,c,'r');
      row.appendChild(d)});
    I.appendChild(row)}
  const tx=mkEl('div','trk');
  texts.forEach(x=>{const d=mkEl('div','clip tt'+(x.id===selT?' sel':''));d.style.left=x.s*pps+'px';d.style.width=Math.max(6,(x.e-x.s)*pps)+'px';d.textContent=x.t;d.onpointerdown=e=>dragT(e,x);tx.appendChild(d)});
  tx.onpointerdown=e=>{if(e.target===tx){sel=null;selT=null;panel();build();scrub(e)}};
  I.appendChild(tx);const nd=mkEl('div','needle');nd.id='nd';I.appendChild(nd);needle();
  const L=$('#txl');L.innerHTML='';
  texts.forEach((x,i)=>{const r=mkEl('div','segrow'),b0=mkEl('button','sec'),b=mkEl('button','sec');
    b0.textContent='“'+x.t.slice(0,16)+'” '+fmt(x.s).slice(3);b0.onclick=()=>{selT=x.id;sel=null;loadTx();panel();build()};
    b.textContent='Remover';b.onclick=()=>{push();texts.splice(i,1);if(selT===x.id)selT=null;build()};r.append(b0,b);L.appendChild(r)});
}
function panel(){
  const c=cur(),P=$('#cp');P.hidden=!c;$('#cnone').hidden=!!c;$('#ctr').textContent='';if(!c)return;
  $('#ctr').textContent=c.kind==='a'?'A'+(c.tr-ROWS+1):'V'+(c.tr+1);$('#cspd').value=c.spd;$('#cvol').value=c.vol;$('#cvv').textContent=c.vol;
  $('#cfi').value=c.fi;$('#cfo').value=c.fo;$('#cmute').checked=c.mute;$('#csc').value=Math.round(layoutAt(c,T).sc*100);
  $('#cov').hidden=$('#cpl').hidden=c.tr===0||c.kind==='a';
}
const bind=(id,fn)=>{const e=$('#'+id);e.addEventListener('input',()=>{const c=cur();if(!c)return;if(!e._p){push();e._p=1}fn(c,e);build()});e.addEventListener('change',()=>{e._p=0;panel()})};
bind('cspd',(c,e)=>{const o=c.spd;c.spd=+e.value;if(bad(c))c.spd=o});
bind('cvol',(c,e)=>{c.vol=+e.value;$('#cvv').textContent=e.value});
bind('cfi',(c,e)=>c.fi=+e.value);bind('cfo',(c,e)=>c.fo=+e.value);
bind('cmute',(c,e)=>c.mute=e.checked);bind('csc',(c,e)=>{materializeLayout(c);c.sc=e.value/100});
bind('cpos',(c,e)=>{materializeLayout(c);const p=e.value.split(',');c.x=+p[0];c.y=+p[1]});

function loadTx(){const x=curT();if(!x)return;$('#txt').value=x.t;$('#txf').value=x.font;$('#txs').value=x.size;$('#txc').value=x.color;$('#txb').checked=x.bold;$('#d-txt').open=true}
function editTx(){const x=curT();if(!x)return;x.t=$('#txt').value;x.size=+$('#txs').value;x.color=$('#txc').value;x.bold=$('#txb').checked;build()}
['txt','txs','txc','txb'].forEach(id=>{const e=$('#'+id);e.addEventListener('input',()=>{if(!curT())return;if(!e._p){push();e._p=1}editTx()});e.addEventListener('change',()=>e._p=0)});
$('#txf').addEventListener('change',()=>{const n=$('#txf').value.trim();loadFont(n);const x=curT();if(x){push();x.font=n||x.font;build()}});
$('#addtx').onclick=()=>{
  const f=$('#txf').value.trim()||'Montserrat';push();loadFont(f);
  const x={id:nid++,t:$('#txt').value.trim()||'Seu texto',s:T,e:T+(+$('#txd').value||3),x:.5,y:.82,size:+$('#txs').value,color:$('#txc').value,font:f,bold:$('#txb').checked};
  texts.push(x);selT=x.id;sel=null;loadTx();build();panel();
};
function hitText(px,py){
  for(const x of texts.filter(x=>T>=x.s&&T<x.e).reverse()){const fs=H*x.size/100;g2.font=tfont(x);const w=Math.min(W*.96,g2.measureText(x.t).width);
    if(Math.abs(px-x.x*W)<=w/2+10&&Math.abs(py-x.y*H)<=fs*.65)return x}
  return null;
}
cv.addEventListener('pointerdown',e=>{
  if(exporting)return;const rc=cv.getBoundingClientRect(),fx=ev=>(ev.clientX-rc.left)/rc.width,fy=ev=>(ev.clientY-rc.top)/rc.height;
  const tx=hitText(fx(e)*W,fy(e)*H);let o=tx;
  if(tx){selT=tx.id;sel=null;loadTx();panel();build()}
  else{const c=cur();if(!c||c.tr===0||c.kind==='a')return;o=c}
  const layout=layoutAt(o,T),dx=layout.x-fx(e),dy=layout.y-fy(e);push();materializeLayout(o);
  const mv=ev=>{o.x=c01(fx(ev)+dx);o.y=c01(fy(ev)+dy)};
  const up=()=>{removeEventListener('pointermove',mv);removeEventListener('pointerup',up)};
  addEventListener('pointermove',mv);addEventListener('pointerup',up);
});
function split(){
  const c=cur(),ok=x=>T>x.start+.05&&T<x.start+len(x)-.05,tg=c&&ok(c)?[c]:clips.filter(ok);if(!tg.length)return;
  push();tg.forEach(c=>{const m=c.in+(T-c.start)*c.spd,n=mk({...c,id:nid++,start:T,in:m});c.out=m;clips.push(n);sel=n.id;selT=null});build();panel();
}
function delSeg(){
  const c=cur();
  if(!c){if(selT){push();texts=texts.filter(x=>x.id!==selT);selT=null;build()}return}
  push();clips=clips.filter(x=>x!==c);
  if(c.tr===0){const L=len(c);clips.filter(x=>x.tr===0&&x.start>=c.start).forEach(x=>x.start-=L)}
  sel=null;build();panel();
}
function dup(){
  const c=cur();if(!c)return;push();
  const n=mk({...c,id:nid++,tr:c.kind==='a'?(c.tr===ROWS?ROWS+1:ROWS):Math.min(ROWS-1,c.tr+1)});
  if(n.tr!==c.tr&&n.kind!=='a')n.mute=true;
  if(n.tr===c.tr)n.start=c.start+len(c);if(bad(n))n.start=endOf(n.tr);
  clips.push(n);sel=n.id;build();panel();
}
function sepAudio(){
  const c=cur();if(!c||c.kind==='a'||srcs[c.src].kind!=='vid')return;push();
  const n=mk({...c,id:nid++,kind:'a',tr:ROWS,mute:false});c.mute=true;
  if(bad(n))n.tr=ROWS+1;if(bad(n))n.start=endOf(n.tr);
  clips.push(n);sel=n.id;build();panel();
}
$('#split').onclick=split;$('#del').onclick=delSeg;$('#dup').onclick=dup;$('#sep').onclick=sepAudio;
$('#imp').onchange=async e=>{
  const f=e.target.files[0];e.target.value='';if(!f)return;
  try{
    const u=URL.createObjectURL(f),t=f.type||'';let s,c;
    if(t.startsWith('image/')){
      const im=new Image();im.src=u;await im.decode();
      s={kind:'img',url:u,dur:3600,w:im.naturalWidth,h:im.naturalHeight,name:f.name.slice(0,24)};srcs.push(s);
      c=mk({src:srcs.length-1,tr:1,start:T,out:5});
    }else{
      const v=document.createElement('video');v.src=u;const d=await fixDur(v),au=t.startsWith('audio/');
      s={kind:au?'aud':'vid',url:u,dur:d,w:v.videoWidth,h:v.videoHeight,name:f.name.slice(0,24)};srcs.push(s);
      c=au?mk({src:srcs.length-1,kind:'a',tr:ROWS,start:T,out:d}):mk({src:srcs.length-1,tr:1,start:T,out:d});
    }
    push();
    if(bad(c))c.tr=c.kind==='a'?ROWS+1:2;if(bad(c))c.start=endOf(c.tr);
    clips.push(c);sel=c.id;selT=null;build();panel();
  }catch(err){alert('Não foi possível importar este arquivo.')}
};
$('#zm').oninput=e=>{pps=+e.target.value;build()};
$('#undo').onclick=()=>{if(hist.length){fut.push(snap());restore(hist.pop())}};
$('#redo').onclick=()=>{if(fut.length){hist.push(snap());restore(fut.pop())}};
addEventListener('keydown',e=>{
  const a=document.activeElement,k=e.key.toLowerCase();
  if($('#ed').hidden||exporting||a.matches('input[type=text],input[type=number],textarea,select'))return;
  if(e.ctrlKey||e.metaKey){if(k==='z'){e.preventDefault();$('#undo').click()}else if(k==='y'){e.preventDefault();$('#redo').click()}return}
  if(k===' '){e.preventDefault();$('#pp').click()}
  else if(k==='s')split();else if(k==='delete'||k==='backspace')delSeg();
  else if(!a.closest('input,select,textarea,button,summary,[contenteditable="true"]')&&k==='arrowleft'){e.preventDefault();setT((Math.round(T*FRAME_RATE)-1)/FRAME_RATE)}
  else if(!a.closest('input,select,textarea,button,summary,[contenteditable="true"]')&&k==='arrowright'){e.preventDefault();setT((Math.round(T*FRAME_RATE)+1)/FRAME_RATE)}
});

$('#vol').oninput=e=>$('#vv').textContent=e.target.value;
const dl=(b,n)=>{const a=document.createElement('a'),u=URL.createObjectURL(b);a.href=u;a.download=n;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000)};
const nome=t=>'gravacao'+(t?'-'+t:'')+'-'+new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')+'.'+EXT;
const extensions={'video/mp4':'mp4','video/webm':'webm','video/quicktime':'mov','video/x-matroska':'mkv','video/ogg':'ogv','video/mpeg':'mpeg','video/3gpp':'3gp'};
function fileNameFor(blobPart,label){
  const type=(blobPart.type||MIME).split(';')[0],fileExt=blobPart.name&&blobPart.name.match(/\.([^.]+)$/);
  const ext=extensions[type]||(fileExt&&fileExt[1])||EXT;
  if(label==='original'&&blobPart.name)return blobPart.name.replace(/\.[^.]+$/,'')+'-original.'+ext;
  return nome(label).replace(/\.[^.]+$/,'.'+ext);
}
async function chooseSaveTarget(name,type){
  if(!window.showSaveFilePicker)return null;
  type=type.split(';')[0];
  const ext=extensions[type];
  const options={suggestedName:name};
  if(ext)options.types=[{description:'Arquivo de vídeo',accept:{[type]:['.'+ext]}}];
  return window.showSaveFilePicker(options);
}
async function saveToTarget(b,name,target){
  if(!target){dl(b,name);return 'O navegador baixou o vídeo para a pasta Downloads: '+name}
  const w=await target.createWritable();await w.write(b);await w.close();
  return 'Vídeo salvo: '+name;
}
async function saveFile(b,name){
  const target=await chooseSaveTarget(name,b.type||MIME);
  return saveToTarget(b,name,target);
}
$('#ask').oncancel=e=>e.preventDefault();
$('#askEdit').onclick=()=>{$('#ask').close();openEditor()};
$('#askSave').onclick=async()=>{
  $('#ask').close();$('#msg').textContent='Escolha onde salvar o vídeo…';
  try{$('#msg').textContent=await saveFile(blob,fileNameFor(blob,''))}
  catch(e){$('#msg').textContent=e.name==='AbortError'?'Salvamento cancelado. O vídeo continua disponível para editar ou salvar novamente.':'Não foi possível salvar o vídeo: '+e.message}
};
if(EXT!=='mp4')$('#msg').textContent='Este navegador só grava em WebM. Para gravar em MP4, use Chrome ou Edge atualizados.';
$('#orig').onclick=async()=>{try{$('#out').textContent=await saveFile(blob,fileNameFor(blob,'original'))}catch(e){$('#out').textContent=e.name==='AbortError'?'Salvamento cancelado.':'Não foi possível salvar o vídeo: '+e.message}};
$('#new').onclick=closeEditor;

$('#exp').onclick=async()=>{
  if(!total())return;
  const btn=$('#exp');btn.disabled=true;exporting=true;stopP();$('#prog').hidden=false;$('#prog').value=0;
  $('#out').textContent='Salvando em tempo real… não feche nem minimize esta aba.';
  let pi=null,ok=false;
  try{
    const name=fileNameFor({type:MIME},'editada');
    const target=await chooseSaveTarget(name,MIME);
    await AC.resume();
    try{await Promise.all(texts.map(x=>document.fonts.load('40px "'+x.font+'"')))}catch(e){}
    spk.gain.value=0;T=0;
    await Promise.all(clips.map(c=>new Promise((resolve,reject)=>{
      const rr=R(c),wait=()=>rr.ok?waitForDecodedFrame(rr).then(resolve,reject):setTimeout(wait,100);wait();
    })));
    const out=new MediaStream([...cv.captureStream(30).getVideoTracks(),...exD.stream.getAudioTracks()]);
    const mr=new MediaRecorder(out,{mimeType:MIME,videoBitsPerSecond:5e6}),parts=[];
    mr.ondataavailable=e=>e.data.size&&parts.push(e.data);
    const done=new Promise(r=>mr.onstop=r);
    mr.start(1000);
    await new Promise(r=>{endCb=()=>{endCb=null;r()};play();pi=setInterval(()=>{$('#prog').value=T/total()},100)});
    await new Promise(r=>setTimeout(r,400));mr.stop();await done;
    const msgS=await saveToTarget(new Blob(parts,{type:MIME}),name,target);
    $('#out').textContent='Pronto. '+msgS;$('#msg').textContent=msgS;ok=true;
  }catch(e){$('#out').textContent='Falha ao salvar: '+e.message}
  clearInterval(pi);endCb=null;spk&&(spk.gain.value=1);exporting=false;btn.disabled=false;$('#prog').hidden=true;
  if(ok)closeEditor();
};
listMics();listCameras();updateCaptureSupport();navigator.mediaDevices&&navigator.mediaDevices.addEventListener&&navigator.mediaDevices.addEventListener('devicechange',()=>{listMics();listCameras()});
try{if(document.featurePolicy&&!document.featurePolicy.allowsFeature('display-capture'))err('Esta página está num quadro que bloqueia a captura de tela. Baixe o arquivo e abra no Chrome ou Edge.')}catch(e){}
