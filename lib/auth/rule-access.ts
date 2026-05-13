import type { RoleUsuario, RuleKey as RuleKeyType, RulePermissions as RulePermissionsType } from '@/lib/data/types'

export type RuleKey = RuleKeyType
export type RulePermissions = RulePermissionsType

export type RuleGroupKey =
  | 'propostasFunil'
  | 'comentariosArquivos'
  | 'aprovacao'
  | 'fechamento'
  | 'tarefas'

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
      'allowSellerViewReleasedProposals',
      'allowOrcamentistaViewAssignedProposalsOutsideScope',
      'allowOrcamentistaEditAssignedProposalsOutsideScope',
    ],
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
    key: 'tarefas',
    title: 'Tarefas',
    description: 'Permissoes operacionais ligadas a criacao e atribuicao de tarefas.',
    rules: ['canAssignTaskResponsavel'],
  },
]

export const RULE_KEYS: RuleKey[] = RULE_GROUPS.flatMap((group) => group.rules)

export const ruleLabels: Record<RuleKey, string> = {
  canCreateProposals: 'Criar propostas',
  canAssignTaskResponsavel: 'Escolher responsavel da tarefa',
  allowSellerCommentsOnResponsibleProposals: 'Permitir comentarios do vendedor',
  allowSellerViewReleasedProposals: 'Mostrar propostas liberadas ao vendedor',
  allowOrcamentistaViewAssignedProposalsOutsideScope: 'Permitir visao historica do orcamentista',
  allowOrcamentistaEditAssignedProposalsOutsideScope: 'Permitir edicao historica do orcamentista',
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
  allowSellerCommentsOnResponsibleProposals:
    'Permite que o vendedor comente nas propostas em que ele e o responsavel, mesmo sem poder editar o restante do conteudo.',
  allowSellerViewReleasedProposals:
    'Mantem visiveis para o vendedor apenas as propostas comerciais ja liberadas para ele.',
  allowOrcamentistaViewAssignedProposalsOutsideScope:
    'Permite ao orcamentista abrir propostas atribuídas a ele mesmo depois que elas saem das colunas tecnicas do funil.',
  allowOrcamentistaEditAssignedProposalsOutsideScope:
    'Permite ao orcamentista continuar alterando propostas atribuídas a ele mesmo fora do escopo tecnico padrao.',
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
      requireClosedClientData: false,
    }
  }

  if (role === 'orcamentista') {
    return {
      ...ALL_ENABLED,
      canCreateProposals: true,
      canAssignTaskResponsavel: false,
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
