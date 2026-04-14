import { promises as fs } from 'fs'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'

export type SavedProposalFile = {
  id: string
  nomeOriginal: string
  nomeArquivo: string
  caminho: string
  url: string
  tipoMime: string
  tamanho: number
}

const uploadsRoot = path.join(process.cwd(), 'public', 'uploads', 'propostas')

function sanitizeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_')
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
      caminho: absolutePath,
      url: `/uploads/propostas/${propostaId}/${nomeArquivo}`,
      tipoMime: file.type || 'application/octet-stream',
      tamanho: file.size,
    })
  }

  return savedFiles
}

export async function deleteStoredFiles(paths: string[]) {
  for (const filePath of paths) {
    try {
      await fs.unlink(filePath)
    } catch {
      // Ignore missing files during cleanup.
    }
  }
}
