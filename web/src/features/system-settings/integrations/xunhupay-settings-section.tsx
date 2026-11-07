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
import { useFormContext } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'

export function XunhuPaySettingsSection() {
  const { t } = useTranslation()
  const form = useFormContext()

  return (
    <div className='space-y-4'>
      <div>
        <h3 className='text-lg font-medium'>{t('XunhuPay')}</h3>
        <p className='text-muted-foreground text-sm'>
          {t('Configuration for XunhuPay wallet top-ups')}
        </p>
      </div>

      <p className='text-muted-foreground text-sm'>
        {t(
          'WeChat and Alipay are separate XunhuPay apps. Enter the AppID and AppSecret for each channel you want to offer.'
        )}
      </p>

      <FormField
        control={form.control}
        name='XunhuPayGateway'
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t('XunhuPay gateway URL')}</FormLabel>
            <FormControl>
              <Input
                placeholder='https://api.xunhupay.com/payment/do.html'
                autoComplete='off'
                {...field}
              />
            </FormControl>
            <FormDescription>
              {t(
                'Use the full payment URL ending in /payment/do.html. Leave blank to use https://api.xunhupay.com/payment/do.html. Do not append submit.php.'
              )}
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />

      <div className='grid gap-6 md:grid-cols-2'>
        <FormField
          control={form.control}
          name='XunhuPayWechatAppId'
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('WeChat AppID')}</FormLabel>
              <FormControl>
                <Input autoComplete='off' {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name='XunhuPayWechatAppSecret'
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('WeChat AppSecret')}</FormLabel>
              <FormControl>
                <Input
                  type='password'
                  placeholder={t('Enter new key to update')}
                  autoComplete='new-password'
                  {...field}
                />
              </FormControl>
              <FormDescription>
                {t('Leave blank unless rotating the secret')}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name='XunhuPayAlipayAppId'
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('Alipay AppID')}</FormLabel>
              <FormControl>
                <Input autoComplete='off' {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name='XunhuPayAlipayAppSecret'
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('Alipay AppSecret')}</FormLabel>
              <FormControl>
                <Input
                  type='password'
                  placeholder={t('Enter new key to update')}
                  autoComplete='new-password'
                  {...field}
                />
              </FormControl>
              <FormDescription>
                {t('Leave blank unless rotating the secret')}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <div className='bg-muted/40 space-y-2 rounded-md p-4 text-sm'>
        <p>
          <span className='font-medium'>{t('Notify URL')}</span>
        </p>
        <p className='text-muted-foreground'>
          {t(
            'XunhuPay posts payment results to <callback address>/api/user/xunhupay/notify. The callback address is the Epay callback address when set, otherwise the server address.'
          )}
        </p>
        <p>
          <span className='font-medium'>{t('Return URL')}</span>
        </p>
        <p className='text-muted-foreground'>
          {t('After payment, the browser returns to <server address>/wallet.')}
        </p>
      </div>
    </div>
  )
}
