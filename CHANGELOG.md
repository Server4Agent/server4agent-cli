# Changelog

## 0.1.0

First release.

- `server4agent login` signs you in through the browser. It opens a listener on
  `127.0.0.1`, sends you to the approval page, and receives a short-lived code
  on the callback, which it trades over HTTPS for an ordinary `sk_live_` API
  key. The key itself never travels in a URL, so it stays out of browser
  history and referer headers. Pass `--label` to name the key that appears in
  your dashboard, or `--no-browser` to print the URL and open it yourself,
  which is what you want over SSH.
- `server4agent logout` forgets the stored key. It does not revoke it: revoke
  from the dashboard when you want the key itself dead.
- `server4agent whoami` shows which account the stored key belongs to, and
  where that key came from.
- Credentials live in `~/.server4agent/credentials.json`, written `0600`, keyed
  by API base so a staging sign-in cannot overwrite a production one.
  `SERVER4AGENT_API_KEY` takes precedence over anything stored, so the same
  commands work unchanged in CI.
- No runtime dependencies.
