import { CRMProvider } from '@/lib/context/crm-context'
import { AppSettingsProvider } from '@/lib/context/app-settings-context'
import { CRMSidebar } from '@/components/crm/sidebar'
import { getAuthenticatedServerUser, getServerSession } from '@/lib/auth/session'
import { redirect } from 'next/navigation'
import { SWRConfig } from 'swr'

export default async function CRMLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await getServerSession()
  const authenticatedUser = await getAuthenticatedServerUser().catch(() => {
    if (!session) {
      return null
    }

    return {
      id: session.userId,
      nome: undefined,
      email: undefined,
      avatar: undefined,
      role: session.role,
      ativo: true,
      modulePermissions: null,
    }
  })
  if (!authenticatedUser?.ativo) {
    redirect('/login')
  }

  const sessionFallback = {
    user: {
      id: authenticatedUser.id,
      nome: authenticatedUser.nome ?? '',
      email: authenticatedUser.email ?? '',
      avatar: authenticatedUser.avatar ?? '',
      role: authenticatedUser.role,
      ativo: authenticatedUser.ativo,
      modulePermissions: authenticatedUser.modulePermissions ?? null,
    },
  }

  return (
    <SWRConfig
      value={{
        revalidateOnFocus: false,
        revalidateOnReconnect: false,
        revalidateIfStale: false,
        keepPreviousData: true,
        dedupingInterval: 30000,
        focusThrottleInterval: 60000,
        loadingTimeout: 10000,
        errorRetryCount: 0,
        shouldRetryOnError: false,
        fallback: {
          '/api/auth/session': sessionFallback,
        },
      }}
    >
        <AppSettingsProvider>
          <CRMProvider>
            <div className="flex min-h-screen bg-background">
              <CRMSidebar />
              <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
                {children}
              </main>
            </div>
          </CRMProvider>
      </AppSettingsProvider>
    </SWRConfig>
  )
}
