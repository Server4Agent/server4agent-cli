// Where the CLI keeps the key it was handed.
//
// A file, not the OS keychain, and deliberately: every keychain binding for
// Node is a native module, and a native module in a CLI people run with npx is
// a compiler toolchain in the install path. The SDKs here ship zero runtime
// dependencies and this keeps that promise. What the file gives up in secrecy
// it takes back in being inspectable, portable, and easy to revoke: the key it
// holds is an ordinary sk_live_ key, listed and revocable in the dashboard like
// any other.
//
// Layout is keyed by API base so a staging sign-in cannot overwrite production:
//
//   {
//     "https://api.server4agent.com": {
//       "key": "sk_live_…", "key_id": "…", "label": "…", "created_at": "…"
//     }
//   }

import { chmodSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface StoredCredential {
  key: string;
  key_id?: string;
  label?: string;
  created_at?: string;
}

/** 0600: readable by the user who signed in, nobody else on a shared box. */
const FILE_MODE = 0o600;
const DIR_MODE = 0o700;

export function credentialsPath(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.SERVER4AGENT_CONFIG_DIR?.trim();
  const dir = override || join(env.XDG_CONFIG_HOME?.trim() || homedir(), ".server4agent");
  return join(dir, "credentials.json");
}

type Store = Record<string, StoredCredential>;

function readStore(path: string): Store {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Store;
  } catch {
    // Missing, unreadable, or corrupt all mean the same thing to a caller: we
    // have nothing stored. A corrupt file is replaced on the next save rather
    // than aborting a sign-in the user just approved in a browser.
    return {};
  }
}

function writeStore(path: string, store: Store): void {
  mkdirSync(dirname(path), { recursive: true, mode: DIR_MODE });
  // Create with the restrictive mode rather than widening later, so the key is
  // never briefly world-readable. chmod after covers a pre-existing file whose
  // mode is wrong.
  writeFileSync(path, `${JSON.stringify(store, null, 2)}\n`, { mode: FILE_MODE });
  chmodSync(path, FILE_MODE);
}

/**
 * The credential for one API base, or null.
 *
 * SERVER4AGENT_API_KEY wins over anything stored. That is what makes CI work:
 * the same command reads a key from the environment there and from the file on
 * a laptop, with no branch in the calling code.
 */
export function loadCredential(
  apiUrl: string,
  env: NodeJS.ProcessEnv = process.env,
): StoredCredential | null {
  const fromEnv = env.SERVER4AGENT_API_KEY?.trim();
  if (fromEnv) return { key: fromEnv, label: "SERVER4AGENT_API_KEY" };
  return readStore(credentialsPath(env))[apiUrl] ?? null;
}

export function saveCredential(
  apiUrl: string,
  credential: StoredCredential,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const path = credentialsPath(env);
  const store = readStore(path);
  store[apiUrl] = credential;
  writeStore(path, store);
  return path;
}

/** Returns true when something was actually removed. */
export function clearCredential(apiUrl: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const path = credentialsPath(env);
  const store = readStore(path);
  if (!(apiUrl in store)) return false;
  delete store[apiUrl];
  if (Object.keys(store).length === 0) {
    if (existsSync(path)) rmSync(path);
    return true;
  }
  writeStore(path, store);
  return true;
}
