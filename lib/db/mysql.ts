import mysql from 'mysql2/promise'

const MYSQL_TIMEZONE = process.env.MYSQL_TIMEZONE || '-03:00'

// Pool de conexoes para melhor performance
const pool = mysql.createPool({
  host: process.env.MYSQL_HOST,
  database: process.env.MYSQL_DATABASE,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  timezone: MYSQL_TIMEZONE,
  dateStrings: true,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
})

export async function query<T>(sql: string, params?: any[]): Promise<T> {
  const connection = await pool.getConnection()

  try {
    await connection.query('SET time_zone = ?', [MYSQL_TIMEZONE])
    const [results] = await connection.execute(sql, params)
    return results as T
  } finally {
    connection.release()
  }
}

export async function getConnection() {
  const connection = await pool.getConnection()
  await connection.query('SET time_zone = ?', [MYSQL_TIMEZONE])
  return connection
}

export default pool
