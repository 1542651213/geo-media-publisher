import { readFileSync } from 'node:fs';

/** Source guards continue checking the real handlers after presentation-only extraction. */
export function rendererSource(entry: 'App' | 'V11Workspace' | 'OperationsCenter'): string {
  const paths = entry === 'App' ? ['App.tsx', 'AppShell.tsx', 'legacy/LegacyWorkspacePages.tsx'] : entry === 'V11Workspace' ? ['V11Workspace.tsx', 'workspace/AccountsWorkspace.tsx', 'workspace/PublishWorkspace.tsx', 'workspace/workspace-utils.ts'] : ['OperationsCenter.tsx', 'operations/TodayWorkspace.tsx', 'operations/OwnerActions.tsx'];
  return paths.map(path => readFileSync(`apps/desktop/src/renderer/${path}`, 'utf8')).join('\n');
}
