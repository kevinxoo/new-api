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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { Toaster } from 'sonner'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import zh from '@/i18n/locales/zh.json'
import { api } from '@/lib/api'
import { STATUS_QUERY_KEY } from '@/lib/status-query'

import { apiKeySchema } from '../../types'
import { ApiKeysProvider } from '../api-keys-provider'
import { ApiKeysTable } from '../api-keys-table'

const key = apiKeySchema.parse({
  id: 7,
  name: 'production',
  key: 'demo********1234',
  status: 1,
  remain_quota: 40_000_000,
  used_quota: 60_000_000,
  unlimited_quota: false,
  expired_time: -1,
  created_time: 0,
  accessed_time: 0,
  group: 'default',
  model_limits_enabled: false,
})

const i18n = createInstance()
await i18n.init({
  lng: 'en',
  resources: { en: { translation: {} }, zh: { translation: zh.translation } },
  initAsync: false,
})

const clients: QueryClient[] = []

function KeysPage() {
  return (
    <ApiKeysProvider>
      <ApiKeysTable />
      <Toaster />
    </ApiKeysProvider>
  )
}

async function renderKeysPage() {
  vi.mocked(api.get).mockImplementation(async (url) => {
    if (String(url).startsWith('/api/token/')) {
      return { data: { success: true, data: { items: [key], total: 1 } } }
    }
    return { data: { success: true, data: { default: { ratio: 1 } } } }
  })
  const post = vi.spyOn(api, 'post').mockResolvedValue({
    data: { success: true, data: { key: 'plain-key-for-export' } },
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  client.setQueryData(STATUS_QUERY_KEY, {
    chats: [
      {
        'Cherry Studio':
          'cherrystudio://providers/api-keys?v=1&data={cherryConfig}',
      },
      { 'CC Switch': 'ccswitch' },
      { 'Lobe Chat': 'https://chat.example/?key={key}' },
    ],
  })
  clients.push(client)
  const root = createRootRoute()
  const auth = createRoute({ getParentRoute: () => root, id: '_authenticated' })
  const keysRoute = createRoute({
    getParentRoute: () => auth,
    path: 'keys/',
    component: KeysPage,
  })
  const router = createRouter({
    routeTree: root.addChildren([auth.addChildren([keysRoute])]),
    history: createMemoryHistory({ initialEntries: ['/keys/'] }),
  })
  await router.load()
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </I18nextProvider>
  )
  await screen.findByText(key.name)
  return { post }
}

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(api, 'get').mockResolvedValue({ data: { success: true, data: {} } })
  localStorage.clear()
})

afterEach(async () => {
  cleanup()
  localStorage.clear()
  clients.splice(0).forEach((client) => client.clear())
  await i18n.changeLanguage('en')
})

test('exports a provider file for the copied key and hides CCS entries', async () => {
  const user = userEvent.setup()
  const { post } = await renderKeysPage()
  const blobs: Blob[] = []
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
    blobs.push(blob as Blob)
    return 'blob:lingyuai-provider'
  })
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  const downloads: string[] = []
  const createElement = document.createElement.bind(document)
  vi.spyOn(document, 'createElement').mockImplementation((tagName, options) => {
    const element = createElement(tagName, options)
    if (String(tagName).toLowerCase() === 'a') {
      element.click = () => {
        downloads.push((element as HTMLAnchorElement).download)
      }
    }
    return element
  })

  await user.click(screen.getByRole('button', { name: 'Open menu' }))
  expect(post).not.toHaveBeenCalled()
  expect(
    screen.queryByRole('menuitem', { name: 'CC Switch' })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('dialog', { name: 'Import to CC Switch' })
  ).not.toBeInTheDocument()
  await user.hover(screen.getByRole('menuitem', { name: 'Chat' }))
  expect(
    await screen.findByRole('menuitem', { name: 'Lobe Chat' })
  ).toBeInTheDocument()
  expect(
    screen.queryByRole('menuitem', { name: 'Cherry Studio' })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('menuitem', { name: 'CC Switch' })
  ).not.toBeInTheDocument()

  await user.click(screen.getByRole('menuitem', { name: 'Export .ts' }))

  await waitFor(() => expect(post).toHaveBeenCalledWith('/api/token/7/key'))
  await waitFor(() => expect(downloads).toEqual(['lingyuai-provider.ts']))
  const text = await blobs[0].text()
  expect(text).toContain('value: "sk-plain-key-for-export"')
  expect(text).toContain('value: "https://lingyuai.shop/v1"')
  expect(
    await screen.findByText('Downloaded lingyuai-provider.ts')
  ).toBeInTheDocument()
})

test('shows 导出 .ts in Chinese and does not download when the key request fails', async () => {
  const user = userEvent.setup()
  await i18n.changeLanguage('zh')
  const { post } = await renderKeysPage()
  post.mockResolvedValue({
    data: { success: false, message: 'Verification required' },
  })
  const createObjectURL = vi.spyOn(URL, 'createObjectURL')

  await user.click(screen.getByRole('button', { name: '打开菜单' }))
  expect(screen.getByRole('menuitem', { name: '导出 .ts' })).toBeInTheDocument()
  expect(
    screen.queryByRole('menuitem', { name: 'CC Switch' })
  ).not.toBeInTheDocument()

  await user.click(screen.getByRole('menuitem', { name: '导出 .ts' }))

  await screen.findByText('Verification required')
  expect(createObjectURL).not.toHaveBeenCalled()
})
