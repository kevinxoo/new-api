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
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'

import { STATUS_QUERY_KEY } from '@/lib/status-query'

import { Hero } from '../hero'

afterEach(() => {
  cleanup()
})

test('home hero does not offer Cherry Studio or CC Switch', async () => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  client.setQueryData(STATUS_QUERY_KEY, {})
  const root = createRootRoute({ component: () => <Outlet /> })
  const index = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => <Hero />,
  })
  const signUp = createRoute({
    getParentRoute: () => root,
    path: '/sign-up',
    component: () => null,
  })
  const pricing = createRoute({
    getParentRoute: () => root,
    path: '/pricing',
    component: () => null,
  })
  const router = createRouter({
    routeTree: root.addChildren([index, signUp, pricing]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  await router.load()

  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )

  expect(
    await screen.findByRole('button', { name: 'Get Started' })
  ).toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Cherry Studio' })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: /CC Switch/ })
  ).not.toBeInTheDocument()
  expect(screen.queryByText('Cherry Studio')).not.toBeInTheDocument()
  expect(screen.queryByText('CC Switch')).not.toBeInTheDocument()
  expect(screen.queryByText('Supported Applications')).not.toBeInTheDocument()
})
