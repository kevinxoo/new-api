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

import { isHiddenOneClickPreset, parseChatConfig } from '../chat-links'

describe('isHiddenOneClickPreset', () => {
  test('hides Cherry Studio and CC Switch one-click entries and keeps other chats', () => {
    const presets = parseChatConfig([
      {
        'Cherry Studio':
          'cherrystudio://providers/api-keys?v=1&data={cherryConfig}',
      },
      { 'CC Switch': 'ccswitch' },
      { CCS: 'https://example.com/ccs' },
      { 'Renamed client': 'cherrystudio://providers/api-keys?v=1' },
      {
        'Lobe Chat':
          'https://chat.example/?settings={"key":"{key}","url":"{address}"}',
      },
      { DeepChat: 'deepchat://provider/install?v=1&data={deepchatConfig}' },
    ])

    const visible = presets.filter((preset) => !isHiddenOneClickPreset(preset))

    expect(visible.map((preset) => preset.name)).toEqual([
      'Lobe Chat',
      'DeepChat',
    ])
  })
})
