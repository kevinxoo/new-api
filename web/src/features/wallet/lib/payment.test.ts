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
import { describe, expect, test } from 'vitest'

import { PAYMENT_TYPES } from '../constants'
import {
  dispatchSelectedPayment,
  getMinTopupAmount,
  isStripePayment,
  isWaffoPayment,
  isWaffoPancakePayment,
  resolveXunhuPayCheckout,
  visiblePayMethods,
} from './payment'
import type { TopupInfo } from '../types'

describe('payment type classification', () => {
  test('keeps Waffo and Waffo Pancake on their dedicated flows', () => {
    expect(isWaffoPayment(PAYMENT_TYPES.WAFFO)).toBe(true)
    expect(isWaffoPayment(PAYMENT_TYPES.WAFFO_PANCAKE)).toBe(false)
    expect(isWaffoPancakePayment(PAYMENT_TYPES.WAFFO_PANCAKE)).toBe(true)
    expect(isWaffoPancakePayment(PAYMENT_TYPES.WAFFO)).toBe(false)
    expect(isStripePayment(PAYMENT_TYPES.STRIPE)).toBe(true)
  })
})

describe('payment dispatch', () => {
  test('keeps the selected Waffo method index through confirmation', async () => {
    const calls: string[] = []
    const success = await dispatchSelectedPayment(
      { name: 'Waffo Card', type: PAYMENT_TYPES.WAFFO },
      120,
      3,
      {
        regular: async () => {
          calls.push('regular')
          return false
        },
        waffo: async (amount, index) => {
          calls.push(`waffo:${amount}:${index}`)
          return true
        },
        waffoPancake: async () => {
          calls.push('pancake')
          return false
        },
        xunhupay: async () => false,
      }
    )

    expect(success).toBe(true)
    expect(calls).toEqual(['waffo:120:3'])
  })

  test('does not create a Waffo order without a selected method index', async () => {
    let called = false
    const success = await dispatchSelectedPayment(
      { name: 'Waffo Card', type: PAYMENT_TYPES.WAFFO },
      120,
      null,
      {
        regular: async () => false,
        waffo: async () => {
          called = true
          return true
        },
        waffoPancake: async () => false,
        xunhupay: async () => false,
      }
    )

    expect(success).toBe(false)
    expect(called).toBe(false)
  })

  test('sends WeChat and Alipay through XunhuPay instead of the Epay form', async () => {
    const calls: string[] = []
    const success = await dispatchSelectedPayment(
      { name: 'WeChat Pay', type: PAYMENT_TYPES.XUNHU_WECHAT },
      20,
      null,
      {
        regular: async () => {
          calls.push('regular')
          return false
        },
        waffo: async () => false,
        waffoPancake: async () => false,
        xunhupay: async (amount, paymentType) => {
          calls.push(`${paymentType}:${amount}`)
          return true
        },
      }
    )

    expect(success).toBe(true)
    expect(calls).toEqual(['xunhupay_wxpay:20'])
  })
})

function topupInfo(overrides: Partial<TopupInfo> = {}): TopupInfo {
  return {
    enable_online_topup: false,
    enable_stripe_topup: false,
    pay_methods: [
      { name: '支付宝', type: 'alipay' },
      { name: 'WeChat Pay', type: PAYMENT_TYPES.XUNHU_WECHAT },
      { name: 'Stripe', type: PAYMENT_TYPES.STRIPE },
    ],
    min_topup: 5,
    stripe_min_topup: 2,
    amount_options: [],
    discount: {},
    ...overrides,
  }
}

describe('visible payment methods', () => {
  test('shows XunhuPay channels without unconfigured Epay buttons', () => {
    const methods = visiblePayMethods(
      topupInfo({ enable_xunhupay_topup: true, enable_stripe_topup: true })
    )
    expect(methods.map((method) => method.type)).toEqual([
      PAYMENT_TYPES.XUNHU_WECHAT,
      PAYMENT_TYPES.STRIPE,
    ])
  })

  test('keeps Epay buttons when Epay is enabled', () => {
    const methods = visiblePayMethods(topupInfo({ enable_online_topup: true }))
    expect(methods.map((method) => method.type)).toEqual(['alipay'])
  })
})

describe('XunhuPay checkout presentation', () => {
  const checkout = {
    url: 'https://pay.example.com/mobile',
    url_qrcode: 'https://pay.example.com/qr.png',
  }

  test('uses the QR code on desktop and does not also open the cashier URL', () => {
    expect(resolveXunhuPayCheckout(checkout, false)).toEqual({
      action: 'qr',
      url: '',
      qrURL: 'https://pay.example.com/qr.png',
    })
  })

  test('redirects mobile browsers to the https cashier URL', () => {
    expect(resolveXunhuPayCheckout(checkout, true)).toEqual({
      action: 'redirect',
      url: 'https://pay.example.com/mobile',
      qrURL: '',
    })
  })

  test('rejects non-https payment links', () => {
    expect(
      resolveXunhuPayCheckout(
        { url: 'http://pay.example.com/mobile', url_qrcode: 'javascript:alert(1)' },
        false
      )
    ).toEqual({ action: 'none', url: '', qrURL: '' })
  })
})

describe('XunhuPay minimum top-up', () => {
  test('uses the shared minimum when only XunhuPay is enabled', () => {
    expect(getMinTopupAmount(topupInfo({ enable_xunhupay_topup: true }))).toBe(5)
  })
})
