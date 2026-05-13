import { applyLegacySystemSchemaBaseline } from '@/lib/server/schema-legacy-bootstrap'

export const migration202605130001 = {
  version: '202605130001',
  name: 'baseline_crm_schema',
  run: applyLegacySystemSchemaBaseline,
}
