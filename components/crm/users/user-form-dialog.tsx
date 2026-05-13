'use client'

import type { RoleUsuario, Usuario } from '@/lib/data/types'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'

type UserFormState = {
  nome: string
  email: string
  role: RoleUsuario
  avatar: string
  ativo: boolean
  senha: string
  confirmarSenha: string
}

interface UserFormDialogProps {
  open: boolean
  editingUser: Usuario | null
  isEditingSelfAdmin: boolean
  isEditingSelf: boolean
  isSubmitting: boolean
  formData: UserFormState
  onOpenChange: (open: boolean) => void
  onFormDataChange: (updater: UserFormState | ((prev: UserFormState) => UserFormState)) => void
  onSubmit: () => void
}

export function UserFormDialog({
  open,
  editingUser,
  isEditingSelfAdmin,
  isEditingSelf,
  isSubmitting,
  formData,
  onOpenChange,
  onFormDataChange,
  onSubmit,
}: UserFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{editingUser ? 'Editar Usuario' : 'Novo Usuario'}</DialogTitle>
          <DialogDescription>
            {editingUser ? 'Atualize as informacoes do usuario' : 'Preencha os dados para criar um novo usuario'}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="nome">Nome</Label>
            <Input
              id="nome"
              value={formData.nome}
              onChange={(event) => onFormDataChange((prev) => ({ ...prev, nome: event.target.value }))}
              placeholder="Nome completo"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="email">E-mail</Label>
            <Input
              id="email"
              type="email"
              value={formData.email}
              onChange={(event) => onFormDataChange((prev) => ({ ...prev, email: event.target.value }))}
              placeholder="email@exemplo.com"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="role">Funcao</Label>
            <Select
              value={formData.role}
              onValueChange={(value: RoleUsuario) =>
                onFormDataChange((prev) => ({
                  ...prev,
                  role: value,
                }))
              }
              disabled={isEditingSelfAdmin}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione a funcao" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">Administrador</SelectItem>
                <SelectItem value="gerente">Gerente</SelectItem>
                <SelectItem value="vendedor">Vendedor</SelectItem>
                <SelectItem value="orcamentista">Orcamentista</SelectItem>
              </SelectContent>
            </Select>
            {isEditingSelfAdmin && (
              <p className="text-xs text-muted-foreground">
                O administrador nao pode alterar o proprio nivel de acesso.
              </p>
            )}
          </div>
          {!editingUser && (
            <>
              <div className="grid gap-2">
                <Label htmlFor="senha">Senha</Label>
                <Input
                  id="senha"
                  type="password"
                  value={formData.senha}
                  onChange={(event) => onFormDataChange((prev) => ({ ...prev, senha: event.target.value }))}
                  placeholder="Minimo de 8 caracteres"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="confirmarSenha">Confirmar Senha</Label>
                <Input
                  id="confirmarSenha"
                  type="password"
                  value={formData.confirmarSenha}
                  onChange={(event) => onFormDataChange((prev) => ({ ...prev, confirmarSenha: event.target.value }))}
                  placeholder="Repita a senha"
                />
              </div>
            </>
          )}
          <div className="grid gap-2">
            <Label htmlFor="avatar">Iniciais do Avatar (opcional)</Label>
            <Input
              id="avatar"
              value={formData.avatar}
              onChange={(event) => onFormDataChange((prev) => ({ ...prev, avatar: event.target.value }))}
              placeholder="Ex: JC"
              maxLength={2}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="ativo">Usuario Ativo</Label>
            <Switch
              id="ativo"
              checked={formData.ativo}
              disabled={isEditingSelfAdmin}
              onCheckedChange={(checked) => onFormDataChange((prev) => ({ ...prev, ativo: checked }))}
            />
          </div>
          {isEditingSelfAdmin && (
            <p className="text-xs text-muted-foreground">
              O administrador nao pode desativar a propria conta.
            </p>
          )}
          {isEditingSelf && !isEditingSelfAdmin && (
            <p className="text-xs text-muted-foreground">
              Para evitar bloqueio acidental, a exclusao do proprio usuario nao fica disponivel nesta tela.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancelar
          </Button>
          <Button
            data-enter-confirm="true"
            onClick={onSubmit}
            pending={isSubmitting}
            disabled={
              isSubmitting ||
              !formData.nome ||
              !formData.email ||
              (!editingUser && (!formData.senha || !formData.confirmarSenha))
            }
          >
            {editingUser ? 'Salvar' : 'Criar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
