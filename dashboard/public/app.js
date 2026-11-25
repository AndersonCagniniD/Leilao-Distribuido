'use strict';
const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const brl=v=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(v)||0);
const when=t=>{if(!t)return '—';try{return new Date(t).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit',second:'2-digit'});}catch{return '—';}};
const state={cluster:null,auctions:[],events:[],view:'overview',busy:false};
const views={overview:['Visão geral','Acompanhe leilões, servidores e decisões do cluster em tempo real.'],auctions:['Leilões','Crie itens, acompanhe ofertas e encerre leilões.'],lab:['Laboratório','Simule falhas e observe a eleição automática de líder.'],events:['Eventos','Cada nó registra seus eventos de coordenação e replicação.']};
let toastTimer;
function toast(text,isError=false){const t=$('#toast');t.textContent=text;t.className='toast show'+(isError?' error':'');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('show'),4400);}
async function api(route,method='GET',data){const res=await fetch(route,{method,headers:{'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data),signal:AbortSignal.timeout(11000)});const json=await res.json().catch(()=>({}));if(!res.ok)throw Error(json.error||`Erro HTTP ${res.status}`);return json;}
function view(key){if(!views[key])return;state.view=key;document.querySelectorAll('.view').forEach(e=>e.classList.toggle('hidden',e.id!=='view-'+key));document.querySelectorAll('[data-view]').forEach(e=>e.classList.toggle('active',e.classList.contains('nav-link')&&e.dataset.view===key));$('#current-page-label').textContent=views[key][0];$('#page-title').innerHTML=esc(views[key][0])+' <span class="heading-accent">↗</span>';$('#page-subtitle').textContent=views[key][1];}
const idFor=(id)=>state.auctions.find(a=>a.id===id);
function renderMetrics(){
 const c=state.cluster;const active=c?.configuredCount??3;
 $('#metric-active').textContent=state.auctions.filter(a=>a.status==='aberto').length;
 $('#metric-bids').textContent=state.auctions.reduce((n,a)=>n+a.bids.length,0);
 $('#metric-nodes').innerHTML=esc(c?.liveCount??'—')+`<span class="metric-suffix"> / ${active}</span>`;
 $('#metric-quorum').textContent=`Quórum de escrita: ${c?.quorum??'—'} de ${active}`;
 const leader=c?.nodes.find(n=>n.id===c.leaderId);$('#metric-leader').textContent=leader?.name||'—';
 $('#metric-term').textContent=leader?`Mandato ${leader.term} · eleição Bully`:'Aguardando eleição';
 const pill=$('#cluster-indicator');pill.textContent=c?.majority?(c.liveCount===active?'Todos os membros online':'Quórum ativo'):'Sem quórum';pill.className='state-pill'+(c?.majority?'':' warning');
 const banner=$('#banner');banner.classList.toggle('hidden',!!c?.majority);banner.textContent=!c?.synchronized?'Configuração de membros ainda não sincronizada. Operações de escrita bloqueadas.':c?.liveCount===0?'Todos os nós ativos estão indisponíveis. Restaure um membro no laboratório.':'Cluster sem quórum. Operações de escrita temporariamente bloqueadas.';
}
function renderOptions(){
 const sel=$('#demo-auction');const previous=sel.value;const open=state.auctions.filter(a=>a.status==='aberto');
 sel.innerHTML='<option value="">Automático (primeiro aberto)</option>'+open.map(a=>`<option value="${esc(a.id)}">${esc(a.item)} · ${esc(a.id)}</option>`).join('');
 if(open.some(a=>a.id===previous))sel.value=previous;
 const c=state.cluster;if(!c)return;$('#membership-label').textContent=`${c.configuredCount} de ${c.capacity} membros habilitados`;
 const q=$('#lab-quorum-select'),prev=q.value; q.innerHTML=Array.from({length:c.configuredCount-c.minimumQuorum+1},(_,i)=>{const value=c.minimumQuorum+i;return `<option value="${value}">${value} de ${c.configuredCount}</option>`;}).join('');
 q.value=[...q.options].some(x=>x.value===prev)&&document.activeElement===q?prev:String(c.quorum);
 $('#quorum-help').textContent=`Mínimo seguro: ${c.minimumQuorum} de ${c.configuredCount}. Atualmente: ${c.quorum} confirmações.`;
 $('#lab-quorum-note').textContent=`Quórum necessário: ${c.quorum} de ${c.configuredCount}.`;
 $('#btn-add-node').disabled=c.configuredCount>=c.capacity;
}
function emptyAuctions(){return `<div class="empty"><div class="empty-icon">◈</div><b>Nenhum leilão por aqui</b><p>Comece criando um item ou rode uma simulação completa com alguns cliques.</p><button class="small-btn primary" data-action="create">Criar primeiro leilão ↗</button></div>`;}
function auctionCards(list){if(!list.length)return emptyAuctions();return list.map(a=>`<div class="auction-card"><div class="auction-top"><span class="auction-id">${esc(a.id)}</span><span class="pill ${a.status==='aberto'?'pill-open':'pill-closed'}">${a.status==='aberto'?'● Aberto':'Encerrado'}</span></div><div class="auction-main"><div><div class="auction-title">${esc(a.item)}</div><div class="auction-description">${esc(a.description||'Leilão distribuído · registros replicados')}</div></div><div><div class="bid-amount">${brl(a.highestBid)}</div><div class="bid-caption">${a.bids.length?'Maior lance atual':'Lance inicial'}</div></div></div><div class="auction-actions"><div class="auction-meta">${a.bids.length} lance${a.bids.length!==1?'s':''} · ${a.winner?'Líder: '+esc(a.winner):'Sem vencedor'}</div><div class="auction-actions-right"><button class="small-btn" data-action="history" data-id="${esc(a.id)}">Histórico</button>${a.status==='aberto'?`<button class="small-btn" data-action="close" data-id="${esc(a.id)}">Encerrar</button><button class="small-btn primary" data-action="bid" data-id="${esc(a.id)}">Dar lance ↗</button>`:''}</div></div></div>`).join('');}
function renderAuctions(){$('#overview-auctions').innerHTML=auctionCards(state.auctions.slice(0,3));$('#all-auctions').innerHTML=auctionCards(state.auctions);}
function renderNodes(){
 const nodes=state.cluster?.nodes||[];
 const leaderId=state.cluster?.leaderId;
 const status=n=>!n.connected?'Contêiner offline':!n.member?'Inativo':n.paused?'Falha simulada':n.reachable?'Operacional':'Sincronizando';
 const ok=n=>n.member&&n.reachable;
 $('#overview-nodes').innerHTML=nodes.filter(n=>n.member).map(n=>`<div class="node-mini"><div class="node-mini-top"><span class="server-symbol">⬡</span><span class="pill ${ok(n)?'pill-open':'pill-closed'}"><span class="status-dot ${ok(n)?'':'off'}"></span>${status(n)}</span></div><div class="node-mini-title">${esc(n.name)} <small>· #${n.id}</small>${leaderId===n.id?' · líder':''}</div><div class="node-mini-bottom"><span>TERM ${n.term??'—'}</span><span>SEQ ${n.seq??'—'}</span></div></div>`).join('');
 $('#lab-nodes').innerHTML=nodes.map(n=>`<article class="lab-node ${!n.member?'inactive-node':''}"><div class="lab-id">NODE_0${n.id} / DOCKER CONTAINER</div><h3>${esc(n.name)} ${leaderId===n.id?'<span class="pill pill-open">★ Líder</span>':''}</h3><span class="pill ${ok(n)?'pill-open':'pill-closed'}"><span class="status-dot ${ok(n)?'':'off'}"></span>${status(n)}</span><div class="lab-stats"><div><span class="lab-stat-label">Mandato</span><span class="lab-stat-value">${n.term??'—'}</span></div><div><span class="lab-stat-label">Log seq.</span><span class="lab-stat-value">${n.seq??'—'}</span></div><div><span class="lab-stat-label">Lamport</span><span class="lab-stat-value">${n.lamport??'—'}</span></div><div><span class="lab-stat-label">Papel</span><span class="lab-stat-value">${!n.member?'Reserva':leaderId===n.id?'Líder':'Seguidor'}</span></div></div><div class="node-controls"><button class="small-btn" data-action="renameNode" data-id="${n.id}">Renomear</button>${n.member?(n.paused===null?'<button class="small-btn" disabled>Contêiner inacessível</button>':`<button class="small-btn" data-action="failure" data-id="${n.id}" data-paused="${n.paused?'false':'true'}">${n.paused?'↻ Restaurar':'⏸ Simular falha'}</button>`):''}${n.member?`<button class="small-btn danger" data-action="deactivate" data-id="${n.id}" ${state.cluster.configuredCount<=2?'disabled':''}>Desativar membro</button>`:'<span class="node-reserve-text">Reserva: use “Criar nó” para ativar.</span>'}</div></article>`).join('');
}
const descriptions={NO_INICIADO:'Servidor iniciado',ELEICAO_INICIADA:'Eleição Bully iniciada',ELEITO_LIDER:'Novo líder eleito',LIDER_ATUALIZADO:'Liderança atualizada',ELEICAO_AGUARDANDO_SUPERIOR:'Aguardando nó com ID superior',OPERACAO_CONFIRMADA:'Operação replicada e confirmada',QUORUM_ATINGIDO:'Quórum de escrita atingido',FALHA_SIMULADA:'Falha simulada no servidor',NO_RECUPERADO:'Servidor restaurado',ESTADO_SINCRONIZADO:'Estado sincronizado',HTTP_ERRO:'Requisição recusada',SINCRONIZACAO_FALHOU:'Falha de sincronização',CONFIG_CLUSTER_ATUALIZADA:'Membros ou quórum atualizados',NO_PREPARADO_ENTRADA:'Novo nó recebeu o histórico'};
function eventCards(list){if(!list.length)return '<div class="empty"><div class="empty-icon">≡</div><b>Sem eventos recentes</b><p>Os registros aparecerão assim que os nós iniciarem a comunicação.</p></div>';return list.map(e=>`<div class="event"><span class="event-icon">${e.type==='ELEITO_LIDER'?'✳':e.type==='FALHA_SIMULADA'?'!':e.type==='OPERACAO_CONFIRMADA'?'✓':'↗'}</span><div class="event-body"><b>${esc(descriptions[e.type]||e.type)}</b><small>Nó ${e.node}${e.seq!==undefined?' · seq '+e.seq:''}${e.term!==undefined?' · term '+e.term:''}</small></div><span class="event-time">${when(e.time)}</span></div>`).join('');}
function renderEvents(){$('#overview-events').innerHTML=eventCards(state.events.slice(0,5));$('#all-events').innerHTML=eventCards(state.events);}
async function refresh(){try{const [c,a,e]=await Promise.all([api('/api/cluster'),api('/api/auctions'),api('/api/events')]);state.cluster=c;state.auctions=a.auctions||[];state.events=e.events||[];renderMetrics();renderAuctions();renderNodes();renderEvents();renderOptions();$('#sync-label').textContent='● Atualizado às '+new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});}catch(e){$('#sync-label').textContent='● Sem conexão com o painel';console.error('Falha na atualização',e);}}
const fields={
create:`<label class="form-row"><span>Nome do produto</span><input name="item" placeholder="Ex.: Notebook gamer" minlength="3" maxlength="90" required autocomplete="off" /></label><label class="form-row"><span>Descrição (opcional)</span><textarea name="description" rows="3" maxlength="300" placeholder="Detalhes do item..."></textarea></label><label class="form-row"><span>Lance inicial (R$)</span><input name="openingBid" type="number" min="0.01" step="0.01" value="100.00" required /></label>`,
bid:`<label class="form-row"><span>Seu nome</span><input name="bidder" placeholder="Ex.: Maria" maxlength="60" required autocomplete="off" /></label><label class="form-row"><span>Valor do lance (R$)</span><input name="amount" type="number" min="0.01" step="0.01" required /></label><label class="form-row"><span>Enviar pelo nó</span><select name="receiverNode"><option value="">Automaticamente (líder)</option></select></label><div class="form-help">Escolher outro nó demonstra o encaminhamento REST até o líder.</div>`,
nodeCreate:`<label class="form-row"><span>Nome do novo nó</span><input name="name" placeholder="Ex.: Servidor reserva" minlength="2" maxlength="40" required autocomplete="off" /></label><div class="form-help">Um contêiner reserva existente será incluído no cluster. Capacidade máxima: ${state.cluster?.capacity||5} nós.</div>`,
nodeRename:`<label class="form-row"><span>Nome exibido</span><input name="name" minlength="2" maxlength="40" required autocomplete="off" /></label><div class="form-help">O ID fixo e o endereço interno do contêiner não serão alterados.</div>`
};
let modalAction=null;
function openModal(action,id){
 modalAction={action,id};const a=idFor(id),n=state.cluster?.nodes.find(x=>x.id===Number(id));
 const title={create:'Criar novo leilão',bid:`Novo lance · ${a?.item||id}`,history:`Histórico · ${a?.item||id}`,nodeCreate:'Criar novo nó',nodeRename:`Renomear · ${n?.name||'Nó '+id}`};
 $('#modal-eyebrow').textContent=action.startsWith('node')?'ADMINISTRAÇÃO DO CLUSTER':action==='create'?'NOVO LEILÃO':action==='bid'?'REGISTRAR LANCE':'HISTÓRICO';$('#modal-title').textContent=title[action]||'Operação';
 if(action==='history'){const bids=a?.bids||[];$('#modal-fields').innerHTML=bids.length?`<div class="event-list">${bids.map(b=>`<div class="event"><div class="event-icon">↗</div><div class="event-body"><b>${esc(b.bidder)} · ${brl(b.amount)}</b><small>Seq. ${b.seq} · Term ${b.term} · Lamport ${b.lamport}</small></div><div class="event-time">${when(b.at)}</div></div>`).join('')}</div>`:'<p class="subtitle">Nenhum lance registrado para este leilão.</p>';$('#modal-submit').classList.add('hidden');}
 else{$('#modal-fields').innerHTML=fields[action];$('#modal-submit').classList.remove('hidden');if(action==='bid'&&a){$('#modal-fields [name="receiverNode"]').insertAdjacentHTML('beforeend',(state.cluster?.nodes||[]).filter(n=>n.member&&n.reachable).map(n=>`<option value="${n.id}">${esc(n.name)} (#${n.id})</option>`).join(''));const input=$('#modal-fields [name="amount"]');input.value=(Math.round((a.highestBid+10)*100)/100).toFixed(2);input.min=(Math.round(a.highestBid*100)+1)/100;}if(action==='nodeRename')$('#modal-fields [name="name"]').value=n?.name||'';if(action==='nodeCreate')$('#modal-fields [name="name"]').value='Nó '+(state.cluster?.nodes.find(n=>!n.member)?.id||4);}
 $('#modal-backdrop').classList.remove('hidden');setTimeout(()=>$('#modal-fields input')?.focus(),50);
}
function closeModal(){$('#modal-backdrop').classList.add('hidden');modalAction=null;}
async function actionWork(fn){if(state.busy)return;state.busy=true;document.querySelectorAll('button').forEach(b=>{if(b.closest('.modal-actions')&&b.id==='modal-cancel')return;if(b.id==='modal-close')return;if(b.classList.contains('btn')||b.dataset.action)b.disabled=true;});try{await fn();await refresh();}catch(e){toast(e.message,true);}finally{state.busy=false;document.querySelectorAll('button').forEach(b=>{if(b.textContent!=='Nó inacessível')b.disabled=false;});renderNodes();renderOptions();}}
async function submitModal(event){
 event.preventDefault();if(!modalAction||modalAction.action==='history')return;
 const {action,id}=modalAction;const data=Object.fromEntries(new FormData(event.currentTarget));
 await actionWork(async()=>{
  const req=crypto.randomUUID();let result;
  if(action==='create')result=await api('/api/auctions','POST',{item:data.item,description:data.description,openingBid:Number(data.openingBid),requestId:req});
  else if(action==='bid')result=await api(`/api/auctions/${encodeURIComponent(id)}/bids`,'POST',{bidder:data.bidder,amount:Number(data.amount),receiverNode:data.receiverNode?Number(data.receiverNode):undefined,requestId:req});
  else if(action==='nodeCreate')result=await api('/api/nodes','POST',{name:data.name});
  else if(action==='nodeRename')result=await api(`/api/nodes/${id}`,'PATCH',{name:data.name});
  closeModal();toast(action==='create'?`Leilão ${result.auction.id} criado!`:action==='bid'?`Lance confirmado · ${brl(result.auction.highestBid)}`:action==='nodeCreate'?'Nó adicionado ao cluster. Aguarde a nova eleição.':'Nome do nó atualizado.');
 });
}
async function handleButton(e){
 const b=e.target.closest('[data-view],[data-action]');if(!b)return;if(b.dataset.view)return view(b.dataset.view);
 const {action,id,paused}=b.dataset;if(['create','bid','history'].includes(action))return openModal(action,id);
 if(action==='renameNode')return openModal('nodeRename',id);
 if(action==='deactivate'){if(!confirm(`Desativar o Nó ${id}? Ele sairá do conjunto de membros, não apenas de uma falha simulada.`))return;return actionWork(async()=>{await api(`/api/nodes/${id}/deactivate`,'POST',{});toast(`Nó ${id} removido da configuração ativa.`);});}
 if(action==='close'){if(!confirm('Encerrar este leilão? Não será possível receber novos lances.'))return;return actionWork(async()=>{await api(`/api/auctions/${encodeURIComponent(id)}/close`,'POST',{requestId:crypto.randomUUID()});toast('Leilão encerrado.');});}
 if(action==='failure'){const stop=paused==='true';if(stop&&!confirm(`Simular falha do Nó ${id}? Ele parará de participar até ser restaurado.`))return;return actionWork(async()=>{await api(`/api/nodes/${id}/failure`,'POST',{paused:stop});toast(stop?`Falha simulada no Nó ${id}. Acompanhe a eleição.`:`Nó ${id} restaurado.`);});}
}
$('#btn-create').addEventListener('click',()=>openModal('create'));
$('#btn-demo').addEventListener('click',()=>actionWork(async()=>{const r=await api('/api/demo','POST',{auctionId:$('#demo-auction').value||undefined});toast(`Rodada concluída: ${r.results.length} lances no ${r.auctionId}`);}));
$('#btn-open-lab').addEventListener('click',()=>view('lab'));
$('#btn-add-node').addEventListener('click',()=>openModal('nodeCreate'));
$('#btn-quorum-save').addEventListener('click',()=>actionWork(async()=>{const q=Number($('#lab-quorum-select').value);await api('/api/cluster/quorum','PATCH',{quorum:q});toast(`Quórum definido para ${q} confirmações.`);}));
$('#modal-close').addEventListener('click',closeModal);
$('#modal-cancel').addEventListener('click',closeModal);
$('#modal-backdrop').addEventListener('click',e=>{if(e.target.id==='modal-backdrop')closeModal();});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal();});
document.addEventListener('click',handleButton);
$('#modal-form').addEventListener('submit',submitModal);
view('overview');refresh();setInterval(()=>{if(!state.busy)refresh();},2200);
