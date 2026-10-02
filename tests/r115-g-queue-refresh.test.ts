import {expect,it,vi} from "vitest";
import {startOperationsQueueRefresh} from "../apps/desktop/src/renderer/operations-center-ui";
it("waits for each queue read and stops without scheduling again after company/unmount cleanup",async()=>{
  vi.useFakeTimers();try{let finish!:(value:unknown)=>void;const refresh=vi.fn(()=>new Promise(resolve=>{finish=resolve;}));const stop=startOperationsQueueRefresh(refresh,100);await vi.advanceTimersByTimeAsync(100);expect(refresh).toHaveBeenCalledTimes(1);await vi.advanceTimersByTimeAsync(1000);expect(refresh).toHaveBeenCalledTimes(1);stop();finish(undefined);await vi.advanceTimersByTimeAsync(1000);expect(refresh).toHaveBeenCalledTimes(1);expect(vi.getTimerCount()).toBe(0);}finally{vi.useRealTimers();}
});
