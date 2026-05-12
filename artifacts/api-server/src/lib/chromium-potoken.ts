/**
 * chromium-potoken — Mint a YouTube PO token inside a real headless Chromium.
 *
 * BotGuard's environment checks reject JSDOM (the integrity-token mint
 * function comes back as `undefined`, surfacing as "APF:Failed"). Running
 * the same bgutils-js flow inside an actual Chromium page passes those
 * checks, so we can use the resulting PO token to decipher streams on
 * cloud IPs (Replit Autoscale).
 *
 * Chromium is provided by Nix (`pkgs.chromium`) and the bgutils-js CJS
 * bundle is read from disk and injected into the page as a browser
 * <script>. The whole mint runs ad-hoc (no persistent browser process)
 * and the caller is expected to cache the resulting token.
 */
import { accessSync, constants as fsConstants } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import puppeteer from "puppeteer-core";

export interface PoTokenPair {
  token: string;
  visitor_data: string;
}

const REQUEST_KEY = "O43z0dpjhgX20SCx4KAo";

/** Resolve a chromium executable. Honours `CHROMIUM_PATH` for overrides. */
function resolveChromiumPath(): string {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  // Resolve `chromium` against PATH ourselves — puppeteer-core requires an
  // absolute executablePath and won't honor a bare command.
  const pathEnv = process.env.PATH ?? "";
  for (const dir of pathEnv.split(":")) {
    if (!dir) continue;
    const candidate = path.join(dir, "chromium");
    try {
      accessSync(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // keep looking
    }
  }
  // Last resort — let puppeteer surface the error.
  return "chromium";
}

/** Read the bgutils-js browser-friendly bundle from node_modules. */
async function loadBgutilsBundle(): Promise<string> {
  const req = createRequire(import.meta.url);
  // bgutils-js exports point `require` at bundle/index.cjs; resolve via that
  // entry so the lookup works whether we're running from src/ or dist/.
  const cjsPath = req.resolve("bgutils-js");
  let bundlePath = cjsPath;
  if (!cjsPath.endsWith(".cjs")) {
    // Fallback: walk up to package root and load bundle/index.cjs explicitly.
    const pkgDir = path.dirname(req.resolve("bgutils-js/package.json"));
    bundlePath = path.join(pkgDir, "bundle", "index.cjs");
  }
  return readFile(bundlePath, "utf8");
}

function generateIdentifier(): string {
  const raw = crypto.getRandomValues(new Uint8Array(11));
  const b64 = btoa(String.fromCharCode(...raw))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const ts = Math.floor(Date.now() / 1000);
  const buf = new ArrayBuffer(4);
  new DataView(buf).setUint32(0, ts);
  const tsEnc = btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${b64}${tsEnc}`;
}

/**
 * Launch chromium, navigate to youtube.com, run bgutils-js inside the
 * real page context, and return the minted PO token + visitor_data.
 *
 * Throws if chromium fails to launch or the mint fails. Always closes
 * the browser before returning.
 */
export async function mintPoTokenWithChromium(): Promise<PoTokenPair> {
  const bundle = await loadBgutilsBundle();
  const executablePath = resolveChromiumPath();
  console.log(`[chromium-potoken] launching chromium at ${executablePath}`);

  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-zygote",
      "--single-process",
    ],
  });

  try {
    const page = await browser.newPage();
    // youtube.com ships a Trusted-Types CSP that blocks `addScriptTag`.
    // Disabling CSP for this throwaway page is fine — we only run our
    // own injected code.
    await page.setBypassCSP(true);
    // Navigate to youtube.com so BotGuard's location/origin checks see a
    // real youtube.com page, not about:blank.
    await page.goto("https://www.youtube.com/", {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });

    const identifier = generateIdentifier();

    // Inject bgutils-js. The CJS bundle assumes a `module.exports` sink
    // and a `require` shim; wrap it so we can read `window.__bgutils`.
    const browserScript = `
      (function () {
        var module = { exports: {} };
        var exports = module.exports;
        function require() { throw new Error("require() not supported in browser"); }
        ${bundle}
        window.__bgutils = module.exports;
      })();
    `;
    await page.evaluate(browserScript);

    const result = await page.evaluate(
      async (id: string, requestKey: string): Promise<string> => {
        type BgGlobal = {
          BG: {
            Challenge: {
              create(opts: {
                fetch: typeof fetch;
                identifier: string;
                requestKey: string;
                useYouTubeAPI?: boolean;
              }): Promise<{
                interpreterJavascript: {
                  privateDoNotAccessOrElseSafeScriptWrappedValue: string | null;
                };
                program: string;
                globalName: string;
              } | undefined>;
            };
            PoToken: {
              generate(opts: {
                program: string;
                globalName: string;
                bgConfig: {
                  fetch: typeof fetch;
                  identifier: string;
                  requestKey: string;
                  globalObj: typeof window;
                };
              }): Promise<{ poToken: string }>;
            };
          };
        };
        const w = window as unknown as BgGlobal & { __bgutils: BgGlobal };
        const BG = w.__bgutils.BG;
        const challenge = await BG.Challenge.create({
          fetch: window.fetch.bind(window),
          identifier: id,
          requestKey,
          useYouTubeAPI: false,
        });
        if (!challenge) throw new Error("No challenge from WAA");
        const script =
          challenge.interpreterJavascript
            .privateDoNotAccessOrElseSafeScriptWrappedValue;
        if (!script) throw new Error("No interpreter script in challenge");
        // eslint-disable-next-line no-eval
        (0, eval)(script);
        const out = await BG.PoToken.generate({
          program: challenge.program,
          globalName: challenge.globalName,
          bgConfig: {
            fetch: window.fetch.bind(window),
            identifier: id,
            requestKey,
            globalObj: window,
          },
        });
        if (!out?.poToken) throw new Error("Mint returned no poToken");
        return out.poToken;
      },
      identifier,
      REQUEST_KEY,
    );

    return { token: result, visitor_data: identifier };
  } finally {
    await browser.close().catch(() => {});
  }
}
