import { beforeEach, describe, expect, it } from 'vitest'

import { KAZIKE_TEMPLATES } from './kazike-templates'
import { loadSnippets, saveSnippets } from './prompt-snippets'

describe('prompt snippets store', () => {
  beforeEach(() => {
    saveSnippets([])
  })

  it('can restore the 12 Kazike templates', () => {
    saveSnippets(
      KAZIKE_TEMPLATES.map(item => ({
        id: item.id,
        label: item.label,
        description: item.description,
        text: item.text
      }))
    )
    const loaded = loadSnippets()
    expect(loaded).toHaveLength(12)
    expect(loaded.map(item => item.id)).toEqual(KAZIKE_TEMPLATES.map(item => item.id))
  })

  it('drops non-string ids and oversized text on save', () => {
    saveSnippets([
      { id: 'ok', label: 'A', description: '', text: 'hello' },
      { id: '', label: 'bad', description: '', text: 'no' },
      { id: 'huge', label: 'A', description: '', text: 't'.repeat(100_001) }
    ])
    expect(loadSnippets()).toEqual([{ id: 'ok', label: 'A', description: '', text: 'hello' }])
  })

  it('keeps an empty list after the user deletes everything', () => {
    saveSnippets([])
    expect(loadSnippets()).toEqual([])
  })
})
