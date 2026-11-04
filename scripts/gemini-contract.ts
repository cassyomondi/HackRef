import { loadOperatorEnvironment } from "../src/lib/evaluation/operator-environment";
import { describeProviderContract } from "../src/lib/evaluation/contract-smoke";
import { describeDiagnostic, diagnosticOptions, runProviderDiagnostic, type DiagnosticCase } from "../src/lib/evaluation/provider-diagnostic";
import { GeminiError } from "../src/lib/evaluation/provider-errors";

function argumentsFor(args: string[]) {
  let live = false, describe = false, compare = false;
  let selectedCase: DiagnosticCase | undefined;
  let maxOutputTokens: number | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--live") live = true;
    else if (arg === "--describe") describe = true;
    else if (arg === "--compare") compare = true;
    else if (arg === "--case" && ["A", "B", "C"].includes(args[i + 1])) selectedCase = args[++i] as DiagnosticCase;
    else if (arg === "--max-output-tokens" && /^\d+$/.test(args[i + 1] ?? "")) maxOutputTokens = Number(args[++i]);
    else throw new Error("Invalid diagnostic arguments.");
  }
  if ((live && describe) || (compare && selectedCase)) throw new Error("Conflicting diagnostic arguments.");
  return { live, cases: compare ? ["A", "B", "C"] as DiagnosticCase[] : [selectedCase ?? "C"], maxOutputTokens };
}

async function main() {
  let options: ReturnType<typeof argumentsFor>;
  try {
    options = argumentsFor(process.argv.slice(2));
    diagnosticOptions(options); // Validate limits before configuration or calls.
  } catch {
    console.error("Use --describe or --live; optionally --compare or --case A|B|C, and --max-output-tokens 256..12000. No call made.");
    process.exitCode = 2;
    return;
  }
  try {
    // Both offline and live diagnostics read the same configuration as the
    // worker. Return only the selected model and source labels, never env values.
    const environment = loadOperatorEnvironment();
    if (!options.live) {
      console.log(JSON.stringify({ status: "NOT_RUN", ...environment, ...describeProviderContract(environment.selectedModel), requests: describeDiagnostic(options) }, null, 2));
      return;
    }
    const results = await runProviderDiagnostic(options, (row) => console.log(JSON.stringify({ ...environment, ...row })));
    if (results.some((row) => row.status !== "PASS")) process.exitCode = 1;
  } catch (error) {
    // No raw exception, response, prompt, source text, headers or key is printed.
    console.error(JSON.stringify({ status: "FAIL", httpStatus: error instanceof GeminiError ? error.providerStatus ?? null : null,
      category: error instanceof GeminiError ? error.code : "DIAGNOSTIC_CONFIGURATION_FAILED" }));
    process.exitCode = 1;
  }
}
main().catch(() => { console.error('{"status":"FAIL","category":"DIAGNOSTIC_STARTUP_FAILED"}'); process.exitCode = 1; });
