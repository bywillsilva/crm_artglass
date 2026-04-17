'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

export default function LoginPage() {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)
  const [appName, setAppName] = useState('CRM')

  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [twoFactorToken, setTwoFactorToken] = useState('')
  const [twoFactorChallengeId, setTwoFactorChallengeId] = useState<string | null>(null)
  const [twoFactorEmailMask, setTwoFactorEmailMask] = useState('')
  const [twoFactorDialogOpen, setTwoFactorDialogOpen] = useState(false)

  const [registerName, setRegisterName] = useState('')
  const [registerEmail, setRegisterEmail] = useState('')
  const [registerToken, setRegisterToken] = useState('')
  const [registerPassword, setRegisterPassword] = useState('')
  const [registerPasswordConfirm, setRegisterPasswordConfirm] = useState('')
  const [registerTokenRequested, setRegisterTokenRequested] = useState(false)
  const [registerTokenDialogOpen, setRegisterTokenDialogOpen] = useState(false)

  const [resetEmail, setResetEmail] = useState('')
  const [resetToken, setResetToken] = useState('')
  const [resetPassword, setResetPassword] = useState('')
  const [resetPasswordConfirm, setResetPasswordConfirm] = useState('')
  const [resetTokenRequested, setResetTokenRequested] = useState(false)
  const [resetTokenDialogOpen, setResetTokenDialogOpen] = useState(false)

  useEffect(() => {
    let isMounted = true

    const loadCompany = async () => {
      try {
        const response = await fetch('/api/configuracoes?chave=empresa')
        const data = await response.json()
        const companyName = data?.valor?.nome || data?.nome || 'CRM'

        if (isMounted) {
          setAppName(companyName)
          document.title = `${companyName} - Acesso`
        }
      } catch {
        if (isMounted) {
          document.title = 'CRM - Acesso'
        }
      }
    }

    void loadCompany()

    return () => {
      isMounted = false
    }
  }, [])

  const handleLogin = async () => {
    setIsLoading(true)
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, senha }),
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data?.error || 'Falha no login')
      }

      if (data?.requiresTwoFactor) {
        setTwoFactorChallengeId(data.challengeId)
        setTwoFactorEmailMask(data.emailMask || email)
        setTwoFactorToken('')
        setTwoFactorDialogOpen(true)
        toast.success('Enviamos um codigo de verificacao para o seu e-mail.')
        return
      }

      toast.success('Login realizado com sucesso!')
      router.push('/dashboard')
      router.refresh()
    } catch (error: any) {
      toast.error(error.message || 'Nao foi possivel entrar')
    } finally {
      setIsLoading(false)
    }
  }

  const handleVerifyTwoFactor = async () => {
    if (!twoFactorChallengeId || !twoFactorToken) {
      toast.error('Informe o codigo de verificacao recebido por e-mail.')
      return
    }

    setIsLoading(true)
    try {
      const response = await fetch('/api/auth/verify-login-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challengeId: twoFactorChallengeId,
          token: twoFactorToken,
        }),
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data?.error || 'Falha ao validar o codigo')
      }

      toast.success('Login realizado com sucesso!')
      setTwoFactorDialogOpen(false)
      router.push('/dashboard')
      router.refresh()
    } catch (error: any) {
      toast.error(error.message || 'Nao foi possivel validar o codigo')
    } finally {
      setIsLoading(false)
    }
  }

  const handleRegister = async () => {
    if (registerPassword.length < 8) {
      toast.error('A senha deve ter no minimo 8 caracteres.')
      return
    }

    if (registerPassword !== registerPasswordConfirm) {
      toast.error('A confirmacao de senha nao confere.')
      return
    }

    setIsLoading(true)
    try {
      const response = await fetch('/api/auth/request-register-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome: registerName,
          email: registerEmail,
          senha: registerPassword,
        }),
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data?.error || 'Falha ao solicitar token de cadastro')
      }

      setRegisterTokenRequested(true)
      setRegisterTokenDialogOpen(true)
      toast.success('Enviamos um token de confirmacao para o seu e-mail.')
    } catch (error: any) {
      toast.error(error.message || 'Nao foi possivel solicitar o token')
    } finally {
      setIsLoading(false)
    }
  }

  const handleConfirmRegister = async () => {
    if (!registerToken) {
      toast.error('Informe o token recebido por e-mail.')
      return
    }

    setIsLoading(true)
    try {
      const response = await fetch('/api/auth/confirm-register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: registerEmail,
          token: registerToken,
        }),
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data?.error || 'Falha ao confirmar cadastro')
      }

      toast.success('Conta criada com sucesso!')
      router.push('/dashboard')
      router.refresh()
    } catch (error: any) {
      toast.error(error.message || 'Nao foi possivel confirmar o cadastro')
    } finally {
      setIsLoading(false)
    }
  }

  const handleRequestResetToken = async () => {
    if (!resetEmail) return

    setIsLoading(true)
    try {
      const response = await fetch('/api/auth/request-password-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: resetEmail }),
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data?.error || 'Falha ao solicitar token')
      }

      setResetTokenRequested(true)
      setResetTokenDialogOpen(true)
      toast.success('Se existir uma conta com este e-mail, enviamos um token temporario.')
    } catch (error: any) {
      toast.error(error.message || 'Nao foi possivel solicitar o token')
    } finally {
      setIsLoading(false)
    }
  }

  const handleResetPassword = async () => {
    if (resetPassword.length < 8) {
      toast.error('A nova senha deve ter no minimo 8 caracteres.')
      return
    }

    if (resetPassword !== resetPasswordConfirm) {
      toast.error('A confirmacao da nova senha nao confere.')
      return
    }

    setIsLoading(true)
    try {
      const response = await fetch('/api/auth/confirm-password-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: resetEmail,
          token: resetToken,
          novaSenha: resetPassword,
        }),
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data?.error || 'Falha ao redefinir senha')
      }

      setEmail(resetEmail)
      setSenha('')
      setResetToken('')
      setResetPassword('')
      setResetPasswordConfirm('')
      setResetTokenRequested(false)
      setResetTokenDialogOpen(false)
      toast.success('Senha redefinida com sucesso. Agora voce ja pode entrar.')
    } catch (error: any) {
      toast.error(error.message || 'Nao foi possivel redefinir a senha')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md border-border bg-card">
        <CardHeader>
          <CardTitle>Entrar no {appName}</CardTitle>
          <CardDescription>Acesse, cadastre sua conta ou recupere seu acesso</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="login" className="space-y-4">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="login">Entrar</TabsTrigger>
              <TabsTrigger value="register">Cadastro</TabsTrigger>
              <TabsTrigger value="reset">Recuperar</TabsTrigger>
            </TabsList>

            <TabsContent value="login" className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">E-mail</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="seu@email.com"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="senha">Senha</Label>
                <Input
                  id="senha"
                  type="password"
                  value={senha}
                  onChange={(event) => setSenha(event.target.value)}
                  placeholder="Sua senha"
                />
              </div>
              <Button onClick={handleLogin} className="w-full" disabled={isLoading || !email || !senha}>
                {isLoading ? 'Entrando...' : 'Entrar'}
              </Button>
            </TabsContent>

            <TabsContent value="register" className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="register-name">Nome</Label>
                <Input
                  id="register-name"
                  value={registerName}
                  onChange={(event) => setRegisterName(event.target.value)}
                  placeholder="Seu nome"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="register-email">E-mail</Label>
                <Input
                  id="register-email"
                  type="email"
                  value={registerEmail}
                  onChange={(event) => setRegisterEmail(event.target.value)}
                  placeholder="seu@email.com"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="register-password">Senha</Label>
                <Input
                  id="register-password"
                  type="password"
                  value={registerPassword}
                  onChange={(event) => setRegisterPassword(event.target.value)}
                  placeholder="Minimo de 8 caracteres"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="register-password-confirm">Confirmar Senha</Label>
                <Input
                  id="register-password-confirm"
                  type="password"
                  value={registerPasswordConfirm}
                  onChange={(event) => setRegisterPasswordConfirm(event.target.value)}
                  placeholder="Repita a senha"
                />
              </div>
              <div className="grid gap-2">
                <Button
                  onClick={handleRegister}
                  className="w-full"
                  disabled={
                    isLoading ||
                    !registerName ||
                    !registerEmail ||
                    !registerPassword ||
                    !registerPasswordConfirm
                  }
                >
                  {isLoading ? 'Enviando token...' : registerTokenRequested ? 'Reenviar Token de Cadastro' : 'Enviar Token de Cadastro'}
                </Button>
                {registerTokenRequested && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setRegisterTokenDialogOpen(true)}
                    disabled={isLoading}
                  >
                    Abrir confirmacao do token
                  </Button>
                )}
              </div>
            </TabsContent>

            <TabsContent value="reset" className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="reset-email">E-mail da Conta</Label>
                <Input
                  id="reset-email"
                  type="email"
                  value={resetEmail}
                  onChange={(event) => setResetEmail(event.target.value)}
                  placeholder="seu@email.com"
                />
              </div>
              <div className="grid gap-2">
                <Button
                  onClick={handleRequestResetToken}
                  className="w-full"
                  disabled={isLoading || !resetEmail}
                >
                  {isLoading ? 'Enviando token...' : resetTokenRequested ? 'Reenviar Token por E-mail' : 'Enviar Token por E-mail'}
                </Button>
                {resetTokenRequested && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setResetTokenDialogOpen(true)}
                    disabled={isLoading}
                  >
                    Abrir redefinicao com token
                  </Button>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Dialog open={registerTokenDialogOpen} onOpenChange={setRegisterTokenDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Confirmar Cadastro</DialogTitle>
            <DialogDescription>
              Digite o token recebido por e-mail para concluir a criacao da conta.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="register-token">Token de Confirmacao</Label>
              <Input
                id="register-token"
                value={registerToken}
                onChange={(event) => setRegisterToken(event.target.value)}
                placeholder="Digite o token recebido"
              />
            </div>
            <div className="grid gap-2">
              <Button
                onClick={handleConfirmRegister}
                className="w-full"
                disabled={isLoading || !registerEmail || !registerToken}
              >
                {isLoading ? 'Confirmando...' : 'Confirmar Token e Criar Conta'}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setRegisterTokenRequested(false)
                  setRegisterTokenDialogOpen(false)
                  setRegisterToken('')
                }}
                disabled={isLoading}
              >
                Solicitar Novo Token
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={resetTokenDialogOpen} onOpenChange={setResetTokenDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Redefinir Senha</DialogTitle>
            <DialogDescription>
              Informe o token recebido e a nova senha para concluir a recuperacao do acesso.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="reset-token">Token Recebido</Label>
              <Input
                id="reset-token"
                value={resetToken}
                onChange={(event) => setResetToken(event.target.value)}
                placeholder="Digite o token de 6 digitos"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reset-password">Nova Senha</Label>
              <Input
                id="reset-password"
                type="password"
                value={resetPassword}
                onChange={(event) => setResetPassword(event.target.value)}
                placeholder="Minimo de 8 caracteres"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reset-password-confirm">Confirmar Nova Senha</Label>
              <Input
                id="reset-password-confirm"
                type="password"
                value={resetPasswordConfirm}
                onChange={(event) => setResetPasswordConfirm(event.target.value)}
                placeholder="Repita a nova senha"
              />
            </div>
            <div className="grid gap-2">
              <Button
                onClick={handleResetPassword}
                className="w-full"
                disabled={
                  isLoading ||
                  !resetEmail ||
                  !resetToken ||
                  !resetPassword ||
                  !resetPasswordConfirm
                }
              >
                {isLoading ? 'Confirmando...' : 'Confirmar Token e Redefinir'}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setResetTokenRequested(false)
                  setResetTokenDialogOpen(false)
                  setResetToken('')
                  setResetPassword('')
                  setResetPasswordConfirm('')
                }}
                disabled={isLoading}
              >
                Solicitar Novo Token
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={twoFactorDialogOpen} onOpenChange={setTwoFactorDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Verificacao em duas etapas</DialogTitle>
            <DialogDescription>
              Digite o codigo enviado para {twoFactorEmailMask || 'o seu e-mail'} para concluir o acesso.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="two-factor-token">Codigo de verificacao</Label>
              <Input
                id="two-factor-token"
                inputMode="numeric"
                value={twoFactorToken}
                onChange={(event) => setTwoFactorToken(event.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="Digite os 6 digitos"
              />
            </div>
            <Button
              onClick={handleVerifyTwoFactor}
              className="w-full"
              disabled={isLoading || twoFactorToken.length < 6}
            >
              {isLoading ? 'Validando...' : 'Confirmar acesso'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
