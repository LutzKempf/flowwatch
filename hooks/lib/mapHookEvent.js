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

const FILE_SIGNAL = /(openspec\/changes\/|tasks\.md$)/;

/**
 * Maps one Claude Code hook payload to pipeline events. Keep in sync with the backfill parser
 * (server/sessions/transcriptParse.js): test/unit/hooks/eventRules.parity.test.js holds the two to the same rules.
 * @param {{hook_event_name: string, session_id: string, cwd?: string, tool_name?: string,
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
    case 'PreToolUse':
      if (/^(Bash|PowerShell)$/.test(tool) && inp.command) return one({ type: 'bash', command: inp.command });
      if (tool === 'Skill' && (inp.skill || inp.name)) return one({ type: 'skill', name: inp.skill || inp.name });
      return [];
    case 'PostToolUse':
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
