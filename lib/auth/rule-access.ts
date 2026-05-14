import type { RoleUsuario, RuleKey as RuleKeyType, RulePermissions as RulePermissionsType } from '@/lib/data/types'

export type RuleKey = RuleKeyType
export type RulePermissions = RulePermissionsType

export type RuleGroupKey =
  | 'propostasFunil'
  | 'formulariosProposta'
  | 'detalhesEdicao'
  | 'comentariosArquivos'
  | 'aprovacao'
  | 'fechamento'
  | 'clientes'
  | 'buscaNotificacoes'
  | 'dashboardRelatorios'
  | 'tarefas'
  | 'configuracoes'
  | 'auditoria'
  | 'administracao'

export const RULE_GROUPS: Array<{
  key: RuleGroupKey
  title: string
  description: string
  rules: RuleKey[]
}> = [
  {
    key: 'propostasFunil',
    title: 'Propostas e funil',
    description: 'Regras de visibilidade e edicao das propostas ao longo do fluxo comercial e tecnico.',
    rules: [
      'canCreateProposals',
      'canDeleteProposalsDirectly',
      'canApproveReadyProposals',
      'allowSellerViewReleasedProposals',
      'allowOrcamentistaViewAssignedProposalsOutsideScope',
      'allowOrcamentistaEditAssignedProposalsOutsideScope',
    ],
  },
  {
    key: 'formulariosProposta',
    title: 'Formulario da proposta',
    description: 'Controla o que cada usuario pode alterar no formulario completo de proposta fora do fluxo arrastavel do funil.',
    rules: [
      'canEditProposalDirectlyOutsideFunnel',
      'canEditProposalStatusDirectly',
      'canSelectProposalResponsavelOnForm',
      'canAssignProposalOrcamentistaOnForm',
    ],
  },
  {
    key: 'detalhesEdicao',
    title: 'Detalhes e edicao direta',
    description: 'Controla o que pode ser visto ou alterado diretamente em Ver detalhes e nas telas de proposta.',
    rules: ['canViewTechnicalProposalData', 'canEditProposalResponsavelDirectly'],
  },
  {
    key: 'comentariosArquivos',
    title: 'Comentarios e anexos',
    description: 'Controla o que pode continuar sendo manipulado quando a proposta entra em modo mais restrito.',
    rules: ['allowSellerCommentsOnResponsibleProposals'],
  },
  {
    key: 'aprovacao',
    title: 'Aprovacao e retificacao',
    description: 'Define o que precisa estar presente antes da proposta seguir para aprovacao ou voltar para ajuste.',
    rules: [
      'requireRetificationJustification',
      'requireStandByJustification',
      'requireLostJustification',
      'requireApprovalPdf',
      'requireApprovalTechnicalData',
      'requireApprovalOrcamentista',
    ],
  },
  {
    key: 'fechamento',
    title: 'Fechamento',
    description: 'Regras aplicadas no momento de concluir a proposta como fechada.',
    rules: ['requireClosedClientData'],
  },
  {
    key: 'clientes',
    title: 'Clientes',
    description: 'Controla a edicao direta do cadastro do cliente fora dos fluxos guiados da proposta.',
    rules: ['canViewAllClients', 'canEditClientsDirectly'],
  },
  {
    key: 'buscaNotificacoes',
    title: 'Busca e notificacoes',
    description: 'Define se o usuario fica limitado aos proprios itens ou se enxerga o panorama inteiro nas notificacoes e pesquisas.',
    rules: ['canViewAllNotifications'],
  },
  {
    key: 'dashboardRelatorios',
    title: 'Dashboard e relatorios',
    description: 'Controla a abrangencia dos dados analiticos e quem pode editar metas e indicadores do time.',
    rules: ['canViewAllDashboardData', 'canManageSellerGoals'],
  },
  {
    key: 'tarefas',
    title: 'Tarefas',
    description: 'Permissoes operacionais ligadas a criacao e atribuicao de tarefas.',
    rules: ['canAssignTaskResponsavel', 'canViewAllTasks', 'canManageAllTasks'],
  },
  {
    key: 'configuracoes',
    title: 'Configuracoes',
    description: 'Define quem pode alterar configuracoes estruturais e dados institucionais do sistema.',
    rules: ['canEditCompanySettings', 'canRunSchemaSync'],
  },
  {
    key: 'auditoria',
    title: 'Auditoria e manutencao',
    description: 'Permissoes mais sensiveis de auditoria interna e manutencao controlada do sistema.',
    rules: ['canAuditProposalAttachments'],
  },
]

export const RULE_KEYS: RuleKey[] = RULE_GROUPS.flatMap((group) => group.rules)

export const ruleLabels: Record<RuleKey, string> = {
  canCreateProposals: 'Criar propostas',
  canAssignTaskResponsavel: 'Escolher responsavel da tarefa',
  canViewAllTasks: 'Visualizar tarefas de todos',
  canManageAllTasks: 'Editar tarefas de todos',
  canViewAllClients: 'Visualizar todos os clientes',
  canViewAllNotifications: 'Visualizar todas as notificacoes',
  canViewAllDashboardData: 'Visualizar dashboard completo',
  canManageSellerGoals: 'Editar metas de vendedores e orcamentistas',
  canRunSchemaSync: 'Executar sincronizacao do banco',
  canEditClientsDirectly: 'Editar cadastro de clientes diretamente',
  canEditCompanySettings: 'Editar dados institucionais da empresa',
  canApproveReadyProposals: 'Aprovar proposta pronta para envio ao cliente',
  canDeleteProposalsDirectly: 'Excluir propostas diretamente',
  canAuditProposalAttachments: 'Auditar e migrar anexos de propostas',
  canEditProposalDirectlyOutsideFunnel: 'Editar proposta diretamente fora do funil',
  canEditProposalStatusDirectly: 'Alterar status diretamente no formulario',
  canSelectProposalResponsavelOnForm: 'Escolher vendedor no formulario da proposta',
  canAssignProposalOrcamentistaOnForm: 'Escolher orcamentista no formulario da proposta',
  canViewTechnicalProposalData: 'Visualizar dados tecnicos da proposta',
  canEditProposalResponsavelDirectly: 'Alterar vendedor diretamente nos detalhes',
  allowSellerCommentsOnResponsibleProposals: 'Permitir comentarios do vendedor',
  allowSellerViewReleasedProposals: 'Mostrar propostas liberadas ao vendedor',
  allowOrcamentistaViewAssignedProposalsOutsideScope: 'Permitir visualizar proposta fora do escopo do funil',
  allowOrcamentistaEditAssignedProposalsOutsideScope: 'Permitir editar proposta fora do escopo do funil',
  requireRetificationJustification: 'Exigir justificativa em retificacao',
  requireStandByJustification: 'Exigir justificativa em stand-by',
  requireLostJustification: 'Exigir justificativa em perdido',
  requireClosedClientData: 'Exigir cadastro completo no fechamento',
  requireApprovalPdf: 'Exigir PDF para aprovacao',
  requireApprovalTechnicalData: 'Exigir dado tecnico para aprovacao',
  requireApprovalOrcamentista: 'Exigir orcamentista na aprovacao',
}

export const ruleDescriptions: Record<RuleKey, string> = {
  canCreateProposals: 'Permite abrir e registrar novas propostas nas telas habilitadas.',
  canAssignTaskResponsavel:
    'Permite escolher outro responsavel ao criar tarefa. Quando desligado, a tarefa nasce no proprio nome.',
  canViewAllTasks:
    'Permite consultar tarefas de outros usuarios nas listagens e detalhes, em vez de ver apenas as proprias.',
  canManageAllTasks:
    'Permite editar, concluir e remover tarefas de outros usuarios, nao apenas as proprias.',
  canViewAllClients:
    'Permite ver a carteira completa de clientes, mesmo quando nao houver vinculo direto com o usuario.',
  canViewAllNotifications:
    'Permite receber notificacoes e alertas do sistema inteiro, em vez de apenas itens sob responsabilidade direta.',
  canViewAllDashboardData:
    'Permite abrir dashboard e indicadores com dados do time inteiro, sem limitar por responsavel.',
  canManageSellerGoals:
    'Permite ajustar metas comerciais e tecnicas na tela de performance do time.',
  canRunSchemaSync:
    'Permite consultar e executar a sincronizacao versionada do banco de dados pelo painel administrativo.',
  canEditClientsDirectly:
    'Permite alterar o cadastro de clientes diretamente pela tela de clientes, sem depender apenas do fechamento da proposta.',
  canEditCompanySettings:
    'Permite alterar os dados institucionais e configuracoes globais da empresa dentro do CRM.',
  canApproveReadyProposals:
    'Permite liberar a proposta de Aguardando aprovacao para Enviar ao cliente.',
  canDeleteProposalsDirectly:
    'Permite excluir propostas pelas telas de propostas e detalhes quando a proposta estiver acessivel ao usuario.',
  canAuditProposalAttachments:
    'Permite abrir a auditoria interna de anexos e executar a migracao controlada de arquivos legados.',
  canEditProposalDirectlyOutsideFunnel:
    'Permite editar o formulario completo da proposta fora do fluxo guiado do funil, inclusive em listagens e detalhes.',
  canEditProposalStatusDirectly:
    'Permite trocar o status da proposta pelo formulario completo, sem depender apenas do arraste e das acoes do funil.',
  canSelectProposalResponsavelOnForm:
    'Permite escolher ou trocar o vendedor responsavel no formulario completo da proposta.',
  canAssignProposalOrcamentistaOnForm:
    'Permite escolher ou trocar o orcamentista no formulario completo da proposta.',
  canViewTechnicalProposalData:
    'Libera a leitura dos dados tecnicos estruturados da proposta dentro de detalhes, listagens e consultas relacionadas.',
  canEditProposalResponsavelDirectly:
    'Libera a troca direta do vendedor responsavel pela proposta sem precisar abrir o formulario completo da proposta.',
  allowSellerCommentsOnResponsibleProposals:
    'Permite que o vendedor comente nas propostas em que ele e o responsavel, mesmo sem poder editar o restante do conteudo.',
  allowSellerViewReleasedProposals:
    'Libera para o vendedor apenas as propostas comerciais ja aprovadas e colocadas no fluxo dele.',
  allowOrcamentistaViewAssignedProposalsOutsideScope:
    'Permite ao orcamentista abrir propostas atribuidas a ele mesmo depois que elas saem das colunas tecnicas do funil.',
  allowOrcamentistaEditAssignedProposalsOutsideScope:
    'Permite ao orcamentista continuar alterando propostas atribuidas a ele mesmo fora do escopo tecnico padrao do funil.',
  requireRetificationJustification:
    'Bloqueia a movimentacao para Em retificacao ate que uma justificativa seja informada.',
  requireStandByJustification:
    'Bloqueia a movimentacao para Stand-by ate que uma justificativa seja informada.',
  requireLostJustification:
    'Bloqueia a movimentacao para Perdido ate que uma justificativa seja informada.',
  requireClosedClientData:
    'Exige nome, documento, e-mail, telefone, endereco e valor no fechamento da proposta.',
  requireApprovalPdf:
    'Exige que a proposta tenha PDF anexado antes de seguir para Aguardando aprovacao.',
  requireApprovalTechnicalData:
    'Exige pelo menos um dado tecnico preenchido antes de seguir para Aguardando aprovacao.',
  requireApprovalOrcamentista:
    'Exige que a proposta tenha um orcamentista definido antes de seguir para Aguardando aprovacao.',
}

const ALL_ENABLED = RULE_KEYS.reduce((acc, key) => {
  acc[key] = true
  return acc
}, {} as RulePermissions)

export function getDefaultRulePermissions(role: RoleUsuario): RulePermissions {
  if (role === 'admin') {
    return {
      ...ALL_ENABLED,
      requireRetificationJustification: false,
      requireClosedClientData: false,
    }
  }

  if (role === 'gerente') {
    return {
      ...ALL_ENABLED,
      canCreateProposals: true,
      canAssignTaskResponsavel: true,
      canViewAllTasks: true,
      canManageAllTasks: true,
      canViewAllClients: true,
      canViewAllNotifications: true,
      canViewAllDashboardData: true,
      canManageSellerGoals: true,
      canRunSchemaSync: false,
      canEditClientsDirectly: true,
      canEditCompanySettings: false,
      canApproveReadyProposals: false,
      canDeleteProposalsDirectly: true,
      canAuditProposalAttachments: false,
      canEditProposalDirectlyOutsideFunnel: true,
      canEditProposalStatusDirectly: true,
      canSelectProposalResponsavelOnForm: true,
      canAssignProposalOrcamentistaOnForm: true,
      canViewTechnicalProposalData: false,
      canEditProposalResponsavelDirectly: false,
      requireClosedClientData: false,
    }
  }

  if (role === 'orcamentista') {
    return {
      ...ALL_ENABLED,
      canCreateProposals: true,
      canAssignTaskResponsavel: false,
      canViewAllTasks: false,
      canManageAllTasks: false,
      canViewAllClients: true,
      canViewAllNotifications: false,
      canViewAllDashboardData: false,
      canManageSellerGoals: false,
      canRunSchemaSync: false,
      canEditClientsDirectly: false,
      canEditCompanySettings: false,
      canApproveReadyProposals: false,
      canDeleteProposalsDirectly: false,
      canAuditProposalAttachments: false,
      canEditProposalDirectlyOutsideFunnel: true,
      canEditProposalStatusDirectly: true,
      canSelectProposalResponsavelOnForm: true,
      canAssignProposalOrcamentistaOnForm: true,
      canEditProposalResponsavelDirectly: false,
      allowSellerCommentsOnResponsibleProposals: false,
      allowSellerViewReleasedProposals: false,
      allowOrcamentistaEditAssignedProposalsOutsideScope: false,
      requireClosedClientData: false,
    }
  }

  return {
    ...ALL_ENABLED,
    canCreateProposals: false,
    canAssignTaskResponsavel: false,
    canViewAllTasks: false,
    canManageAllTasks: false,
    canViewAllClients: false,
    canViewAllNotifications: false,
    canViewAllDashboardData: false,
    canManageSellerGoals: false,
    canRunSchemaSync: false,
    canEditClientsDirectly: false,
    canEditCompanySettings: false,
    canApproveReadyProposals: false,
    canDeleteProposalsDirectly: false,
    canAuditProposalAttachments: false,
    canEditProposalDirectlyOutsideFunnel: false,
    canEditProposalStatusDirectly: false,
    canSelectProposalResponsavelOnForm: false,
    canAssignProposalOrcamentistaOnForm: false,
    canViewTechnicalProposalData: false,
    canEditProposalResponsavelDirectly: false,
    allowOrcamentistaViewAssignedProposalsOutsideScope: false,
    allowOrcamentistaEditAssignedProposalsOutsideScope: false,
  }
}

export function normalizeRulePermissions(
  value: unknown,
  role: RoleUsuario | null | undefined
): RulePermissions {
  const safeRole = role || 'vendedor'
  const defaults = getDefaultRulePermissions(safeRole)

  if (!value || typeof value !== 'object') {
    return defaults
  }

  const source = value as Record<string, unknown>
  return RULE_KEYS.reduce((acc, key) => {
    acc[key] = key in source ? Boolean(source[key]) : defaults[key]
    return acc
  }, { ...defaults } as RulePermissions)
}

export function hasRuleAccess(
  user:
    | {
        role?: string | null
        rulePermissions?: Partial<Record<RuleKey, boolean>> | unknown
        rule_permissions?: Partial<Record<RuleKey, boolean>> | unknown
      }
    | null
    | undefined,
  rule: RuleKey
) {
  if (!user?.role) return false
  return normalizeRulePermissions(user.rulePermissions ?? user.rule_permissions, user.role as RoleUsuario)[rule]
}
