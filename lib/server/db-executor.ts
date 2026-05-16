import { prisma } from '@/lib/db/prisma'

export type SqlExecutor = {
  execute: (sql: string, params?: any[]) => Promise<unknown>
  $queryRawUnsafe?: <T = unknown>(sql: string, ...values: any[]) => Promise<T>
  $executeRawUnsafe?: (sql: string, ...values: any[]) => Promise<number>
}

export async function executeSql<T>(
  sql: string,
  params?: any[],
  executor?: SqlExecutor | null
): Promise<T> {
  const isRead = /^\s*(SELECT|SHOW|DESCRIBE|WITH)\b/i.test(sql)

  if (executor) {
    if (executor.$queryRawUnsafe) {
      if (isRead) {
        return executor.$queryRawUnsafe<T>(sql, ...(params || []))
      }

      const result = await executor.$executeRawUnsafe?.(sql, ...(params || []))
      return result as T
    }

    const [results] = (await executor.execute(sql, params)) as [T]
    return results
  }

  if (isRead) {
    return prisma.$queryRawUnsafe<T>(sql, ...(params || []))
  }

  return prisma.$executeRawUnsafe(sql, ...(params || [])) as T
}
