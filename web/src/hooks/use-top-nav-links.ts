/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { useStatus } from '@/hooks/use-status'
import {
  parseHeaderNavModulesFromStatus,
  type HeaderNavModules,
} from '@/lib/nav-modules'
import { useAuthStore } from '@/stores/auth-store'

export const CANVAS_PROVIDER_URL = 'https://lingyuai.shop/providers/lingyuai.ts'

export type TopNavLink = {
  title: string
  href: string
  disabled?: boolean
  requiresAuth?: boolean
  external?: boolean
}

/**
 * Generate top navigation links based on HeaderNavModules configuration from backend /api/status
 * Backend format example (stringified JSON):
 * {
 *   home: true,
 *   console: true,
 *   pricing: { enabled: true, requireAuth: false },
 *   rankings: { enabled: true, requireAuth: false },
 *   docs: true,
 *   about: true
 * }
 */
export function buildTopNavLinks(input: {
  t: (key: string) => string
  modules: HeaderNavModules | null
  docsLink?: string
  isAuthed: boolean
}): TopNavLink[] {
  const links: TopNavLink[] = []
  const modules = input.modules

  if (modules?.home !== false) {
    links.push({
      title: input.t('Canvas'),
      href: CANVAS_PROVIDER_URL,
      external: true,
    })
  }

  if (modules?.console !== false) {
    links.push({ title: input.t('Console'), href: '/dashboard' })
  }

  // Pricing
  const pricing = modules?.pricing
  if (pricing && typeof pricing === 'object' && pricing.enabled) {
    const requiresAuth = pricing.requireAuth && !input.isAuthed
    links.push({
      title: input.t('Model Square'),
      href: '/pricing',
      requiresAuth,
    })
  }

  // Rankings
  const rankings = modules?.rankings
  if (rankings && typeof rankings === 'object' && rankings.enabled) {
    const requiresAuth = rankings.requireAuth && !input.isAuthed
    links.push({
      title: input.t('Rankings'),
      href: '/rankings',
      requiresAuth,
    })
  }

  // Docs (supports external links)
  if (modules?.docs !== false) {
    if (input.docsLink) {
      links.push({
        title: input.t('Docs'),
        href: input.docsLink,
        external: true,
      })
    } else {
      links.push({ title: input.t('Docs'), href: '/docs' })
    }
  }

  if (modules?.about !== false) {
    links.push({ title: input.t('About'), href: '/about' })
  }

  return links
}

export function useTopNavLinks(): TopNavLink[] {
  const { t } = useTranslation()
  const { status } = useStatus()
  const { auth } = useAuthStore()

  const modules = useMemo(() => {
    return parseHeaderNavModulesFromStatus(
      status as Record<string, unknown> | null
    )
  }, [status])

  const docsLink: string | undefined = status?.docs_link as string | undefined
  const isAuthed = !!auth?.user

  return buildTopNavLinks({ t, modules, docsLink, isAuthed })
}
