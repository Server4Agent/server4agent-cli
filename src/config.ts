// Where the CLI talks to, and how that is overridden.
//
// Two hosts, because they do different jobs. The approval page is on the app
// origin, since that is where the session cookie lives. The REST API is on the
// api host, matching the JS and Python SDKs so a user who has configured one
// has configured all three.

/** The app origin, which serves /cli/authorize. */
export const DEFAULT_APP_URL = "https://www.server4agent.com";

/** The REST base, which serves /cli/exchange and /me. */
export const DEFAULT_API_URL = "https://api.server4agent.com";

export interface Endpoints {
  appUrl: string;
  apiUrl: string;
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * Resolve the endpoints, letting the environment point the CLI at a staging
 * deployment or a local dev server. Anyone running this against localhost is
 * doing so deliberately, so no scheme is enforced here; the loopback rule that
 * matters is on the callback, and the server enforces that itself.
 */
export function resolveEndpoints(env: NodeJS.ProcessEnv = process.env): Endpoints {
  return {
    appUrl: trimSlash(env.SERVER4AGENT_APP_URL?.trim() || DEFAULT_APP_URL),
    apiUrl: trimSlash(env.SERVER4AGENT_BASE_URL?.trim() || DEFAULT_API_URL),
  };
}
