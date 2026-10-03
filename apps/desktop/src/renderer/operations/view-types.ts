import type { OperationsSnapshot } from '../../shared/content-operations';
import type { ProductHealthStatus } from '../../shared/product-platform-policy';

export interface OperationsViewSnapshot extends OperationsSnapshot {
  platformHealth: Array<{ platformKey: string; status: ProductHealthStatus; message: string }>;
  providers: Array<{ id: string; name: string; models: string[]; configured: boolean }>;
  templates: Array<{ id: string; name: string }>;
}

export type PlatformHealthRow = OperationsViewSnapshot['platformHealth'][number];
