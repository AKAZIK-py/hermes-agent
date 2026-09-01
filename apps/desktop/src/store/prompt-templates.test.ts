import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock translateNow before importing the store — it reads the active locale
// at call time, so we stub it with a locale-aware fake.
vi.mock('@/i18n/runtime', () => ({
  translateNow: (key: string) => {
    // Return a predictable string that includes the key so tests can verify
    // the i18n path was taken (not the old hardcoded English constants).
    return `[zh] ${key}`
  }
}))

// Mock localStorage before importing the store
const store = new Map<string, string>()

const localStorageMock = {
  getItem: vi.fn((key: string) => store.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => {
    store.set(key, value)
  }),
  removeItem: vi.fn((key: string) => {
    store.delete(key)
  }),
  clear: vi.fn(() => {
    store.clear()
  }),
  key: vi.fn(() => null),
  length: 0
}

vi.stubGlobal('localStorage', localStorageMock)
vi.stubGlobal('window', { localStorage: localStorageMock })

import {
  $promptTemplates,
  addFolder,
  addTemplate,
  deleteTemplate,
  ensureSeeded,
  getBuiltInTemplates,
  indentNode,
  moveTemplateDown,
  moveTemplateUp,
  outdentNode,
  placeNode,
  resetToBuiltins,
  toggleFolderCollapsed,
  updateTemplate,
  visibleTreeRows
} from './prompt-templates'

/** Product three-builtins fixture (ensureSeeded is empty dogfood). */
function seedThree(): void {
  $promptTemplates.set(getBuiltInTemplates())
}

describe('prompt-templates store', () => {
  beforeEach(() => {
    store.clear()
    localStorageMock.getItem.mockClear()
    localStorageMock.setItem.mockClear()
    localStorageMock.removeItem.mockClear()
    // Restore a valid non-empty state between tests. The store's seed decision
    // is intentionally process-scoped and should not be reset by test setup.
    resetToBuiltins()
  })

  describe('ensureSeeded', () => {
    it('local dogfood seed is empty (packs hang via inbox, not builtins)', () => {
      ensureSeeded()
      expect($promptTemplates.get()).toEqual([])
    })

    it('is a no-op when templates already exist', () => {
      addTemplate('Custom', '', '')
      const before = $promptTemplates.get()
      ensureSeeded()
      expect($promptTemplates.get()).toEqual(before)
    })

    it('preserves an intentionally empty list', () => {
      $promptTemplates.set([])
      ensureSeeded()
      expect($promptTemplates.get()).toEqual([])
    })
  })

  describe('addTemplate', () => {
    it('appends a new template with generated id', () => {
      seedThree()
      const created = addTemplate('My template', 'A test', 'Do something')

      const templates = $promptTemplates.get()

      expect(templates).toHaveLength(4)
      expect(templates[3]).toBe(created)
      expect(created.id).toMatch(/^tpl-\d+-/)
      expect(created.label).toBe('My template')
    })

    it('defaults to empty strings', () => {
      $promptTemplates.set([])

      const created = addTemplate()

      expect(created.label).toBe('')
      expect(created.description).toBe('')
      expect(created.text).toBe('')
    })
  })

  describe('updateTemplate', () => {
    it('patches a template by id', () => {
      seedThree()
      updateTemplate('codeReview', { label: 'Updated label' })

      const template = $promptTemplates.get().find(s => s.id === 'codeReview')

      expect(template?.label).toBe('Updated label')
      // Other fields unchanged
      expect(template?.description).toBeTruthy()
    })

    it('ignores unknown ids', () => {
      seedThree()
      const before = $promptTemplates.get()

      updateTemplate('nonexistent', { label: 'Nope' })

      expect($promptTemplates.get()).toEqual(before)
    })
  })

  describe('deleteTemplate', () => {
    it('removes a template by id', () => {
      seedThree()
      deleteTemplate('explainThis')

      const templates = $promptTemplates.get()

      expect(templates).toHaveLength(2)
      expect(templates.find(s => s.id === 'explainThis')).toBeUndefined()
    })

    it('ignores unknown ids', () => {
      seedThree()
      const before = $promptTemplates.get()

      deleteTemplate('nonexistent')

      expect($promptTemplates.get()).toEqual(before)
    })
  })

  describe('moveTemplateUp', () => {
    it('swaps with the previous element', () => {
      seedThree()
      moveTemplateUp('implementationPlan')

      const ids = $promptTemplates.get().map(s => s.id)

      expect(ids).toEqual(['implementationPlan', 'codeReview', 'explainThis'])
    })

    it('is a no-op at index 0', () => {
      seedThree()
      const before = $promptTemplates.get()

      moveTemplateUp('codeReview')

      expect($promptTemplates.get().map(s => s.id)).toEqual(before.map(s => s.id))
    })

    it('ignores unknown ids', () => {
      seedThree()
      const before = $promptTemplates.get()

      moveTemplateUp('nonexistent')

      expect($promptTemplates.get()).toEqual(before)
    })
  })

  describe('moveTemplateDown', () => {
    it('swaps with the next element', () => {
      seedThree()
      moveTemplateDown('codeReview')

      const ids = $promptTemplates.get().map(s => s.id)

      expect(ids).toEqual(['implementationPlan', 'codeReview', 'explainThis'])
    })

    it('is a no-op at the last index', () => {
      seedThree()
      const before = $promptTemplates.get()

      moveTemplateDown('explainThis')

      expect($promptTemplates.get().map(s => s.id)).toEqual(before.map(s => s.id))
    })
  })

  describe('resetToBuiltins', () => {
    it('restores the three built-ins after modifications', () => {
      seedThree()
      // Start from seeded state, add one, delete one, then reset
      addTemplate('Extra', '', '')
      deleteTemplate('codeReview')

      expect($promptTemplates.get()).toHaveLength(3) // 3 - 1 + 1 = 3

      resetToBuiltins()

      // Live dogfood reset = empty slate (packs re-import via inbox).
      expect($promptTemplates.get()).toEqual([])
    })
  })

  describe('getBuiltInTemplates', () => {
    it('returns a fresh copy each call', () => {
      const a = getBuiltInTemplates()
      const b = getBuiltInTemplates()

      expect(a).toEqual(b)
      expect(a).not.toBe(b)

      // Mutating one copy must not affect the other
      a[0].label = 'mutated'

      expect(b[0].label).not.toBe('mutated')
    })
  })

  describe('persistence', () => {
    it('writes to localStorage on every mutation', () => {
      $promptTemplates.set([])

      addTemplate('Persisted', '', '')

      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        'hermes.desktop.prompt-templates',
        expect.stringContaining('"label":"Persisted"')
      )
    })
  })

  describe('folders', () => {
    it('nests templates under a folder and hides them when collapsed', () => {
      $promptTemplates.set([])
      const folder = addFolder('Group')
      const child = addTemplate('Socratic', '', 'Ask why', folder.id)

      expect(child.parentId).toBe(folder.id)
      expect(visibleTreeRows().map(r => r.node.id)).toEqual([folder.id, child.id])
      expect(visibleTreeRows().map(r => r.depth)).toEqual([0, 1])

      toggleFolderCollapsed(folder.id)

      expect(visibleTreeRows().map(r => r.node.id)).toEqual([folder.id])
    })

    it('deletes a folder and its descendants', () => {
      $promptTemplates.set([])
      const folder = addFolder('Pack')
      addTemplate('A', '', 'a', folder.id)
      addTemplate('B', '', 'b', folder.id)
      addTemplate('Root', '', 'r')

      deleteTemplate(folder.id)

      expect($promptTemplates.get()).toHaveLength(1)
      expect($promptTemplates.get()[0].label).toBe('Root')
    })

    it('indents under the previous sibling folder and outdents back to root', () => {
      $promptTemplates.set([])
      const folder = addFolder('Group')
      const tpl = addTemplate('Nested', '', 'x')

      indentNode(tpl.id)

      expect($promptTemplates.get().find(s => s.id === tpl.id)?.parentId).toBe(folder.id)

      outdentNode(tpl.id)

      expect($promptTemplates.get().find(s => s.id === tpl.id)?.parentId).toBeNull()
    })

    it('moves only among siblings', () => {
      $promptTemplates.set([])
      const folder = addFolder('G')
      const a = addTemplate('A', '', 'a', folder.id)
      const b = addTemplate('B', '', 'b', folder.id)
      addTemplate('Root', '', 'r')

      moveTemplateDown(a.id)

      const kids = $promptTemplates.get().filter(s => s.parentId === folder.id).map(s => s.id)
      expect(kids).toEqual([b.id, a.id])
    })

    it('normalizes legacy v1 rows without kind/parentId', async () => {
      store.set(
        'hermes.desktop.prompt-templates',
        JSON.stringify([{ id: 'legacy', label: 'L', description: 'd', text: 't' }])
      )
      vi.resetModules()

      const reloaded = await import('./prompt-templates')
      const [row] = reloaded.$promptTemplates.get()

      expect(row).toMatchObject({ id: 'legacy', kind: 'template', parentId: null, label: 'L', text: 't' })
    })
  })

  describe('placeNode', () => {
    it('reorders siblings with before/after', () => {
      $promptTemplates.set([])
      const a = addTemplate('A', '', 'a')
      const b = addTemplate('B', '', 'b')
      const c = addTemplate('C', '', 'c')

      expect(placeNode(c.id, a.id, 'before')).toBe(true)
      expect($promptTemplates.get().map(s => s.id)).toEqual([c.id, a.id, b.id])

      expect(placeNode(c.id, b.id, 'after')).toBe(true)
      expect($promptTemplates.get().map(s => s.id)).toEqual([a.id, b.id, c.id])
    })

    it('nests into a collapsed folder at the top without expanding', () => {
      $promptTemplates.set([])
      const folder = addFolder('Group')
      updateTemplate(folder.id, { collapsed: true })
      const existing = addTemplate('Existing', '', 'e', folder.id)
      const tpl = addTemplate('Nested', '', 'x')

      expect(placeNode(tpl.id, folder.id, 'inside')).toBe(true)

      const list = $promptTemplates.get()
      expect(list.find(s => s.id === tpl.id)?.parentId).toBe(folder.id)
      expect(list.find(s => s.id === folder.id)?.collapsed).toBe(true)
      // First among children in flat order (right after the folder row).
      const ids = list.map(s => s.id)
      expect(ids.indexOf(tpl.id)).toBe(ids.indexOf(folder.id) + 1)
      expect(ids.indexOf(existing.id)).toBeGreaterThan(ids.indexOf(tpl.id))
    })

    it('nests into an expanded folder as last child and leaves it open', () => {
      $promptTemplates.set([])
      const folder = addFolder('Group')
      updateTemplate(folder.id, { collapsed: false })
      const existing = addTemplate('Existing', '', 'e', folder.id)
      const tpl = addTemplate('Nested', '', 'x')

      expect(placeNode(tpl.id, folder.id, 'inside')).toBe(true)

      const list = $promptTemplates.get()
      expect(list.find(s => s.id === tpl.id)?.parentId).toBe(folder.id)
      expect(list.find(s => s.id === folder.id)?.collapsed).toBe(false)
      const ids = list.map(s => s.id)
      expect(ids.indexOf(tpl.id)).toBeGreaterThan(ids.indexOf(existing.id))
    })

    it('rejects drop into own subtree (snap-back case)', () => {
      $promptTemplates.set([])
      const folder = addFolder('Outer')
      const inner = addFolder('Inner', folder.id)
      const leaf = addTemplate('Leaf', '', 'l', folder.id)

      expect(placeNode(folder.id, inner.id, 'inside')).toBe(false)
      expect(placeNode(folder.id, leaf.id, 'before')).toBe(false)
      expect($promptTemplates.get().find(s => s.id === folder.id)?.parentId).toBeNull()
    })

    it('can nest back into a folder after being pulled out', () => {
      $promptTemplates.set([])
      const folder = addFolder('Group')
      const tpl = addTemplate('T', '', 't', folder.id)

      expect(placeNode(tpl.id, folder.id, 'before')).toBe(true)
      expect($promptTemplates.get().find(s => s.id === tpl.id)?.parentId).toBeNull()

      expect(placeNode(tpl.id, folder.id, 'inside')).toBe(true)
      expect($promptTemplates.get().find(s => s.id === tpl.id)?.parentId).toBe(folder.id)
    })

    it('moves a folder with its descendants as one block', () => {
      $promptTemplates.set([])
      const f = addFolder('F')
      const child = addTemplate('Child', '', 'c', f.id)
      const other = addTemplate('Other', '', 'o')

      expect(placeNode(f.id, other.id, 'after')).toBe(true)

      const ids = $promptTemplates.get().map(s => s.id)
      expect(ids.indexOf(f.id)).toBeGreaterThan(ids.indexOf(other.id))
      expect($promptTemplates.get().find(s => s.id === child.id)?.parentId).toBe(f.id)
    })
  })
})
