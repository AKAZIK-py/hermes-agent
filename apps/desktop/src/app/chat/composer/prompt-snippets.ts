/** User-editable prompt snippets for the Desktop composer.

Built-in list is a first-run seed — the original 3 composer snippets, using
the active UI language. After that the list lives in localStorage through the
shared `persistentAtom` choke point (same as themes), so cross-window sync /
telemetry hooks see the writes; add / edit / delete never touch i18n or source.

Scope: desktop-global (`hermes.desktop.prompt-snippets`), same class as
user-themes.
*/
import { Codecs, persistentAtom } from '@/lib/persisted'
import { readKey } from '@/lib/storage'

export interface PromptSnippet {
  id: string
  description: string
  label: string
  text: string
}

export type SnippetCopy = Pick<PromptSnippet, 'description' | 'label' | 'text'>

export const PROMPT_SNIPPETS_STORAGE_KEY = 'hermes.desktop.prompt-snippets'

/** Same keys as the pre-CRUD `SNIPPET_KEYS` in context-menu.tsx. */
export const BUILTIN_SNIPPET_KEYS = ['codeReview', 'implementationPlan', 'explainThis'] as const

export type BuiltinSnippetKey = (typeof BUILTIN_SNIPPET_KEYS)[number]

/** English fallback matching `i18n/en.ts` composer.snippets — used by tests and SSR. */
export const DEFAULT_SNIPPETS: PromptSnippet[] = [
  {
    id: 'codeReview',
    label: 'Code review',
    description: 'Audit the current change for regressions, dropped edge cases, and missing tests.',
    text: 'Please review this for bugs, regressions, and missing tests.'
  },
  {
    id: 'implementationPlan',
    label: 'Implementation plan',
    description: 'Outline an approach before touching code so the diff stays focused.',
    text: 'Please make a concise implementation plan before changing code.'
  },
  {
    id: 'explainThis',
    label: 'Explain this',
    description: 'Walk through how the selected code works and link to the key files.',
    text: 'Please explain how this works and point me to the key files.'
  }
]

function isSnippet(value: unknown): value is PromptSnippet {
  if (!value || typeof value !== 'object') {
    return false
  }

  const item = value as Partial<PromptSnippet>

  return (
    typeof item.id === 'string' &&
    item.id.length > 0 &&
    typeof item.label === 'string' &&
    typeof item.description === 'string' &&
    typeof item.text === 'string'
  )
}

function sanitizeList(raw: unknown): PromptSnippet[] {
  if (!Array.isArray(raw)) {
    return []
  }

  return raw.filter(isSnippet)
}

/** Build the built-in seed using the active locale's snippet copy when
 *  available, falling back to the English defaults. Called lazily so the
 *  i18n runtime is initialised. */
export function seedSnippets(copy?: Record<string, SnippetCopy>): PromptSnippet[] {
  return BUILTIN_SNIPPET_KEYS.map(id => {
    const localized = copy?.[id]
    const fallback = DEFAULT_SNIPPETS.find(item => item.id === id) ?? DEFAULT_SNIPPETS[0]

    return {
      id,
      label: localized?.label ?? fallback.label,
      description: localized?.description ?? fallback.description,
      text: localized?.text ?? fallback.text
    }
  })
}

// The empty array is a valid, user-owned state. Track whether seeding is
// needed from the persisted payload rather than from the current list length.
// This read happens before persistentAtom's fallback subscription writes []
// for a missing key.
const persistedRaw = readKey(PROMPT_SNIPPETS_STORAGE_KEY)
let shouldSeed = persistedRaw === null

if (persistedRaw !== null) {
  try {
    shouldSeed = !Array.isArray(JSON.parse(persistedRaw) as unknown)
  } catch {
    shouldSeed = true
  }
}

export const $promptSnippets = persistentAtom<PromptSnippet[]>(
  PROMPT_SNIPPETS_STORAGE_KEY,
  [],
  Codecs.json(sanitizeList)
)

/** Seed the store with locale-appropriate built-in snippets the first time
 *  the dialog opens (or after a corrupted-payload reset). A valid persisted
 *  empty list is intentional and must remain empty. */
function ensureSeeded(copy?: Record<string, SnippetCopy>): void {
  if (!shouldSeed) {
    return
  }

  shouldSeed = false
  $promptSnippets.set(seedSnippets(copy))
}

/** Load the snippet list. Missing/corrupt storage falls back to the seed. */
export function loadSnippets(copy?: Record<string, SnippetCopy>): PromptSnippet[] {
  ensureSeeded(copy)
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
