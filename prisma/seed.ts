import { PrismaClient, type Prisma } from '@prisma/client'
import { computeDueAt } from '../src/service-desk/sla'

const prisma = new PrismaClient()

const DAY = 86_400_000
const HOUR = 3_600_000
const ago = (ms: number) => new Date(Date.now() - ms)

const users = [
  { email: 'ana.souza@nexo.com.br', name: 'Ana Souza', department: 'Financeiro', passwordChangedAt: ago(42 * DAY) },
  { email: 'bruno.tavares@nexo.com.br', name: 'Bruno Tavares', department: 'Comercial' },
  { email: 'carla.mendes@nexo.com.br', name: 'Carla Mendes', department: 'Controladoria' },
  { email: 'diego.ramos@nexo.com.br', name: 'Diego Ramos', department: 'Operações' },
  { email: 'elisa.prado@nexo.com.br', name: 'Elisa Prado', department: 'Marketing' },
  { email: 'fabio.nunes@nexo.com.br', name: 'Fábio Nunes', department: 'Jurídico' },
  { email: 'gabriela.rocha@nexo.com.br', name: 'Gabriela Rocha', department: 'Recursos Humanos' },
  { email: 'rafael.lima@nexo.com.br', name: 'Rafael Lima', role: 'ANALYST' as const, team: 'Suporte N2' },
  { email: 'juliana.costa@nexo.com.br', name: 'Juliana Costa', role: 'ANALYST' as const, team: 'Suporte N1' },
]

const articles: Prisma.ArticleCreateInput[] = [
  {
    slug: 'vpn-erro-809',
    title: 'VPN com erro 809',
    category: 'REDE_VPN',
    tags: ['vpn', 'erro 809', 'conexão remota', 'windows 10'],
    content:
      'Reinstale o cliente de VPN pelo portal de softwares e reinicie o computador. Vale apenas para Windows 10; no Windows 11, abra um chamado.',
  },
  {
    slug: 'horario-service-desk',
    title: 'Horário do service desk',
    tags: ['horário', 'atendimento', 'plantão', 'telefone', 'ramal'],
    content:
      'O service desk atende de segunda a sexta, das 8h às 18h, pelo chat ou no ramal 4000. Chamados críticos têm plantão 24 horas.',
  },
  {
    slug: 'senha-de-rede-expirada',
    title: 'Senha de rede expirada ou bloqueada',
    category: 'ACESSO',
    tags: ['senha', 'bloqueada', 'expirada', 'login', 'rede', 'ad'],
    content:
      'A senha de rede expira a cada 90 dias. Para trocar, acesse senha.nexo.com.br de um computador da empresa. Após 5 tentativas erradas a conta é bloqueada por 30 minutos; se precisar antes, abra um chamado de Acesso.',
  },
  {
    slug: 'outlook-celular',
    title: 'Configurar o e-mail corporativo no celular',
    category: 'EMAIL',
    tags: ['outlook', 'e-mail', 'celular', 'sincronizar', 'android', 'iphone'],
    content:
      'Use o app Outlook (Android ou iOS) e entre com o e-mail corporativo. O app Mail nativo não é suportado. Se não sincronizar, remova a conta e adicione de novo; o celular precisa estar com a autenticação em dois fatores ativa.',
  },
  {
    slug: 'impressora-fila-travada',
    title: 'Impressora não imprime (fila travada)',
    category: 'HARDWARE',
    tags: ['impressora', 'imprimir', 'fila', 'travada'],
    content:
      'Abra "Impressoras e scanners", selecione a impressora e clique em "Abrir fila". Cancele todos os documentos e tente de novo. Se a impressora mostrar erro no visor, abra um chamado de Hardware informando o andar.',
  },
  {
    slug: 'notebook-lento-atualizacao',
    title: 'Computador lento após atualização do Windows',
    category: 'HARDWARE',
    tags: ['lento', 'lentidão', 'windows update', 'atualização', 'notebook'],
    content:
      'Depois de uma atualização, o Windows pode ficar lento por até 1 dia enquanto indexa arquivos. Reinicie e rode o "Diagnóstico Nexo" pelo portal de softwares. Se continuar lento após isso, abra um chamado de Hardware.',
  },
  {
    slug: 'pedido-de-acesso-sistemas',
    title: 'Como pedir acesso a sistemas (SAP, SharePoint, pastas)',
    category: 'ACESSO',
    tags: ['acesso', 'permissão', 'sap', 'sharepoint', 'pasta', 'sistema'],
    content:
      'Acessos são requisições (REQ) da categoria Acesso e precisam da aprovação do gestor, que é solicitada automaticamente. Informe o sistema, o perfil ou a pasta e o motivo.',
  },
  {
    slug: 'instalar-software',
    title: 'Instalar programas no computador',
    category: 'SOFTWARE',
    tags: ['instalar', 'software', 'programa', 'portal de softwares', 'licença'],
    content:
      'Programas homologados podem ser instalados sem chamado pelo portal de softwares (atalho na área de trabalho). Programas fora do portal ou que exigem licença precisam de uma requisição de Software.',
  },
]

async function main() {
  // Limpa em ordem de dependência (seed idempotente)
  await prisma.agentDecision.deleteMany()
  await prisma.message.deleteMany()
  await prisma.ticketDraft.deleteMany()
  await prisma.conversation.deleteMany()
  await prisma.ticketUpdate.deleteMany()
  await prisma.ticket.deleteMany()
  await prisma.ticketCounter.deleteMany()
  await prisma.article.deleteMany()
  await prisma.user.deleteMany()

  const byEmail: Record<string, string> = {}
  for (const user of users) {
    const created = await prisma.user.create({ data: user })
    byEmail[user.email.split('@')[0]] = created.id
  }

  await prisma.article.createMany({ data: articles })

  type SeedTicket = Omit<Prisma.TicketUncheckedCreateInput, 'dueAt'> & { updatedAt: Date }
  const tickets: SeedTicket[] = [
    // Ana: vencido aguardando analista, em andamento, aprovado, resolvido recente e antigo
    {
      number: 'INC-20311',
      type: 'INC',
      title: 'Notebook lento após atualização do Windows',
      description:
        'Lentidão geral desde a atualização de 15/10. Reiniciar e rodar o diagnóstico da central não resolveu.',
      category: 'HARDWARE',
      priority: 'MEDIA',
      status: 'AGUARDANDO_ANALISTA',
      requesterId: byEmail['ana.souza'],
      createdAt: ago(10 * DAY),
      updatedAt: ago(6 * DAY),
    },
    {
      number: 'INC-20298',
      type: 'INC',
      title: 'Acesso à pasta Financeiro no SharePoint',
      description: 'Sem permissão de escrita na pasta Financeiro/2026 desde a migração do SharePoint.',
      category: 'ACESSO',
      priority: 'MEDIA',
      status: 'EM_ANDAMENTO',
      requesterId: byEmail['ana.souza'],
      createdAt: ago(12 * DAY),
      updatedAt: ago(1 * DAY),
    },
    {
      number: 'REQ-10442',
      type: 'REQ',
      title: 'Segundo monitor para home office',
      description: 'Pedido de monitor adicional de 24" para uso em home office. Aprovado pelo gestor.',
      category: 'HARDWARE',
      priority: 'BAIXA',
      status: 'APROVADO',
      requesterId: byEmail['ana.souza'],
      createdAt: ago(17 * DAY),
      updatedAt: ago(7 * DAY),
    },
    {
      number: 'INC-20150',
      type: 'INC',
      title: 'Senha do SAP bloqueada',
      description: 'Conta do SAP bloqueada após tentativas de login com a senha antiga.',
      category: 'ACESSO',
      priority: 'MEDIA',
      status: 'RESOLVIDO',
      requesterId: byEmail['ana.souza'],
      createdAt: ago(6 * DAY),
      updatedAt: ago(4 * DAY),
      resolvedAt: ago(4 * DAY),
    },
    {
      number: 'INC-19410',
      type: 'INC',
      title: 'Troca de senha da rede',
      description: 'Senha de rede expirada e sem acesso ao portal de troca.',
      category: 'ACESSO',
      priority: 'ALTA',
      status: 'RESOLVIDO',
      requesterId: byEmail['ana.souza'],
      createdAt: ago(108 * DAY),
      updatedAt: ago(107 * DAY),
      resolvedAt: ago(107 * DAY),
    },
    // Outros funcionários (nunca devem aparecer para a Ana)
    {
      number: 'INC-20402',
      type: 'INC',
      title: 'Outlook não sincroniza no celular',
      description: 'App Outlook no Android parou de sincronizar após troca de aparelho.',
      category: 'EMAIL',
      priority: 'BAIXA',
      status: 'ABERTO',
      requesterId: byEmail['bruno.tavares'],
      createdAt: ago(2 * DAY),
      updatedAt: ago(2 * DAY),
    },
    {
      number: 'REQ-10480',
      type: 'REQ',
      title: 'Acesso ao SAP módulo FI',
      description: 'Preciso de acesso ao módulo FI do SAP para o fechamento do mês.',
      category: 'ACESSO',
      priority: 'ALTA',
      status: 'AGUARDANDO_ANALISTA',
      requesterId: byEmail['carla.mendes'],
      createdAt: ago(5 * HOUR),
      updatedAt: ago(5 * HOUR),
    },
    {
      number: 'INC-20519',
      type: 'INC',
      title: 'Impressora do 3º andar sem imprimir',
      description: 'Impressora do 3º andar mostra erro de papel atolado mesmo vazia.',
      category: 'HARDWARE',
      priority: 'MEDIA',
      status: 'ABERTO',
      requesterId: byEmail['elisa.prado'],
      createdAt: ago(1 * HOUR),
      updatedAt: ago(1 * HOUR),
    },
  ]

  const ids: Record<string, string> = {}
  for (const t of tickets) {
    const created = await prisma.ticket.create({
      data: {
        ...t,
        dueAt: computeDueAt(t.priority, t.updatedAt),
        updates: { create: { author: 'Service desk', message: 'Chamado registrado.', createdAt: t.createdAt as Date } },
      },
    })
    ids[t.number] = created.id
  }

  await prisma.ticketCounter.createMany({
    data: [
      { type: 'INC', value: 20520 },
      { type: 'REQ', value: 10500 },
    ],
  })

  // Conversas de exemplo para o console do analista
  type SeedMessage = {
    role: 'USER' | 'AGENT' | 'SYSTEM'
    content: string
    minutesAgo: number
    decision?: Omit<Prisma.AgentDecisionUncheckedCreateInput, 'conversationId' | 'messageId'>
  }
  async function conversation(
    employee: string,
    data: Omit<Prisma.ConversationUncheckedCreateInput, 'employeeId'>,
    messages: SeedMessage[],
  ) {
    const conv = await prisma.conversation.create({
      data: {
        ...data,
        title: data.title ?? messages.find((m) => m.role === 'USER')?.content.slice(0, 60),
        employeeId: byEmail[employee],
        userMessageCount: messages.filter((m) => m.role === 'USER').length,
        lastMessageAt: ago(Math.min(...messages.map((m) => m.minutesAgo)) * 60_000),
      },
    })
    for (const m of messages) {
      await prisma.message.create({
        data: {
          conversationId: conv.id,
          role: m.role,
          content: m.content,
          authorId: m.role === 'USER' ? byEmail[employee] : undefined,
          createdAt: ago(m.minutesAgo * 60_000),
          decision: m.decision ? { create: { ...m.decision, conversationId: conv.id } } : undefined,
        },
      })
    }
  }

  const decision = (intent: string, action: string, confidence: number, reasoning: string, steps: string[]) => ({
    intent,
    action,
    confidence,
    reasoning,
    steps,
    toolCalls: [],
    model: 'seed',
  })

  await conversation(
    'carla.mendes',
    {
      mode: 'WAITING_HUMAN',
      handoffReason: 'PEDIDO_USUARIO',
      ticketId: ids['REQ-10480'],
      unreadForAnalyst: 1,
      handoffSummary:
        'Carla precisa de acesso ao SAP FI hoje para o fechamento. REQ-10480 aberto há 5 h, prioridade alta.',
    },
    [
      { role: 'USER', content: 'Preciso de acesso ao SAP ainda hoje', minutesAgo: 30 },
      {
        role: 'AGENT',
        content: 'Seu pedido REQ-10480 está aguardando analista e vence hoje. Quer que eu chame um analista?',
        minutesAgo: 29,
        decision: decision(
          'acelerar acesso ao SAP',
          'ofereceu transferência',
          0.82,
          'REQ de acesso com prioridade alta e compromisso no mesmo dia.',
          ['consultou seus chamados'],
        ),
      },
      { role: 'USER', content: 'Sim, por favor', minutesAgo: 28 },
      {
        role: 'AGENT',
        content: 'Encaminhei para o Suporte N2. Um analista vai falar com você em até 2 h úteis.',
        minutesAgo: 28,
        decision: decision(
          'falar com analista',
          'transferiu para um analista',
          0.95,
          'O funcionário aceitou a transferência.',
          ['transferiu para um analista'],
        ),
      },
      { role: 'SYSTEM', content: 'Transferida para Suporte N2 (a pedido do funcionário)', minutesAgo: 28 },
    ],
  )

  await conversation(
    'bruno.tavares',
    {
      mode: 'WAITING_HUMAN',
      handoffReason: 'BAIXA_CONFIANCA',
      lastConfidence: 0.41,
      unreadForAnalyst: 1,
      handoffSummary: 'Bruno relata que o CRM "some" com os pedidos salvos. Não está claro se é sistema, rede ou uso.',
    },
    [
      { role: 'USER', content: 'O CRM sumiu com meus pedidos de ontem, isso é com vocês?', minutesAgo: 22 },
      {
        role: 'AGENT',
        content: 'Vou chamar um analista para isso. Ele vai falar com você por aqui.',
        minutesAgo: 21,
        decision: decision(
          'dados sumidos no CRM',
          'pediu ajuda a um analista',
          0.41,
          'Não ficou claro se é falha do sistema, permissão ou uso; sem artigo aplicável.',
          ['buscou na central de ajuda', 'pediu ajuda a um analista'],
        ),
      },
      { role: 'SYSTEM', content: 'Transferida para Suporte N2 (o agent não teve segurança)', minutesAgo: 21 },
    ],
  )

  await conversation('elisa.prado', { mode: 'AGENT', ticketId: ids['INC-20519'] }, [
    { role: 'USER', content: 'A impressora do 3º andar não imprime nada', minutesAgo: 14 },
    {
      role: 'AGENT',
      content: 'Abri o INC-20519 com prioridade média. A primeira resposta chega em até 3 dias úteis.',
      minutesAgo: 12,
      decision: decision('impressora sem imprimir', 'criou o INC-20519', 1, 'Funcionário confirmou o rascunho.', [
        'buscou na central de ajuda',
        'criou o chamado',
      ]),
    },
  ])

  await conversation('fabio.nunes', { mode: 'CLOSED', closedAt: ago(10 * 60_000) }, [
    { role: 'USER', content: 'Como instalo o Adobe Reader?', minutesAgo: 20 },
    {
      role: 'AGENT',
      content: 'O Adobe Reader está no portal de softwares (atalho na área de trabalho), dá para instalar sem chamado.',
      minutesAgo: 19,
      decision: decision(
        'instalar programa',
        'respondeu com artigo',
        0.93,
        'Programa homologado; artigo "Instalar programas" se aplica.',
        ['buscou na central de ajuda'],
      ),
    },
    { role: 'USER', content: 'Isso resolveu, obrigado!', minutesAgo: 15 },
  ])

  // Histórico da Ana: uma conversa encerrada (chamado já resolvido) e uma dúvida respondida pelo agent
  const DAY_MIN = 24 * 60
  await conversation('ana.souza', { mode: 'CLOSED', closedAt: ago(4 * DAY), ticketId: ids['INC-20150'] }, [
    { role: 'USER', content: 'Minha senha do SAP está bloqueada', minutesAgo: 6 * DAY_MIN },
    {
      role: 'AGENT',
      content: 'Abri o INC-20150 com prioridade média. A primeira resposta chega em até 3 dias úteis.',
      minutesAgo: 6 * DAY_MIN - 2,
      decision: decision('desbloquear senha do SAP', 'criou o INC-20150', 1, 'A funcionária confirmou o rascunho.', [
        'consultou seus chamados',
        'criou o chamado',
      ]),
    },
    { role: 'SYSTEM', content: 'Atendimento encerrado por Juliana Costa', minutesAgo: 4 * DAY_MIN },
  ])
  await conversation('ana.souza', { mode: 'AGENT' }, [
    { role: 'USER', content: 'Como configuro o e-mail corporativo no celular?', minutesAgo: DAY_MIN + 30 },
    {
      role: 'AGENT',
      content:
        'Use o app Outlook (Android ou iOS) e entre com o e-mail corporativo. O app Mail nativo não é suportado; a autenticação em dois fatores precisa estar ativa.',
      minutesAgo: DAY_MIN + 29,
      decision: decision(
        'configurar e-mail no celular',
        'respondeu com artigo da central',
        0.92,
        'Artigo "Configurar o e-mail corporativo no celular" se aplica.',
        ['buscou na central de ajuda'],
      ),
    },
    { role: 'USER', content: 'Deu certo, obrigada!', minutesAgo: DAY_MIN + 20 },
  ])

  console.log(
    `Seed concluído: ${users.length} usuários, ${articles.length} artigos, ${tickets.length} chamados, 6 conversas.`,
  )
  console.log('\nAcesso (http://localhost:3000/login) — qualquer senha não vazia funciona:')
  console.table(
    users.map((u) => ({
      'E-mail': u.email,
      Nome: u.name,
      Papel: u.role === 'ANALYST' ? `Analista · ${u.team}` : `Funcionário · ${u.department}`,
      Área: u.role === 'ANALYST' ? '/atendente' : '/atendimento',
    })),
  )
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
