import { register } from "tsx/esm/api";

register();
await import(`./v132-toutiao-real-publish.mts?run=${Date.now()}`);
