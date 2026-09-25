const fs = require('fs');

// Version guard: we rely ONLY on these fields — type ('user'|'assistant'), timestamp (ISO),
// userType, message.content[].type/name/input, message.usage.{input,output}_tokens.
// A file where NO line matches that shape is treated as format drift: LOUD warn + empty result
// (never a silent wrong answer). Should the format change, `claude -p --output-format json` is the fallback.

/**
 * @typedef {{session_id: string, worktree?: string, ts: number, type: string, command?: string, name?: string,
 *   path?: string, tokensTotal?: number, touchesCode?: null, reason?: string}} TranscriptEvent
 */

/**
 * @param {any} rec one transcript line, parsed
 * @returns {boolean}
 */
function isHumanPrompt(rec) {
  if (rec.isSidechain === true) return false; // subagent turn, not the human operator
  if (rec.type !== 'user' || rec.userType !== 'external') return false;
  const c = rec.message && rec.message.content;
  if (typeof c === 'string') return true; // plain human text
  if (Array.isArray(c)) return !c.some((b) => b && b.type === 'tool_result'); // not a tool result
  return false;
}

/**
 * @param {any} rec one transcript line, parsed
 * @returns {boolean}
 */
function looksLikeKnownFormat(rec) {
  return (rec.type === 'user' || rec.type === 'assistant') && typeof rec.timestamp === 'string';
}

// Mirrors mapHookEvent's FILE_SIGNAL — the two mappers are deliberately separate implementations
// of one rule set, held to the same rules by test/unit/hooks/eventRules.parity.test.js.
// An openspec change, or a plan: tasks.md, or a markdown file in a plans/ folder (where a plan is usually written).
const FILE_SIGNAL = /(openspec\/changes\/|tasks\.md$|\/plans\/[^/]+\.md$)/;

/**
 * Parses one Claude Code session transcript (.jsonl) into pipeline events.
 * Turn-collapse: ONE turn_stop at the LAST assistant message before the next
 * human prompt. token_usage carries a CUMULATIVE tokensTotal (input+output).
 * @param {string} file transcript path
 * @param {{session_id:string, worktree?:string, warn?:(msg:string)=>void}} opts
 * @returns {TranscriptEvent[]} pipeline events (empty on unreadable file or format drift)
 */
function parseTranscript(file, { session_id, worktree, warn = console.warn }) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  /** @type {TranscriptEvent[]} */
  const out = [];
  let known = 0,
    total = 0;
  /** @type {TranscriptEvent|null} last assistant msg of the current (possibly multi-message) turn */
  let pendingStop = null;
  let cumTokens = 0;
  /** @type {Set<string>} the ids of questions put to the operator, so their answers can be told apart */
  const questions = new Set();

  const flushStop = () => {
    if (pendingStop) {
      out.push(pendingStop);
      pendingStop = null;
    }
  };

  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    let rec;
    try {
      rec = JSON.parse(t);
    } catch {
      continue;
    }
    total++;
    if (!looksLikeKnownFormat(rec)) continue;
    known++;
    const ts = Date.parse(rec.timestamp);
    if (Number.isNaN(ts)) continue;
    const base = { session_id, worktree, ts };

    if (isHumanPrompt(rec)) {
      flushStop(); // the previous turn ends at its LAST assistant msg
      out.push({ ...base, type: 'user_prompt' });
      continue;
    }
    // The operator's answer to a question arrives as a tool result, not a prompt: the turn goes on after it.
    if (rec.type === 'user' && rec.message && Array.isArray(rec.message.content)) {
      if (
        rec.message.content.some(
          (/** @type {any} */ b) => b && b.type === 'tool_result' && questions.has(b.tool_use_id)
        )
      )
        out.push({ ...base, type: 'answered' });
    }
    if (rec.type === 'assistant') {
      const blocks = rec.message && Array.isArray(rec.message.content) ? rec.message.content : [];
      for (const b of blocks) {
        if (b.type === 'tool_use' && b.name === 'AskUserQuestion') {
          out.push({ ...base, type: 'waiting', reason: 'question' });
          if (b.id) questions.add(b.id);
        }
        if (b.type === 'tool_use' && /^(Bash|PowerShell)$/.test(b.name) && b.input && b.input.command) {
          out.push({ ...base, type: 'bash', command: b.input.command });
          // touchesCode stays null: a historical commit has no HEAD to interrogate,
          // and claiming false would keep a session that wrote code out of Execute.
          if (/\bgit commit\b/.test(b.input.command)) out.push({ ...base, type: 'commit', touchesCode: null });
        }
        if (b.type === 'tool_use' && b.name === 'Skill' && b.input && (b.input.skill || b.input.name))
          out.push({ ...base, type: 'skill', name: b.input.skill || b.input.name });
        if (b.type === 'tool_use' && /^(Write|Edit)$/.test(b.name) && b.input && b.input.file_path) {
          const p = b.input.file_path.replace(/\\/g, '/');
          if (FILE_SIGNAL.test(p)) out.push({ ...base, type: 'file_change', path: p });
        }
      }
      const u = (rec.message && rec.message.usage) || rec.usage;
      if (u && (u.input_tokens || u.output_tokens)) {
        cumTokens += (u.input_tokens || 0) + (u.output_tokens || 0);
        out.push({ ...base, type: 'token_usage', tokensTotal: cumTokens }); // so a backfilled cost is never silently zero
      }
      // Turn-collapse: don't emit yet — a later assistant msg in the same
      // turn replaces this stop; the stop is flushed when the next HUMAN prompt arrives.
      pendingStop = { ...base, type: 'turn_stop' };
    }
  }
  flushStop();
  if (total > 0 && known === 0) {
    warn(
      `[flowwatch] transcript format not recognized (${file}) — skipped; ` +
        `update transcriptParse or use the 'claude -p --output-format json' fallback`
    );
    return [];
  }
  return out;
}

module.exports = { parseTranscript, isHumanPrompt };
