/**
 * The stages feed: the stages a repo's work moves through, in the repo's own words, and how far each
 * workstream has got. Flowwatch knows no stage names of its own: the grid's header, the legend and the
 * milestone labels all come from here.
 *
 * Format 1: `{ "format": 1, "stages": ["idea", …], "milestoneStatus"?: [label per stage],
 * "workstreams": [{ "id", "name", "role"?, "cells": [one state per stage] }], "warnings"?: [sentences] }`,
 * with 1 to 20 stages and each cell one of CELL_STATES. At most one cell per workstream is its `frontier`:
 * the furthest stage it has passed.
 */

const { isName, listOfSentences } = require('./formatChecks');

/**
 * @typedef {{id: string, name: string, role?: string|null, cells: string[]}} Workstream
 * @typedef {{stages: string[], milestoneStatus?: string[], workstreams: Workstream[], warnings?: string[]}} StagesFeed
 */

const CELL_STATES = ['passed', 'inferred', 'frontier', 'skipped', 'failed', 'voided', 'none'];
const MAX_STAGES = 20;

/**
 * @param {any} data a parsed stages feed, not yet checked
 * @returns {string[]} what does not match the format; empty when it matches
 */
function checkStages(data) {
  const { stages, milestoneStatus, workstreams, warnings } = data;
  if (!Array.isArray(stages)) return ['"stages" must be a list of stage names'];
  if (stages.length === 0) return ['"stages" is empty'];
  if (stages.length > MAX_STAGES) return ['"stages" has ' + stages.length + ' entries; at most ' + MAX_STAGES];
  /** @type {string[]} */
  const problems = [];
  stages.forEach((s, i) => {
    if (!isName(s)) problems.push('stages[' + i + '] must be a name');
    else if (stages.indexOf(s) !== i) problems.push('stages[' + i + '] "' + s + '" is used twice');
  });
  if (milestoneStatus !== undefined) {
    if (!Array.isArray(milestoneStatus)) problems.push('"milestoneStatus" must be a list of labels');
    else if (milestoneStatus.length !== stages.length) {
      problems.push(
        '"milestoneStatus" has ' + milestoneStatus.length + ' labels; it needs one per stage (' + stages.length + ')'
      );
    } else
      milestoneStatus.forEach((l, i) => {
        if (!isName(l)) problems.push('milestoneStatus[' + i + '] must be a label');
      });
  }
  if (!Array.isArray(workstreams)) problems.push('"workstreams" must be a list');
  else {
    const ids = new Set();
    workstreams.forEach((w, i) =>
      problems.push(...workstreamProblems(w, 'workstreams[' + i + ']', stages.length, ids))
    );
  }
  problems.push(...listOfSentences(warnings, 'warnings'));
  return problems;
}

/**
 * @param {any} w one row of the feed, not yet checked
 * @param {string} at where it is, for the problems' wording
 * @param {number} stageCount
 * @param {Set<string>} ids the row ids seen so far
 * @returns {string[]}
 */
function workstreamProblems(w, at, stageCount, ids) {
  if (!w || typeof w !== 'object' || Array.isArray(w)) return [at + ' must be an object'];
  /** @type {string[]} */
  const problems = [];
  if (!isName(w.id)) problems.push(at + '.id must be a name');
  else if (ids.has(w.id)) problems.push(at + '.id "' + w.id + '" is used twice');
  else ids.add(w.id);
  if (!isName(w.name)) problems.push(at + '.name must be a name');
  if (w.role !== undefined && w.role !== null && typeof w.role !== 'string') problems.push(at + '.role must be text');
  if (!Array.isArray(w.cells)) return [...problems, at + '.cells must be a list'];
  if (w.cells.length !== stageCount)
    return [...problems, at + ' has ' + w.cells.length + ' cells; it needs one per stage (' + stageCount + ')'];
  w.cells.forEach((/** @type {any} */ c, /** @type {number} */ j) => {
    if (!CELL_STATES.includes(c))
      problems.push(at + '.cells[' + j + '] ' + JSON.stringify(c) + ' is not one of ' + CELL_STATES.join(', '));
  });
  const frontiers = w.cells.filter((/** @type {any} */ c) => c === 'frontier').length;
  if (frontiers > 1) problems.push(at + ' has ' + frontiers + ' frontier cells; at most one');
  return problems;
}

/**
 * How far a workstream has got: its frontier cell's 1-based stage number, else its furthest passed or
 * inferred stage. Null when it has reached none — never 0, which would read as a stage.
 * @param {string[]} cells one state per stage
 * @returns {number|null}
 */
function frontierOf(cells) {
  const at = cells.indexOf('frontier');
  if (at >= 0) return at + 1;
  for (let i = cells.length - 1; i >= 0; i--) if (cells[i] === 'passed' || cells[i] === 'inferred') return i + 1;
  return null;
}

/**
 * The stages payload: the feed's stages and rows, each row with its frontier, and never the format number.
 * @param {StagesFeed|null} data a stages feed that passed checkStages, or null when the panel has none
 * @returns {{stages: string[], milestoneStatus: string[]|null,
 *   workstreams: Array<Workstream & {frontier: number|null}>, warnings: string[]}|null}
 */
function stagesPayload(data) {
  if (!data) return null;
  return {
    stages: data.stages,
    milestoneStatus: data.milestoneStatus || null,
    workstreams: data.workstreams.map((w) => ({
      id: w.id,
      name: w.name,
      role: w.role || null,
      cells: w.cells,
      frontier: frontierOf(w.cells),
    })),
    warnings: data.warnings || [],
  };
}

module.exports = { checkStages, frontierOf, stagesPayload, CELL_STATES };
