import { promises as fs } from 'fs'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import { prisma } from '@/lib/db/prisma'

export type SavedProposalFile = {
  id: string
  nomeOriginal: string
  nomeArquivo: string
  caminho: string
  url: string
  tipoMime: string
  tamanho: number
  conteudo: Buffer
}

const uploadsRoot = path.join(process.cwd(), 'public', 'uploads', 'propostas')

function sanitizeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_')
}

export function toStoredRelativeProposalPath(propostaId: string, nomeArquivo: string) {
  return path.posix.join('uploads', 'propostas', propostaId, nomeArquivo)
}

export function resolveStoredProposalFilePath(filePath: string | null | undefined) {
  if (!filePath) return null

  const normalized = String(filePath).trim()
  if (!normalized) return null

  if (path.isAbsolute(normalized)) {
    return normalized
  }

  const withoutLeadingSlashes = normalized.replace(/^[/\\]+/, '')
  return path.join(process.cwd(), 'public', withoutLeadingSlashes.replace(/\//g, path.sep))
}

export async function saveProposalFiles(propostaId: string, files: File[]) {
  if (!files.length) {
    return []
  }

  const targetDir = path.join(uploadsRoot, propostaId)
  await fs.mkdir(targetDir, { recursive: true })

  const savedFiles: SavedProposalFile[] = []

  for (const file of files) {
    const extension = path.extname(file.name)
    const baseName = sanitizeFileName(path.basename(file.name, extension))
    const nomeArquivo = `${uuidv4()}-${baseName}${extension}`
    const absolutePath = path.join(targetDir, nomeArquivo)
    const buffer = Buffer.from(await file.arrayBuffer())

    await fs.writeFile(absolutePath, buffer)

    savedFiles.push({
      id: uuidv4(),
      nomeOriginal: file.name,
      nomeArquivo,
      caminho: toStoredRelativeProposalPath(propostaId, nomeArquivo),
      url: `/uploads/propostas/${propostaId}/${nomeArquivo}`,
      tipoMime: file.type || 'application/octet-stream',
      tamanho: file.size,
      conteudo: buffer,
    })
  }

  return savedFiles
}

export async function persistSavedProposalFiles(
  propostaId: string,
  usuarioId: string,
  files: SavedProposalFile[]
) {
  if (!files.length) {
    return
  }

  await prisma.proposta_anexos.createMany({
    data: files.map((file) => ({
      id: file.id,
      proposta_id: propostaId,
      nome_original: file.nomeOriginal,
      nome_arquivo: file.nomeArquivo,
      caminho: file.caminho,
      tipo_mime: file.tipoMime,
      tamanho: BigInt(file.tamanho),
      conteudo: Uint8Array.from(file.conteudo),
      usuario_id: usuarioId,
    })),
  })
}

export async function deleteStoredFiles(paths: string[]) {
  for (const filePath of paths) {
    try {
      const resolvedPath = resolveStoredProposalFilePath(filePath)
      if (!resolvedPath) {
        continue
      }

      await fs.unlink(resolvedPath)
    } catch {
      // Ignore missing files during cleanup.
    }
  }
}
