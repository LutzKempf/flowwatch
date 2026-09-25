/**
 * Worktree name from a hook payload cwd (the segment after 'worktrees', else basename).
 * @param {string|undefined} cwd hook payload cwd
 * @returns {string} worktree name ('unknown' when cwd is missing)
 */
function worktreeOf(cwd) {
  if (!cwd) return 'unknown';
  const parts = cwd.replace(/\\/g, '/').split('/').filter(Boolean);
  const i = parts.lastIndexOf('worktrees');
  return i >= 0 && parts[i + 1] ? parts[i + 1] : parts[parts.length - 1];
}

// An openspec change, or a plan: tasks.md, or a markdown file in a plans/ folder (where a plan is usually written).
const FILE_SIGNAL = /(openspec\/changes\/|tasks\.md$|\/plans\/[^/]+\.md$)/;

// The notifications that mean the agent has stopped to wait for the operator (Claude Code's notification_type).
// A turn does not END while a question or a permission prompt waits -- no Stop fires -- so without these the wait
// read as the agent's work. idle_prompt comes after a turn has ended, when the operator is already waited on.
const WAITING_NOTICES = new Set([
  'permission_prompt',
  'elicitation_dialog',
  'elicitation_url_dialog',
  'agent_needs_input',
]);

/**
 * Maps one Claude Code hook payload to pipeline events. Keep in sync with the backfill parser
 * (server/sessions/transcriptParse.js): test/unit/hooks/eventRules.parity.test.js holds the two to the same rules.
 * @param {{hook_event_name: string, session_id: string, cwd?: string, tool_name?: string, notification_type?: string,
 *   tool_input?: {command?: string, skill?: string, name?: string, file_path?: string}}} h hook payload (stdin JSON)
 * @returns {Array<Record<string, any>>} 0..n partial events (no id/ts yet — the emit lib stamps those)
 */
function mapHookEvent(h) {
  const common = { session_id: h.session_id, worktree: worktreeOf(h.cwd) };
  const ev = h.hook_event_name;
  const tool = h.tool_name || '';
  const inp = h.tool_input || {};

  const one = (/** @type {Record<string, any>} */ fields) => [{ ...common, ...fields }];

  switch (ev) {
    case 'SessionStart':
      return one({ type: 'session_start' });
    case 'UserPromptSubmit':
      return one({ type: 'user_prompt' });
    case 'Stop':
      return one({ type: 'turn_stop' });
    case 'WorktreeRemove':
      return one({ type: 'worktree_remove' });
    case 'Notification':
      return WAITING_NOTICES.has(String(h.notification_type))
        ? one({ type: 'waiting', reason: h.notification_type })
        : [];
    case 'PreToolUse':
      if (tool === 'AskUserQuestion') return one({ type: 'waiting', reason: 'question' });
      if (/^(Bash|PowerShell)$/.test(tool) && inp.command) return one({ type: 'bash', command: inp.command });
      if (tool === 'Skill' && (inp.skill || inp.name)) return one({ type: 'skill', name: inp.skill || inp.name });
      return [];
    case 'PostToolUse':
      if (tool === 'AskUserQuestion') return one({ type: 'answered' });
      if (/^(Write|Edit)$/.test(tool) && inp.file_path && FILE_SIGNAL.test(inp.file_path.replace(/\\/g, '/')))
        return one({ type: 'file_change', path: inp.file_path.replace(/\\/g, '/') });
      if (/^(Bash|PowerShell)$/.test(tool) && inp.command && /\bgit commit\b/.test(inp.command))
        return one({ type: 'commit', touchesCode: null }); // hooks/emit.js resolves touchesCode
      return [];
    default:
      return [];
  }
}

module.exports = { mapHookEvent, worktreeOf };
