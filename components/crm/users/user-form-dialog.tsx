'use client'

import {
  MODULE_KEYS,
  getDefaultModulePermissions,
  moduleLabels,
  normalizeModulePermissions,
} from '@/lib/auth/module-access'
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
  permissionMode: 'padrao' | 'personalizado'
  modulePermissions: ReturnType<typeof getDefaultModulePermissions>
}

interface UserFormDialogProps {
  open: boolean
  editingUser: Usuario | null
  isEditingSelfAdmin: boolean
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
  isSubmitting,
  formData,
  onOpenChange,
  onFormDataChange,
  onSubmit,
}: UserFormDialogProps) {
  const normalizedPermissions = normalizeModulePermissions(formData.modulePermissions, formData.role)

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
                  modulePermissions:
                    prev.permissionMode === 'padrao'
                      ? getDefaultModulePermissions(value)
                      : prev.modulePermissions,
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
          <div className="grid gap-2">
            <Label htmlFor="permission-mode">Modelo de Permissao</Label>
            <Select
              value={isEditingSelfAdmin || formData.role === 'admin' ? 'padrao' : formData.permissionMode}
              onValueChange={(value: 'padrao' | 'personalizado') =>
                onFormDataChange((prev) => ({
                  ...prev,
                  permissionMode: value,
                  modulePermissions:
                    value === 'padrao'
                      ? getDefaultModulePermissions(prev.role)
                      : normalizeModulePermissions(prev.modulePermissions, prev.role),
                }))
              }
              disabled={isEditingSelfAdmin || formData.role === 'admin'}
            >
              <SelectTrigger id="permission-mode">
                <SelectValue placeholder="Escolha o modelo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="padrao">Permissao predefinida</SelectItem>
                <SelectItem value="personalizado">Permissao personalizada</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              O admin sempre possui acesso total. Para os demais usuarios voce pode manter o padrao da funcao ou personalizar modulo por modulo.
            </p>
          </div>
          <div className="grid gap-3 rounded-lg border border-border p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-foreground">Modulos liberados</p>
                <p className="text-xs text-muted-foreground">Controle o que este usuario pode acessar na leftbar e nas paginas.</p>
              </div>
              {formData.permissionMode === 'personalizado' && formData.role !== 'admin' && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    onFormDataChange((prev) => ({
                      ...prev,
                      modulePermissions: getDefaultModulePermissions(prev.role),
                    }))
                  }
                >
                  Reaplicar padrao
                </Button>
              )}
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {MODULE_KEYS.map((moduleKey) => {
                const checked = formData.role === 'admin' ? true : normalizedPermissions[moduleKey]
                return (
                  <div key={moduleKey} className="flex items-center justify-between rounded-md bg-secondary/30 px-3 py-2">
                    <div>
                      <p className="text-sm font-medium text-foreground">{moduleLabels[moduleKey]}</p>
                      <p className="text-xs text-muted-foreground">
                        {checked ? 'Acesso liberado' : 'Acesso bloqueado'}
                      </p>
                    </div>
                    <Switch
                      checked={checked}
                      disabled={
                        formData.role === 'admin' ||
                        isEditingSelfAdmin ||
                        formData.permissionMode !== 'personalizado'
                      }
                      onCheckedChange={(nextChecked) =>
                        onFormDataChange((prev) => ({
                          ...prev,
                          modulePermissions: {
                            ...normalizeModulePermissions(prev.modulePermissions, prev.role),
                            [moduleKey]: nextChecked,
                          },
                        }))
                      }
                    />
                  </div>
                )
              })}
            </div>
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
              onCheckedChange={(checked) => onFormDataChange((prev) => ({ ...prev, ativo: checked }))}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancelar
          </Button>
          <Button
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
