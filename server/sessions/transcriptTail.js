const fs = require('fs');

const PENDING_TOOLS = /^(AskUserQuestion|ExitPlanMode)$/;
const DEFAULT_STALE_MS = 30 * 60 * 1000; // mid-tool and quiet this long reads as ended mid-turn
const DEFAULT_MAX_BYTES = 512 * 1024; // only the end of a transcript decides the last turn
const MAX_TEXT = 6000;

/**
 * @typedef {{id: string, ts: number, blocks: any[], apiError: boolean}} Message one assistant message, gathered
 *   from the records that carry its blocks
 * @typedef {{ts: number, kind: 'prompt'|'wake'|'toolresult', text?: string}} TurnEvent
 */

/** @type {(c: unknown) => string} */
const textOf = (c) =>
  typeof c === 'string'
    ? c
    : Array.isArray(c)
      ? c
          .filter((b) => b && b.type === 'text')
          .map((b) => b.text)
          .join('\n')
      : '';

/**
 * The end of a transcript file. A long-running session's transcript reaches tens of megabytes, and
 * this runs on the collector's event loop on every refresh, so only the tail is read; the first
 * (probably partial) line of that tail is dropped. Everything the last turn needs is at the end.
 * @param {string} file transcript path
 * @param {number} maxBytes how much of the end to read
 * @returns {string} text of the tail ('' when the file cannot be read)
 */
function readTailText(file, maxBytes) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return '';
  }
  if (stat.size <= maxBytes) {
    try {
      return fs.readFileSync(file, 'utf8');
    } catch {
      return '';
    }
  }
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(maxBytes);
    fs.readSync(fd, buf, 0, maxBytes, stat.size - maxBytes);
    const text = buf.toString('utf8');
    return text.slice(text.indexOf('\n') + 1);
  } catch {
    return '';
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

/**
 * What a user record means for turn-taking: a real prompt, an automated wake-up, a tool result, or
 * nothing at all. Only a prompt hands the turn back to the agent.
 * @param {any} r transcript record of type 'user'
 * @returns {{kind: 'prompt'|'wake'|'toolresult', text?: string}|null}
 */
function userEvent(r) {
  const c = r.message.content;
  if (Array.isArray(c) && c.some((b) => b && b.type === 'tool_result')) return { kind: 'toolresult' };
  if (r.isMeta) return null; // context injected alongside a prompt, not a turn boundary
  const text = textOf(c).trim();
  if (!text) return null;
  if (r.isCompactSummary) return { kind: 'wake' };
  if (text.includes('<command-name>')) {
    const name = (text.match(/<command-name>([^<]*)<\/command-name>/) || [])[1] || '';
    const args = (text.match(/<command-args>([\s\S]*?)<\/command-args>/) || [])[1] || '';
    return { kind: 'prompt', text: (name + ' ' + args).trim() };
  }
  if (text.startsWith('<local-command')) return null;
  if (text.startsWith('<')) return { kind: 'wake' }; // task notifications and other automated wake-ups
  return { kind: 'prompt', text };
}

/** @type {(s: string, n: number) => string} */
const cap = (s, n) =>
  s.length <= n ? s : s.slice(0, Math.floor(n * 0.3)) + '\n[... middle cut ...]\n' + s.slice(-Math.floor(n * 0.7));

/**
 * The state of a session's last turn, read from its transcript files (a session has more than one
 * when it was resumed). A turn that ends without a tool call has handed the turn back; one that
 * stops mid-tool is still working until it goes quiet, and then it ended mid-turn.
 * @param {string[]} files transcript paths
 * @param {{now?: number, staleMs?: number, maxBytes?: number}} [opts] clock, quiet threshold, tail size
 * @returns {{state:'waiting'|'working'|'abandoned', lastActivity:number, messageId:string,
 *   pendingQuestion:boolean, apiError:boolean, finalText:string}|null} null when nothing was said
 */
function readTranscriptTail(
  files,
  { now = Date.now(), staleMs = DEFAULT_STALE_MS, maxBytes = DEFAULT_MAX_BYTES } = {}
) {
  /** @type {Map<string, Message>} */
  const msgs = new Map();
  /** @type {TurnEvent[]} */
  const events = [];
  for (const file of files) {
    const raw = readTailText(file, maxBytes);
    if (!raw) continue;
    for (const line of raw.split(/\r?\n/)) {
      if (!line) continue;
      let r;
      try {
        r = JSON.parse(line);
      } catch {
        continue;
      }
      if (r.isSidechain || !r.message || !r.timestamp) continue;
      const ts = Date.parse(r.timestamp);
      if (r.type === 'assistant' && Array.isArray(r.message.content)) {
        const id = r.message.id || r.uuid;
        if (!msgs.has(id)) msgs.set(id, { id, ts, blocks: [], apiError: false });
        const m = /** @type {Message} */ (msgs.get(id));
        m.ts = Math.max(m.ts, ts);
        m.blocks.push(...r.message.content);
        if (r.isApiErrorMessage) m.apiError = true;
      } else if (r.type === 'user') {
        const e = userEvent(r);
        if (e) events.push({ ts, ...e });
      }
    }
  }
  if (!msgs.size) return null;

  const ordered = [...msgs.values()].sort((a, b) => a.ts - b.ts);
  const last = ordered[ordered.length - 1];
  const lastEvent = events.reduce((a, e) => (!a || e.ts > a.ts ? e : a), /** @type {TurnEvent|null} */ (null));
  const activityAfter = !!lastEvent && lastEvent.ts > last.ts;
  const toolUses = last.blocks.filter((b) => b.type === 'tool_use');
  const pendingQuestion = !activityAfter && toolUses.some((b) => PENDING_TOOLS.test(b.name));
  const lastActivity = Math.max(last.ts, activityAfter ? /** @type {TurnEvent} */ (lastEvent).ts : 0);

  /** @type {'waiting'|'working'|'abandoned'} */
  let state;
  if (!activityAfter && (toolUses.length === 0 || pendingQuestion)) state = 'waiting';
  else state = now - lastActivity > staleMs ? 'abandoned' : 'working';

  let finalText = last.blocks
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
  let messageId = last.id;
  if (pendingQuestion) {
    for (const b of toolUses) {
      const input = b.input || {};
      if (b.name === 'AskUserQuestion' && Array.isArray(input.questions)) {
        finalText +=
          '\n\n[Asked with the question tool] ' +
          input.questions
            .map(
              (/** @type {any} */ q) =>
                q.question + ' Options: ' + (q.options || []).map((/** @type {any} */ o) => o.label).join(' / ')
            )
            .join(' | ');
      }
      if (b.name === 'ExitPlanMode') finalText += '\n\n[Plan submitted for approval] ' + String(input.plan || '');
    }
  }
  if (!finalText) {
    const spoken = [...ordered].reverse().find((m) => m.blocks.some((b) => b.type === 'text' && String(b.text).trim()));
    if (spoken) {
      finalText = spoken.blocks
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
      messageId = spoken.id;
    }
  }
  return {
    state,
    lastActivity,
    messageId,
    pendingQuestion,
    apiError: last.apiError,
    finalText: cap(finalText, MAX_TEXT),
  };
}

module.exports = { readTranscriptTail, readTailText, userEvent };
