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
import i18next from 'i18next'
import { useCallback, useState } from 'react'
import { toast } from 'sonner'

import { handleServerError } from '@/lib/handle-server-error'

import { isApiSuccess, requestXunhuPayPayment } from '../api'
import {
  getPaymentErrorTranslation,
  resolveXunhuPayCheckout,
  type XunhuPayPresentation,
} from '../lib'

export function useXunhuPayPayment() {
  const [processing, setProcessing] = useState(false)
  const [checkout, setCheckout] = useState<XunhuPayPresentation | null>(null)

  const processXunhuPayPayment = useCallback(
    async (topupAmount: number, paymentType: string) => {
      setProcessing(true)
      try {
        const response = await requestXunhuPayPayment({
          amount: Math.floor(topupAmount),
          payment_method: paymentType,
        })
        if (!isApiSuccess(response) || !response.data) {
          handleServerError(response, undefined, {
            title:
              getPaymentErrorTranslation(response) ??
              i18next.t('Payment request failed'),
          })
          return false
        }

        const isMobile = window.matchMedia('(max-width: 767px)').matches
        const presentation = resolveXunhuPayCheckout(response.data, isMobile)
        if (presentation.action === 'redirect') {
          window.location.assign(presentation.url)
          toast.success(i18next.t('Redirecting to payment page...'))
          return true
        }
        if (presentation.action === 'qr') {
          setCheckout(presentation)
          return true
        }

        handleServerError(response, i18next.t('Payment request failed'))
        return false
      } catch (error) {
        handleServerError(error, i18next.t('Payment request failed'))
        return false
      } finally {
        setProcessing(false)
      }
    },
    []
  )

  return {
    processing,
    processXunhuPayPayment,
    checkout,
    closeCheckout: () => setCheckout(null),
  }
}
