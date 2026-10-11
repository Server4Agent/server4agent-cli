import { describe, expect, it } from "vitest";
import { formatIdentity, type MeResponse } from "../src/whoami.js";

// The shape GET /me actually returns. Account fields are nested under
// `account`, alongside usage and resource counts this command ignores.
const REAL_ME: MeResponse = {
  account: { email: "marcin@northstar.example", name: "Marcin" },
};

describe("formatIdentity", () => {
  it("reads the email out of the nested account object", () => {
    // 0.1.0 read `email` off the top level, which is always undefined, so
    // every user saw "(unknown account)". Pin the real shape here.
    expect(formatIdentity(REAL_ME, "laptop")).toBe("marcin@northstar.example  via laptop");
  });

  it("does not read a top-level email", () => {
    // Guards the regression directly: a payload shaped the old way must not
    // be treated as an account.
    const wrongShape = { email: "marcin@northstar.example" } as MeResponse;
    expect(formatIdentity(wrongShape, "laptop")).toBe("(unknown account)  via laptop");
  });

  it("names the environment variable when the key came from there", () => {
    expect(formatIdentity(REAL_ME, "SERVER4AGENT_API_KEY")).toBe(
      "marcin@northstar.example  via SERVER4AGENT_API_KEY",
    );
  });

  it("falls back when the account carries no email", () => {
    expect(formatIdentity({ account: { email: null } }, "laptop")).toBe("(unknown account)  via laptop");
  });

  it("falls back when the response has no account at all", () => {
    expect(formatIdentity({}, "laptop")).toBe("(unknown account)  via laptop");
  });

  it("describes an unlabelled credential as the stored key", () => {
    expect(formatIdentity(REAL_ME, undefined)).toBe("marcin@northstar.example  via stored key");
  });

  it("names both when the key belongs to a teammate", () => {
    // Inside someone else's account, "whose servers is this about" and "who am
    // I" are different answers, and printing only the first reads as if you
    // were signed in as the owner.
    const teammate: MeResponse = {
      account: { email: "ada@northstar.example", name: "Ada" },
      you: { email: "grace@northstar.example", name: "Grace" },
    };
    expect(formatIdentity(teammate, "laptop")).toBe(
      "grace@northstar.example in ada@northstar.example  via laptop",
    );
  });

  it("does not repeat itself when the key holder is the owner", () => {
    // The control plane omits `you` in that case, but a client should not
    // depend on it: an echoed value must still print one name, not two.
    const echoed: MeResponse = {
      account: { email: "marcin@northstar.example" },
      you: { email: "marcin@northstar.example" },
    };
    expect(formatIdentity(echoed, "laptop")).toBe("marcin@northstar.example  via laptop");
  });
});
