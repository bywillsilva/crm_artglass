'use client'

import { useEffect } from 'react'
import { AlertTriangle, RefreshCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'

type CRMErrorProps = {
  error: Error & { digest?: string }
  reset: () => void
}

export default function CRMError({ error, reset }: CRMErrorProps) {
  useEffect(() => {
    console.error('Erro capturado na rota do CRM:', error)
  }, [error])

  return (
    <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center p-6">
      <div className="w-full max-w-xl rounded-2xl border border-border bg-card p-8 shadow-sm">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="rounded-full bg-amber-500/10 p-3 text-amber-400">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-semibold text-foreground">O CRM encontrou um erro temporario</h2>
            <p className="text-sm leading-6 text-muted-foreground">
              A tela foi protegida para evitar que a aplicacao inteira quebre no aparelho do usuario. Voce
              pode tentar novamente agora sem perder toda a sessao.
            </p>
          </div>
          <Button type="button" variant="outline" onClick={reset}>
            <RefreshCcw className="mr-2 h-4 w-4" />
            Tentar novamente
          </Button>
        </div>
      </div>
    </div>
  )
}
