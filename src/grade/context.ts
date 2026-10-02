// Shared input contract for mechanical + judgment graders.

import type { SystemCatalog, SystemConfig, SystemId, SystemTokens, Task } from '../types.ts';
import type { StaticAttrValue } from './angular.ts';
import type { FileAnalysis } from './ast.ts';

export interface AnalyzedFile {
  path: string;
  source: string;
  analysis: FileAnalysis;
}

export interface GradeContext {
  system: SystemId;
  systemCfg: SystemConfig;
  catalog: SystemCatalog;
  tokens: SystemTokens;
  task: Task;
  files: AnalyzedFile[];
  workspaceDir: string;
  /**
   * Angular cells only (SystemConfig.framework 'angular'): static attribute
   * values written on design-system elements, which the compile dimension
   * checks against the catalog because Angular's own compiler does not, and
   * any template the parser could not read.
   */
  angular?: { staticValues: StaticAttrValue[]; templateErrors: string[] };
}
