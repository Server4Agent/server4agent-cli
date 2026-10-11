// Formatting for `server4agent whoami`, kept out of index.ts so it can be
// tested without importing the CLI entrypoint (which runs main() on import).

/**
 * The slice of GET /me this command needs. The account fields are nested:
 * the endpoint returns usage, key and resource counts alongside them, and
 * reading `email` off the top level silently yields undefined.
 *
 * `you` appears only when the key belongs to someone other than the account
 * owner, which is what happens once a teammate mints a key inside an account
 * they were invited to. Its absence is the ordinary solo case, not an error.
 */
export interface MeResponse {
  account?: { email?: string | null; name?: string | null } | null;
  you?: { email?: string | null; name?: string | null } | null;
}

/**
 * One line naming the account and where its key came from. `label` is the
 * stored credential's label, or "SERVER4AGENT_API_KEY" when the environment
 * supplied the key instead of the credentials file.
 *
 * When the key belongs to a teammate the line names both, because "whose
 * servers will this command touch" and "who am I" stop being the same
 * question the moment you are working inside someone else's account.
 */
export function formatIdentity(body: MeResponse, label?: string): string {
  const account = body.account?.email ?? "(unknown account)";
  const you = body.you?.email;
  const who = you && you !== account ? `${you} in ${account}` : account;
  return `${who}  via ${label ?? "stored key"}`;
}
