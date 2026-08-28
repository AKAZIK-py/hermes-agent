/** User-editable prompt snippets for the Desktop composer.

Local overlay on current main. Persistence uses the desktop `persistentAtom`
choke point (same as themes). First-run seed is this machine's Kazike list.
Insert is plain text into the composer — never HTML / eval.

Not based on rayn1314/80207's branch.
*/
import { Codecs, persistentAtom } from '@/lib/persisted'
import { readKey } from '@/lib/storage'

import { KAZIKE_TEMPLATES } from './kazike-templates'

export interface PromptSnippet {
  description: string
  id: string
  label: string
  text: string
}

export const PROMPT_SNIPPETS_STORAGE_KEY = 'hermes.desktop.prompt-snippets'

const MAX_LABEL = 200
const MAX_DESCRIPTION = 500
const MAX_TEXT = 100_000
const MAX_ID = 80

function asSnippet(value: unknown): null | PromptSnippet {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const rec = value as Record<string, unknown>
  if (
    typeof rec.id !== 'string' ||
    typeof rec.label !== 'string' ||
    typeof rec.description !== 'string' ||
    typeof rec.text !== 'string'
  ) {
    return null
  }

  if (rec.id.length === 0 || rec.id.length > MAX_ID) {
    return null
  }

  if (rec.label.length > MAX_LABEL || rec.description.length > MAX_DESCRIPTION || rec.text.length > MAX_TEXT) {
    return null
  }

  return {
    id: rec.id,
    label: rec.label,
    description: rec.description,
    text: rec.text
  }
}

function sanitizeList(raw: unknown): PromptSnippet[] {
  if (!Array.isArray(raw)) {
    return []
  }

  const out: PromptSnippet[] = []
  for (const item of raw) {
    const snippet = asSnippet(item)
    if (snippet) {
      out.push(snippet)
    }
  }
  return out
}

function cloneSeed(): PromptSnippet[] {
  return KAZIKE_TEMPLATES.map(item => ({
    id: item.id,
    label: item.label,
    description: item.description,
    text: item.text
  }))
}

const persistedRaw = readKey(PROMPT_SNIPPETS_STORAGE_KEY)
let shouldSeed = persistedRaw === null

if (persistedRaw !== null) {
  try {
    const parsed: unknown = JSON.parse(persistedRaw)
    shouldSeed = !Array.isArray(parsed)
  } catch {
    shouldSeed = true
  }
}

export const $promptSnippets = persistentAtom<PromptSnippet[]>(
  PROMPT_SNIPPETS_STORAGE_KEY,
  [],
  Codecs.json(sanitizeList)
)

function ensureSeeded(): void {
  if (!shouldSeed) {
    return
  }

  shouldSeed = false
  $promptSnippets.set(cloneSeed())
}

export function loadSnippets(): PromptSnippet[] {
  ensureSeeded()
  return $promptSnippets.get().map(item => ({ ...item }))
}

export function saveSnippets(items: PromptSnippet[]): void {
  shouldSeed = false
  $promptSnippets.set(sanitizeList(items))
}

export function createSnippetId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `custom-${crypto.randomUUID()}`
  }

  return `custom-${Date.now().toString(36)}`
}
