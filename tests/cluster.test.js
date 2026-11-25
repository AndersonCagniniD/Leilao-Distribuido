'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const net = require('node:net');
const root = path.resolve(__dirname, '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const temp = mkdtempSync(path.join(tmpdir(), 'atrio-test-'));
const jobs = new Map(); let nodePorts = [], gatewayPort, debug = [];
async function free() { return new Promise((resolve, reject) => { const server = net.createServer(); server.once('error', reject); server.listen(0, '127.0.0.1', () => { const p = server.address().port; server.close(() => resolve(p)); }); }); }
function start(id) { const cluster = nodePorts.map((port, i) => `${i + 1}=http://127.0.0.1:${port}`).join(','); const dashboard = id === 0; const file = path.join(root, dashboard ? 'dashboard/server.js' : 'src/server.js'); const child = spawn(process.execPath, [file], { env: { ...process.env, PORT: String(dashboard ? gatewayPort : nodePorts[id - 1]), NODE_ID: String(id), DATA_DIR: path.join(temp, 'node' + id), CLUSTER_NODES: cluster, CONTROL_TOKEN: 'testing-local' }, stdio: ['ignore', 'pipe', 'pipe'] }); child.stdout.on('data', b => debug.push(String(b))); child.stderr.on('data', b => debug.push(String(b))); jobs.set(id, child); }
async function stop(id) { const c = jobs.get(id); if (!c) return; const ended = new Promise(r => c.once('exit', r)); c.kill('SIGTERM'); await Promise.race([ended, sleep(1500)]); if (c.exitCode === null) c.kill('SIGKILL'); jobs.delete(id); }
async function api(route, method = 'GET', payload) { const r = await fetch(`http://127.0.0.1:${gatewayPort}${route}`, { method, headers: { 'Content-Type': 'application/json' }, body: payload === undefined ? undefined : JSON.stringify(payload), signal: AbortSignal.timeout(7500) }); return { status: r.status, data: await r.json() }; }
async function until(fn, message, ms = 14000) { const end = Date.now() + ms; let last; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await sleep(180); } throw Error(`${message}. Último erro: ${last?.message || 'nenhum'}\n${debug.slice(-8).join('')}`); }
function nodeState() { return api('/api/cluster').then(x => x.data); }
function auctionList() { return api('/api/auctions').then(x => x.data.auctions); }
function ctl(id, paused) { return api(`/api/nodes/${id}/failure`, 'POST', { paused }); }
test('painel + cinco contêineres (três ativos) + membros dinâmicos + Bully + leilões', { timeout: 135000 }, async () => {
  try {
    const used = new Set(); for (let i = 0; i < 6; i++) { let port; do { port = await free(); } while (used.has(port)); used.add(port); if (i < 5) nodePorts.push(port); else gatewayPort = port; }
    [1, 2, 3, 4, 5, 0].forEach(start);
    await until(async () => { const c = await nodeState(); return c.liveCount === 3 && c.leaderId === 3 && c.capacity === 5 && c.configuredCount === 3; }, 'Eleição inicial', 16000);
    const created = await api('/api/auctions', 'POST', { item: 'Notebook gamer', openingBid: 100, description: 'Teste', requestId: 'create-test' });
    assert.equal(created.status, 201, JSON.stringify(created.data)); const id = created.data.auction.id;
    assert.equal(created.data.auction.highestBid, 100);
    const first = await api(`/api/auctions/${id}/bids`, 'POST', { bidder: 'Ana', amount: 150, receiverNode: 1, requestId: 'ana-1' });
    assert.equal(first.status, 200, JSON.stringify(first.data));
    const second = await api(`/api/auctions/${id}/bids`, 'POST', { bidder: 'Bruno', amount: 200, receiverNode: 2, requestId: 'bruno-1' });
    assert.equal(second.status, 200, JSON.stringify(second.data));
    await until(async () => { const all = await Promise.all(nodePorts.slice(0, 3).map(async port => { const r = await fetch(`http://127.0.0.1:${port}/auctions`); return (await r.json()).auctions[0]; })); return all.every(a => a?.bids.length === 2 && a.highestBid === 200); }, 'Replicação nos 3 nós');
    const renamed = await api('/api/nodes/1', 'PATCH', { name: 'Entrada principal' }); assert.equal(renamed.status, 200, JSON.stringify(renamed.data)); assert.equal((await nodeState()).nodes[0].name, 'Entrada principal');
    const quorumRaised = await api('/api/cluster/quorum', 'PATCH', { quorum: 3 }); assert.equal(quorumRaised.status, 200, JSON.stringify(quorumRaised.data));
    assert.equal((await nodeState()).quorum, 3);
    const illegalQuorum = await api('/api/cluster/quorum', 'PATCH', { quorum: 1 }); assert.equal(illegalQuorum.status, 400);
    const quorumNormal = await api('/api/cluster/quorum', 'PATCH', { quorum: 2 }); assert.equal(quorumNormal.status, 200);
    const duplicate = await api(`/api/auctions/${id}/bids`, 'POST', { bidder: 'Ana', amount: 150, requestId: 'ana-1' });
    assert.equal(duplicate.status, 200); assert.equal(duplicate.data.duplicate, true);
    const failed = await ctl(3, true); assert.equal(failed.status, 200);
    await until(async () => { const c = await nodeState(); return c.leaderId === 2 && c.liveCount === 2; }, 'Failover para Nó 2');
    const after = await api(`/api/auctions/${id}/bids`, 'POST', { bidder: 'Carla', amount: 250, receiverNode: 1, requestId: 'carla-1' });
    assert.equal(after.status, 200, JSON.stringify(after.data));
    assert.equal(after.data.auction.bids.length, 3);
    const restored = await ctl(3, false); assert.equal(restored.status, 200);
    await until(async () => { const c = await nodeState(); return c.leaderId === 3 && c.liveCount === 3; }, 'Recuperação Nó 3', 18000);
    await until(async () => { const r = await fetch(`http://127.0.0.1:${nodePorts[2]}/auctions`); const a = (await r.json()).auctions[0]; return a?.bids.length === 3 && a.highestBid === 250; }, 'Estado do nó restaurado');
    const extra = await api('/api/auctions', 'POST', { item: 'PlayStation 5', openingBid: 500, requestId: 'create-ps5' }); assert.equal(extra.status, 201, JSON.stringify(extra.data));
    const simulated = await api('/api/demo', 'POST', { auctionId: extra.data.auction.id }); assert.equal(simulated.status, 200, JSON.stringify(simulated.data)); assert.equal(simulated.data.auctionId, extra.data.auction.id); assert.equal(simulated.data.results.length, 3);
    const selected = (await auctionList()).find(a => a.id === extra.data.auction.id); assert.equal(selected.bids.length, 3);
    const added4 = await api('/api/nodes', 'POST', { name: 'Servidor de apoio' }); assert.equal(added4.status, 201, JSON.stringify(added4.data));
    await until(async () => { const c = await nodeState(); return c.configuredCount === 4 && c.quorum === 3 && c.leaderId === 4 && c.liveCount === 4; }, 'Entrada do Nó 4 e novo líder', 18000);
    const afterAdded4 = await api(`/api/auctions/${id}/bids`, 'POST', { bidder: 'Elisa', amount: 300, requestId: 'elisa-1' }); assert.equal(afterAdded4.status, 200, JSON.stringify(afterAdded4.data));
    const added5 = await api('/api/nodes', 'POST', { name: 'Servidor extra' }); assert.equal(added5.status, 201, JSON.stringify(added5.data));
    await until(async () => { const c = await nodeState(); return c.configuredCount === 5 && c.quorum === 3 && c.leaderId === 5 && c.liveCount === 5; }, 'Entrada do Nó 5 e novo líder', 18000);
    const quorumFive = await api('/api/cluster/quorum', 'PATCH', { quorum: 5 }); assert.equal(quorumFive.status, 200);
    await ctl(1, true);
    const shouldBlock = await api(`/api/auctions/${id}/bids`, 'POST', { bidder: 'Fora do quorum', amount: 320, requestId: 'blocked-5' }); assert.equal(shouldBlock.status, 503);
    await ctl(1, false);
    await until(async () => { const c = await nodeState(); return c.liveCount === 5; }, 'Recuperação Nó 1 no quórum 5');
    const quorumThree = await api('/api/cluster/quorum', 'PATCH', { quorum: 3 }); assert.equal(quorumThree.status, 200);
    const maxMembers = await api('/api/nodes', 'POST', { name: 'Sexto nó' }); assert.equal(maxMembers.status, 409);
    const removed5 = await api('/api/nodes/5/deactivate', 'POST', {}); assert.equal(removed5.status, 200, JSON.stringify(removed5.data));
    await until(async () => { const c = await nodeState(); return c.configuredCount === 4 && c.leaderId === 4 && c.liveCount === 4; }, 'Remoção de membro 5 e eleição 4', 16000);
    const removed4 = await api('/api/nodes/4/deactivate', 'POST', {}); assert.equal(removed4.status, 200, JSON.stringify(removed4.data));
    await until(async () => { const c = await nodeState(); return c.configuredCount === 3 && c.leaderId === 3 && c.liveCount === 3; }, 'Remoção de membro 4 e eleição 3', 16000);
    const quorumNormalAgain = await api('/api/cluster/quorum', 'PATCH', { quorum: 2 }); assert.equal(quorumNormalAgain.status, 200);
    const closed = await api(`/api/auctions/${id}/close`, 'POST', { requestId: 'close-1' });
    assert.equal(closed.status, 200, JSON.stringify(closed.data)); assert.equal(closed.data.auction.status, 'encerrado');
    const rejected = await api(`/api/auctions/${id}/bids`, 'POST', { bidder: 'Diego', amount: 300, requestId: 'after-close' });
    assert.equal(rejected.status, 409);
    await ctl(2, true); await ctl(3, true);
    const noQuorum = await api('/api/auctions', 'POST', { item: 'Outro produto', openingBid: 50 });
    assert.equal(noQuorum.status, 503);
    const timeline = await api('/api/events'); assert.equal(timeline.status, 200); assert.ok(timeline.data.events.length > 0);
    const html = await fetch(`http://127.0.0.1:${gatewayPort}/`); assert.equal(html.status, 200); assert.match(await html.text(), /Visão geral/);
    console.log('PASSOU: eleição, criação, lances, replicação, falha, recuperação, administração de 5 nós, renomear, desativar, quórum, seleção de leilão simulado e dashboard');
  } finally { await Promise.all([...jobs.keys()].map(stop)); rmSync(temp, { recursive: true, force: true }); }
});
