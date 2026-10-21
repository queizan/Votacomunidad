(()=>{
'use strict';
const $=id=>document.getElementById(id), cfg=window.VOTA_CONFIG||{};
let db=null,uid='',room=null,mode='',questions=[],counts=[],houses=[],members=[],myHouses=[],availableHomes=[],claimLocked=false,claimEditing=false,claimDraft=new Set(),active=null,poll=null,chosen=null,working=false,importBusy=false,lastSnapshot='',lastError='';
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
function enter(r){availableHomes=[];claimLocked=false;claimEditing=false;claimDraft=new Set();lastSnapshot='';lastError='';exportStarted=false;exportRevision=null;$('confirmSaved').checked=false;updateFinish();room=r;mode=r.owner_id===uid?'organizer':'participant';localStorage.removeItem('vota-last-room');const url=new URL(location.href);url.search='';url.searchParams.set('s',r.code);history.replaceState(null,'',url.pathname+url.search);if(mode==='organizer'){$('organizerTitle').textContent=r.title;$('roomCode').textContent=r.code;$('shareLink').textContent=share();}else{$('participantTitle').textContent=r.title;$('participantCode').textContent=r.code;}show(mode);clearInterval(poll);refresh();poll=setInterval(refresh,3000);}
function leave(){clearInterval(poll);room=null;localStorage.removeItem('vota-last-room');history.replaceState(null,'',location.pathname);$('joinCode').value='';show('landing');}
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
// Solo el organizador puede solicitar el detalle vivienda-voto desde Supabase.
let exportRevision=null;
let excelLibraryLoading=null;
async function ensureExcelJS(){
 if(window.ExcelJS)return window.ExcelJS;
 if(!excelLibraryLoading){
  excelLibraryLoading=new Promise((resolve,reject)=>{
   const script=document.createElement('script');
   script.src='https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
   script.async=true;
   script.onload=()=>window.ExcelJS?resolve(window.ExcelJS):reject(Error('La biblioteca Excel no está disponible.'));
   script.onerror=()=>reject(Error('No se ha podido descargar el generador Excel. Comprueba la conexión.'));
   document.head.appendChild(script);
  }).catch(e=>{excelLibraryLoading=null;throw e;});
 }
 return excelLibraryLoading;
}
async function getExportSnapshot(){
 if(!room||mode!=='organizer')throw Error('Solo el organizador puede exportar los votos por vivienda.');
 const {data,error}=await db.rpc('export_session_details',{p_session:room.id});
 if(error){
  if(/schema cache|could not find the function|PGRST202/i.test(error.message||''))
   throw Error('Supabase no encuentra la función de exportación. Ejecuta 07_exportacion_excel_detallada.sql en SQL Editor; si ya lo ejecutaste, fuerza NOTIFY pgrst, \'reload schema\'; y vuelve a probar.');
  throw error;
 }
 if(!data||!Array.isArray(data.questions)||!Array.isArray(data.dwellings)||!Array.isArray(data.votes)||!data.revision)
  throw Error('El servidor no ha devuelto una exportación válida.');
 return data;
}
const voteStateLabel={draft:'Pendiente',open:'Abierta',closed:'Cerrada'};
function buildExcelRows(data){
 const questions=data.questions,homes=data.dwellings,votes=data.votes;
 const homeById=new Map(homes.map(h=>[h.id,h.label]));
 if(votes.some(v=>!homeById.has(v.dwelling_id)))
  throw Error('Existen votos sin vivienda en el censo. No se exportará un informe incompleto.');
 const options=[...new Set(questions.flatMap(q=>q.options||[]))];
 const summary=[['Sesión','Pregunta','Estado',...options,'Total votos','Sin votar']];
 const sheets=[];
 for(let index=0;index<questions.length;index++){
  const q=questions[index],qVotes=votes.filter(v=>v.question_id===q.id);
  const byOption=new Map((q.options||[]).map(o=>[o,[]]));
  const voted=new Set();
  for(const v of qVotes){
   if(!byOption.has(v.choice))throw Error('Hay un voto con una respuesta no incluida en la pregunta '+(index+1));
   if(voted.has(v.dwelling_id))throw Error('Hay votos duplicados en la pregunta '+(index+1));
   voted.add(v.dwelling_id);
   byOption.get(v.choice).push(String(homeById.get(v.dwelling_id)));
  }
  for(const arr of byOption.values())arr.sort((x,y)=>x.localeCompare(y,'es',{numeric:true}));
  const didNotVote=homes.filter(h=>!voted.has(h.id)).map(h=>String(h.label)).sort((x,y)=>x.localeCompare(y,'es',{numeric:true}));
  summary.push([data.session,q.title,voteStateLabel[q.status]||q.status,
   ...options.map(o=>(byOption.get(o)||[]).length),voted.size,didNotVote.length]);
  sheets.push({index:index+1,title:q.title,status:voteStateLabel[q.status]||q.status,
    choices:[...byOption.keys(),'Sin votar'],
    columns:[...byOption.values(),didNotVote]});
 }
 return {summary,sheets};
}
function beautifySheet(sheet,widths){
 sheet.views=[{state:'frozen',ySplit:1}];
 sheet.columns=widths.map(w=>({width:w}));
 sheet.autoFilter={from:{row:1,column:1},to:{row:1,column:widths.length}};
 const head=sheet.getRow(1);
 head.height=27;
 head.font={bold:true,color:{argb:'FFFFFFFF'}};
 head.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF234B86'}};
 head.alignment={vertical:'middle',wrapText:true};
 for(let i=2;i<=sheet.rowCount;i++){
  const row=sheet.getRow(i);
  row.alignment={vertical:'middle',wrapText:true};
  if(i%2===0)row.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF1F5FC'}};
 }
}
async function exportXlsx(){
 if(working||!room||mode!=='organizer')return;
 working=true;exportStarted=false;exportRevision=null;updateFinish();
 const button=$('exportBtn');button.disabled=true;button.textContent='Preparando Excel…';
 try{
  const snapshot=await getExportSnapshot();
  if(!snapshot.questions.length)throw Error('No hay preguntas para exportar.');
  const {summary,sheets}=buildExcelRows(snapshot);
  const ExcelJS=await ensureExcelJS();
  const book=new ExcelJS.Workbook();
  book.creator='VotaComunidad';book.subject='Resultados de votaciones por vivienda';
  book.created=new Date();
  const resume=book.addWorksheet('Resumen');
  summary.forEach(line=>resume.addRow(line));
  beautifySheet(resume,[18,65,18,...summary[0].slice(3,-2).map(()=>19),19,19]);
  for(const entry of sheets){
   const prefix='P'+String(entry.index).padStart(2,'0')+' ';
   const max=31-prefix.length;
   const name=prefix+(String(entry.title).replace(/[\[\]\:*?\/\\]/g,' ').trim().slice(0,max)||'Pregunta');
   const tab=book.addWorksheet(name);
   const num=entry.choices.length;
   tab.mergeCells(1,1,1,num);tab.getCell(1,1).value='Pregunta '+entry.index+': '+entry.title;
   tab.mergeCells(2,1,2,num);tab.getCell(2,1).value='Sesión: '+snapshot.session+'  ·  Estado: '+entry.status;
   tab.mergeCells(3,1,3,num);tab.getCell(3,1).value='Una vivienda = un voto. Abstención es diferente de Sin votar.';
   tab.getRow(1).font={size:16,bold:true,color:{argb:'FF173A6B'}};
   tab.getRow(1).height=35;tab.getRow(2).font={bold:true};
   tab.getRow(3).font={italic:true,color:{argb:'FF59677C'}};
   tab.getRow(5).values=entry.choices;
   tab.getRow(6).values=entry.columns.map(column=>'Total: '+column.length);
   const maxLen=Math.max(0,...entry.columns.map(column=>column.length));
   for(let i=0;i<maxLen;i++){
    tab.addRow(entry.columns.map(column=>column[i]||''));
   }
   tab.columns=entry.choices.map(()=>({width:27}));
   tab.views=[{state:'frozen',ySplit:6}];
   const heading=tab.getRow(5);
   heading.font={bold:true,color:{argb:'FFFFFFFF'}};
   heading.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF234B86'}};
   heading.height=26;
   tab.getRow(6).font={bold:true,color:{argb:'FF173A6B'}};
   for(let row=7;row<=tab.rowCount;row++){
    if(row%2===0)tab.getRow(row).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF1F5FC'}};
   }
   tab.autoFilter={from:{row:5,column:1},to:{row:5,column:num}};
  }
  const bytes=await book.xlsx.writeBuffer();
  if(!bytes||!bytes.byteLength)throw Error('No se ha podido generar el Excel.');
  const blob=new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  const url=URL.createObjectURL(blob);
  const anchor=document.createElement('a');anchor.href=url;anchor.download='VotaComunidad_'+snapshot.session+'_resultados.xlsx';
  document.body.appendChild(anchor);anchor.click();anchor.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
  exportStarted=true;exportRevision=snapshot.revision;
  notice('Excel generado. Ábrelo y comprueba que está guardado antes de finalizar.',true);
 }catch(e){problem(e);}
 finally{
  working=false;button.disabled=false;button.textContent='Exportar Excel completo (.xlsx)';updateFinish();
 }
}
function updateFinish(){let ready=exportStarted&&$('confirmSaved').checked&&!!room&&!working;$('finishBtn').disabled=!ready;$('finishStatus').textContent=exportStarted?'Comprueba el Excel descargado y confirma antes de eliminar.':'Primero exporta el Excel y comprueba su contenido.';}
async function finishSession(){
 if(working||!room||!exportStarted||!$('confirmSaved').checked)return;
 if(questions.some(q=>q.status==='open'))return notice('Cierra todas las votaciones antes de finalizar.');
 try{const latest=await getExportSnapshot();if(latest.revision!==exportRevision){exportStarted=false;exportRevision=null;$('confirmSaved').checked=false;updateFinish();return notice('Las respuestas o estados han cambiado desde la exportación. Descarga un Excel actualizado antes de finalizar.');}}catch(e){return problem(e);}
 if(!confirm('¿Has guardado el Excel completo (.xlsx) con sus hojas de detalle? Esta acción eliminará la sesión, los votos y el censo de Supabase. No se puede deshacer.'))return;
 const typed=prompt('Para confirmar el borrado irreversible, escribe ELIMINAR:');
 if(typed!=='ELIMINAR')return notice('Cancelado: los datos siguen intactos.');
 working=true;updateFinish();
 try{
   const result=await db.functions.invoke('finalizar-reunion',{body:{session_id:room.id,confirm_export:true}});
   if(result.error){
     let message=result.error.message||'Error de conexión con Supabase';
     if(result.error.name==='FunctionsFetchError' || /Failed to send a request to the Edge Function/i.test(message)){
       message='No se pudo contactar con la función finalizar-reunion. Comprueba que está desplegada en Supabase → Edge Functions. Conserva el Excel: no se ha podido confirmar el borrado.';
     }else if(result.error.context?.json){
       try{const payload=await result.error.context.json();if(payload?.error)message=payload.error;}catch{}
     }
     throw Error(message);
   }
   if(!result.data?.deleted)throw Error(result.data?.error||'No se confirmó la eliminación');
   const warning=result.data.warning;
   leave();questions=[];counts=[];houses=[];members=[];myHouses=[];active=null;chosen=null;exportStarted=false;exportRevision=null;
   await db.auth.signOut();db=null;uid='';
   notice(warning||'Sesión y datos operativos eliminados. Guarda el Excel exportado.',!warning);
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
 for(const id of ['housesFile','housesManual','addHouses'])$(id).disabled=locked()||importBusy;
}
function csvParts(line,sep){let a=[],v='',quoted=false;for(let i=0;i<line.length;i++){let c=line[i];if(c==='"'){if(quoted&&line[i+1]==='"'){v+='"';i++;}else quoted=!quoted;}else if(c===sep&&!quoted){a.push(v.trim());v='';}else v+=c;}a.push(v.trim());return a;}
function parseHomes(s){let lines=s.replace(/^\uFEFF/,'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean);if(!lines.length)return [];let sep=lines[0].includes(';')?';':',',h=csvParts(lines[0],sep).map(x=>x.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')),portal=h.findIndex(x=>['portal','numero','bloque'].includes(x)),planta=h.findIndex(x=>['planta','piso'].includes(x)),puerta=h.findIndex(x=>['puerta','letra'].includes(x)),vivienda=h.findIndex(x=>['vivienda','casa'].includes(x)),header=portal>=0||vivienda>=0;return [...new Set((header?lines.slice(1):lines).map(line=>{if(!header)return line;let x=csvParts(line,sep);let floor=planta>=0?(x[planta]||''):'';if(/^\d+$/.test(floor))floor+='º';return [portal>=0?x[portal]:'',vivienda>=0?x[vivienda]:'',floor,puerta>=0?x[puerta]:''].filter(Boolean).join(' ');}).map(x=>x.replace(/\s+/g,' ').trim()).filter(x=>x.length&&x.length<=100))];}
async function readHousingFile(file){
 if(/\.xlsx$/i.test(file.name)){
  const ExcelJS=await ensureExcelJS();
  const book=new ExcelJS.Workbook();
  await book.xlsx.load(await file.arrayBuffer());
  const sheet=book.worksheets[0];
  if(!sheet)throw Error('El Excel no contiene hojas de cálculo.');
  const toText=value=>{
   if(value==null)return '';
   if(typeof value==='object'){
    if(Array.isArray(value.richText))return value.richText.map(v=>v.text||'').join('');
    if(value.result!==undefined)return String(value.result??'');
    if(value.text!==undefined)return String(value.text);
    return '';
   }
   return String(value);
  };
  const all=[];
  sheet.eachRow({includeEmpty:false},row=>{
   const line=[];
   const width=Math.min(sheet.columnCount||row.cellCount,30);
   for(let i=1;i<=width;i++){
    const v=toText(row.getCell(i).value);
    line.push('"'+v.replace(/"/g,'""')+'"');
   }
   all.push(line.join(';'));
  });
  return all.join('\n');
 }
 return await file.text();
}
async function importHomes(labels){
 if(!room||mode!=='organizer')throw Error('Debes entrar como organizador para importar viviendas.');
 if(locked())throw Error('El censo está bloqueado: ya ha comenzado una votación.');
 if(!labels.length)throw Error('No se encontraron viviendas. Escribe una por línea o revisa las columnas del CSV.');
 if(labels.length>5000)throw Error('El máximo es de 5000 viviendas por importación.');
 const {error}=await db.rpc('import_dwellings',{p_session:room.id,p_labels:labels});
 if(error)throw error;
 lastSnapshot='';
 await refresh();
 notice(labels.length+' vivienda(s) procesada(s) correctamente.',true);
 return labels.length;
}
function setImportBusy(busy){
 importBusy=busy;
 for(const id of ['addHouses','housesFile','housesManual']){
  const el=$(id);
  el.disabled=busy||locked();
 }
 $('addHouses').textContent=busy?'Importando…':'Añadir viviendas';
}
async function submitHousingImport(content,fromFile=false){
 if(importBusy)return;
 if(!String(content||'').trim()){
  notice(fromFile?'El archivo está vacío. Selecciona un CSV con viviendas.':'Escribe al menos una vivienda antes de pulsar Añadir viviendas.');
  return;
 }
 let labels;
 try{labels=parseHomes(content);}catch(e){problem(e);return;}
 if(!labels.length){notice('No se han encontrado viviendas válidas. Comprueba el formato y vuelve a intentarlo.');return;}
 setImportBusy(true);
 try{
  await importHomes(labels);
  if(!fromFile)$('housesManual').value='';
 }catch(e){problem(e);}
 finally{setImportBusy(false);}
}

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
$('housesFile').onchange=async e=>{
 if(importBusy){e.target.value='';return;}
 const f=e.target.files?.[0];if(!f)return;
 // El bloqueo se activa antes de leer el archivo para evitar dos importaciones simultáneas.
 importBusy=true;
 $('housesFile').disabled=true;$('addHouses').disabled=true;$('housesManual').disabled=true;
 try{
  if(!/\.(csv|txt|xlsx)$/i.test(f.name))throw Error('Usa un archivo .xlsx o CSV con el censo de viviendas.');
  const content=await readHousingFile(f);
  const labels=parseHomes(content);
  if(!labels.length)throw Error('El archivo no contiene viviendas válidas. Usa la columna vivienda o las columnas portal, planta y puerta.');
  await importHomes(labels);
 }catch(err){problem(err);}
 finally{importBusy=false;e.target.value='';setImportBusy(false);}
};
$('addHouses').onclick=()=>submitHousingImport($('housesManual').value);

async function copy(t){try{await navigator.clipboard.writeText(t);notice('Copiado al portapapeles',true);}catch{notice('No se ha podido copiar automáticamente');}}
$('finishBtn').onclick=finishSession;$('confirmSaved').onchange=updateFinish;
$('copyCode').onclick=()=>copy(room.code);$('copyLink').onclick=()=>copy(share());$('exportBtn').onclick=exportXlsx;$('leaveOrg').onclick=leave;$('leaveParticipant').onclick=leave;
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){lastSnapshot='';refresh();}});
(async()=>{
 // Portada siempre limpia: no reabrir automáticamente la última sesión.
 localStorage.removeItem('vota-last-room');
 const c=new URLSearchParams(location.search).get('s');
 if(c){
   $('joinCode').value=c.toUpperCase();
   await join(c);
 }else{
   $('connectionStatus').textContent='Listo para crear o entrar en una sesión';
 }
})();
})();