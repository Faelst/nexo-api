# Nexo Assist — API

Backend do Nexo Assist, o agent do service desk de TI da Nexo.
NestJS + Prisma/PostgreSQL + Socket.IO + Mastra (OpenAI `gpt-4.1-mini`; troca de provedor por variável). O frontend está em [`../nexo-web`](../nexo-web).

## Como rodar localmente

São dois projetos lado a lado: esta API (`nexo-api`) e o frontend (`nexo-web`). Suba nesta ordem:
**banco → API → frontend**.

### 1. Pré-requisitos

| Ferramenta | Versão | Verificar |
|---|---|---|
| Node.js | **22.13 ou superior** na API (o Mastra exige); o frontend também roda nele | `node -v` |
| npm | 10+ | `npm -v` |
| Docker + Docker Compose | Compose v2 | `docker compose version` |
| Chave de LLM | OpenAI (padrão) ou outro provedor suportado pelo Mastra | — |

Com [nvm](https://github.com/nvm-sh/nvm): `nvm install 22` (o projeto tem `.nvmrc`, então `nvm use` basta depois).

Portas usadas: **5440** (Postgres no Docker), **3333** (API), **3000** (frontend).

### 2. Banco de dados e API

```bash
cd nexo-api
nvm use                          # Node 22
npm install
cp .env.example .env
```

Edite o `.env`:

| Variável | O que colocar |
|---|---|
| `OPENAI_API_KEY` | sua chave da OpenAI (obrigatória para o agent responder) |
| `JWT_SECRET` | um segredo aleatório — gere com `openssl rand -hex 32` |
| `LLM_MODEL` | deixe `openai/gpt-4.1-mini` (ou `anthropic/claude-haiku-5-5` + `ANTHROPIC_API_KEY`) |
| `DATABASE_URL`, `PORT`, `FRONTEND_URL` | os padrões já funcionam |

Depois:

```bash
npm run setup                    # sobe o Postgres (espera ficar saudável), aplica as migrations e roda o seed
npm run start:dev                # API em http://localhost:3333 (recarrega ao salvar)
```

O seed imprime a tabela de usuários para login. A API está no ar quando o log mostrar
`API em http://localhost:3333 · CORS http://localhost:3000`.

### 3. Frontend

Em outro terminal:

```bash
cd nexo-web
npm install
cp .env.example .env.local       # NEXT_PUBLIC_API_URL=http://localhost:3333
npm run dev                      # http://localhost:3000
```

### 4. Testar

1. Abra **http://localhost:3000/login**.
2. Entre como `ana.souza@nexo.com.br` com qualquer senha (ex.: `123`) e pergunte "Qual o status do meu chamado?".
3. Em outra janela (anônima), entre como `rafael.lima@nexo.com.br` para ver o console do analista em tempo real.

### Comandos úteis

| Comando (em `nexo-api`) | O que faz |
|---|---|
| `npm run start:dev` | API com recarga automática |
| `npm run db:up` / `npm run db:down` | sobe / para o Postgres (os dados ficam no volume `nexo-pgdata`) |
| `npm run db:seed` | apaga e recria os dados de exemplo |
| `npm run db:reset` | recria o banco do zero (migrations + seed) |
| `npm test` | testes (Jest + integração do agent) |
| `npm run lint` | lint |
| `npm run build && npm run start:prod` | build e execução de produção |

No frontend: `npm run dev`, `npm run build && npm start` (produção) e `npm run lint`.

Para desligar tudo: pare os dois `npm run ...` com Ctrl+C e rode `npm run db:down` na API.
Para apagar também os dados do banco: `docker compose down -v`.

### Problemas comuns

| Sintoma | Causa e solução |
|---|---|
| A API não inicia, com erro de `require`/ESM vindo do `@mastra/core` (ou aviso de `engines` no `npm install`) | Node antigo. Use Node 22.13+ (`nvm use`) e rode `npm install` de novo. |
| `port is already allocated` ao subir o banco | A porta 5440 está em uso. Troque `5440` no `docker-compose.yml` e no `DATABASE_URL`. |
| API não sobe: `Configuração inválida` | Falta variável no `.env` (a API valida tudo na inicialização). Compare com o `.env.example`. |
| O chat responde "O assistente está sem configuração" | Falta a chave do provedor de `LLM_MODEL` no `.env`. Preencha e reinicie a API. |
| O chat responde "Tive um problema para responder agora" | Erro do provedor (chave inválida, sem crédito, rede). Veja o log da API (ex.: `insufficient_quota`). |
| Frontend carrega mas não conecta (erro de CORS ou socket) | O frontend precisa estar em `http://localhost:3000` (`FRONTEND_URL` da API). Se usar outra porta, ajuste `FRONTEND_URL` e reinicie a API. |
| "E-mail não encontrado" no login | O seed não rodou: `npm run db:seed`. |
| Erros depois de rodar o seed de novo | Os ids mudaram e a sessão antiga ficou inválida: clique em **Sair** e entre de novo. |
| "O sistema de chamados está instável" de vez em quando | É proposital: o legado simulado falha às vezes (`LEGACY_FAILURE_RATE`, padrão 0.08). Use `0` para desligar. |

## Acesso (dados de exemplo)

Entre em **http://localhost:3000/login**. Como pede o PRD, os usuários de exemplo entram com **qualquer senha**
(basta não deixar o campo vazio — ex.: `123`). O login verifica só se o e-mail existe; o papel define a área:
funcionários vão para `/atendimento` (chat) e analistas para `/atendente` (console).

### Analistas (console)

| E-mail | Senha | Nome | Equipe |
|---|---|---|---|
| `rafael.lima@nexo.com.br` | qualquer (ex.: `123`) | Rafael Lima | Suporte N2 |
| `juliana.costa@nexo.com.br` | qualquer (ex.: `123`) | Juliana Costa | Suporte N1 |

Ao entrar, o console já tem conversas de exemplo: Carla (transferida a pedido, REQ-10480 vencido), Bruno (o agent
pediu ajuda, confiança 41%), Elisa (com o agent) e Fábio (encerrada).

### Funcionários (chat)

| E-mail | Senha | Nome | Área | O que há nos dados de exemplo |
|---|---|---|---|---|
| `ana.souza@nexo.com.br` | qualquer | Ana Souza | Financeiro | **Use esta para testar.** INC-20311 vencido (aguardando analista), INC-20298 em andamento, REQ-10442 aprovado, INC-20150 resolvido há 4 dias (pode reabrir), INC-19410 resolvido há 107 dias (não pode reabrir); 2 conversas no histórico |
| `bruno.tavares@nexo.com.br` | qualquer | Bruno Tavares | Comercial | INC-20402 (Outlook no celular); conversa transferida por baixa confiança |
| `carla.mendes@nexo.com.br` | qualquer | Carla Mendes | Controladoria | REQ-10480 (acesso ao SAP FI) vencido; conversa aguardando analista |
| `diego.ramos@nexo.com.br` | qualquer | Diego Ramos | Operações | sem chamados (bom para abrir o primeiro) |
| `elisa.prado@nexo.com.br` | qualquer | Elisa Prado | Marketing | INC-20519 (impressora); conversa com o agent |
| `fabio.nunes@nexo.com.br` | qualquer | Fábio Nunes | Jurídico | conversa encerrada (dúvida resolvida pelo agent) |
| `gabriela.rocha@nexo.com.br` | qualquer | Gabriela Rocha | Recursos Humanos | sem chamados |

Os chamados de um funcionário nunca aparecem para outro (ex.: logado como Ana, o INC-20402 do Bruno retorna 404).

### Recriar os dados

```bash
npm run db:seed    # apaga e recria usuários, artigos, chamados e conversas (imprime a tabela de acesso)
npm run db:reset   # recria o banco do zero (migrations + seed)
```

Depois de rodar o seed os ids mudam: se estiver logado, saia e entre de novo.

O seed fica em [`prisma/seed.ts`](prisma/seed.ts) (usuários, 8 artigos da central de ajuda, chamados e conversas).

Outros comandos: `npm test` (Jest + teste de integração do agent), `npm run db:seed`, `npm run db:reset`, `npm run lint`.

Sem a chave do provedor configurado em `LLM_MODEL` a API sobe normalmente; o agent responde com uma mensagem de erro amigável e registra o motivo no detalhe da decisão.

## Arquitetura

```
src/
├── config/          Validação das variáveis de ambiente (class-validator) — a API não sobe com config inválida
├── auth/            Login (JWT), /auth/me, guard por papel (EMPLOYEE | ANALYST)
├── service-desk/    Regras do Anexo A: SLA em horas úteis, rótulos, janela de reabertura (+ testes)
├── tickets/         Serviço de chamados simulado, SEPARADO do agent
│   └── legacy-system.ts   Simula o sistema legado: latência e indisponibilidade (LEGACY_FAILURE_RATE) + retry
├── knowledge/       Central de ajuda (busca por palavras-chave com pontuação)
├── conversations/   Persistência de conversas/mensagens/decisões + publicação em tempo real
├── agent/           Mastra: instruções, ferramentas e orquestração de cada turno
├── chat/            Casos de uso: chat do funcionário, rascunhos, console do analista, gateway Socket.IO
└── realtime/        RealtimeService (emissão de eventos, presença) e adapter Socket.IO com CORS
prisma/              schema, migrations e seed (dados do Anexo B)
```

Dependências entre módulos são de mão única: `chat → agent → (tickets, knowledge, conversations)`.
O agent não conhece HTTP nem sockets; o serviço de chamados não conhece o agent.

### Modelo de dados

`User` · `Ticket` (+ `TicketUpdate`, `TicketCounter`) · `Article` · `Conversation` (modo: `AGENT`, `WAITING_HUMAN`,
`HUMAN`, `CLOSED`) · `Message` (com `parts` JSON para cards/opções) · `AgentDecision` (transparência) · `TicketDraft`.
Tudo no Postgres: conversas, chamados e o estado de cada conversa sobrevivem a um reinício.

### Tempo real (Socket.IO)

O cliente conecta com o JWT no handshake. Funcionários entram na sala `user:<id>`; analistas na sala `analysts`.

| Direção | Evento | Uso |
|---|---|---|
| cliente → servidor | `chat:send` (`{ conversationId, text }`), `draft:confirm`, `draft:cancel` | ações do funcionário, com *ack* `{ ok, data \| error }` validado por class-validator |
| servidor → cliente | `message:new`, `message:updated` | mensagens e cards (ex.: rascunho confirmado) |
| servidor → cliente | `agent:status` | "pensando" + cada passo ao vivo ("consultou seus chamados"…) |
| servidor → cliente | `conversation:updated` | modo, transferência, não lidas — alimenta o console |

Leituras e ações do analista são REST (`/chat/*`, `/analyst/*`, `/tickets/*`).

O funcionário pode ter **várias conversas**: `GET /chat/conversations` (histórico, com título gerado da primeira
mensagem), `GET /chat/conversations/:id`, `POST /chat/conversations` (nova; reaproveita uma vazia). Conversas
encerradas ficam só para leitura; o limite de 30 mensagens vale por conversa.

## Como o agent decide

Cada mensagem do funcionário dispara um **turno** (`AgentService.runTurn`), com fila por conversa (um turno por vez):

1. Se a conversa está com um analista (ou aguardando), o agent **não responde**.
2. Monta o contexto: instruções fixas (regras do Anexo A, tabela de prioridade/prazo, condução da conversa) + uma
   mensagem de contexto do turno (nome, horário, mensagens usadas) + as últimas 24 mensagens. Cards antigos viram
   descrições curtas (`[rascunho D-XXXX: confirmado]`) para o modelo saber o estado sem reenviar JSON.
3. O modelo escolhe ferramentas. Elas são criadas **por turno**, com o id do funcionário vindo do servidor — o modelo
   nunca informa de quem são os chamados, o que garante a privacidade.

| Ferramenta | O que faz |
|---|---|
| `listar_meus_chamados`, `consultar_chamado` | consulta o serviço de chamados (com retry do legado) |
| `buscar_central_de_ajuda` | busca artigos |
| `mostrar_selecao_de_chamados`, `mostrar_chamado`, `oferecer_opcoes` | geram os cards/opções da interface |
| `propor_novo_chamado` | recebe *afetados* e *urgência*; o **servidor calcula a prioridade** (Anexo A), verifica duplicidade e cria um *rascunho* com prazo |
| `propor_atualizacao` | rascunho de complemento/reabertura (bloqueia reabrir resolvido há mais de 7 dias) |
| `transferir_para_analista` | pausa o agent, guarda motivo e resumo, marca o chamado como aguardando analista |
| `registrar_decisao` | intenção, ação, confiança (0–1) e motivo — obrigatória em todo turno |

4. **Nada é criado sem confirmação**: o chamado só nasce quando o funcionário clica em *Confirmar* no rascunho
   (`draft:confirm`), e isso é código determinístico — não depende do LLM.
5. **Rede de segurança**: se a confiança registrada for < 0,4 e o modelo não tiver transferido, o servidor transfere
   (motivo "o agent não teve segurança").
6. Falhas do legado viram `{ erro: 'sistema_de_chamados_indisponivel' }` para o modelo avisar o funcionário em vez
   de inventar dados. Falhas do LLM viram uma resposta de erro com a decisão registrada.

### Transparência

Cada resposta grava um `AgentDecision`: intenção, ação, confiança, motivo, passos, chamadas de ferramenta (entrada,
sucesso, duração, resumo), modelo, latência e tokens. Na interface:
- os **passos** aparecem acima da resposta e **ao vivo** enquanto o agent trabalha;
- **"Por quê?"** abre o detalhe completo (funcionário e analista);
- o console mostra a confiança de cada resposta da IA e o **resumo da transferência**.

## Como garanti a qualidade das decisões

- Regras críticas no **código**, não só no prompt: prioridade (impacto × urgência), duplicidade, janela de reabertura,
  cálculo de prazo/vencimento, privacidade, confirmação antes de criar, um rascunho pendente por conversa, pausa do
  agent durante atendimento humano, limite de 30 mensagens.
- Guardas de condução: num mesmo turno o agent não pergunta e propõe rascunho ao mesmo tempo (as ferramentas recusam
  e o servidor descarta); o texto não repete a pergunta já exibida no card de opções.
- Contexto por turno com a lista compacta dos chamados do funcionário, para resolver referências como "o do notebook".
- Se o modelo não registrar a decisão, uma chamada curta com `toolChoice` forçado em `registrar_decisao` completa o
  registro — toda resposta tem transparência.
- O prompt fica para o que é julgamento: entender a intenção, perguntar o que falta (uma coisa por vez, com opções),
  classificar tipo/categoria/prioridade e decidir quando transferir.
- `temperature: 0.2`, `maxSteps: 8`, timeout de 60 s.
- Testes:
  - `src/service-desk/sla.spec.ts` — horas úteis, fim de semana, plantão 24h, vencimento (Jest);
  - `src/service-desk/priority.spec.ts` — matriz impacto × urgência do Anexo A (Jest);
  - `src/agent/agent.tools.test.ts` — integração real com o Mastra usando um modelo simulado que chama as ferramentas:
    valida blocos gerados, decisão registrada, normalização do número, uso do id do servidor e indisponibilidade do
    legado (`npm run test:agent`, roda no test runner do Node porque o build CJS do Mastra depende de `require(esm)`).

## Escolha do modelo

**OpenAI `gpt-4.1-mini`** via roteador de modelos do Mastra (`LLM_MODEL=openai/gpt-4.1-mini`): rápido (3–7 s por
turno com ferramentas), barato por conversa e bom em chamada de ferramentas. Não é um modelo de raciocínio, então aceita
`temperature` baixa e não consome o limite de saída "pensando". O trabalho difícil (regras) está no código, então não é
preciso um modelo maior. Trocar de provedor é só mudar `LLM_MODEL` e a chave correspondente
(`anthropic/claude-haiku-5-5` + `ANTHROPIC_API_KEY`, por exemplo).

Custo: instruções estáveis (o contexto variável vai numa mensagem separada, favorecendo cache de prompt), histórico
limitado a 24 mensagens, cards resumidos em texto e `maxOutputTokens: 700`. Tokens e latência ficam registrados por
resposta.

## Trade-offs

- **Login sem senha real**: o PRD pede aceitar qualquer senha para os funcionários de exemplo. Em produção seria SSO.
- **Busca por palavras-chave** na central de ajuda em vez de embeddings: suficiente para 8 artigos, sem custo extra.
- **API em CommonJS** (padrão do Nest) importando o Mastra, que é ESM: isolado em `src/agent/mastra.ts` e exige Node 22.
- **Socket para ações do funcionário, REST para o analista**: o chat se beneficia do ack em tempo real; o console é
  mais simples com REST + eventos.
- **Fila de turnos em memória**: suficiente para uma instância; com várias instâncias usaria Redis (adapter do
  Socket.IO + fila).

## O que faria com mais tempo

- Avaliações automáticas do agent (conjunto de conversas com resultado esperado e um juiz LLM) rodando no CI.
- Streaming do texto da resposta, além dos passos.
- Resumo automático de conversas longas (memória) em vez de cortar o histórico.
- Busca semântica na central de ajuda e artigos sugeridos ao analista.
- Rate limit por usuário/IP, logs estruturados com o id da conversa e métricas de custo por conversa.
- Testes e2e (Playwright) cobrindo os fluxos das 5 telas.
