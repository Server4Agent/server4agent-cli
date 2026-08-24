#!/usr/bin/env node
// server4agent: sign in once in a browser, and let everything else on this
// machine use the key.
//
// Commands are deliberately few. This is not a second way to drive the API,
// which the SDKs and the MCP server already do well. It exists because getting
// a credential onto a machine was the one step that still meant copying a
// secret out of a dashboard by hand.

import { resolveEndpoints } from "./config.js";
import { clearCredential, credentialsPath, loadCredential, saveCredential } from "./credentials.js";
import { login } from "./login.js";
import { VERSION } from "./version.js";

const HELP = `server4agent ${VERSION}

Usage
  server4agent login [--label <name>] [--no-browser]
  server4agent logout
  server4agent whoami
  server4agent --version

Commands
  login      Approve in a browser; the key is stored for this machine.
  logout     Forget the stored key. Revoke it in the dashboard to kill it.
  whoami     Show the account the stored key belongs to.

Environment
  SERVER4AGENT_API_KEY     Use this key and ignore anything stored.
  SERVER4AGENT_BASE_URL    REST base. Default https://api.server4agent.com
  SERVER4AGENT_APP_URL     App origin. Default https://www.server4agent.com
  SERVER4AGENT_CONFIG_DIR  Where credentials.json lives.
`;

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

/** Minimal flag reader: enough for the three commands, no dependency. */
function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const value = argv[i + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

async function cmdLogin(argv: string[]): Promise<void> {
  const { appUrl, apiUrl } = resolveEndpoints();

  if (process.env.SERVER4AGENT_API_KEY?.trim()) {
    // Signing in would store a key that every command then ignores. Say so
    // rather than leaving the user to wonder why nothing changed.
    process.stderr.write(
      "SERVER4AGENT_API_KEY is set, so it would take precedence over anything stored.\n" +
        "Unset it first if you want this machine to use a browser sign-in.\n",
    );
    process.exit(1);
  }

  const credential = await login({
    appUrl,
    apiUrl,
    label: flag(argv, "label"),
    noBrowser: argv.includes("--no-browser"),
    onUrl: (url) => {
      process.stdout.write(
        `Opening your browser to approve this sign-in.\nIf it does not open, visit:\n\n  ${url}\n\n`,
      );
    },
  }).catch((err: unknown) => fail(err instanceof Error ? err.message : String(err)));

  const path = saveCredential(apiUrl, credential);
  process.stdout.write(
    `Signed in. Key "${credential.label ?? "unnamed"}" saved to ${path} (mode 0600).\n` +
      `Revoke it any time from the dashboard.\n`,
  );
}

function cmdLogout(): void {
  const { apiUrl } = resolveEndpoints();
  const removed = clearCredential(apiUrl);
  process.stdout.write(
    removed
      ? `Signed out. The key is gone from ${credentialsPath()}, and is still live until you revoke it in the dashboard.\n`
      : "Nothing stored for this host, so nothing to forget.\n",
  );
}

async function cmdWhoami(): Promise<void> {
  const { apiUrl } = resolveEndpoints();
  const credential = loadCredential(apiUrl);
  if (!credential) fail("Not signed in. Run `server4agent login`.");

  const res = await fetch(`${apiUrl}/me`, {
    headers: { authorization: `Bearer ${credential.key}` },
  }).catch((err: unknown) => fail(`Could not reach ${apiUrl}: ${String(err)}`));

  if (res.status === 401) fail("The stored key is not valid. Run `server4agent login` again.");
  if (!res.ok) fail(`Could not read the account (HTTP ${res.status}).`);

  const me = (await res.json()) as { email?: string };
  const source = credential.label === "SERVER4AGENT_API_KEY" ? "SERVER4AGENT_API_KEY" : credential.label;
  process.stdout.write(`${me.email ?? "(unknown account)"}  via ${source ?? "stored key"}\n`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const command = argv[0];

  if (!command || command === "--help" || command === "-h" || command === "help") {
    process.stdout.write(HELP);
    return;
  }
  if (command === "--version" || command === "-v") {
    process.stdout.write(`${VERSION}\n`);
    return;
  }

  switch (command) {
    case "login":
      return cmdLogin(argv);
    case "logout":
      return cmdLogout();
    case "whoami":
      return cmdWhoami();
    default:
      fail(`Unknown command "${command}". Run \`server4agent --help\`.`);
  }
}

main().catch((err: unknown) => fail(err instanceof Error ? err.message : String(err)));
