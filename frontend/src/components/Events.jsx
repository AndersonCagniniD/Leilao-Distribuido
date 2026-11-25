import React from 'react';
import { when } from '../services/api.js';

const descriptions = {
  NO_INICIADO: 'Servidor iniciado',
  ELEICAO_INICIADA: 'Eleição Bully iniciada',
  ELEITO_LIDER: 'Novo líder eleito',
  LIDER_ATUALIZADO: 'Liderança atualizada',
  ELEICAO_AGUARDANDO_SUPERIOR: 'Aguardando nó com ID superior',
  OPERACAO_CONFIRMADA: 'Operação replicada e confirmada',
  QUORUM_ATINGIDO: 'Quórum de escrita atingido',
  FALHA_SIMULADA: 'Falha simulada no servidor',
  NO_RECUPERADO: 'Servidor restaurado',
  ESTADO_SINCRONIZADO: 'Estado sincronizado',
  HTTP_ERRO: 'Requisição recusada',
  SINCRONIZACAO_FALHOU: 'Falha de sincronização',
  CONFIG_CLUSTER_ATUALIZADA: 'Membros ou quórum atualizados',
  NO_PREPARADO_ENTRADA: 'Novo nó recebeu o histórico'
};

export default function Events({ events }) {
  if (!events.length)
    return (
      <p className="muted py-6 text-center">Sem eventos recentes.</p>
    );
  return (
    <div className="divide-y divide-stone-100">
      {events.map((e, i) => (
        <div
          key={[e.node, e.time, e.type, i].join('-')}
          className="flex items-start justify-between gap-2 py-3"
        >
          <div>
            <p className="text-sm font-semibold">{descriptions[e.type] || e.type}</p>
            <p className="muted">Nó {e.node}{e.seq !== undefined && ' · seq ' + e.seq}{e.term !== undefined && ' · term ' + e.term}</p>
          </div>
          <time className="muted shrink-0">{when(e.time)}</time>
        </div>
      ))}
    </div>
  );
}
