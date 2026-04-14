'use client'

import { useState } from 'react'
import { useCRM } from '@/lib/context/crm-context'
import { useAppSettings } from '@/lib/context/app-settings-context'
import { useSession } from '@/lib/hooks/use-api'
import { ProposalDetailsSheet } from '@/components/crm/propostas/proposal-details-sheet'
import { ProposalFormDialog } from '@/components/crm/propostas/proposal-form-dialog'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Plus, FileText, Calendar, Paperclip, MessageSquare } from 'lucide-react'
import { statusPropostaColors, statusPropostaLabels } from '@/lib/data/types'

interface ProposalsTabProps {
  clienteId: string
}

export function ProposalsTab({ clienteId }: ProposalsTabProps) {
  const { formatCurrency, formatDate } = useAppSettings()
  const { getPropostasByCliente } = useCRM()
  const { user } = useSession()
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingPropostaId, setEditingPropostaId] = useState<string | null>(null)
  const [detailsPropostaId, setDetailsPropostaId] = useState<string | null>(null)

  const propostas = getPropostasByCliente(clienteId)

  return (
    <>
      <Card className="border-border bg-card">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg">Propostas</CardTitle>
          <Button size="sm" onClick={() => setShowAddForm(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Nova Proposta
          </Button>
        </CardHeader>
        <CardContent>
          {propostas.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">Nenhuma proposta registrada</p>
          ) : (
            <div className="space-y-4">
              {propostas.map((proposta) => (
                <div
                  key={proposta.id}
                  className="rounded-lg border border-border bg-secondary/30 p-4"
                >
                  <div className="mb-3 flex items-start justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="rounded-lg bg-primary/20 p-2">
                        <FileText className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <p className="text-xl font-bold text-foreground">
                          {formatCurrency(proposta.valor)}
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            Atualizada em {formatDate(proposta.dataEnvio)}
                          </span>
                          <span>Vendedor: {proposta.responsavelNome || '-'}</span>
                          <span>Orcamentista: {proposta.orcamentistaNome || '-'}</span>
                        </div>
                      </div>
                    </div>
                    <Badge variant="outline" className={statusPropostaColors[proposta.status]}>
                      {statusPropostaLabels[proposta.status]}
                    </Badge>
                  </div>

                  {proposta.descricao ? (
                    <p className="mb-3 text-sm text-muted-foreground">{proposta.descricao}</p>
                  ) : null}

                  <div className="mb-4 flex flex-wrap gap-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Paperclip className="h-3 w-3" />
                      {proposta.anexosCount ?? proposta.anexos?.length ?? 0} anexos
                    </span>
                    <span className="flex items-center gap-1">
                      <MessageSquare className="h-3 w-3" />
                      {proposta.comentariosCount ?? proposta.comentarios?.length ?? 0} comentarios
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setDetailsPropostaId(proposta.id)}>
                      Ver detalhes
                    </Button>
                    {(user?.role === 'admin' ||
                      user?.role === 'gerente' ||
                      proposta.responsavelId === user?.id ||
                      (
                        user?.role === 'orcamentista' &&
                        (!proposta.orcamentistaId || proposta.orcamentistaId === user.id) &&
                        ['novo_cliente', 'em_orcamento', 'em_retificacao', 'aguardando_aprovacao'].includes(proposta.status)
                      )) && (
                      <Button size="sm" variant="outline" onClick={() => setEditingPropostaId(proposta.id)}>
                        Editar
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <ProposalFormDialog
        open={showAddForm}
        onOpenChange={setShowAddForm}
        clienteIdInicial={clienteId}
      />
      <ProposalFormDialog
        open={Boolean(editingPropostaId)}
        onOpenChange={(open) => !open && setEditingPropostaId(null)}
        propostaId={editingPropostaId}
      />
      <ProposalDetailsSheet
        open={Boolean(detailsPropostaId)}
        onOpenChange={(open) => !open && setDetailsPropostaId(null)}
        propostaId={detailsPropostaId}
      />
    </>
  )
}
