import vm from "node:vm";
import { Platform } from "youtubei.js";

interface EvalArgs {
  n?: string;
  sp?: string;
  sig?: string;
}

interface EvalData {
  output: string;
}

function evaluate(data: EvalData, env: EvalArgs): { sig?: string; n?: string } {
  // data.output is a self-contained script that ends with a top-level
  // `return process(...)`. Wrap it in an IIFE so the top-level `return`
  // is legal under CommonJS-style evaluation.
  const script = `(function(){\n${data.output}\n})()`;
  const ctx = vm.createContext({ env, console });
  const result = vm.runInContext(script, ctx, { timeout: 5_000 });
  if (typeof result !== "object" || result === null) {
    throw new Error("Player script evaluation returned non-object");
  }
  return result as { sig?: string; n?: string };
}

let installed = false;

export function installJsEvaluator(): void {
  if (installed) return;
  const shim = Platform.shim as unknown as { eval: typeof evaluate };
  shim.eval = evaluate;
  installed = true;
}
