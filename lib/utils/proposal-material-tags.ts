export function parseProposalMaterialTags(value?: string | null) {
  if (!value) {
    return []
  }

  const seen = new Set<string>()

  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => {
      if (!item) {
        return false
      }

      const normalized = item.toLocaleLowerCase('pt-BR')
      if (seen.has(normalized)) {
        return false
      }

      seen.add(normalized)
      return true
    })
}
