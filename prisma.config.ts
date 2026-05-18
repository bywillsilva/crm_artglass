import 'dotenv/config'
import { defineConfig } from 'prisma/config'

function resolveDatabaseUrl() {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL
  }

  const hasMysqlParts =
    process.env.MYSQL_HOST ||
    process.env.MYSQL_PORT ||
    process.env.MYSQL_USER ||
    process.env.MYSQL_PASSWORD ||
    process.env.MYSQL_DATABASE

  if (hasMysqlParts) {
    const url = new URL('mariadb://localhost')
    url.hostname = process.env.MYSQL_HOST || 'localhost'
    url.port = String(Math.max(Number(process.env.MYSQL_PORT || 3306), 1))
    url.username = process.env.MYSQL_USER || ''
    url.password = process.env.MYSQL_PASSWORD || ''
    url.pathname = `/${process.env.MYSQL_DATABASE || ''}`
    return url.toString()
  }

  return 'mariadb://placeholder:placeholder@localhost:3306/placeholder'
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: resolveDatabaseUrl(),
  },
})
