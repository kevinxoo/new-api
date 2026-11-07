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

import { parseHeaderNavModulesFromStatus } from '@/lib/nav-modules'

import { buildTopNavLinks, CANVAS_PROVIDER_URL } from '../use-top-nav-links'

const t = (key: string) => key

describe('buildTopNavLinks', () => {
  test('replaces Home with an external canvas provider link', () => {
    const links = buildTopNavLinks({
      t,
      modules: parseHeaderNavModulesFromStatus(null),
      isAuthed: true,
    })

    expect(links[0]).toEqual({
      title: 'Canvas',
      href: CANVAS_PROVIDER_URL,
      external: true,
    })
    expect(
      links.some((link) => link.href === '/' || link.title === 'Home')
    ).toBe(false)
    expect(CANVAS_PROVIDER_URL).toBe(
      'https://lingyuai.shop/providers/lingyuai.ts'
    )
  })

  test('hides the canvas link when the home module is turned off', () => {
    const links = buildTopNavLinks({
      t,
      modules: parseHeaderNavModulesFromStatus({
        HeaderNavModules: JSON.stringify({ home: false }),
      }),
      isAuthed: false,
    })

    expect(links.some((link) => link.title === 'Canvas')).toBe(false)
    expect(links.some((link) => link.href === CANVAS_PROVIDER_URL)).toBe(false)
  })
})
