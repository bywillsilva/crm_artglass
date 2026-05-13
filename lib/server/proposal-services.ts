import { v4 as uuidv4 } from 'uuid'
import { executeSql, type SqlExecutor } from '@/lib/server/db-executor'

function readServiceTextCandidate(source: Record<string, unknown>, key: string) {
  const value = source[key]
  return typeof value === 'string' ? value.trim() : ''
}

export function extractProposalServiceName(item: unknown) {
  if (typeof item === 'string') {
    const trimmed = item.trim()
    return trimmed || null
  }

  if (!item || typeof item !== 'object') {
    return null
  }

  const record = item as Record<string, unknown>
  const candidate =
    readServiceTextCandidate(record, 'nome') ||
    readServiceTextCandidate(record, 'label') ||
    readServiceTextCandidate(record, 'descricao') ||
    readServiceTextCandidate(record, 'titulo') ||
    readServiceTextCandidate(record, 'codigo')

  return candidate || null
}

export function normalizeProposalServicesInput(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as string[]
  }

  return value
    .map((item) => extractProposalServiceName(item))
    .filter((item): item is string => Boolean(item))
}

export async function syncProposalServices(
  propostaId: string,
  services: unknown,
  executor?: SqlExecutor | null
) {
  const normalizedServices = normalizeProposalServicesInput(services)

  await executeSql('DELETE FROM proposta_servicos WHERE proposta_id = ?', [propostaId], executor)

  for (let index = 0; index < normalizedServices.length; index += 1) {
    await executeSql(
      `INSERT INTO proposta_servicos (id, proposta_id, nome, ordem)
       VALUES (?, ?, ?, ?)`,
      [uuidv4(), propostaId, normalizedServices[index], index],
      executor
    )
  }
}
