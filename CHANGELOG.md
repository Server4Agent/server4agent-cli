# Changelog

## 0.2.0

- Requires Node 22 or newer. Node 18 and 20 are both past end of life, so the
  floor now sits on the oldest release that still gets upstream fixes. The
  commands themselves are unchanged.

## 0.1.2

- `server4agent whoami` names you as well as the account when your key belongs
  to a teammate rather than the account owner, e.g.
  `grace@example.com in ada@example.com  via laptop`. Inside someone else's
  account those are different answers, and printing only the account reads as
  if you were signed in as its owner. A solo key prints exactly what it did
  before.

## 0.1.1

- `server4agent whoami` now prints the account it is signed in as. It read
  `email` from the top level of the `/me` response, where no such field exists,
  so it printed `(unknown account)` for everyone regardless of the key. The
  account fields are nested under `account`, and it reads them there now.

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
