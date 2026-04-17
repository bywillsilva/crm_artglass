import { redirect } from 'next/navigation'
import { getServerSession } from '@/lib/auth/session'
import { getDefaultRouteForRole } from '@/lib/auth/default-route'

export default async function Home() {
  const session = await getServerSession()
  redirect(session ? getDefaultRouteForRole(session.role) : '/login')
}
