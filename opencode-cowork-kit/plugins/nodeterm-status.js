// nodeterm managed plugin — do not edit (reinstalled at app launch)
import fs from 'node:fs'
import http from 'node:http'

// The SAME quote-aware parser every TS consumer of the endpoint file uses, embedded verbatim
// (this plugin runs standalone under Bun/node — it cannot import from the app). Values are
// posixQuote'd since #351; a quote-blind read would present a token wrapped in literal quotes,
// which the hook server's constant-time bearer check rejects on every POST.
const parseEndpointEnv = function parseEndpointEnv(text) {
  const env = {};
  for (const line of text.split("\n")) {
    const i = line.indexOf("=");
    if (i <= 0) continue;
    let v = line.slice(i + 1);
    if (v.length >= 2 && v.charAt(0) === "'" && v.charAt(v.length - 1) === "'") {
      v = v.slice(1, -1).split("'\\''").join("'");
    }
    env[line.slice(0, i)] = v;
  }
  return env;
}

export const NodetermStatus = async () => {
  const nodeId = process.env.NODETERM_NODE_ID
  if (!nodeId) return {}
  const live = () => {
    const conf = {
      port: process.env.NODETERM_HOOK_PORT,
      sock: process.env.NODETERM_HOOK_SOCK,
      token: process.env.NODETERM_HOOK_TOKEN,
      version: process.env.NODETERM_HOOK_VERSION,
      tokenDir: process.env.NODETERM_NODE_TOKEN_DIR
    }
    try {
      const file = process.env.NODETERM_HOOK_ENDPOINT
      if (file) {
        const env = parseEndpointEnv(fs.readFileSync(file, 'utf8'))
        if ('NODETERM_HOOK_PORT' in env) conf.port = env.NODETERM_HOOK_PORT
        if ('NODETERM_HOOK_SOCK' in env) conf.sock = env.NODETERM_HOOK_SOCK
        if ('NODETERM_HOOK_TOKEN' in env) conf.token = env.NODETERM_HOOK_TOKEN
        if ('NODETERM_HOOK_VERSION' in env) conf.version = env.NODETERM_HOOK_VERSION
        // The v2 endpoint line: where this instance keeps per-node tokens.
        if ('NODETERM_NODE_TOKEN_DIR' in env) conf.tokenDir = env.NODETERM_NODE_TOKEN_DIR
      }
    } catch {}
    return conf
  }
  // The PER-NODE capability, read fresh per POST from <dir>/<nodeId> — a lookup by name, never a
  // scan, so this session can only ever present its own. Missing (pre-v2 endpoint, a node whose
  // token was never materialised) is an ordinary state: the header goes out EMPTY and the server
  // reads that as legacy, exactly like every client that predates this.
  const nodeToken = (dir) => {
    try {
      if (!dir) return ''
      return fs.readFileSync(dir + '/' + nodeId, 'utf8').split('\n')[0].trim()
    } catch {
      return ''
    }
  }
  const post = (event, extra) => {
    try {
      const { port, sock, token, version, tokenDir } = live()
      if (!token || (!sock && !port)) return
      const payload = JSON.stringify({ event, ...extra })
      const headers = {
        'content-type': 'application/x-www-form-urlencoded',
        'x-nodeterm-hook-token': token,
        'x-nodeterm-node-token': nodeToken(tokenDir)
      }
      const body =
        'nodeId=' + encodeURIComponent(nodeId) +
        '&version=' + encodeURIComponent(version || '') +
        '&payload=' + encodeURIComponent(payload)
      if (sock && typeof Bun !== 'undefined') {
        fetch('http://localhost/hook/opencode', { method: 'POST', unix: sock, headers, body }).catch(() => {})
      } else if (sock) {
        const req = http.request(
          { socketPath: sock, path: '/hook/opencode', method: 'POST', headers },
          (res) => res.resume()
        )
        req.on('error', () => {})
        req.end(body)
      } else {
        fetch('http://127.0.0.1:' + port + '/hook/opencode', { method: 'POST', headers, body }).catch(() => {})
      }
    } catch {}
  }
  const seenUserMsgs = new Set()
  return {
    event: async (input) => {
      const ev = input && input.event
      if (!ev || !ev.type) return
      const p = ev.properties || {}
      const info = p.info || {}
      switch (ev.type) {
        case 'session.created':
          return post('session.created', { sessionID: info.id || p.sessionID })
        case 'session.idle':
        case 'session.error':
          return post(ev.type, { sessionID: p.sessionID })
        case 'permission.updated':
          return post('permission.asked', { sessionID: p.sessionID })
        case 'permission.replied':
          return post('permission.replied', { sessionID: p.sessionID })
        // The question (elicitation) dialog blocks the turn WITHOUT idling the session —
        // unforwarded, the badge sat on RUNNING while the TUI waited for an answer.
        case 'question.asked':
        case 'question.replied':
        case 'question.rejected':
          return post(ev.type, { sessionID: p.sessionID })
        case 'message.updated': {
          if ((info.role || p.role) !== 'user') return
          if (info.id) {
            if (seenUserMsgs.has(info.id)) return
            seenUserMsgs.add(info.id)
            if (seenUserMsgs.size > 500) {
              for (const first of seenUserMsgs) { seenUserMsgs.delete(first); break }
            }
          }
          return post('message.updated', { sessionID: info.sessionID || p.sessionID, role: 'user' })
        }
      }
    },
    'tool.execute.before': async (input) =>
      post('tool.execute.before', { sessionID: input && input.sessionID })
  }
}
