import { query } from '@/lib/db/mysql'

export type SqlExecutor = {
  execute: (sql: string, params?: any[]) => Promise<unknown>
}

export async function executeSql<T>(
  sql: string,
  params?: any[],
  executor?: SqlExecutor | null
): Promise<T> {
  if (executor) {
    const [results] = (await executor.execute(sql, params)) as [T]
    return results
  }

  return query<T>(sql, params)
}
