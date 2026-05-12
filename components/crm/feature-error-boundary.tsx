'use client'

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RefreshCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'

type FeatureErrorBoundaryProps = {
  children: ReactNode
  title?: string
  description?: string
}

type FeatureErrorBoundaryState = {
  hasError: boolean
}

export class FeatureErrorBoundary extends Component<
  FeatureErrorBoundaryProps,
  FeatureErrorBoundaryState
> {
  state: FeatureErrorBoundaryState = {
    hasError: false,
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Erro de interface capturado na FeatureErrorBoundary:', error, errorInfo)
  }

  handleRetry = () => {
    this.setState({ hasError: false })
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children
    }

    return (
      <div className="rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
        <div className="mx-auto flex max-w-xl flex-col items-center gap-3">
          <div className="rounded-full bg-amber-500/10 p-3 text-amber-400">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div className="space-y-1">
            <p className="text-base font-semibold text-foreground">
              {this.props.title || 'Nao foi possivel carregar esta area agora'}
            </p>
            <p className="text-sm text-muted-foreground">
              {this.props.description ||
                'O sistema bloqueou um erro inesperado nesta interface para evitar quebrar a tela inteira.'}
            </p>
          </div>
          <Button type="button" variant="outline" onClick={this.handleRetry}>
            <RefreshCcw className="mr-2 h-4 w-4" />
            Tentar novamente
          </Button>
        </div>
      </div>
    )
  }
}
