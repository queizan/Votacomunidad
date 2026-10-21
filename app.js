(()=>{
'use strict';
const $=id=>document.getElementById(id), cfg=window.VOTA_CONFIG||{};
let db=null,uid='',room=null,mode='',questions=[],counts=[],houses=[],members=[],myHouses=[],availableHomes=[],claimLocked=false,claimEditing=false,claimDraft=new Set(),active=null,poll=null,chosen=null,working=false,lastSnapshot='',lastError='';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function notice(t,ok=false){let e=$('alert');e.textContent=t;e.className='alert'+(ok?' ok':'');clearTimeout(notice.t);notice.t=setTimeout(()=>e.classList.add('hidden'),6500);}
const problem=e=>notice(e?.message||String(e));
const configured=()=>/^https:\/\//.test(cfg.supabaseUrl||'')&&cfg.supabaseAnonKey&&!cfg.supabaseAnonKey.startsWith('PON_');
function show(which){for(let id of ['landing','organizer','participant'])$(id).classList.toggle('hidden',which!==id);scrollTo(0,0);}
async function connect(){if(db)return true;if(!configured()){notice('Falta configurar Supabase en config.js y ejecutar los scripts SQL.');return false;}if(!window.supabase){notice('No se ha cargado la biblioteca de Supabase. Revisa la conexión.');return false;}try{db=window.supabase.createClient(cfg.supabaseUrl,cfg.supabaseAnonKey);let x=await db.auth.getSession();if(x.error)throw x.error;let s=x.data.session;if(!s){let y=await db.auth.signInAnonymously();if(y.error)throw y.error;s=y.data.session;}uid=s.user.id;$('connectionStatus').textContent='Conectado';return true;}catch(e){db=null;problem(e);return false;}}
const newCode=()=>{const letters='ABCDEFGHJKLMNPQRSTUVWXYZ23456789',a=new Uint32Array(8);crypto.getRandomValues(a);return [...a].map(x=>letters[x%letters.length]).join('');};
async function create(){if(working)return;working=true;try{if(!await connect())return;let r;for(let i=0;i<4;i++){r=await db.from('sessions').insert({code:newCode(),owner_id:uid,title:'Reunión de comunidad'}).select().single();if(!r.error||r.error.code!=='23505')break;}if(r.error)throw r.error;enter(r.data);}catch(e){problem(e);}finally{working=false;}}
async function join(v){if(working)return;working=true;try{if(!await connect())return;let c=String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'');if(c.length!==8)throw Error('Introduce un código de 8 caracteres.');const j=await db.rpc('join_session',{access_code:c});if(j.error)throw j.error;const r=await db.from('sessions').select('*').eq('id',j.data).single();if(r.error)throw r.error;enter(r.data);}catch(e){problem(e);}finally{working=false;}}
function share(){let u=new URL(location.href);u.search='';u.hash='';u.searchParams.set('s',room.code);return u.toString();}
function enter(r){availableHomes=[];claimLocked=false;claimEditing=false;claimDraft=new Set();lastSnapshot='';lastError='';exportStarted=false;$('confirmSaved').checked=false;updateFinish();room=r;mode=r.owner_id===uid?'organizer':'participant';localStorage.setItem('vota-last-room',r.id);if(mode==='organizer'){$('organizerTitle').textContent=r.title;$('roomCode').textContent=r.code;$('shareLink').textContent=share();}else{$('participantTitle').textContent=r.title;$('participantCode').textContent=r.code;}show(mode);clearInterval(poll);refresh();poll=setInterval(refresh,3000);}
function leave(){clearInterval(poll);room=null;localStorage.removeItem('vota-last-room');history.replaceState(null,'',location.pathname);show('landing');}
let exportStarted=false;
let loading=false;
async function refresh(){
 if(!db||!room||loading||working||document.visibilityState==='hidden')return;
 loading=true;
 try{
  const result=await db.rpc(mode==='organizer'?'organizer_state':'participant_state',{p_session:room.id});
  if(result.error)throw result.error;
  if(!room)return;
  const data=result.data;if(!data||typeof data!=='object')throw Error('La respuesta de Supabase está vacía');
  const signature=JSON.stringify(data);
  $('connectionStatus').textContent='Sincronizado · '+new Date().toLocaleTimeString('es-ES');
  lastError='';
  if(signature===lastSnapshot)return;
  lastSnapshot=signature;
  room={...room,title:data.title,code:data.code};
  if(mode==='organizer'){
   questions=data.questions||[];active=questions.find(q=>q.status==='open')||null;
   members=data.members||[];houses=data.dwellings||[];counts=data.counts||[];
   $('memberCount').textContent=members.length;renderOrg();renderHouses();
  }else{
   active=data.question||null;availableHomes=data.homes||[];
   myHouses=availableHomes.filter(h=>h.mine);claimLocked=!!data.locked;
   renderParticipant(data.my_vote||null);renderClaimPicker();
  }
 }catch(e){
  console.error('VotaComunidad: error de sincronización',e);
  $('connectionStatus').textContent='Error de conexión';
  let message=e?.message||String(e);
  if(message.includes('schema cache')||message.includes('Could not find the function'))
   message='Falta instalar en Supabase 06_reparacion_y_rendimiento.sql.';
  if(message!==lastError){lastError=message;notice(message);}
 }finally{loading=false;}
}
function renderOrg(){
 $('organizerStatus').textContent=active?'Votación abierta':'Sin votación abierta';
 const total=id=>counts.filter(x=>x.question_id===id).reduce((n,x)=>n+Number(x.count),0);
 $('voteCount').textContent=active?total(active.id):0;
 $('participation').textContent=active?total(active.id)+' votos de '+houses.length+' viviendas':'Sin pregunta abierta';
 $('questionsList').innerHTML=questions.length?questions.map((q,i)=>'<div class="question-row"><p>'+(i+1)+'. '+esc(q.title)+'</p><div class="row-actions"><span class="pill '+(q.status==='closed'?'gray':q.status==='open'?'green':'')+'">'+(q.status==='open'?'Abierta':q.status==='closed'?'Cerrada':'Pendiente')+'</span>'+(q.status==='draft'?'<button class="button primary" data-open="'+q.id+'" '+(active?'disabled':'')+'>Abrir votación</button>':'')+(q.status==='open'?'<button class="button danger" data-close="'+q.id+'">Cerrar votación</button>':'')+(q.status==='closed'?'<button class="button outline" data-result="'+q.id+'">Ver resultados</button>':'')+'</div></div>').join(''):'<p class="muted">Todavía no hay preguntas.</p>';
 const q=questions.find(x=>x.id===chosen)||active||[...questions].reverse().find(x=>x.status==='closed');
 $('questionBadge').textContent=q?(q.status==='open'?'En directo':q.status==='closed'?'Cerrada':'Pendiente'):'Sin votación';
 if(!q){$('resultsContent').innerHTML='<div class="empty">Abre una pregunta para recibir votos.</div>';return;}
 const n=total(q.id);
 $('resultsContent').innerHTML='<div class="result-title">'+esc(q.title)+'</div><p class="muted">'+n+' viviendas votadas</p>'+q.options.map(o=>{
 const c=Number(counts.find(v=>v.question_id===q.id&&v.choice===o)?.count||0),p=n?Math.round(c*100/n):0;
 return '<div class="result-row"><div class="result-line"><strong>'+esc(o)+'</strong><span>'+c+' · '+p+'%</span></div><div class="bar-track"><div class="bar" style="width:'+p+'%"></div></div></div>';
 }).join('');
}
function renderParticipant(v){$('participantIdentity').textContent=uid.slice(0,8).toUpperCase();$('myHouses').textContent=myHouses.length?myHouses.length+' vivienda(s): '+myHouses.map(x=>x.label).join(', '):'Todavía no tienes viviendas asignadas. Selecciónalas en el listado.';$('participantBadge').textContent=active?'Votación abierta':'Esperando';
if(!active){$('ballotArea').innerHTML='<div class="wait-icon">◷</div><h2>Esperando a que se abra una pregunta</h2><p class="muted">Esta pantalla se actualizará automáticamente.</p>';return;}
if(!myHouses.length){$('ballotArea').innerHTML='<h2>'+esc(active.title)+'</h2><p class="muted">Esta pregunta ya está abierta. Selecciona tus viviendas disponibles arriba y pulsa Guardar viviendas seleccionadas para poder responder.</p>';return;}
$('ballotArea').innerHTML='<h2>'+esc(active.title)+'</h2><p class="muted">Tu respuesta contará para '+myHouses.length+' vivienda(s).</p>'+active.options.map((o,i)=>'<button type="button" class="option '+(o===v?'selected':'')+'" data-choice="'+i+'"><span class="radio-dot"></span><span>'+esc(o)+'</span></button>').join('')+'<p class="vote-note">'+(v?'✓ Voto registrado. Puedes modificarlo antes del cierre.':'Aún no has votado.')+'</p>';
}
async function vote(i){if(working||!active)return;working=true;try{let o=active.options[i];if(o===undefined)throw Error('Opción no válida');let v=await db.rpc('cast_unit_votes',{p_question:active.id,p_choice:o});if(v.error)throw v.error;notice('Voto registrado correctamente',true);}catch(e){problem(e);}finally{working=false;refresh();}}
async function addQuestion(e){e.preventDefault();if(working||!room)return;working=true;try{let title=$('questionTitle').value.trim(),options=$('questionType').value==='binary'?['Sí','No','Abstención']:$('questionOptions').value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);if(!title)throw Error('Escribe una pregunta');if(options.length<2||options.length>8||new Set(options).size!==options.length)throw Error('Introduce entre 2 y 8 opciones diferentes');let r=await db.from('questions').insert({session_id:room.id,title,options,status:'draft'});if(r.error)throw r.error;$('questionForm').reset();$('optionsBox').classList.add('hidden');notice('Pregunta añadida',true);}catch(e){problem(e);}finally{working=false;refresh();}}
async function status(id,s){if(working)return;working=true;try{let r=await db.from('questions').update({status:s}).eq('id',id).select('id,status').single();if(r.error)throw r.error;if(r.data?.status!==s)throw Error('No se ha podido actualizar el estado de la votación');chosen=null;notice(s==='open'?'Votación abierta. Los móviles se actualizarán automáticamente.':'Votación cerrada',true);}catch(e){problem(e);}finally{working=false;refresh();}}
function exportCsv(){if(!room||!questions.length){notice('No hay preguntas para exportar');return;}let rows=[['Sesión','Pregunta','Estado','Opción','Votos','Total votos']];for(let q of questions){let n=counts.filter(v=>v.question_id===q.id).reduce((a,v)=>a+Number(v.count),0);for(let o of q.options)rows.push([room.code,q.title,q.status,o,Number(counts.find(v=>v.question_id===q.id&&v.choice===o)?.count||0),n]);}let quote=x=>'"'+String(x??'').replace(/"/g,'""')+'"',b=new Blob(['\ufeff'+rows.map(r=>r.map(quote).join(';')).join('\r\n')],{type:'text/csv;charset=utf-8'}),a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='votaciones-'+room.code+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),5000);exportStarted=true;updateFinish();notice('Descarga iniciada: verifica que has guardado el CSV',true);}
function updateFinish(){let ready=exportStarted&&$('confirmSaved').checked&&!!room&&!working;$('finishBtn').disabled=!ready;$('finishStatus').textContent=exportStarted?'Comprueba el archivo descargado y confirma antes de eliminar.':'Primero exporta el CSV y comprueba su contenido.';}
async function finishSession(){
 if(working||!room||!exportStarted||!$('confirmSaved').checked)return;
 if(questions.some(q=>q.status==='open'))return notice('Cierra todas las votaciones antes de finalizar.');
 if(!confirm('¿Has guardado el CSV? Esta acción eliminará la sesión, los votos y el censo de Supabase. No se puede deshacer.'))return;
 const typed=prompt('Para confirmar el borrado irreversible, escribe ELIMINAR:');
 if(typed!=='ELIMINAR')return notice('Cancelado: los datos siguen intactos.');
 working=true;updateFinish();
 try{
   const result=await db.functions.invoke('finalizar-reunion',{body:{session_id:room.id,confirm_export:true}});
   if(result.error)throw result.error;
   if(!result.data?.deleted)throw Error(result.data?.error||'No se confirmó la eliminación');
   const warning=result.data.warning;
   leave();questions=[];counts=[];houses=[];members=[];myHouses=[];active=null;chosen=null;exportStarted=false;
   await db.auth.signOut();db=null;uid='';
   notice(warning||'Sesión y datos operativos eliminados. Guarda el CSV exportado.',!warning);
 }catch(e){problem(e);}finally{working=false;updateFinish();}
}
function renderClaimPicker(){
 if(!claimEditing)claimDraft=new Set(myHouses.map(h=>h.id));
 const filter=($('claimSearch').value||'').trim().toLocaleLowerCase('es');
 const matches=availableHomes.filter(h=>h.label.toLocaleLowerCase('es').includes(filter));
 $('claimList').innerHTML=matches.length?matches.slice(0,180).map(h=>{
 const occupied=h.occupied&&!h.mine,selected=!occupied&&claimDraft.has(h.id);
 return '<label class="house-item '+(occupied?'unavailable':'')+'"><input type="checkbox" data-claim="'+h.id+'" '+(selected?'checked':'')+' '+(occupied||claimLocked?'disabled':'')+'><span><strong>'+esc(h.label)+'</strong><small>'+(h.mine?'Tu vivienda':occupied?'Ya seleccionada':'Disponible')+'</small></span></label>';
 }).join(''):'<p class="muted">No se han encontrado viviendas.</p>';
 $('claimBtn').disabled=claimLocked||!availableHomes.length||!claimDraft.size||working;
 $('claimStatus').textContent=claimLocked?'Ya has votado; tus viviendas quedan bloqueadas.':
 'Seleccionadas: '+claimDraft.size+' · Ocupadas: '+availableHomes.filter(h=>h.occupied&&!h.mine).length+' · Libres: '+availableHomes.filter(h=>!h.occupied).length+
 (matches.length>180?' · Mostrando 180 de '+matches.length+'. Usa el buscador.':'');
}
async function claimSelected(){
 if(working||!room||claimLocked)return;
 const ids=[...claimDraft];
 if(!ids.length)return notice('Selecciona una vivienda');
 working=true;
 try{
  const {data,error}=await db.rpc('claim_my_dwellings',{p_session:room.id,p_ids:ids});
  if(error)throw error;
  claimEditing=false;notice('Viviendas asignadas: '+data+'. Ya puedes votar.',true);
 }catch(e){problem(e);claimEditing=false;}
 finally{working=false;lastSnapshot='';refresh();}
}
const locked=()=>questions.some(x=>x.status!=='draft');
function renderHouses(){
 $('dwellingCounter').textContent=houses.length+' viviendas';
 const byUser=new Map();
 for(const h of houses){if(!h.representative_id)continue;
 if(!byUser.has(h.representative_id))byUser.set(h.representative_id,[]);
 byUser.get(h.representative_id).push(h.label);}
 $('rosterParticipants').innerHTML=members.length?members.map(m=>{
 const assigned=byUser.get(m.user_id)||[];
 return '<div class="question-row"><strong>'+esc(m.user_id.slice(0,8).toUpperCase())+'</strong><span class="pill '+(assigned.length?'green':'gray')+'">'+assigned.length+' vivienda(s)</span><div class="micro">'+(assigned.length?assigned.map(esc).join(', '):'Pendiente de asignar')+'</div></div>';
 }).join(''):'<p class="muted">Todavía no hay participantes inscritos.</p>';
 const unassigned=houses.filter(h=>!h.representative_id);
 $('rosterStatus').textContent=(houses.length-unassigned.length)+' asignadas · '+unassigned.length+' sin asignar · '+members.length+' participantes registrados';
 const filter=($('rosterFilter').value||'').trim().toLocaleLowerCase('es');
 const matching=unassigned.filter(h=>h.label.toLocaleLowerCase('es').includes(filter));
 $('rosterUnassigned').innerHTML=matching.length?matching.slice(0,180).map(h=>'<span class="pill gray">'+esc(h.label)+'</span>').join(' ')+(matching.length>180?'<p class="micro">Mostrando 180 de '+matching.length+'. Usa el buscador.</p>':''):'<p class="muted">No hay viviendas pendientes con ese filtro.</p>';
 for(const id of ['housesFile','housesManual','addHouses'])$(id).disabled=locked();
}
function csvParts(line,sep){let a=[],v='',quoted=false;for(let i=0;i<line.length;i++){let c=line[i];if(c==='"'){if(quoted&&line[i+1]==='"'){v+='"';i++;}else quoted=!quoted;}else if(c===sep&&!quoted){a.push(v.trim());v='';}else v+=c;}a.push(v.trim());return a;}
function parseHomes(s){let lines=s.replace(/^\uFEFF/,'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean);if(!lines.length)return [];let sep=lines[0].includes(';')?';':',',h=csvParts(lines[0],sep).map(x=>x.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')),portal=h.findIndex(x=>['portal','numero','bloque'].includes(x)),planta=h.findIndex(x=>['planta','piso'].includes(x)),puerta=h.findIndex(x=>['puerta','letra'].includes(x)),vivienda=h.findIndex(x=>['vivienda','casa'].includes(x)),header=portal>=0||vivienda>=0;return [...new Set((header?lines.slice(1):lines).map(line=>{if(!header)return line;let x=csvParts(line,sep);return [portal>=0?x[portal]:'',vivienda>=0?x[vivienda]:'',planta>=0?x[planta]:'',puerta>=0?x[puerta]:''].filter(Boolean).join(' ');}).map(x=>x.replace(/\s+/g,' ').trim()).filter(x=>x.length&&x.length<=100))];}
async function importHomes(labels){if(locked())throw Error('El censo está bloqueado');if(!labels.length)throw Error('No hay viviendas válidas');if(labels.length>5000)throw Error('Máximo 5000 viviendas');const r=await db.rpc('import_dwellings',{p_session:room.id,p_labels:labels});if(r.error)throw r.error;notice(labels.length+' viviendas procesadas',true);refresh();}

$('themeBtn').onclick=()=>{document.documentElement.classList.toggle('dark');localStorage.setItem('vota-theme',document.documentElement.classList.contains('dark')?'dark':'light');};if(localStorage.getItem('vota-theme')==='dark')document.documentElement.classList.add('dark');
$('createBtn').onclick=create;$('joinForm').onsubmit=e=>{e.preventDefault();join($('joinCode').value);};
$('questionForm').onsubmit=addQuestion;$('questionType').onchange=()=> $('optionsBox').classList.toggle('hidden',$('questionType').value!=='multiple');
$('questionsList').onclick=e=>{let b=e.target.closest('button');if(!b)return;if(b.dataset.open)status(b.dataset.open,'open');if(b.dataset.close&&confirm('¿Cerrar esta votación?'))status(b.dataset.close,'closed');if(b.dataset.result){chosen=b.dataset.result;renderOrg();}};
$('ballotArea').onclick=e=>{let b=e.target.closest('[data-choice]');if(b)vote(Number(b.dataset.choice));};
$('claimList').onchange=e=>{
 if(!e.target.matches('[data-claim]'))return;
 claimEditing=true;
 if(e.target.checked)claimDraft.add(e.target.dataset.claim);
 else claimDraft.delete(e.target.dataset.claim);
 $('claimBtn').disabled=claimLocked||working||!claimDraft.size;
 $('claimStatus').textContent='Seleccionadas: '+claimDraft.size+' · Guarda para confirmar.';
};
$('claimSearch').oninput=renderClaimPicker;
$('rosterFilter').oninput=renderHouses;
$('claimBtn').onclick=claimSelected;
$('housesFile').onchange=async e=>{let f=e.target.files[0];if(!f)return;try{await importHomes(parseHomes(await f.text()));}catch(err){problem(err);}e.target.value='';};
$('addHouses').onclick=async()=>{try{await importHomes(parseHomes($('housesManual').value));$('housesManual').value='';}catch(e){problem(e);}};

async function copy(t){try{await navigator.clipboard.writeText(t);notice('Copiado al portapapeles',true);}catch{notice('No se ha podido copiar automáticamente');}}
$('finishBtn').onclick=finishSession;$('confirmSaved').onchange=updateFinish;
$('copyCode').onclick=()=>copy(room.code);$('copyLink').onclick=()=>copy(share());$('exportBtn').onclick=exportCsv;$('leaveOrg').onclick=leave;$('leaveParticipant').onclick=leave;
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){lastSnapshot='';refresh();}});
(async()=>{if(!await connect())return;let c=new URLSearchParams(location.search).get('s');if(c){$('joinCode').value=c.toUpperCase();await join(c);}else{let id=localStorage.getItem('vota-last-room');if(id){let r=await db.from('sessions').select('*').eq('id',id).maybeSingle();if(!r.error&&r.data)enter(r.data);}}})();
})();