'use client'

import {
  MODULE_KEYS,
  getDefaultModulePermissions,
  moduleLabels,
  normalizeModulePermissions,
} from '@/lib/auth/module-access'
import {
  RULE_GROUPS,
  getDefaultRulePermissions,
  normalizeRulePermissions,
  ruleDescriptions,
  ruleLabels,
} from '@/lib/auth/rule-access'
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
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'

export type UserAccessState = {
  modulePermissionMode: 'padrao' | 'personalizado'
  modulePermissions: ReturnType<typeof getDefaultModulePermissions>
  rulePermissionMode: 'padrao' | 'personalizado'
  rulePermissions: ReturnType<typeof getDefaultRulePermissions>
}

interface UserAccessDialogProps {
  open: boolean
  user: Usuario | null
  isEditingSelfAdmin: boolean
  isSubmitting: boolean
  accessData: UserAccessState
  onOpenChange: (open: boolean) => void
  onAccessDataChange: (updater: UserAccessState | ((prev: UserAccessState) => UserAccessState)) => void
  onSubmit: () => void
}

export function UserAccessDialog({
  open,
  user,
  isEditingSelfAdmin,
  isSubmitting,
  accessData,
  onOpenChange,
  onAccessDataChange,
  onSubmit,
}: UserAccessDialogProps) {
  const role = (user?.role || 'vendedor') as RoleUsuario
  const normalizedModulePermissions = normalizeModulePermissions(accessData.modulePermissions, role)
  const normalizedRulePermissions = normalizeRulePermissions(accessData.rulePermissions, role)
  const lockModulePermissions = role === 'admin' || isEditingSelfAdmin

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-[760px]">
        <DialogHeader>
          <DialogTitle>Definir acessos do usuario</DialogTitle>
          <DialogDescription>
            Ajuste modulos liberados e regras operacionais para {user?.nome || 'este usuario'} sem misturar isso
            com o formulario basico de cadastro.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-2">
          <section className="space-y-4 rounded-xl border border-border p-4">
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">Modulos liberados</p>
              <p className="text-xs text-muted-foreground">
                Controla o que aparece na navegacao e quais paginas este usuario pode acessar.
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="module-permission-mode">Modelo de modulos</Label>
              <Select
                value={lockModulePermissions ? 'padrao' : accessData.modulePermissionMode}
                onValueChange={(value: 'padrao' | 'personalizado') =>
                  onAccessDataChange((prev) => ({
                    ...prev,
                    modulePermissionMode: value,
                    modulePermissions:
                      value === 'padrao'
                        ? getDefaultModulePermissions(role)
                        : normalizeModulePermissions(prev.modulePermissions, role),
                  }))
                }
                disabled={lockModulePermissions}
              >
                <SelectTrigger id="module-permission-mode">
                  <SelectValue placeholder="Escolha o modelo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="padrao">Permissao predefinida</SelectItem>
                  <SelectItem value="personalizado">Permissao personalizada</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {lockModulePermissions
                  ? 'O administrador logado nao pode reduzir o proprio acesso aos modulos nesta tela.'
                  : 'Use o padrao da funcao ou personalize modulo por modulo.'}
              </p>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              {MODULE_KEYS.map((moduleKey) => {
                const checked = role === 'admin' ? true : normalizedModulePermissions[moduleKey]
                return (
                  <div
                    key={moduleKey}
                    className="flex items-center justify-between rounded-md bg-secondary/30 px-3 py-2"
                  >
                    <div>
                      <p className="text-sm font-medium text-foreground">{moduleLabels[moduleKey]}</p>
                      <p className="text-xs text-muted-foreground">
                        {checked ? 'Acesso liberado' : 'Acesso bloqueado'}
                      </p>
                    </div>
                    <Switch
                      checked={checked}
                      disabled={lockModulePermissions || accessData.modulePermissionMode !== 'personalizado'}
                      onCheckedChange={(nextChecked) =>
                        onAccessDataChange((prev) => ({
                          ...prev,
                          modulePermissions: {
                            ...normalizeModulePermissions(prev.modulePermissions, role),
                            [moduleKey]: nextChecked,
                          },
                        }))
                      }
                    />
                  </div>
                )
              })}
            </div>
          </section>

          <section className="space-y-4 rounded-xl border border-border p-4">
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">Regras operacionais</p>
              <p className="text-xs text-muted-foreground">
                Define quais regras de negocio o usuario precisa obedecer e quais podem ficar opcionais.
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="rule-permission-mode">Modelo de regras</Label>
              <Select
                value={accessData.rulePermissionMode}
                onValueChange={(value: 'padrao' | 'personalizado') =>
                  onAccessDataChange((prev) => ({
                    ...prev,
                    rulePermissionMode: value,
                    rulePermissions:
                      value === 'padrao'
                        ? getDefaultRulePermissions(role)
                        : normalizeRulePermissions(prev.rulePermissions, role),
                  }))
                }
                disabled={role === 'admin' && isEditingSelfAdmin}
              >
                <SelectTrigger id="rule-permission-mode">
                  <SelectValue placeholder="Escolha o modelo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="padrao">Regras predefinidas</SelectItem>
                  <SelectItem value="personalizado">Regras personalizadas</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Quando desligada, a regra deixa de ser exigida para este usuario. Quando ligada, a regra volta a
                ser aplicada normalmente.
              </p>
            </div>

            <div className="space-y-4">
              {RULE_GROUPS.map((group) => (
                <div key={group.key} className="space-y-3 rounded-lg border border-border/60 p-3">
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-foreground">{group.title}</p>
                    <p className="text-xs leading-5 text-muted-foreground">{group.description}</p>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    {group.rules.map((ruleKey) => {
                      const checked = normalizedRulePermissions[ruleKey]
                      return (
                        <div
                          key={ruleKey}
                          className="flex items-start justify-between gap-4 rounded-md bg-secondary/30 px-3 py-3"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-foreground">{ruleLabels[ruleKey]}</p>
                            <p className="mt-1 text-xs leading-5 text-muted-foreground">
                              {ruleDescriptions[ruleKey]}
                            </p>
                          </div>
                          <Switch
                            checked={checked}
                            disabled={accessData.rulePermissionMode !== 'personalizado'}
                            onCheckedChange={(nextChecked) =>
                              onAccessDataChange((prev) => ({
                                ...prev,
                                rulePermissions: {
                                  ...normalizeRulePermissions(prev.rulePermissions, role),
                                  [ruleKey]: nextChecked,
                                },
                              }))
                            }
                          />
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancelar
          </Button>
          <Button type="button" onClick={onSubmit} pending={isSubmitting} disabled={isSubmitting || !user}>
            Salvar acessos
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
