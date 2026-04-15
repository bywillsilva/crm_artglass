import { CRMProvider } from '@/lib/context/crm-context'
import { AppSettingsProvider } from '@/lib/context/app-settings-context'
import { CRMSidebar } from '@/components/crm/sidebar'
import { getServerSession } from '@/lib/auth/session'
import { redirect } from 'next/navigation'
import { SWRConfig } from 'swr'

export default async function CRMLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await getServerSession()
  if (!session) {
    redirect('/login')
  }

  return (
    <AppSettingsProvider>
      <SWRConfig
        value={{
          revalidateOnFocus: false,
          revalidateOnReconnect: false,
          keepPreviousData: true,
          dedupingInterval: 5000,
          focusThrottleInterval: 15000,
          errorRetryCount: 0,
          shouldRetryOnError: false,
        }}
      >
        <CRMProvider>
          <div className="flex min-h-screen bg-background">
            <CRMSidebar />
            <main className="flex-1 flex flex-col overflow-hidden">
              {children}
            </main>
          </div>
        </CRMProvider>
      </SWRConfig>
    </AppSettingsProvider>
  )
}
