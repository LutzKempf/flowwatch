// Cleanup hands picked items to a session running the repo's own cleanup skill, named in flowwatch.json
// ("cleanup": { "skill": "<name>" }). Whether it is installed is a file check on the box's skills folder.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { cleanupSkillOf } = require('../../../server/sessions/buildLanes');

const skillsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-'));
fs.mkdirSync(path.join(skillsDir, 'tidy-up'));
fs.writeFileSync(path.join(skillsDir, 'tidy-up', 'SKILL.md'), '---\nname: tidy-up\n---\n');

test('a named skill is installed when its SKILL.md is in the skills folder, and missing when it is not', () => {
  expect(cleanupSkillOf({ skill: 'tidy-up' }, skillsDir)).toEqual({ name: 'tidy-up', state: 'installed' });
  expect(cleanupSkillOf({ skill: 'sweep' }, skillsDir)).toEqual({ name: 'sweep', state: 'missing' });
});

test.each([undefined, null, false])('no "cleanup" entry (%p) names no skill', (entry) => {
  expect(cleanupSkillOf(entry, skillsDir)).toEqual({ name: null, state: 'not-set' });
});

// The name starts the hand-off message ("/<name>") and is a folder name on disk: anything else is refused.
test.each([{ skill: '../tidy-up' }, { skill: 'tidy up' }, { skill: '' }, { skill: 42 }, {}, 'tidy-up'])(
  'an entry that does not name a skill (%p) is invalid, and never looked up',
  (entry) => {
    expect(cleanupSkillOf(entry, skillsDir)).toEqual({ name: null, state: 'invalid' });
  }
);
