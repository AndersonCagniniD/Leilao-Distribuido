# Átrio — Leilão Online Distribuído · Laboratório v2

Aplicação acadêmica com interface minimalista, API REST em Node.js, eleição Bully, relógio de Lamport, replicação de histórico por confirmação de quórum e um **laboratório para gerenciar os nós** sem usar o terminal.

## Rodar com Docker Desktop (Windows)

1. Abra o **Docker Desktop** e confirme que o engine Linux está ativo.
2. Na pasta deste projeto, execute:

   ```powershell
   docker compose up --build -d
   ```

3. Abra **http://localhost:8080**.

O Compose inicia **seis contêineres**: `node1` a `node5` e `dashboard`. **Somente 1, 2 e 3 são membros ativos no início**. Os contêineres 4 e 5 são reservas preparadas para ingressar no cluster por meio da interface. O líder inicial esperado é o Nó 3. O projeto não altera nem apaga automaticamente volumes da versão anterior.

## O que você consegue fazer pelo painel

### Leilões
- **Novo leilão**: define nome, descrição e valor inicial.
- **Dar lance**: escolhe usuário, valor e nó receptor; os seguidores encaminham ao líder.
- **Histórico**: exibe a sequência, o mandato (*term*) e o relógio de Lamport de cada lance.
- **Encerrar**: bloqueia novos lances naquele leilão.
- **Simular rodada**: no topo da interface, **escolha um leilão aberto** no campo "Simular no leilão" e clique em "Simular rodada". A simulação registra três lances crescentes naquele leilão. Sem uma escolha explícita, usa o primeiro leilão aberto ou cria um de demonstração se ainda não existir nenhum.

### Laboratório — nós e quórum
- **Criar nó**: ativa a próxima vaga disponível no pool (Nó 4 e, depois, Nó 5). O novo participante sincroniza o histórico antes de ingressar; a eleição Bully pode escolher o novo nó por seu ID maior.
- **Renomear**: altera o nome exibido no painel e no estado administrativo. Não muda o ID nem o nome DNS do contêiner Docker.
- **Desativar membro**: retira o nó da configuração ativa do cluster. O contêiner continua ligado como reserva, e não participa de eleição, replicação ou lances. Mantemos ao menos **dois membros ativos**.
- **Simular falha / Restaurar**: deixa o membro na configuração, mas interrompe a participação dele no protocolo enquanto estiver pausado. Isso permite demonstrar perda de quórum e recuperação.
- **Quórum de escrita**: altera o número de confirmações necessárias para uma operação, **nunca abaixo da maioria dos membros configurados**. Por exemplo, três membros permitem quórum 2 ou 3; cinco membros permitem 3, 4 ou 5. O valor é validado pelo dashboard e pelos nós.

Após uma mudança de membros, a eleição é reiniciada e pode levar alguns segundos. Observe o líder e o status do painel antes de enviar o lance seguinte.

## Exemplos de experimentos

1. Com três membros e quórum 2, pause o líder (Nó 3), aguarde o Nó 2 assumir e registre novo lance. Restaure o Nó 3.
2. Crie o Nó 4 e confirme que ele recebeu o histórico e pode assumir a liderança, por ter o maior ID. Crie depois o Nó 5.
3. Com cinco membros, aumente o quórum para 5 e pause um membro. Novos lances deverão ser bloqueados, pois são necessárias cinco confirmações.
4. Desative o Nó 5: ele sai da configuração de participantes (diferente de ficar pausado) e o quórum se ajusta ao mínimo seguro se necessário.
5. Crie dois leilões, selecione o segundo em "Simular no leilão" e execute a rodada. Confira que os três lances foram aplicados **ao leilão selecionado**.

## Endpoints do dashboard (porta 8080)

| Método | Rota | Função |
|---|---|---|
| GET | `/api/cluster` | Estado de todos os cinco slots, líder, membros, quórum e capacidade |
| PATCH | `/api/cluster/quorum` | `{ "quorum": 3 }` |
| POST | `/api/nodes` | `{ "name": "Servidor novo" }` — ativa um contêiner reserva |
| PATCH | `/api/nodes/:id` | `{ "name": "Nome exibido" }` |
| POST | `/api/nodes/:id/deactivate` | Remove um membro da configuração ativa |
| POST | `/api/nodes/:id/failure` | `{ "paused": true }` / `{ "paused": false }` — falha simulada |
| GET | `/api/auctions` | Leilões e ofertas |
| POST | `/api/auctions` | Criar leilão |
| POST | `/api/auctions/:id/bids` | Dar lance |
| POST | `/api/auctions/:id/close` | Encerrar |
| POST | `/api/demo` | `{ "auctionId": "LEILAO-..." }` — simula nesse leilão |
| GET | `/api/events` | Eventos dos nós |

As rotas `/_admin/*` são internas, protegidas por token para ambiente local, e não devem ficar expostas publicamente.

## Estrutura e execução

```text
Leilao-distribuido-v2/
├── docker-compose.yml          # cinco nós preparados + dashboard
├── src/server.js               # backend de cada nó: Bully, Lamport, log e REST
├── dashboard/server.js         # gateway e gerenciador do laboratório
├── dashboard/public/
│   ├── index.html
│   ├── app.js
│   └── style.css
├── tests/cluster.test.js       # integração sem Docker (seis processos)
└── package.json
```

Para executar o teste automatizado com Node.js >= 20 instalado:

```bash
npm test
```

Para reiniciar os contêineres mantendo os volumes: `docker compose restart`.

**Atenção:** `docker compose down -v` apaga todos os dados persistidos, incluindo leilões, lances e configuração do cluster. Só utilize se quiser reiniciar tudo do zero.

## Limitações e boas práticas

Esta é uma **simulação acadêmica**, não uma implementação de Raft/Paxos nem um sistema de leilão monetário para produção.

- Os **cinco contêineres já existem no Compose**. "Criar nó" significa ingressar no cluster usando um desses slots, não criar arbitrariamente um novo processo ou contêiner. A capacidade padrão é cinco; expandi-la exige editar o Compose e os endereços dos membros.
- A reconfiguração é **coordenada pelo dashboard**, requer quórum da configuração atual e os cinco contêineres acessíveis pelas rotas administrativas. Não é uma alteração de membros por consenso distribuído: não há garantias formais de segurança em partições, falhas simultâneas ou clientes que escrevam fora do gateway durante a reconfiguração.
- A operação de **renomear** altera somente o rótulo, não o ID fixo necessário ao Bully.
- Simular uma falha pausa o protocolo do nó, sem desligar seu contêiner. Para uma queda real no Docker, ainda existem os comandos `docker compose stop node3` e `docker compose start node3`.
- O quórum nunca fica abaixo da maioria. Aumentá-lo pode reduzir a disponibilidade: com 5 membros e quórum 5, a queda de um membro já impede novas confirmações.
- Lances idempotentes utilizam `requestId`; após timeout, consulte o histórico antes de enviar um novo pedido.
- Sem autenticação real de clientes, pagamentos ou garantias formais de consenso. **Use somente localmente para demonstração de Sistemas Distribuídos.**
