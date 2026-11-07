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
import templateSource from './lingyuai-provider.template.txt?raw'

// Public provider snapshot (https://lingyuai.shop/providers/lingyuai.ts, v1.1.1).
// apiKey and baseUrl are filled in the browser at download time. Never commit a real key.
export const LINGYUAI_PROVIDER_TEMPLATE = templateSource

export const LINGYUAI_BASE_URL = 'https://lingyuai.shop/v1'
export const LINGYUAI_PROVIDER_FILENAME = 'lingyuai-provider.ts'

const API_KEY_VALUE_PREFIX = `field: "apiKey" as const,
    title: "API Key",
    value: `

const BASE_URL_VALUE_PREFIX = `field: "baseUrl" as const,
    title: "接口地址",
    value: `

function replacePrefixedString(
  source: string,
  prefix: string,
  value: string
): string | null {
  const start = source.indexOf(prefix)
  if (start < 0) return null
  const valueStart = start + prefix.length
  const quote = source[valueStart]
  if (quote !== '"' && quote !== "'") return null

  let cursor = valueStart + 1
  while (cursor < source.length) {
    if (source[cursor] === '\\') {
      cursor += 2
      continue
    }
    if (source[cursor] === quote) break
    cursor += 1
  }
  if (source[cursor] !== quote) return null

  return (
    source.slice(0, valueStart) +
    JSON.stringify(value) +
    source.slice(cursor + 1)
  )
}

export function buildLingyuaiProviderSource(apiKey: string): string | null {
  const key = apiKey.trim()
  if (!key) return null

  const withBase = replacePrefixedString(
    LINGYUAI_PROVIDER_TEMPLATE,
    BASE_URL_VALUE_PREFIX,
    LINGYUAI_BASE_URL
  )
  if (!withBase) return null
  const withKey = replacePrefixedString(withBase, API_KEY_VALUE_PREFIX, key)
  if (!withKey) return null
  if (!withKey.includes(JSON.stringify(key))) return null
  if (!withKey.includes(JSON.stringify(LINGYUAI_BASE_URL))) return null
  return withKey
}

export function downloadLingyuaiProvider(apiKey: string): boolean {
  const source = buildLingyuaiProviderSource(apiKey)
  if (!source) return false

  const blob = new Blob([source], { type: 'text/typescript;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = LINGYUAI_PROVIDER_FILENAME
  anchor.rel = 'noopener'
  anchor.style.display = 'none'
  document.body.append(anchor)
  try {
    anchor.click()
  } finally {
    anchor.remove()
    URL.revokeObjectURL(url)
  }
  return true
}
