import { query } from '@/lib/db/mysql'

export const migration202605130003 = {
  version: '202605130003',
  name: 'user-rule-permissions',
  async run() {
    const existingColumns = await query<Array<{ COLUMN_NAME: string }>>(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'usuarios'
         AND COLUMN_NAME = 'rule_permissions'`
    )

    if (!existingColumns.length) {
      await query(`ALTER TABLE usuarios ADD COLUMN rule_permissions JSON NULL AFTER module_permissions`)
    }
  },
}

