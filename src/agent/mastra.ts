/**
 * Ponte para o @mastra/core. O pacote é ESM-first, mas publica um build CommonJS (.cjs) para `require`.
 * Como a API Nest compila para CommonJS, os tipos vêm via `import type` (resolution-mode: import)
 * e o valor via `require`, isolando essa particularidade num único arquivo.
 */
import type * as MastraAgent from '@mastra/core/agent' with { 'resolution-mode': 'import' }
import type * as MastraTools from '@mastra/core/tools' with { 'resolution-mode': 'import' }

// eslint-disable-next-line @typescript-eslint/no-require-imports
export const { Agent } = require('@mastra/core/agent') as typeof MastraAgent
// eslint-disable-next-line @typescript-eslint/no-require-imports
export const { createTool } = require('@mastra/core/tools') as typeof MastraTools
