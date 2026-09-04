import { describe, expect, it, vi } from "vitest";
import type { ElementHandle, Locator } from "playwright-core";
import {
  readXiaohongshuUploadInputImmediately,
  type XiaohongshuUploadFileExpectation,
  type XiaohongshuUploadFileReadback,
  type XiaohongshuUploadInputFingerprint
} from "./upload-delivery-diagnostic";

const expected = { name: "task10s-safe-test.png", size: 19226, type: "image/png" } as const;

function inputWithHandle(handle: Pick<ElementHandle<HTMLInputElement>, "evaluate" | "setInputFiles">): Locator {
  return {
    elementHandle: vi.fn(async () => handle as ElementHandle<HTMLInputElement>)
  } as unknown as Locator;
}

const fingerprint: XiaohongshuUploadInputFingerprint = {
  tagName: "INPUT",
  type: "file",
  accept: "image/*",
  multiple: false,
  disabled: false,
  connected: true,
  classNameSafe: "upload-input"
};

const readback: XiaohongshuUploadFileReadback = {
  filesLength: 1,
  files: [{ name: expected.name, size: expected.size, type: expected.type, lastModified: 1788393600000 }]
};

describe("XHS upload delivery instrumentation", () => {
  it("uses one resolved input handle and reads its files immediately after setInputFiles", async () => {
    const evaluate = vi.fn()
      .mockResolvedValueOnce(fingerprint)
      .mockResolvedValueOnce(readback);
    const setInputFiles = vi.fn(async () => undefined);
    const locatorSetInputFiles = vi.fn(async () => undefined);
    const input = { ...inputWithHandle({ evaluate, setInputFiles }), setInputFiles: locatorSetInputFiles } as unknown as Locator;

    const result = await readXiaohongshuUploadInputImmediately(input, ["C:/fixtures/task10s-safe-test.png"], expected);

    expect(setInputFiles).toHaveBeenCalledTimes(1);
    expect(setInputFiles).toHaveBeenCalledWith(["C:/fixtures/task10s-safe-test.png"]);
    expect(locatorSetInputFiles).not.toHaveBeenCalled();
    expect(evaluate).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ status: "PASS", fingerprint, readback, expectedFixtureMatch: "YES" });
  });

  it("fires the controlled mutation-boundary callback immediately before setInputFiles", async () => {
    const evaluate = vi.fn()
      .mockResolvedValueOnce(fingerprint)
      .mockResolvedValueOnce(readback);
    const events: string[] = [];
    const setInputFiles = vi.fn(async () => { events.push("setInputFiles"); });
    const onMutationStarted = () => { events.push("mutationBoundary"); };
    const readWithCallback = readXiaohongshuUploadInputImmediately as unknown as (
      input: Locator,
      images: readonly string[],
      expected: XiaohongshuUploadFileExpectation,
      onMutationStarted: () => void
    ) => Promise<unknown>;

    await readWithCallback(inputWithHandle({ evaluate, setInputFiles }), ["C:/fixtures/task10s-safe-test.png"], expected, onMutationStarted);

    expect(events).toEqual(["mutationBoundary", "setInputFiles"]);
    expect(setInputFiles).toHaveBeenCalledTimes(1);
  });

  it("fails Layer 2 when the same input does not immediately contain the expected file metadata", async () => {
    const evaluate = vi.fn()
      .mockResolvedValueOnce(fingerprint)
      .mockResolvedValueOnce({ filesLength: 1, files: [{ name: "other.png", size: 3, type: "image/png", lastModified: 1 }] });
    const setInputFiles = vi.fn(async () => undefined);
    const result = await readXiaohongshuUploadInputImmediately(inputWithHandle({ evaluate, setInputFiles }), ["C:/fixtures/task10s-safe-test.png"], expected);

    expect(result).toMatchObject({ status: "FAIL", expectedFixtureMatch: "NO" });
    expect(setInputFiles).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the resolved input is detached before immediate readback", async () => {
    const evaluate = vi.fn()
      .mockResolvedValueOnce(fingerprint)
      .mockRejectedValueOnce(new Error("Element is not attached to the DOM"));
    const setInputFiles = vi.fn(async () => undefined);

    await expect(readXiaohongshuUploadInputImmediately(inputWithHandle({ evaluate, setInputFiles }), ["C:/fixtures/task10s-safe-test.png"], expected)).resolves.toMatchObject({ status: "FAIL", failureCode: "INPUT_DETACHED_DURING_READBACK" });
    expect(setInputFiles).toHaveBeenCalledTimes(1);
  });

  it("fails closed without mutating when no input handle can be resolved", async () => {
    const input = { elementHandle: vi.fn(async () => null) } as unknown as Locator;
    const result = await readXiaohongshuUploadInputImmediately(input, ["C:/fixtures/task10s-safe-test.png"], expected);

    expect(result).toMatchObject({ status: "FAIL", failureCode: "FILE_INPUT_HANDLE_UNAVAILABLE" });
  });

  it("requires one file and exact safe-fixture metadata for the controlled Layer 2 pass", async () => {
    const evaluate = vi.fn()
      .mockResolvedValueOnce(fingerprint)
      .mockResolvedValueOnce({ filesLength: 2, files: [readback.files[0], readback.files[0]] });
    const setInputFiles = vi.fn(async () => undefined);

    const result = await readXiaohongshuUploadInputImmediately(inputWithHandle({ evaluate, setInputFiles }), ["C:/fixtures/task10s-safe-test.png"], expected);

    expect(result).toMatchObject({ status: "FAIL", expectedFixtureMatch: "NO" });
    expect(result.readback.filesLength).toBe(2);
  });
});
