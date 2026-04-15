"use client"

import { useState } from "react"
import {
  MODULE_KEYS,
  getDefaultModulePermissions,
  hasModuleAccess,
  moduleLabels,
  normalizeModulePermissions,
} from "@/lib/auth/module-access"
import { useCRM } from "@/lib/context/crm-context"
import { useAppSettings } from "@/lib/context/app-settings-context"
import { useSession } from "@/lib/hooks/use-api"
import type { RoleUsuario, Usuario } from "@/lib/data/types"
import { CRMHeader } from "@/components/crm/header"
import { ModuleAccessState } from "@/components/crm/module-access-state"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { MoreHorizontal, Pencil, Search, Shield, Trash2, User as UserIcon, Users } from "lucide-react"
import { toast } from "sonner"

export default function UsuariosPage() {
  const { state, addUsuario, updateUsuario, deleteUsuario } = useCRM()
  const { general } = useAppSettings()
  const { user: sessionUser } = useSession()
  const [search, setSearch] = useState("")
  const [roleFilter, setRoleFilter] = useState<string>("all")
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<Usuario | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [formData, setFormData] = useState({
    nome: "",
    email: "",
    role: "vendedor" as RoleUsuario,
    avatar: "",
    ativo: true,
    senha: "",
    confirmarSenha: "",
    permissionMode: "padrao" as "padrao" | "personalizado",
    modulePermissions: getDefaultModulePermissions("vendedor"),
  })

  const filteredUsers = state.usuarios.filter((user) => {
    const matchesSearch =
      user.nome.toLowerCase().includes(search.toLowerCase()) ||
      user.email.toLowerCase().includes(search.toLowerCase())
    const matchesRole = roleFilter === "all" || user.role === roleFilter
    return matchesSearch && matchesRole
  })

  const isEditingSelfAdmin =
    !!editingUser &&
    editingUser.id === sessionUser?.id &&
    editingUser.role === "admin"

  const handleOpenDialog = (user?: Usuario) => {
    if (user) {
      setEditingUser(user)
      setFormData({
        nome: user.nome,
        email: user.email,
        role: user.role,
        avatar: user.avatar || "",
        ativo: user.ativo,
        senha: "",
        confirmarSenha: "",
        permissionMode: "personalizado",
        modulePermissions: normalizeModulePermissions(user.modulePermissions, user.role),
      })
    } else {
      setEditingUser(null)
      setFormData({
        nome: "",
        email: "",
        role: "vendedor",
        avatar: "",
        ativo: true,
        senha: "",
        confirmarSenha: "",
        permissionMode: "padrao",
        modulePermissions: getDefaultModulePermissions("vendedor"),
      })
    }
    setIsDialogOpen(true)
  }

  const handleSubmit = async () => {
    if (isSubmitting) return

    if (!editingUser) {
      if (formData.senha.length < 8) {
        toast.error("A senha deve ter no minimo 8 caracteres.")
        return
      }

      if (formData.senha !== formData.confirmarSenha) {
        toast.error("A confirmacao de senha nao confere.")
        return
      }
    }

    const modulePermissions =
      formData.permissionMode === "padrao"
        ? getDefaultModulePermissions(formData.role)
        : normalizeModulePermissions(formData.modulePermissions, formData.role)

    setIsSubmitting(true)

    try {
      if (editingUser) {
        await updateUsuario({
          ...editingUser,
          nome: formData.nome,
          email: formData.email,
          role: formData.role,
          avatar: formData.avatar,
          ativo: formData.ativo,
          modulePermissions,
        })
        toast.success("Usuario atualizado com sucesso.")
      } else {
        await addUsuario({
          nome: formData.nome,
          email: formData.email,
          role: formData.role,
          avatar: formData.avatar,
          ativo: formData.ativo,
          senha: formData.senha,
          modulePermissions,
        })
        toast.success("Usuario criado com sucesso.")
      }

      setIsDialogOpen(false)
      setFormData((prev) => ({ ...prev, senha: "", confirmarSenha: "" }))
    } catch (error: any) {
      toast.error(error?.message || "Nao foi possivel salvar o usuario.")
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDelete = (id: string) => {
    if (!general.confirmDeletes || confirm("Tem certeza que deseja excluir este usuario?")) {
      void deleteUsuario(id)
        .then(() => {
          toast.success("Usuario excluido com sucesso.")
        })
        .catch((error: any) => {
          toast.error(error?.message || "Nao foi possivel excluir o usuario.")
        })
    }
  }

  const getRoleBadge = (role: RoleUsuario) => {
    const styles = {
      admin: "bg-purple-500/20 text-purple-400 border-purple-500/30",
      gerente: "bg-blue-500/20 text-blue-400 border-blue-500/30",
      vendedor: "bg-green-500/20 text-green-400 border-green-500/30",
      orcamentista: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    }
    const labels = {
      admin: "Administrador",
      gerente: "Gerente",
      vendedor: "Vendedor",
      orcamentista: "Orcamentista",
    }
    return <Badge variant="outline" className={styles[role]}>{labels[role]}</Badge>
  }

  const getRoleIcon = (role: RoleUsuario) => {
    switch (role) {
      case "admin":
        return <Shield className="h-4 w-4" />
      case "gerente":
        return <Users className="h-4 w-4" />
      case "orcamentista":
        return <UserIcon className="h-4 w-4" />
      default:
        return <UserIcon className="h-4 w-4" />
    }
  }

  if (!hasModuleAccess(sessionUser, "usuarios")) {
    return <ModuleAccessState module="usuarios" />
  }

  const totalUsers = state.usuarios.length
  const activeUsers = state.usuarios.filter((u) => u.ativo).length
  const adminCount = state.usuarios.filter((u) => u.role === "admin").length
  const gerenteCount = state.usuarios.filter((u) => u.role === "gerente").length
  const vendedorCount = state.usuarios.filter((u) => u.role === "vendedor").length
  const orcamentistaCount = state.usuarios.filter((u) => u.role === "orcamentista").length

  return (
    <>
      <CRMHeader
        title="Usuarios"
        subtitle="Gerencie os usuarios e permissoes do sistema"
        action={{ label: "Novo Usuario", onClick: () => handleOpenDialog() }}
      />

      <div className="flex-1 overflow-auto p-6 space-y-6">
        <div className="grid gap-4 md:grid-cols-6">
          <SummaryCard title="Total" value={totalUsers} icon={<Users className="h-4 w-4 text-muted-foreground" />} />
          <SummaryCard title="Ativos" value={activeUsers} icon={<div className="h-2 w-2 rounded-full bg-green-500" />} />
          <SummaryCard title="Admins" value={adminCount} icon={<Shield className="h-4 w-4 text-purple-400" />} />
          <SummaryCard title="Gerentes" value={gerenteCount} icon={<Users className="h-4 w-4 text-blue-400" />} />
          <SummaryCard title="Vendedores" value={vendedorCount} icon={<UserIcon className="h-4 w-4 text-green-400" />} />
          <SummaryCard title="Orcamentistas" value={orcamentistaCount} icon={<UserIcon className="h-4 w-4 text-amber-400" />} />
        </div>

        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-foreground">Lista de Usuarios</CardTitle>
            <CardDescription>Gerencie todos os usuarios do sistema</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-4 flex flex-col gap-4 sm:flex-row">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Buscar por nome ou e-mail..."
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  className="pl-10"
                />
              </div>
              <Select value={roleFilter} onValueChange={setRoleFilter}>
                <SelectTrigger className="w-full sm:w-[180px]">
                  <SelectValue placeholder="Filtrar por funcao" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as funcoes</SelectItem>
                  <SelectItem value="admin">Administrador</SelectItem>
                  <SelectItem value="gerente">Gerente</SelectItem>
                  <SelectItem value="vendedor">Vendedor</SelectItem>
                  <SelectItem value="orcamentista">Orcamentista</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-secondary/50 hover:bg-secondary/50">
                    <TableHead className="text-foreground">Usuario</TableHead>
                    <TableHead className="text-foreground">E-mail</TableHead>
                    <TableHead className="text-foreground">Funcao</TableHead>
                    <TableHead className="text-foreground">Status</TableHead>
                    <TableHead className="w-[50px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredUsers.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                        Nenhum usuario encontrado.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredUsers.map((user) => (
                      <TableRow key={user.id}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <Avatar className="h-9 w-9">
                              <AvatarFallback className="bg-primary/20 text-primary">
                                {user.avatar || user.nome.split(" ").map((parte) => parte[0]).join("").toUpperCase().slice(0, 2)}
                              </AvatarFallback>
                            </Avatar>
                            <div className="flex items-center gap-2">
                              {getRoleIcon(user.role)}
                              <span className="font-medium text-foreground">{user.nome}</span>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{user.email}</TableCell>
                        <TableCell>{getRoleBadge(user.role)}</TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={user.ativo ? "bg-green-500/20 text-green-400 border-green-500/30" : "bg-red-500/20 text-red-400 border-red-500/30"}
                          >
                            {user.ativo ? "Ativo" : "Inativo"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => handleOpenDialog(user)}>
                                <Pencil className="mr-2 h-4 w-4" />
                                Editar
                              </DropdownMenuItem>
                              {user.role !== "admin" && (
                                <DropdownMenuItem onClick={() => handleDelete(user.id)} className="text-destructive">
                                  <Trash2 className="mr-2 h-4 w-4" />
                                  Excluir
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>{editingUser ? "Editar Usuario" : "Novo Usuario"}</DialogTitle>
            <DialogDescription>
              {editingUser ? "Atualize as informacoes do usuario" : "Preencha os dados para criar um novo usuario"}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="nome">Nome</Label>
              <Input id="nome" value={formData.nome} onChange={(event) => setFormData({ ...formData, nome: event.target.value })} placeholder="Nome completo" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="email">E-mail</Label>
              <Input id="email" type="email" value={formData.email} onChange={(event) => setFormData({ ...formData, email: event.target.value })} placeholder="email@exemplo.com" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="role">Funcao</Label>
              <Select
                value={formData.role}
                onValueChange={(value: RoleUsuario) =>
                  setFormData((prev) => ({
                    ...prev,
                    role: value,
                    modulePermissions:
                      prev.permissionMode === "padrao"
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
                value={isEditingSelfAdmin || formData.role === "admin" ? "padrao" : formData.permissionMode}
                onValueChange={(value: "padrao" | "personalizado") =>
                  setFormData((prev) => ({
                    ...prev,
                    permissionMode: value,
                    modulePermissions:
                      value === "padrao"
                        ? getDefaultModulePermissions(prev.role)
                        : normalizeModulePermissions(prev.modulePermissions, prev.role),
                  }))
                }
                disabled={isEditingSelfAdmin || formData.role === "admin"}
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
                {formData.permissionMode === "personalizado" && formData.role !== "admin" && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setFormData((prev) => ({
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
                  const checked =
                    formData.role === "admin"
                      ? true
                      : normalizeModulePermissions(formData.modulePermissions, formData.role)[moduleKey]
                  return (
                    <div key={moduleKey} className="flex items-center justify-between rounded-md bg-secondary/30 px-3 py-2">
                      <div>
                        <p className="text-sm font-medium text-foreground">{moduleLabels[moduleKey]}</p>
                        <p className="text-xs text-muted-foreground">
                          {checked ? "Acesso liberado" : "Acesso bloqueado"}
                        </p>
                      </div>
                      <Switch
                        checked={checked}
                        disabled={
                          formData.role === "admin" ||
                          isEditingSelfAdmin ||
                          formData.permissionMode !== "personalizado"
                        }
                        onCheckedChange={(nextChecked) =>
                          setFormData((prev) => ({
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
                  <Input id="senha" type="password" value={formData.senha} onChange={(event) => setFormData({ ...formData, senha: event.target.value })} placeholder="Minimo de 8 caracteres" />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="confirmarSenha">Confirmar Senha</Label>
                  <Input id="confirmarSenha" type="password" value={formData.confirmarSenha} onChange={(event) => setFormData({ ...formData, confirmarSenha: event.target.value })} placeholder="Repita a senha" />
                </div>
              </>
            )}
            <div className="grid gap-2">
              <Label htmlFor="avatar">Iniciais do Avatar (opcional)</Label>
              <Input id="avatar" value={formData.avatar} onChange={(event) => setFormData({ ...formData, avatar: event.target.value })} placeholder="Ex: JC" maxLength={2} />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="ativo">Usuario Ativo</Label>
              <Switch id="ativo" checked={formData.ativo} onCheckedChange={(checked) => setFormData({ ...formData, ativo: checked })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)} disabled={isSubmitting}>Cancelar</Button>
            <Button
              onClick={handleSubmit}
              pending={isSubmitting}
              disabled={
                isSubmitting ||
                !formData.nome ||
                !formData.email ||
                (!editingUser && (!formData.senha || !formData.confirmarSenha))
              }
            >
              {editingUser ? "Salvar" : "Criar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function SummaryCard({ title, value, icon }: { title: string; value: number; icon: React.ReactNode }) {
  return (
    <Card className="bg-card border-border">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-foreground">{title}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold text-foreground">{value}</div>
      </CardContent>
    </Card>
  )
}
