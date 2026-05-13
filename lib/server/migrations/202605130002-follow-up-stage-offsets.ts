import { runFollowUpStageOffsetMigration } from '@/lib/server/proposal-workflow'

export const migration202605130002 = {
  version: '202605130002',
  name: 'follow_up_stage_offsets',
  run: async () => {
    await runFollowUpStageOffsetMigration()
  },
}
