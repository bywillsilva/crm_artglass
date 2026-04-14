'use client'

import { CRMHeader } from '@/components/crm/header'
import { Card, CardContent } from '@/components/ui/card'
import { moduleLabels, type ModuleKey } from '@/lib/auth/module-access'

interface ModuleAccessStateProps {
  module: ModuleKey
}

export function ModuleAccessState({ module }: ModuleAccessStateProps) {
  return (
    <>
      <CRMHeader
        title={moduleLabels[module]}
        subtitle="Acesso restrito para este modulo"
      />
      <div className="flex flex-1 items-center justify-center p-6">
        <Card className="w-full max-w-xl border-border bg-card">
          <CardContent className="p-8 text-center text-muted-foreground">
            Seu usuario nao possui permissao para acessar este modulo no momento.
          </CardContent>
        </Card>
      </div>
    </>
  )
}
