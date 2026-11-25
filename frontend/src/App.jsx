import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, brl } from './services/api.js';
import Auctions from './components/Auctions.jsx';
import Nodes from './components/Nodes.jsx';
import Events from './components/Events.jsx';
import OperationModal from './components/OperationModal.jsx';

const views = {
  overview: ['Visão geral', 'Acompanhe leilões, servidores e decisões do cluster em tempo real.'],
  auctions: ['Leilões', 'Crie itens, acompanhe ofertas e encerre leilões.'],
  lab: ['Laboratório', 'Simule falhas e observe a eleição automática de líder.'],
  events: ['Eventos', 'Acompanhe a coordenação e a replicação.']
};

function Panel({ title, action, children }) {
  return (
    <section className="panel">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Metric({ title, value, detail, accent }) {
  return (
    <article className={'panel ' + (accent ? 'bg-emerald-50 border-emerald-200' : '')}>
      <p className="muted text-xs font-semibold uppercase">{title}</p>
      <p className="my-2 break-words text-2xl font-bold">{value}</p>
      <p className="muted">{detail}</p>
    </article>
  );
}

export default function App() {
  const [view, setView] = useState('overview'),
    [cluster, setCluster] = useState(null),
    [auctions, setAuctions] = useState([]),
    [events, setEvents] = useState([]);
  const [sync, setSync] = useState('Sincronizando…'),
    [stale, setStale] = useState(false),
    [busy, setBusy] = useState(false),
    [modal, setModal] = useState(null),
    [toast, setToast] = useState(null);
  const [demo, setDemo] = useState(''),
    [quorum, setQuorum] = useState('');
  const running = useRef(false),
    fetching = useRef(null),
    toastTimer = useRef();
  const closeModal = useCallback(() => setModal(null), []);
  const notify = (message, error = false) => {
    clearTimeout(toastTimer.current);
    setToast({ message, error });
    toastTimer.current = setTimeout(() => setToast(null), 4400);
  };
  const refresh = useCallback(() => {
    if (fetching.current)
      return fetching.current;
    const request = (async () => {
      try {
        const [c, a, e] = await Promise.all([api('/api/cluster'), api('/api/auctions'), api('/api/events')]);
        setCluster(c);
        setAuctions(a.auctions || []);
        setEvents(e.events || []);
        setStale(!!a.stale);
        setSync('Atualizado às ' + new Date().toLocaleTimeString('pt-BR'));
      } catch {
        setSync('Sem conexão com o painel');
        setStale(true);
      }
    })();
    fetching.current = request;
    request.finally(() => {
      fetching.current = null;
    });
    return request;
  }, []);
  useEffect(() => {
    refresh();
    const id = setInterval(() => {
      if (!running.current)
        refresh();
    }, 2200);
    return () => {
      clearInterval(id);
      clearTimeout(toastTimer.current);
    };
  }, [refresh]);
  useEffect(() => {
    setQuorum(String(cluster?.quorum ?? ''));
  }, [cluster?.quorum, cluster?.epoch]);
  useEffect(() => {
    if (demo && !auctions.some(a => a.id === demo && a.status === 'aberto'))
      setDemo('');
  }, [auctions, demo]);
  async function work(fn) {
    if (running.current)
      return;
    running.current = true;
    setBusy(true);
    try {
      if (fetching.current)
        await fetching.current;
      await fn();
      await refresh();
    } catch (e) {
      notify(e.message, true);
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  const requestId = () => crypto.randomUUID();
  function action(type, id, paused) {
    if (['create', 'bid', 'history', 'nodeCreate', 'nodeRename'].includes(type)) {
      setModal({ action: type, id });
      return;
    }
    if (type === 'close' && window.confirm('Encerrar este leilão? Não será possível receber novos lances.'))
      work(async () => {
        await api('/api/auctions/' + encodeURIComponent(id) + '/close', 'POST', { requestId: requestId() });
        notify('Leilão encerrado.');
      });
    if (type === 'deactivate' && window.confirm('Desativar o Nó ' + id + ' da configuração ativa?'))
      work(async () => {
        await api('/api/nodes/' + id + '/deactivate', 'POST', {});
        notify('Nó removido da configuração ativa.');
      });
    if (type === 'failure' && (!paused || window.confirm('Simular falha do Nó ' + id + '?')))
      work(async () => {
        await api('/api/nodes/' + id + '/failure', 'POST', { paused });
        notify(paused ? 'Falha simulada. Acompanhe a eleição.' : 'Nó restaurado.');
      });
  }
  function submit(data) {
    if (!modal)
      return;
    const { action: type, id } = modal;
    work(async () => {
      let r;
      if (type === 'create') {
        r = await api('/api/auctions', 'POST', {
          item: data.item,
          description: data.description,
          openingBid: Number(data.openingBid),
          requestId: requestId()
        });
        notify('Leilão ' + r.auction.id + ' criado!');
      } else if (type === 'bid') {
        r = await api('/api/auctions/' + encodeURIComponent(id) + '/bids', 'POST', {
          bidder: data.bidder,
          amount: Number(data.amount),
          receiverNode: data.receiverNode ? Number(data.receiverNode) : undefined,
          requestId: requestId()
        });
        notify('Lance confirmado · ' + brl(r.auction.highestBid));
      } else if (type === 'nodeCreate') {
        await api('/api/nodes', 'POST', { name: data.name });
        notify('Nó adicionado. Aguarde a nova eleição.');
      } else if (type === 'nodeRename') {
        await api('/api/nodes/' + id, 'PATCH', { name: data.name });
        notify('Nome do nó atualizado.');
      }
      closeModal();
    });
  }
  const active = auctions.filter(a => a.status === 'aberto'),
    leader = cluster?.nodes.find(n => n.id === cluster.leaderId);
  const choices = cluster ? Array.from({ length: cluster.configuredCount - cluster.minimumQuorum + 1 }, (_, i) => cluster.minimumQuorum + i) : [];
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[240px_1fr]">
      <aside className="bg-stone-950 p-5 text-white lg:sticky lg:top-0 lg:h-screen lg:flex lg:flex-col">
        <div className="mb-6">
          <p className="text-3xl font-black tracking-tight">
            átrio
            <span className="text-emerald-400">.</span>
          </p>
          <p className="text-xs text-stone-400">distributed auctions</p>
        </div>
        <nav aria-label="Navegação principal" className="flex flex-wrap gap-2 lg:flex-col">
          {Object.entries(views).map(([key, [name]]) => (
            <button
              key={key}
              type="button"
              aria-current={view === key ? 'page' : undefined}
              onClick={() => setView(key)}
              className={'rounded-lg px-3 py-2 text-left text-sm font-semibold ' + (view === key ? 'bg-emerald-300 text-stone-950' : 'text-stone-300 hover:bg-stone-800')}
            >
              {name}
            </button>
          ))}
        </nav>
        <div className="mt-8 text-xs text-stone-400 lg:mt-auto">
          <p className="font-semibold text-emerald-300">● Modo demonstração</p>
          <p className="mt-2">Ambiente local · Docker</p>
          <p>Sistemas Distribuídos · 2026</p>
        </div>
      </aside>
      <div className="min-w-0">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-200 bg-white px-5 py-4 sm:px-8">
          <p className="muted">Workspace / <b className="text-stone-900">{views[view][0]}</b></p>
          <p className="muted">● {sync}</p>
        </header>
        <main className="mx-auto max-w-screen-2xl space-y-5 p-4 sm:p-8">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="muted text-xs font-bold uppercase tracking-wider">Sistema de leilão distribuído</p>
              <h1 className="my-2 text-3xl font-black tracking-tight">{views[view][0]} ↗</h1>
              <p className="muted">{views[view][1]}</p>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <label className="field">
                Simular no leilão
                <select value={demo} onChange={e => setDemo(e.target.value)}>
                  <option value="">Automático (primeiro aberto)</option>
                  {active.map(a => (
                    <option value={a.id} key={a.id}>{a.item} · {a.id}</option>
                  ))}
                </select>
              </label>
              <button
                className="btn"
                disabled={busy}
                onClick={() => work(async () => {
                  const r = await api('/api/demo', 'POST', { auctionId: demo || undefined });
                  notify('Rodada concluída: ' + r.results.length + ' lances no ' + r.auctionId);
                })}
              >
                ▶ Simular rodada
              </button>
              <button
                className="btn primary"
                disabled={busy}
                onClick={() => action('create')}
              >
                ＋ Novo leilão
              </button>
            </div>
          </div>
          {cluster && !cluster.majority && (
            <div
              role="status"
              className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
            >{!cluster.synchronized ? 'Configuração ainda não sincronizada.' : cluster.liveCount === 0 ? 'Todos os membros indisponíveis.' : 'Cluster sem quórum.'} Operações de escrita bloqueadas.</div>
          )}
          {stale && (
            <p className="muted">A lista de leilões pode estar desatualizada.</p>
          )}
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Indicadores">
            <Metric
              title="Leilões ativos"
              value={active.length}
              detail="Itens recebendo lances"
            />
            <Metric
              title="Lances registrados"
              value={auctions.reduce((n, a) => n + a.bids.length, 0)}
              detail="Eventos confirmados"
            />
            <Metric
              title="Nós operacionais"
              value={(cluster?.liveCount ?? '—') + ' / ' + (cluster?.configuredCount ?? '—')}
              detail={'Quórum: ' + (cluster?.quorum ?? '—') + ' de ' + (cluster?.configuredCount ?? '—')}
            />
            <Metric
              title="Líder atual"
              value={leader?.name || '—'}
              detail={leader ? 'Mandato ' + leader.term + ' · eleição Bully' : 'Aguardando eleição'}
              accent
            />
          </section>
          {view === 'overview' && (
            <div className="grid gap-5 xl:grid-cols-[3fr_2fr]">
              <div className="space-y-5">
                <Panel
                  title="Leilões em andamento"
                  action={
                    <button className="btn" onClick={() => setView('auctions')}>
                      Ver todos ↗
                    </button>
                  }
                >
                  <Auctions
                    auctions={auctions.slice(0, 3)}
                    busy={busy}
                    onAction={action}
                  />
                </Panel>
                <Panel
                  title="Saúde do cluster"
                  action={
                    <span className="tag">
                      {cluster?.majority ? 'Quórum ativo' : cluster ? 'Sem quórum' : 'Verificando'}
                    </span>
                  }
                >
                  <Nodes cluster={cluster} compact />
                  <button className="btn mt-4" onClick={() => setView('lab')}>
                    Abrir laboratório ↗
                  </button>
                </Panel>
              </div>
              <div className="space-y-5">
                <div className="rounded-2xl bg-emerald-900 p-6 text-white">
                  <p className="text-xs font-semibold uppercase text-emerald-200">Teste guiado</p>
                  <h2 className="my-3 text-2xl font-bold">Veja o distribuído em ação.</h2>
                  <p className="mb-4 text-emerald-100">Crie lances, interrompa o líder e observe o cluster se reorganizar.</p>
                  <button className="btn text-stone-900" onClick={() => setView('lab')}>
                    Abrir laboratório ↗
                  </button>
                </div>
                <Panel
                  title="Log de eventos"
                  action={
                    <button className="btn" onClick={() => setView('events')}>
                      Ver histórico ↗
                    </button>
                  }
                >
                  <Events events={events.slice(0, 5)} />
                </Panel>
              </div>
            </div>
          )}
          {view === 'auctions' && (
            <Panel title="Todos os leilões">
              <Auctions
                auctions={auctions}
                busy={busy}
                onAction={action}
              />
            </Panel>
          )}
          {view === 'lab' && (
            <>
              <div className="grid gap-4 md:grid-cols-2">
                <Panel title="Criar e administrar nós">
                  <p className="muted mb-4">Ative um contêiner reserva, renomeie ou retire um membro. {cluster?.configuredCount ?? '—'} de {cluster?.capacity ?? '—'} membros habilitados.</p>
                  <button
                    className="btn primary"
                    disabled={busy || !cluster || cluster.configuredCount >= cluster.capacity}
                    onClick={() => action('nodeCreate')}
                  >
                    ＋ Criar nó
                  </button>
                </Panel>
                <Panel title="Quórum de escrita">
                  <p className="muted mb-3">Mínimo seguro: {cluster?.minimumQuorum ?? '—'} de {cluster?.configuredCount ?? '—'}. Atual: {cluster?.quorum ?? '—'}.</p>
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="field">
                      Mínimo de confirmações
                      <select
                        value={quorum}
                        onChange={e => setQuorum(e.target.value)}
                        disabled={!cluster}
                      >
                        {choices.map(q => (
                          <option key={q} value={q}>{q} de {cluster.configuredCount}</option>
                        ))}
                      </select>
                    </label>
                    <button
                      className="btn"
                      disabled={busy || !choices.includes(Number(quorum))}
                      onClick={() => work(async () => {
                        await api('/api/cluster/quorum', 'PATCH', { quorum: Number(quorum) });
                        notify('Quórum definido para ' + quorum + ' confirmações.');
                      })}
                    >
                      Aplicar quórum
                    </button>
                  </div>
                </Panel>
              </div>
              <Nodes
                cluster={cluster}
                busy={busy}
                onAction={action}
              />
              <div className="grid gap-4 md:grid-cols-2">
                <Panel title="Experimento A · Troca de liderança">
                  <p className="muted">Com três membros ativos, pause o líder (normalmente Nó 3), observe o Nó 2 assumir e restaure o Nó 3.</p>
                </Panel>
                <Panel title="Experimento B · Quórum e consistência">
                  <p className="muted">Pause membros até perder o quórum e tente enviar um lance. A escrita deve ser bloqueada. A simulação não desliga os contêineres reais.</p>
                </Panel>
              </div>
            </>
          )}
          {view === 'events' && (
            <Panel title="Eventos do cluster">
              <Events events={events} />
            </Panel>
          )}
          <footer className="flex flex-wrap justify-between gap-2 border-t border-stone-200 pt-4 text-xs text-stone-500">
            <span>ÁTRIO / LEILÃO DISTRIBUÍDO</span>
            <span>React · Node.js · REST · Bully · Lamport · Replicação</span>
          </footer>
        </main>
      </div>
      {modal && (
        <OperationModal
          key={modal.action + ':' + modal.id}
          modal={modal}
          auction={auctions.find(a => a.id === modal.id)}
          node={cluster?.nodes.find(n => n.id === Number(modal.id))}
          cluster={cluster}
          busy={busy}
          onClose={closeModal}
          onSubmit={submit}
        />
      )}
      {toast && (
        <div
          role={toast.error ? 'alert' : 'status'}
          className={'fixed bottom-5 right-5 z-[60] max-w-[calc(100%-2.5rem)] rounded-xl px-5 py-3 text-sm font-semibold text-white shadow-lg ' + (toast.error ? 'bg-red-800' : 'bg-stone-900')}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
