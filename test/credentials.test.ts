import { mkdtempSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearCredential,
  credentialsPath,
  loadCredential,
  saveCredential,
} from "../src/credentials.js";

const PROD = "https://api.server4agent.com";
const STAGING = "https://api.staging.example";

function scratch(): NodeJS.ProcessEnv {
  return { SERVER4AGENT_CONFIG_DIR: mkdtempSync(join(tmpdir(), "s4a-cli-")) };
}

afterEach(() => {
  delete process.env.SERVER4AGENT_API_KEY;
});

describe("credential storage", () => {
  it("round-trips a credential", () => {
    const env = scratch();
    saveCredential(PROD, { key: "sk_live_a", label: "laptop" }, env);
    expect(loadCredential(PROD, env)).toMatchObject({ key: "sk_live_a", label: "laptop" });
  });

  it("writes the file 0600", () => {
    const env = scratch();
    const path = saveCredential(PROD, { key: "sk_live_a" }, env);
    // A key readable by every account on a shared box is the failure this
    // guards, so assert the bits rather than trusting the write options.
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("tightens the mode on a file that already existed too open", () => {
    const env = scratch();
    const path = credentialsPath(env);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, "{}", { mode: 0o644 });
    saveCredential(PROD, { key: "sk_live_a" }, env);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("keeps hosts apart so a staging sign-in cannot clobber production", () => {
    const env = scratch();
    saveCredential(PROD, { key: "sk_live_prod" }, env);
    saveCredential(STAGING, { key: "sk_live_staging" }, env);
    expect(loadCredential(PROD, env)?.key).toBe("sk_live_prod");
    expect(loadCredential(STAGING, env)?.key).toBe("sk_live_staging");
  });

  it("returns null when nothing is stored", () => {
    expect(loadCredential(PROD, scratch())).toBeNull();
  });

  it("lets the environment override anything on disk", () => {
    const env = scratch();
    saveCredential(PROD, { key: "sk_live_file" }, env);
    env.SERVER4AGENT_API_KEY = "sk_live_env";
    // This is what makes one command work in CI and on a laptop unchanged.
    expect(loadCredential(PROD, env)).toMatchObject({ key: "sk_live_env" });
  });

  it("ignores a blank environment key rather than signing in as nobody", () => {
    const env = scratch();
    saveCredential(PROD, { key: "sk_live_file" }, env);
    env.SERVER4AGENT_API_KEY = "   ";
    expect(loadCredential(PROD, env)?.key).toBe("sk_live_file");
  });

  it("treats a corrupt file as empty and still saves over it", () => {
    const env = scratch();
    const path = credentialsPath(env);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, "{ not json", { mode: 0o600 });
    expect(loadCredential(PROD, env)).toBeNull();
    saveCredential(PROD, { key: "sk_live_a" }, env);
    expect(loadCredential(PROD, env)?.key).toBe("sk_live_a");
  });

  it("forgets one host and leaves the other", () => {
    const env = scratch();
    saveCredential(PROD, { key: "sk_live_prod" }, env);
    saveCredential(STAGING, { key: "sk_live_staging" }, env);
    expect(clearCredential(PROD, env)).toBe(true);
    expect(loadCredential(PROD, env)).toBeNull();
    expect(loadCredential(STAGING, env)?.key).toBe("sk_live_staging");
  });

  it("reports when there was nothing to forget", () => {
    expect(clearCredential(PROD, scratch())).toBe(false);
  });

  it("removes the file once the last credential is gone", () => {
    const env = scratch();
    saveCredential(PROD, { key: "sk_live_a" }, env);
    expect(clearCredential(PROD, env)).toBe(true);
    expect(() => statSync(credentialsPath(env))).toThrow();
  });
});
