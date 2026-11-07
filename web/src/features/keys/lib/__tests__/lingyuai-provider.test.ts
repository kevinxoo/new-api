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
import { afterEach, describe, expect, test, vi } from 'vitest'

import {
  buildLingyuaiProviderSource,
  downloadLingyuaiProvider,
  LINGYUAI_BASE_URL,
  LINGYUAI_PROVIDER_FILENAME,
  LINGYUAI_PROVIDER_TEMPLATE,
} from '../lingyuai-provider'

describe('buildLingyuaiProviderSource', () => {
  test('fills the current API key and lingyuai base URL into the public template', () => {
    const source = buildLingyuaiProviderSource('  sk-user-key  ')

    expect(source).toContain('value: "sk-user-key"')
    expect(source).toContain(`value: "${LINGYUAI_BASE_URL}"`)
    expect(source).toContain('id: "lingyuai"')
    expect(source).toContain('muse-video')
    expect(source).not.toContain('value: ""')
    expect(LINGYUAI_PROVIDER_TEMPLATE).toContain('value: ""')
    expect(LINGYUAI_PROVIDER_TEMPLATE).not.toContain('sk-user-key')
  })

  test('escapes quotes, dollars, and newlines so the key stays inside the string', () => {
    const key = 'sk-"quote"\n$end'
    const source = buildLingyuaiProviderSource(key)

    expect(source).toContain(`value: ${JSON.stringify(key)}`)
    expect(source).toContain('id: "lingyuai"')
    expect(source?.split('field: "apiKey"').length).toBe(2)
  })

  test('returns null for a blank key and does not echo that key', () => {
    expect(buildLingyuaiProviderSource('   ')).toBeNull()
    expect(buildLingyuaiProviderSource('')).toBeNull()
  })
})

describe('downloadLingyuaiProvider', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('downloads lingyuai-provider.ts containing the key and base URL', async () => {
    const blobs: Blob[] = []
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      blobs.push(blob as Blob)
      return 'blob:lingyuai-provider'
    })
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const downloads: HTMLAnchorElement[] = []
    const createElement = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation(
      (tagName, options) => {
        const element = createElement(tagName, options)
        if (tagName.toLowerCase() === 'a') {
          element.click = () => {
            downloads.push(element as HTMLAnchorElement)
          }
        }
        return element
      }
    )

    expect(downloadLingyuaiProvider('sk-download-key')).toBe(true)

    expect(downloads).toHaveLength(1)
    expect(downloads[0].download).toBe(LINGYUAI_PROVIDER_FILENAME)
    expect(downloads[0].href).toContain('blob:lingyuai-provider')
    expect(document.body.contains(downloads[0])).toBe(false)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:lingyuai-provider')
    const text = await blobs[0].text()
    expect(text).toContain('value: "sk-download-key"')
    expect(text).toContain(`value: "${LINGYUAI_BASE_URL}"`)
    expect(text).not.toContain('sk-download-key"sk-download-key')
  })

  test('does not create a file when the key is blank', () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL')

    expect(downloadLingyuaiProvider('  ')).toBe(false)
    expect(createObjectURL).not.toHaveBeenCalled()
  })
})
