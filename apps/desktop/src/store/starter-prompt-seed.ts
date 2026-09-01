/** Local dogfood seed: intentionally empty for clean tests.
 *  Parked packs: ~/.hermes/prompt-packs/{kazike,jiang}.json
 *  Hot-import: ~/.hermes/prompt-templates-inbox/ (prompt-import-inbox).
 *  Not for upstream — upstream uses getBuiltInTemplates(). */
import type { PromptTemplate } from './prompt-templates'

export function getStarterFolderSeed(): PromptTemplate[] {
  return []
}
