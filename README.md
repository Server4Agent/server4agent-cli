# @server4agent/cli

Sign in to [Server4Agent](https://www.server4agent.com) from your terminal, in a
browser, without copying a secret by hand.

This is not a second way to drive the API: the
[SDKs](https://www.server4agent.com/docs/sdks) and the
[MCP server](https://www.server4agent.com/docs/mcp) already do that. It exists
because getting a credential onto a machine was the one step that still meant
finding a dashboard, creating a key, and pasting it somewhere.

## Install

```bash
npm install -g @server4agent/cli
```

Or run it without installing:

```bash
npx @server4agent/cli login
```

Node 18+, no runtime dependencies.

## Sign in

```bash
server4agent login
```

Your browser opens on the approval page. Approve, and the key lands on this
machine. Name it something you will recognise later:

```bash
server4agent login --label "ci runner"
```

Over SSH, or anywhere without a browser to launch, print the URL and open it
wherever you do have one:

```bash
server4agent login --no-browser
```

Check what you are signed in as, and forget the key when you are done with the
machine:

```bash
server4agent whoami
server4agent logout
```

`logout` forgets the key locally. It stays valid until you revoke it in the
dashboard, which is what you want if the machine is gone or compromised.

## How the sign-in works

```
 terminal                    browser                 server4agent.com
 ────────                    ───────                 ────────────────
 login
  │ listen 127.0.0.1:PORT
  │ state = random
  └── open ─────────────►  /cli/authorize?callback=…&state=…&label=…
                                │  approve
                                └──────────────►  mints an sk_live_ key,
                                                  signs a 2-minute code
                           ◄──── redirect ─────── callback?code=…&state=…
  │ state matches?
  └── POST code (HTTPS) ─────────────────────►  /api/cli/exchange
  ◄─────────────── { key, label } ──────────────  verify, burn, decrypt
  store 0600
```

The redirect carries a code, never the key, so nothing secret is written to
browser history or leaked in a referer header. A code is good for one
redemption and two minutes. The callback must be a loopback address, so the
code cannot be sent off the machine. The `state` value ties the callback to the
terminal that started the sign-in.

The result is an ordinary API key. It appears in your dashboard alongside any
key you made by hand, and it is revoked the same way.

## Where the key is stored

`~/.server4agent/credentials.json`, mode `0600`, keyed by API base:

```json
{
  "https://api.server4agent.com": {
    "key": "sk_live_…",
    "key_id": "…",
    "label": "marcin on studio.local",
    "created_at": "…"
  }
}
```

A file rather than the OS keychain, deliberately: every keychain binding for
Node is a native module, and a native module in something people run with `npx`
puts a compiler toolchain in the install path.

## Environment

| Variable | What it does |
| --- | --- |
| `SERVER4AGENT_API_KEY` | Use this key and ignore anything stored. This is how CI works: the same commands, no sign-in. |
| `SERVER4AGENT_BASE_URL` | REST base. Defaults to `https://api.server4agent.com`. |
| `SERVER4AGENT_APP_URL` | App origin serving the approval page. Defaults to `https://www.server4agent.com`. |
| `SERVER4AGENT_CONFIG_DIR` | Where `credentials.json` lives. |

## License

MIT
