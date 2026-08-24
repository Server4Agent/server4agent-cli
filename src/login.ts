// The terminal half of the browser sign-in.
//
// The server half lives in the app: /cli/authorize approves and mints, and
// /api/cli/exchange redeems. This opens a loopback listener, sends the browser
// there, checks the state it gets back, and trades the code for the key.
//
// Split so the decisions are testable without a socket or a browser:
// buildAuthorizeUrl, readCallback and exchangeCode are pure (or take an
// injected fetch), and login() is the wiring around them.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { hostname, userInfo } from "node:os";
import type { StoredCredential } from "./credentials.js";

/** Matches MAX_CLI_LABEL_LENGTH on the server, which truncates past it anyway. */
const MAX_LABEL = 40;

/** A person has to read a page and click. Five minutes is not a rush. */
export const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

export interface AuthorizeUrlOptions {
  appUrl: string;
  port: number;
  state: string;
  label: string;
}

export function buildAuthorizeUrl({ appUrl, port, state, label }: AuthorizeUrlOptions): string {
  const url = new URL("/cli/authorize", `${appUrl}/`);
  // 127.0.0.1 rather than localhost: on a machine where localhost resolves to
  // ::1 first, a v4-only listener would never see the redirect.
  url.searchParams.set("callback", `http://127.0.0.1:${port}/callback`);
  url.searchParams.set("state", state);
  url.searchParams.set("label", label);
  return url.toString();
}

/** "marcin on studio.local", the name that shows up in the dashboard. */
export function defaultLabel(): string {
  let who = "";
  try {
    who = userInfo().username;
  } catch {
    /* no username on some CI images */
  }
  const host = hostname() || "unknown machine";
  return (who ? `${who} on ${host}` : `CLI on ${host}`).slice(0, MAX_LABEL);
}

export type CallbackResult =
  | { ok: true; code: string }
  | { ok: false; error: string };

/**
 * Interpret the redirect the browser lands on.
 *
 * The state check is the whole reason state exists: it proves this callback
 * belongs to the sign-in this process started, so another program on the same
 * machine cannot hand us a code it obtained for a different account.
 */
export function readCallback(requestUrl: string, expectedState: string): CallbackResult {
  let url: URL;
  try {
    url = new URL(requestUrl, "http://127.0.0.1");
  } catch {
    return { ok: false, error: "The browser sent a callback we could not read." };
  }

  const state = url.searchParams.get("state") ?? "";
  // Length-independent compare is overkill for a value we generated and hold in
  // memory, but constant work costs nothing here and the habit is worth having.
  if (!expectedState || state !== expectedState) {
    return { ok: false, error: "This sign-in did not come from this terminal. Nothing was saved." };
  }

  const error = url.searchParams.get("error");
  if (error) {
    return {
      ok: false,
      error:
        error === "access_denied"
          ? "Sign-in was cancelled in the browser."
          : `Sign-in failed: ${error}`,
    };
  }

  const code = url.searchParams.get("code") ?? "";
  if (!code) return { ok: false, error: "The browser came back without a sign-in code." };
  return { ok: true, code };
}

export interface ExchangeOptions {
  apiUrl: string;
  code: string;
  fetchImpl?: typeof fetch;
}

/** Trade the one-time code for the key, over HTTPS. */
export async function exchangeCode({
  apiUrl,
  code,
  fetchImpl = fetch,
}: ExchangeOptions): Promise<StoredCredential> {
  const res = await fetchImpl(`${apiUrl}/cli/exchange`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code }),
  });

  if (!res.ok) {
    // The server answers every bad code with one shape on purpose, so there is
    // nothing more specific to report than the status.
    const detail = res.status === 429 ? "too many attempts, wait a minute" : `HTTP ${res.status}`;
    throw new Error(`Could not complete sign-in (${detail}).`);
  }

  const body = (await res.json()) as Partial<StoredCredential>;
  if (!body?.key) throw new Error("The server did not return a key.");
  return {
    key: body.key,
    key_id: body.key_id,
    label: body.label,
    created_at: body.created_at,
  };
}

/** Best effort. A headless box has no browser, which is why the URL is printed. */
export function openBrowser(url: string): void {
  const [command, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  try {
    const child = spawn(command, args as string[], { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
  } catch {
    /* printed above; nothing else to do */
  }
}

const DONE_PAGE = (message: string) =>
  `<!doctype html><meta charset="utf-8"><title>Server4Agent</title>` +
  `<body style="font:16px/1.6 system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0">` +
  `<p>${message}</p></body>`;

export interface LoginOptions {
  appUrl: string;
  apiUrl: string;
  label?: string;
  /** Skip launching a browser and just print the URL. */
  noBrowser?: boolean;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  onUrl?: (url: string) => void;
}

/**
 * Run the whole flow and return the credential. Does not persist it: the caller
 * decides that, which keeps this function usable for a dry run.
 */
export async function login(options: LoginOptions): Promise<StoredCredential> {
  const state = randomBytes(32).toString("base64url");
  const label = (options.label?.trim() || defaultLabel()).slice(0, MAX_LABEL);
  const timeoutMs = options.timeoutMs ?? LOGIN_TIMEOUT_MS;

  const settled = await new Promise<CallbackResult>((resolve) => {
    let done = false;
    const finish = (result: CallbackResult) => {
      if (done) return;
      done = true;
      server.close();
      clearTimeout(timer);
      resolve(result);
    };

    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      // Browsers ask for a favicon on any page they render. Answering 404
      // keeps it from being mistaken for the callback.
      if (!req.url || req.url.startsWith("/favicon.ico")) {
        res.writeHead(404).end();
        return;
      }
      const result = readCallback(req.url, state);
      res.writeHead(result.ok ? 200 : 400, { "content-type": "text/html; charset=utf-8" });
      res.end(
        DONE_PAGE(
          result.ok
            ? "Signed in. You can close this window and return to the terminal."
            : result.error,
        ),
      );
      finish(result);
    });

    const timer = setTimeout(
      () => finish({ ok: false, error: "Timed out waiting for the browser." }),
      timeoutMs,
    );
    // Do not hold the process open on the timer alone.
    timer.unref?.();

    server.on("error", (err) =>
      finish({ ok: false, error: `Could not open a local listener: ${err.message}` }),
    );

    // Port 0 asks the OS for a free port, so two sign-ins cannot collide.
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address === "string" || address === null) {
        finish({ ok: false, error: "Could not determine the local port." });
        return;
      }
      const authorizeUrl = buildAuthorizeUrl({
        appUrl: options.appUrl,
        port: address.port,
        state,
        label,
      });
      options.onUrl?.(authorizeUrl);
      if (!options.noBrowser) openBrowser(authorizeUrl);
    });
  });

  if (!settled.ok) throw new Error(settled.error);
  return exchangeCode({ apiUrl: options.apiUrl, code: settled.code, fetchImpl: options.fetchImpl });
}
