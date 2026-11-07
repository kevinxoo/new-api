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
import { act, render, renderHook, screen } from '@testing-library/react'
import i18next, { createInstance } from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { toast } from 'sonner'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { RechargeFormCard } from '@/features/wallet/components/recharge-form-card'
import { useRedemption } from '@/features/wallet/hooks/use-redemption'
import zh from '@/i18n/locales/zh.json'
import { api } from '@/lib/api'
import {
  DEFAULT_CURRENCY_CONFIG,
  useSystemConfigStore,
} from '@/stores/system-config-store'

const i18n = createInstance()

beforeEach(async () => {
  await i18n.use(initReactI18next).init({
    lng: 'zh',
    fallbackLng: false,
    nsSeparator: false,
    resources: { zh },
    interpolation: { escapeValue: false },
  })
  useSystemConfigStore.getState().setConfig({
    currency: {
      ...DEFAULT_CURRENCY_CONFIG,
      displayInCurrency: true,
      quotaDisplayType: 'CNY',
      quotaPerUnit: 500_000,
      usdExchangeRate: 7,
    },
  })
})

afterEach(async () => {
  useSystemConfigStore.getState().setConfig({
    currency: { ...DEFAULT_CURRENCY_CONFIG },
  })
  await i18next.changeLanguage('en')
})

test('shows gift code redemption before payment amounts', () => {
  render(
    <I18nextProvider i18n={i18n}>
      <RechargeFormCard
        topupInfo={{
          enable_online_topup: true,
          enable_stripe_topup: false,
          enable_redemption: true,
          pay_methods: [],
          min_topup: 1,
          stripe_min_topup: 1,
          amount_options: [100],
          discount: {},
        }}
        presetAmounts={[{ value: 100 }]}
        selectedPreset={null}
        topupAmount={1}
        paymentAmount={1}
        priceRatio={1}
        calculating={false}
        paymentLoading={null}
        redemptionCode=''
        redeeming={false}
        onSelectPreset={vi.fn()}
        onTopupAmountChange={vi.fn()}
        onPaymentMethodSelect={vi.fn()}
        onRedemptionCodeChange={vi.fn()}
        onRedeem={vi.fn()}
      />
    </I18nextProvider>
  )

  const giftCode = screen.getByLabelText('礼品码')
  const amount = screen.getByText('金额')
  expect(giftCode).toBeVisible()
  expect(screen.getByPlaceholderText('输入礼品码')).toBeVisible()
  expect(screen.getByRole('button', { name: '兑换礼品码' })).toBeVisible()
  expect(
    giftCode.compareDocumentPosition(amount) & Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy()
  expect(screen.queryByText('兑换码')).not.toBeInTheDocument()
})

test('shows the redeemed amount in yuan when quota display is CNY', async () => {
  i18next.addResourceBundle('zh', 'translation', zh.translation, true, true)
  await i18next.changeLanguage('zh')
  vi.spyOn(api, 'post').mockResolvedValue({
    data: { success: true, data: 500_000 },
  })
  vi.spyOn(api, 'get').mockResolvedValue({ data: { success: true, data: {} } })
  const success = vi.spyOn(toast, 'success')
  const { result } = renderHook(() => useRedemption())

  await act(async () => {
    expect(await result.current.redeemCode('GIFT-1')).toBe(true)
  })

  expect(api.post).toHaveBeenCalledWith('/api/user/topup', { key: 'GIFT-1' })
  const message = String(success.mock.calls[0]?.[0])
  expect(message).toContain('礼品码兑换成功')
  expect(message).toMatch(/¥\s?7|￥\s?7|CN¥\s?7/)
})
