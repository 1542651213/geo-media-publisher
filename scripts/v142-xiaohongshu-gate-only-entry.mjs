import { register } from "tsx/esm/api";

register();
const { runXiaohongshuGateOnly } = await import(`./v142-xiaohongshu-gate-only.mts?run=${Date.now()}`);
void runXiaohongshuGateOnly().then((evidence) => {
  console.log(JSON.stringify({ outputPath: process.env.XIAOHONGSHU_OUTPUT_PATH ?? "output/v142-xiaohongshu-gate-only.json", result: evidence.result, readyForRealSelfTest: evidence.readyForRealSelfTest, finalSubmitCount: evidence.finalSubmitCount }));
}).catch((error) => {
  console.error(`V142_ERROR=${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
