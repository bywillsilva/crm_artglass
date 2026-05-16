import { NextResponse } from 'next/server'
import { normalizeJsonPayload } from '@/lib/server/json-normalize'

export const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
} as const

export function jsonNoStore(body: unknown, init: ResponseInit = {}) {
  return NextResponse.json(normalizeJsonPayload(body), {
    ...init,
    headers: {
      ...NO_STORE_HEADERS,
      ...(init.headers || {}),
    },
  })
}
