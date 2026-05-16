import { PrismaMariaDb } from '@prisma/adapter-mariadb'
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as typeof globalThis & {
  prisma?: PrismaClient
}

const MYSQL_TIMEZONE = process.env.MYSQL_TIMEZONE || '-03:00'
const MYSQL_SSL_ENABLED = /^(1|true|required)$/i.test(process.env.MYSQL_SSL || '')
const PRISMA_CONNECTION_LIMIT = Math.max(Number(process.env.PRISMA_CONNECTION_LIMIT || 2), 1)
const PRISMA_ACQUIRE_TIMEOUT_MS = Math.max(Number(process.env.PRISMA_ACQUIRE_TIMEOUT_MS || 10000), 1000)
const PRISMA_CONNECT_TIMEOUT_MS = Math.max(Number(process.env.PRISMA_CONNECT_TIMEOUT_MS || 10000), 1000)

function applyPrismaMariaDbParams(url: URL) {
  url.protocol = 'mariadb:'
  url.searchParams.set('connectionLimit', String(PRISMA_CONNECTION_LIMIT))
  url.searchParams.set('acquireTimeout', String(PRISMA_ACQUIRE_TIMEOUT_MS))
  url.searchParams.set('connectTimeout', String(PRISMA_CONNECT_TIMEOUT_MS))
  url.searchParams.set('resetAfterUse', 'true')
  url.searchParams.set('timezone', MYSQL_TIMEZONE)

  const sslParam = url.searchParams.get('ssl') || url.searchParams.get('sslaccept')
  const sslEnabled = MYSQL_SSL_ENABLED || /^(1|true|required)$/i.test(sslParam || '')
  if (sslEnabled && !url.searchParams.has('ssl')) {
    url.searchParams.set('ssl', 'true')
  }

  return url
}

function buildPrismaMariaDbUrl() {
  const databaseUrl = process.env.DATABASE_URL

  if (databaseUrl) {
    return applyPrismaMariaDbParams(new URL(databaseUrl)).toString()
  }

  const url = new URL('mariadb://localhost')
  url.hostname = process.env.MYSQL_HOST || 'localhost'
  url.port = String(Math.max(Number(process.env.MYSQL_PORT || 3306), 1))
  url.username = process.env.MYSQL_USER || ''
  url.password = process.env.MYSQL_PASSWORD || ''
  url.pathname = `/${process.env.MYSQL_DATABASE || ''}`
  return applyPrismaMariaDbParams(url).toString()
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter: new PrismaMariaDb(buildPrismaMariaDbUrl()),
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  })

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}

export default prisma
