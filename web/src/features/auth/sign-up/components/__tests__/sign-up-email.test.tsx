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
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Toaster } from 'sonner'
import { afterEach, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'
import { STATUS_QUERY_KEY } from '@/lib/status-query'

import { SignUpForm } from '../sign-up-form'

afterEach(() => {
  cleanup()
})

async function renderSignUp(emailVerification: boolean) {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  client.setQueryData(STATUS_QUERY_KEY, {
    email_verification: emailVerification,
    oauth_register_enabled: false,
    turnstile_check: false,
    user_agreement_enabled: false,
    privacy_policy_enabled: false,
    wechat_login: false,
  })
  const root = createRootRoute()
  const signUp = createRoute({
    getParentRoute: () => root,
    path: '/sign-up',
    component: SignUpForm,
  })
  const signIn = createRoute({
    getParentRoute: () => root,
    path: '/sign-in',
    component: () => <div>sign-in</div>,
  })
  const router = createRouter({
    routeTree: root.addChildren([signUp, signIn]),
    history: createMemoryHistory({ initialEntries: ['/sign-up'] }),
  })
  await router.load()
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
      <Toaster />
    </QueryClientProvider>
  )
  return screen.findByRole('button', { name: 'Create account' })
}

async function fillAccount(email: string) {
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('Username'), 'lingyu')
  await user.type(screen.getByLabelText('Email'), email)
  await user.type(screen.getByLabelText('Password'), 'password-123')
  await user.type(screen.getByLabelText('Confirm password'), 'password-123')
  return user
}

test('shows email without a verification code and submits the address', async () => {
  const post = vi.spyOn(api, 'post').mockResolvedValue({
    data: { success: true },
  })
  await renderSignUp(false)
  expect(screen.getByLabelText('Email')).toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Send code' })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByPlaceholderText('Verification code')
  ).not.toBeInTheDocument()

  const user = await fillAccount(' user@example.com ')
  await user.click(screen.getByRole('button', { name: 'Create account' }))

  expect(post).toHaveBeenCalledWith(
    '/api/user/register',
    {
      username: 'lingyu',
      password: 'password-123',
      email: 'user@example.com',
      verification_code: undefined,
      aff_code: '',
      turnstile: '',
    },
    expect.anything()
  )
})

test('blocks an invalid email before registration', async () => {
  const post = vi.spyOn(api, 'post')
  await renderSignUp(false)
  const user = await fillAccount('not-an-email')
  await user.click(screen.getByRole('button', { name: 'Create account' }))
  expect(
    await screen.findByText('Please enter a valid email address')
  ).toBeInTheDocument()
  expect(post).not.toHaveBeenCalled()
})

test('asks for a verification code only when email verification is enabled', async () => {
  const post = vi.spyOn(api, 'post').mockResolvedValue({
    data: { success: true },
  })
  await renderSignUp(true)
  expect(screen.getByLabelText('Email')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Send code' })).toBeInTheDocument()

  const user = await fillAccount('coded@example.com')
  await user.click(screen.getByRole('button', { name: 'Create account' }))
  expect(
    await screen.findByText('Please enter the verification code')
  ).toBeInTheDocument()
  expect(post).not.toHaveBeenCalled()

  await user.type(screen.getByPlaceholderText('Verification code'), '654321')
  await user.click(screen.getByRole('button', { name: 'Create account' }))
  expect(post).toHaveBeenCalledWith(
    '/api/user/register',
    expect.objectContaining({
      email: 'coded@example.com',
      verification_code: '654321',
    }),
    expect.anything()
  )
})
