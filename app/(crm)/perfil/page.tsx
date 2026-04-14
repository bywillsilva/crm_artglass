"use client"

import { useEffect, useState } from "react"
import { usePropostas, useSession, useTarefas, useUsuario, updateUsuario } from '@/lib/hooks/use-api'
import { useAppSettings } from '@/lib/context/app-settings-context'
import { CRMHeader } from "@/components/crm/header"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { roleLabels } from '@/lib/data/types'
import type { Proposta, Tarefa } from '@/lib/data/types'
import { AlertCircle, Calendar, Check, Mail, Shield, User } from "lucide-react"
import { toast } from "sonner"

export default function PerfilPage() {
  const { user: sessionUser } = useSession()
  const { usuario: currentUser } = useUsuario(sessionUser?.id ?? null)
  const { tarefas } = useTarefas()
  const { propostas } = usePropostas()
  const { company, formatCurrency } = useAppSettings()

  const [isEditing, setIsEditing] = useState(false)
  const [formData, setFormData] = useState({
    nome: '',
    email: '',
    avatar: '',
    currentPassword: '',
    newPassword: '',
    confirmNewPassword: '',
  })

  useEffect(() => {
    if (!currentUser || isEditing) return

    setFormData((prev) => {
      const next = {
        nome: currentUser.nome,
        email: currentUser.email,
        avatar: currentUser.avatar,
        currentPassword: '',
        newPassword: '',
        confirmNewPassword: '',
      }

      return prev.nome === next.nome && prev.email === next.email && prev.avatar === next.avatar
        ? prev
        : next
    })
  }, [currentUser, isEditing])

  const handleSave = async () => {
    if (!currentUser) return

    await updateUsuario(currentUser.id, {
      ...currentUser,
      nome: formData.nome,
      email: formData.email,
      avatar: formData.avatar,
    })

    if (formData.currentPassword || formData.newPassword || formData.confirmNewPassword) {
      if (!formData.currentPassword) {
        toast.error("Informe a senha atual para alterar a senha.")
        return
      }

      if (formData.newPassword.length < 8) {
        toast.error("A nova senha deve ter no minimo 8 caracteres.")
        return
      }

      if (formData.newPassword !== formData.confirmNewPassword) {
        toast.error("A confirmacao da nova senha nao confere.")
        return
      }

      const response = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword: formData.currentPassword,
          newPassword: formData.newPassword,
        }),
      })

      const result = await response.json()
      if (!response.ok) {
        toast.error(result?.error || 'Nao foi possivel alterar a senha.')
        return
      }
    }

    setIsEditing(false)
    setFormData((prev) => ({
      ...prev,
      currentPassword: '',
      newPassword: '',
      confirmNewPassword: '',
    }))
    toast.success("Perfil atualizado com sucesso!")
  }

  const handleCancel = () => {
    if (!currentUser) return

    setFormData({
      nome: currentUser.nome,
      email: currentUser.email,
      avatar: currentUser.avatar,
      currentPassword: '',
      newPassword: '',
      confirmNewPassword: '',
    })
    setIsEditing(false)
  }

  const clientesDoUsuario = new Set(
    propostas
      .filter((proposta: Proposta) => proposta.responsavelId === currentUser?.id)
      .map((proposta: Proposta) => proposta.clienteId)
  )
  const tarefasPendentes = tarefas.filter(
    (tarefa: Tarefa) => tarefa.responsavelId === currentUser?.id && tarefa.status === 'pendente'
  )
  const propostasAprovadas = propostas.filter(
    (proposta: Proposta) => proposta.responsavelId === currentUser?.id && proposta.status === 'fechado'
  )
  const valorTotal = propostasAprovadas.reduce((acc: number, proposta: Proposta) => acc + proposta.valor, 0)

  if (!currentUser) return null

  return (
    <>
      <CRMHeader title="Meu Perfil" subtitle="Visualize e edite suas informacoes pessoais" />

      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-4xl space-y-6">
          <Card className="border-border bg-card">
            <CardHeader>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-4">
                  <Avatar className="h-20 w-20">
                    <AvatarFallback className="bg-primary text-2xl text-primary-foreground">
                      {currentUser.avatar}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <CardTitle className="text-2xl text-foreground">{currentUser.nome}</CardTitle>
                    <CardDescription className="mt-1 flex items-center gap-2">
                      <Mail className="h-4 w-4" />
                      {currentUser.email}
                    </CardDescription>
                    <div className="mt-2 flex items-center gap-2">
                      <Badge variant="outline" className="border-primary/30 bg-primary/20 text-primary">
                        <Shield className="mr-1 h-3 w-3" />
                        {roleLabels[currentUser.role]}
                      </Badge>
                      {currentUser.ativo ? (
                        <Badge variant="outline" className="border-green-500/30 bg-green-500/20 text-green-400">
                          <Check className="mr-1 h-3 w-3" />
                          Ativo
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="border-red-500/30 bg-red-500/20 text-red-400">
                          <AlertCircle className="mr-1 h-3 w-3" />
                          Inativo
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
                {!isEditing && <Button onClick={() => setIsEditing(true)}>Editar Perfil</Button>}
              </div>
            </CardHeader>
          </Card>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <MetricCard title="Clientes" value={clientesDoUsuario.size} />
            <MetricCard title="Tarefas Pendentes" value={tarefasPendentes.length} />
            <MetricCard title="Vendas Fechadas" value={propostasAprovadas.length} />
            <MetricCard title="Valor Total" value={formatCurrency(valorTotal)} />
          </div>

          {isEditing && (
            <Card className="border-border bg-card">
              <CardHeader>
                <CardTitle className="text-foreground">Editar Informacoes</CardTitle>
                <CardDescription>Atualize seus dados e, se quiser, altere a sua senha</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="nome">Nome Completo</Label>
                    <Input id="nome" value={formData.nome} onChange={(event) => setFormData({ ...formData, nome: event.target.value })} placeholder="Seu nome" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email">E-mail</Label>
                    <Input id="email" type="email" value={formData.email} onChange={(event) => setFormData({ ...formData, email: event.target.value })} placeholder="seu@email.com" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="avatar">Iniciais do Avatar</Label>
                  <Input id="avatar" value={formData.avatar} onChange={(event) => setFormData({ ...formData, avatar: event.target.value.toUpperCase() })} placeholder="Ex: CS" maxLength={2} className="w-32" />
                </div>

                <Separator />

                <div className="grid gap-4 md:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="currentPassword">Senha Atual</Label>
                    <Input id="currentPassword" type="password" value={formData.currentPassword} onChange={(event) => setFormData({ ...formData, currentPassword: event.target.value })} placeholder="Obrigatoria para trocar a senha" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="newPassword">Nova Senha</Label>
                    <Input id="newPassword" type="password" value={formData.newPassword} onChange={(event) => setFormData({ ...formData, newPassword: event.target.value })} placeholder="Minimo de 8 caracteres" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="confirmNewPassword">Confirmar Nova Senha</Label>
                    <Input id="confirmNewPassword" type="password" value={formData.confirmNewPassword} onChange={(event) => setFormData({ ...formData, confirmNewPassword: event.target.value })} placeholder="Repita a nova senha" />
                  </div>
                </div>

                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={handleCancel}>
                    Cancelar
                  </Button>
                  <Button onClick={() => void handleSave()}>Salvar Alteracoes</Button>
                </div>
              </CardContent>
            </Card>
          )}

          <Card className="border-border bg-card">
            <CardHeader>
              <CardTitle className="text-foreground">Informacoes do Sistema</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <InfoRow icon={<User className="h-4 w-4" />} label="ID do Usuario" value={<code className="rounded bg-secondary px-2 py-1 text-sm text-foreground">{currentUser.id}</code>} />
              <Separator />
              <InfoRow icon={<Shield className="h-4 w-4" />} label="Nivel de Acesso" value={<span className="text-foreground">{roleLabels[currentUser.role]}</span>} />
              <Separator />
              <InfoRow icon={<Calendar className="h-4 w-4" />} label="Sistema" value={<span className="text-foreground">{company.nome || 'CRM'}</span>} />
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  )
}

function MetricCard({ title, value }: { title: string; value: string | number }) {
  return (
    <Card className="border-border bg-card">
      <CardContent className="p-4">
        <div className="text-sm text-muted-foreground">{title}</div>
        <div className="text-2xl font-bold text-foreground">{value}</div>
      </CardContent>
    </Card>
  )
}

function InfoRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between py-2">
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        {label}
      </div>
      {value}
    </div>
  )
}
