import { describe, expect, it } from "vitest";
import {
  buildAuthorizeUrl,
  defaultLabel,
  exchangeCode,
  login,
  readCallback,
} from "../src/login.js";

describe("buildAuthorizeUrl", () => {
  it("points the callback at a loopback address with the chosen port", () => {
    const url = new URL(
      buildAuthorizeUrl({ appUrl: "https://www.example", port: 51234, state: "s", label: "l" }),
    );
    expect(url.origin + url.pathname).toBe("https://www.example/cli/authorize");
    // 127.0.0.1 rather than localhost: the listener binds v4, and on a host
    // where localhost resolves to ::1 first the redirect would never arrive.
    expect(url.searchParams.get("callback")).toBe("http://127.0.0.1:51234/callback");
    expect(url.searchParams.get("state")).toBe("s");
    expect(url.searchParams.get("label")).toBe("l");
  });

  it("does not double the slash when the app url has a trailing one", () => {
    const url = buildAuthorizeUrl({
      appUrl: "https://www.example/",
      port: 1,
      state: "s",
      label: "l",
    });
    expect(url).toContain("https://www.example/cli/authorize");
    expect(url).not.toContain("//cli/authorize");
  });
});

describe("readCallback", () => {
  it("accepts a callback carrying the state we issued", () => {
    expect(readCallback("/callback?code=abc&state=xyz", "xyz")).toEqual({ ok: true, code: "abc" });
  });

  it("refuses a callback whose state is not ours", () => {
    // The point of state: another program on this machine cannot hand us a
    // code it got for a different account.
    const result = readCallback("/callback?code=abc&state=someone-else", "xyz");
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ error: expect.stringContaining("did not come from this terminal") });
  });

  it("refuses a callback with no state at all", () => {
    expect(readCallback("/callback?code=abc", "xyz").ok).toBe(false);
  });

  it("never accepts when we are not expecting a sign-in", () => {
    expect(readCallback("/callback?code=abc&state=", "").ok).toBe(false);
  });

  it("reports a cancelled sign-in in the user's terms", () => {
    const result = readCallback("/callback?error=access_denied&state=xyz", "xyz");
    expect(result).toMatchObject({ ok: false, error: "Sign-in was cancelled in the browser." });
  });

  it("passes through an unexpected error code", () => {
    expect(readCallback("/callback?error=weird&state=xyz", "xyz")).toMatchObject({
      ok: false,
      error: "Sign-in failed: weird",
    });
  });

  it("refuses a callback with the right state but no code", () => {
    expect(readCallback("/callback?state=xyz", "xyz").ok).toBe(false);
  });
});

describe("defaultLabel", () => {
  it("stays within the length the server accepts", () => {
    const label = defaultLabel();
    expect(label.length).toBeGreaterThan(0);
    expect(label.length).toBeLessThanOrEqual(40);
  });
});

describe("exchangeCode", () => {
  const ok = (body: unknown) =>
    (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;

  it("posts the code and returns the credential", async () => {
    let seen: { url: string; body: string } | null = null;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen = { url: String(url), body: String(init.body) };
      return new Response(JSON.stringify({ key: "sk_live_x", key_id: "k1", label: "laptop" }), {
        status: 200,
      });
    }) as unknown as typeof fetch;

    const credential = await exchangeCode({ apiUrl: "https://api.example", code: "c", fetchImpl });
    expect(seen!.url).toBe("https://api.example/cli/exchange");
    expect(JSON.parse(seen!.body)).toEqual({ code: "c" });
    expect(credential).toMatchObject({ key: "sk_live_x", key_id: "k1", label: "laptop" });
  });

  it("explains a rate limit rather than reporting a bare status", async () => {
    const fetchImpl = (async () => new Response("", { status: 429 })) as unknown as typeof fetch;
    await expect(
      exchangeCode({ apiUrl: "https://api.example", code: "c", fetchImpl }),
    ).rejects.toThrow(/too many attempts/);
  });

  it("fails on a rejected code", async () => {
    const fetchImpl = (async () => new Response("", { status: 400 })) as unknown as typeof fetch;
    await expect(
      exchangeCode({ apiUrl: "https://api.example", code: "c", fetchImpl }),
    ).rejects.toThrow(/HTTP 400/);
  });

  it("fails when the body carries no key", async () => {
    await expect(
      exchangeCode({ apiUrl: "https://api.example", code: "c", fetchImpl: ok({ label: "x" }) }),
    ).rejects.toThrow(/did not return a key/);
  });
});

describe("login", () => {
  // Drives the real loopback listener: the test plays the browser, so the
  // listener, the state check and the exchange are all exercised together.
  async function run(browser: (authorizeUrl: string) => Promise<unknown>, fetchImpl: typeof fetch) {
    let resolveUrl: (url: string) => void;
    const urlSeen = new Promise<string>((r) => (resolveUrl = r));
    const flow = login({
      appUrl: "https://www.example",
      apiUrl: "https://api.example",
      noBrowser: true,
      fetchImpl,
      onUrl: (url) => resolveUrl(url),
    });
    // Attach a handler now. The awaits below leave a window where a rejection
    // would otherwise be "unhandled" and reported as a suite error; awaiting
    // `flow` at the end still rejects for the caller.
    flow.catch(() => {});
    const authorizeUrl = await urlSeen;
    await browser(authorizeUrl);
    return flow;
  }

  /** Turn the authorize URL into the loopback URL the browser would be sent to. */
  function callbackUrl(authorizeUrl: string, params: Record<string, string>): string {
    const callback = new URL(new URL(authorizeUrl).searchParams.get("callback")!);
    for (const [k, v] of Object.entries(params)) callback.searchParams.set(k, v);
    return callback.toString();
  }

  const exchangeOk = (async () =>
    new Response(JSON.stringify({ key: "sk_live_ok", label: "laptop" }), {
      status: 200,
    })) as unknown as typeof fetch;

  it("completes when the browser returns the state it was given", async () => {
    const credential = await run(async (authorizeUrl) => {
      const state = new URL(authorizeUrl).searchParams.get("state")!;
      return fetch(callbackUrl(authorizeUrl, { code: "the-code", state }));
    }, exchangeOk);
    expect(credential.key).toBe("sk_live_ok");
  });

  it("issues a fresh state per sign-in", async () => {
    const states: string[] = [];
    for (let i = 0; i < 2; i++) {
      await run(async (authorizeUrl) => {
        const state = new URL(authorizeUrl).searchParams.get("state")!;
        states.push(state);
        return fetch(callbackUrl(authorizeUrl, { code: "c", state }));
      }, exchangeOk);
    }
    expect(states[0]).not.toBe(states[1]);
  });

  it("rejects a forged callback and never reaches the exchange", async () => {
    let exchanged = false;
    const fetchImpl = (async () => {
      exchanged = true;
      return new Response(JSON.stringify({ key: "sk_live_stolen" }), { status: 200 });
    }) as unknown as typeof fetch;

    await expect(
      run(
        (authorizeUrl) => fetch(callbackUrl(authorizeUrl, { code: "c", state: "forged" })),
        fetchImpl,
      ),
    ).rejects.toThrow(/did not come from this terminal/);
    expect(exchanged).toBe(false);
  });

  it("surfaces a cancellation from the browser", async () => {
    await expect(
      run(async (authorizeUrl) => {
        const state = new URL(authorizeUrl).searchParams.get("state")!;
        return fetch(callbackUrl(authorizeUrl, { error: "access_denied", state }));
      }, exchangeOk),
    ).rejects.toThrow(/cancelled/);
  });

  it("gives up rather than hanging when nobody approves", async () => {
    await expect(
      login({
        appUrl: "https://www.example",
        apiUrl: "https://api.example",
        noBrowser: true,
        timeoutMs: 40,
        fetchImpl: exchangeOk,
        onUrl: () => {},
      }),
    ).rejects.toThrow(/Timed out/);
  });
});
