'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { CRMHeader } from '@/components/crm/header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Bell, Palette, Globe, Shield, Database, Mail } from 'lucide-react'
import { toast } from 'sonner'
import { useAppSettings } from '@/lib/context/app-settings-context'

export default function ConfiguracoesPage() {
  const {
    general,
    notifications,
    appearance,
    company,
    isLoading,
    setGeneral,
    setNotifications,
    setAppearance,
    setCompany,
    saveAll,
    requestNotificationPermission,
    canEditCompany,
  } = useAppSettings()
  const [isSaving, setIsSaving] = useState(false)
  const hasLoadedInitialSettings = useRef(false)
  const lastSavedSignatureRef = useRef('')
  const isSavingRef = useRef(false)

  const settingsSignature = useMemo(
    () =>
      JSON.stringify({
        general,
        notifications,
        appearance,
        company: canEditCompany ? company : null,
      }),
    [appearance, canEditCompany, company, general, notifications]
  )

  useEffect(() => {
    if (isLoading) return

    if (!hasLoadedInitialSettings.current) {
      hasLoadedInitialSettings.current = true
      lastSavedSignatureRef.current = settingsSignature
      return
    }

    if (!general.autoSave || settingsSignature === lastSavedSignatureRef.current) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      if (isSavingRef.current) return

      isSavingRef.current = true
      setIsSaving(true)

      void saveAll()
        .then(async () => {
          if (notifications.browser) {
            await requestNotificationPermission()
          }

          lastSavedSignatureRef.current = settingsSignature
        })
        .catch((error: any) => {
          toast.error(error?.message || 'Nao foi possivel salvar automaticamente as configuracoes.')
        })
        .finally(() => {
          isSavingRef.current = false
          setIsSaving(false)
        })
    }, 900)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [
    general.autoSave,
    isLoading,
    notifications.browser,
    requestNotificationPermission,
    saveAll,
    settingsSignature,
  ])

  const handleSave = async () => {
    if (isSaving) return

    isSavingRef.current = true
    setIsSaving(true)

    try {
      await saveAll()

      if (notifications.browser) {
        await requestNotificationPermission()
      }

      lastSavedSignatureRef.current = settingsSignature
      toast.success('Configuracoes salvas com sucesso!')
    } catch (error: any) {
      toast.error(error?.message || 'Nao foi possivel salvar as configuracoes.')
    } finally {
      isSavingRef.current = false
      setIsSaving(false)
    }
  }

  return (
    <>
      <CRMHeader
        title="Configuracoes"
        subtitle="Personalize o sistema de acordo com suas necessidades"
      />

      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-4xl mx-auto">
          <Tabs defaultValue="geral" className="space-y-6">
            <TabsList className="bg-secondary">
              <TabsTrigger value="geral">Geral</TabsTrigger>
              <TabsTrigger value="notificacoes">Notificacoes</TabsTrigger>
              <TabsTrigger value="aparencia">Aparencia</TabsTrigger>
              <TabsTrigger value="empresa">Empresa</TabsTrigger>
            </TabsList>

            <TabsContent value="geral" className="space-y-6">
              <Card className="bg-card border-border">
                <CardHeader>
                  <CardTitle className="text-foreground flex items-center gap-2">
                    <Database className="h-5 w-5" />
                    Configuracoes Gerais
                  </CardTitle>
                  <CardDescription>Configuracoes basicas do sistema</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label className="text-foreground">Modo de Demonstracao</Label>
                      <p className="text-sm text-muted-foreground">
                        Ativa um comportamento visual de ambiente de testes
                      </p>
                    </div>
                    <Switch
                      checked={general.demoMode}
                      onCheckedChange={(checked) => setGeneral({ ...general, demoMode: checked })}
                    />
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label className="text-foreground">Auto-save</Label>
                      <p className="text-sm text-muted-foreground">
                        Salva automaticamente alteracoes nas telas suportadas
                      </p>
                    </div>
                    <Switch
                      checked={general.autoSave}
                      onCheckedChange={(checked) => setGeneral({ ...general, autoSave: checked })}
                    />
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label className="text-foreground">Confirmar exclusoes</Label>
                      <p className="text-sm text-muted-foreground">
                        Exige confirmacao visual antes de excluir registros
                      </p>
                    </div>
                    <Switch
                      checked={general.confirmDeletes}
                      onCheckedChange={(checked) =>
                        setGeneral({ ...general, confirmDeletes: checked })
                      }
                    />
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-card border-border">
                <CardHeader>
                  <CardTitle className="text-foreground flex items-center gap-2">
                    <Shield className="h-5 w-5" />
                    Seguranca
                  </CardTitle>
                  <CardDescription>Configuracoes de seguranca e privacidade</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label className="text-foreground">Autenticacao em duas etapas</Label>
                      <p className="text-sm text-muted-foreground">
                        Preferencia salva para uso quando o fluxo de login for habilitado
                      </p>
                    </div>
                    <Switch
                      checked={general.twoFactor}
                      onCheckedChange={(checked) => setGeneral({ ...general, twoFactor: checked })}
                    />
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label className="text-foreground">Timeout de sessao</Label>
                      <p className="text-sm text-muted-foreground">
                        Tempo de inatividade antes de expirar a sessao
                      </p>
                    </div>
                    <Select
                      value={general.sessionTimeout}
                      onValueChange={(value) => setGeneral({ ...general, sessionTimeout: value })}
                    >
                      <SelectTrigger className="w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="15">15 min</SelectItem>
                        <SelectItem value="30">30 min</SelectItem>
                        <SelectItem value="60">1 hora</SelectItem>
                        <SelectItem value="120">2 horas</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="notificacoes" className="space-y-6">
              <Card className="bg-card border-border">
                <CardHeader>
                  <CardTitle className="text-foreground flex items-center gap-2">
                    <Bell className="h-5 w-5" />
                    Preferencias de Notificacao
                  </CardTitle>
                  <CardDescription>Escolha como deseja receber notificacoes</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label className="text-foreground">Notificacoes por E-mail</Label>
                      <p className="text-sm text-muted-foreground">
                        Preferencia salva para integracao com envio de emails
                      </p>
                    </div>
                    <Switch
                      checked={notifications.email}
                      onCheckedChange={(checked) =>
                        setNotifications({ ...notifications, email: checked })
                      }
                    />
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label className="text-foreground">Notificacoes do Navegador</Label>
                      <p className="text-sm text-muted-foreground">
                        Ativa alertas locais no navegador e no sino do topo
                      </p>
                    </div>
                    <Switch
                      checked={notifications.browser}
                      onCheckedChange={(checked) =>
                        setNotifications({ ...notifications, browser: checked })
                      }
                    />
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-card border-border">
                <CardHeader>
                  <CardTitle className="text-foreground">Tipos de Notificacao</CardTitle>
                  <CardDescription>
                    Escolha quais eventos devem aparecer nas notificacoes
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label className="text-foreground">Tarefas</Label>
                      <p className="text-sm text-muted-foreground">Prazos e atrasos</p>
                    </div>
                    <Switch
                      checked={notifications.tarefas}
                      onCheckedChange={(checked) =>
                        setNotifications({ ...notifications, tarefas: checked })
                      }
                    />
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label className="text-foreground">Propostas</Label>
                      <p className="text-sm text-muted-foreground">Pendencias comerciais</p>
                    </div>
                    <Switch
                      checked={notifications.propostas}
                      onCheckedChange={(checked) =>
                        setNotifications({ ...notifications, propostas: checked })
                      }
                    />
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label className="text-foreground">Novos Leads</Label>
                      <p className="text-sm text-muted-foreground">Leads sem proxima acao</p>
                    </div>
                    <Switch
                      checked={notifications.novosLeads}
                      onCheckedChange={(checked) =>
                        setNotifications({ ...notifications, novosLeads: checked })
                      }
                    />
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="aparencia" className="space-y-6">
              <Card className="bg-card border-border">
                <CardHeader>
                  <CardTitle className="text-foreground flex items-center gap-2">
                    <Palette className="h-5 w-5" />
                    Tema e Aparencia
                  </CardTitle>
                  <CardDescription>Personalize a aparencia do sistema</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label className="text-foreground">Tema</Label>
                      <p className="text-sm text-muted-foreground">
                        Aplicado imediatamente em toda a interface
                      </p>
                    </div>
                    <Select
                      value={appearance.tema}
                      onValueChange={(value) =>
                        setAppearance({
                          ...appearance,
                          tema: value as typeof appearance.tema,
                        })
                      }
                    >
                      <SelectTrigger className="w-40">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="escuro">Escuro</SelectItem>
                        <SelectItem value="claro">Claro</SelectItem>
                        <SelectItem value="sistema">Sistema</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-card border-border">
                <CardHeader>
                  <CardTitle className="text-foreground flex items-center gap-2">
                    <Globe className="h-5 w-5" />
                    Regionalizacao
                  </CardTitle>
                  <CardDescription>Configure idioma e formatos regionais</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label className="text-foreground">Idioma</Label>
                      <p className="text-sm text-muted-foreground">
                        Define o idioma base da interface e formatacoes
                      </p>
                    </div>
                    <Select
                      value={appearance.idioma}
                      onValueChange={(value) =>
                        setAppearance({
                          ...appearance,
                          idioma: value as typeof appearance.idioma,
                        })
                      }
                    >
                      <SelectTrigger className="w-40">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pt-BR">Portugues (BR)</SelectItem>
                        <SelectItem value="en-US">English (US)</SelectItem>
                        <SelectItem value="es-ES">Espanol</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label className="text-foreground">Formato de Data</Label>
                      <p className="text-sm text-muted-foreground">Preferencia salva no projeto</p>
                    </div>
                    <Select
                      value={appearance.formatoData}
                      onValueChange={(value) =>
                        setAppearance({
                          ...appearance,
                          formatoData: value as typeof appearance.formatoData,
                        })
                      }
                    >
                      <SelectTrigger className="w-40">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="dd/MM/yyyy">DD/MM/AAAA</SelectItem>
                        <SelectItem value="MM/dd/yyyy">MM/DD/AAAA</SelectItem>
                        <SelectItem value="yyyy-MM-dd">AAAA-MM-DD</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label className="text-foreground">Moeda</Label>
                      <p className="text-sm text-muted-foreground">
                        Utilizada nas formatacoes monetarias principais
                      </p>
                    </div>
                    <Select
                      value={appearance.formatoMoeda}
                      onValueChange={(value) =>
                        setAppearance({
                          ...appearance,
                          formatoMoeda: value as typeof appearance.formatoMoeda,
                        })
                      }
                    >
                      <SelectTrigger className="w-40">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="BRL">Real (R$)</SelectItem>
                        <SelectItem value="USD">Dolar (US$)</SelectItem>
                        <SelectItem value="EUR">Euro (EUR)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="empresa" className="space-y-6">
              <Card className="bg-card border-border">
                <CardHeader>
                  <CardTitle className="text-foreground flex items-center gap-2">
                    <Mail className="h-5 w-5" />
                    Dados da Empresa
                  </CardTitle>
                  <CardDescription>
                    Informacoes usadas em propostas e documentos
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {!canEditCompany && (
                    <p className="text-sm text-muted-foreground">
                      Apenas o administrador pode alterar os dados da empresa. As demais configuracoes continuam sendo pessoais.
                    </p>
                  )}
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="nomeEmpresa">Nome da Empresa</Label>
                      <Input
                        id="nomeEmpresa"
                        value={company.nome}
                        disabled={!canEditCompany}
                        onChange={(e) => setCompany({ ...company, nome: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="cnpj">CNPJ</Label>
                      <Input
                        id="cnpj"
                        value={company.cnpj}
                        disabled={!canEditCompany}
                        onChange={(e) => setCompany({ ...company, cnpj: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="telefoneEmpresa">Telefone</Label>
                      <Input
                        id="telefoneEmpresa"
                        value={company.telefone}
                        disabled={!canEditCompany}
                        onChange={(e) => setCompany({ ...company, telefone: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="emailEmpresa">E-mail</Label>
                      <Input
                        id="emailEmpresa"
                        type="email"
                        value={company.email}
                        disabled={!canEditCompany}
                        onChange={(e) => setCompany({ ...company, email: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="enderecoEmpresa">Endereco</Label>
                    <Input
                      id="enderecoEmpresa"
                      value={company.endereco}
                      disabled={!canEditCompany}
                      onChange={(e) => setCompany({ ...company, endereco: e.target.value })}
                    />
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>

          <div className="flex justify-end pt-4">
            <Button onClick={() => void handleSave()} size="lg" pending={isSaving} disabled={isLoading || isSaving}>
              Salvar Configuracoes
            </Button>
          </div>
        </div>
      </div>
    </>
  )
}
