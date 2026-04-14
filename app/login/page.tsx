'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

export default function LoginPage() {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)
  const [appName, setAppName] = useState('CRM')

  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')

  const [registerName, setRegisterName] = useState('')
  const [registerEmail, setRegisterEmail] = useState('')
  const [registerToken, setRegisterToken] = useState('')
  const [registerPassword, setRegisterPassword] = useState('')
  const [registerPasswordConfirm, setRegisterPasswordConfirm] = useState('')
  const [registerTokenRequested, setRegisterTokenRequested] = useState(false)

  const [resetEmail, setResetEmail] = useState('')
  const [resetToken, setResetToken] = useState('')
  const [resetPassword, setResetPassword] = useState('')
  const [resetPasswordConfirm, setResetPasswordConfirm] = useState('')
  const [resetTokenRequested, setResetTokenRequested] = useState(false)

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

      toast.success('Login realizado com sucesso!')
      router.push('/dashboard')
      router.refresh()
    } catch (error: any) {
      toast.error(error.message || 'Nao foi possivel entrar')
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
              {!registerTokenRequested ? (
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
                  {isLoading ? 'Enviando token...' : 'Enviar Token de Cadastro'}
                </Button>
              ) : (
                <>
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
                        setRegisterToken('')
                      }}
                      disabled={isLoading}
                    >
                      Solicitar Novo Token
                    </Button>
                  </div>
                </>
              )}
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
              {!resetTokenRequested ? (
                <Button
                  onClick={handleRequestResetToken}
                  className="w-full"
                  disabled={isLoading || !resetEmail}
                >
                  {isLoading ? 'Enviando token...' : 'Enviar Token por E-mail'}
                </Button>
              ) : (
                <>
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
                        setResetToken('')
                        setResetPassword('')
                        setResetPasswordConfirm('')
                      }}
                      disabled={isLoading}
                    >
                      Solicitar Novo Token
                    </Button>
                  </div>
                </>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  )
}
