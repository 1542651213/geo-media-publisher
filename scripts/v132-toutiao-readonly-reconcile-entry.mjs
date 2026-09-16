import { register } from "tsx/esm/api";

register();
await import(`./v132-toutiao-readonly-reconcile.mts?run=${Date.now()}`);
