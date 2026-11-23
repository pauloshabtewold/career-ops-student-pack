// Assumed (M-005): scripts/rank-queue.mjs adds a reply-rate weight only for groups with MIN_GROUP (5) or more tracker
// applications. trackerApps(applicationsText) turns data/applications.md into the apps replyRates and baseRate read, and
// replyBoost(row, rates, base) is the number added to a row's score: 0 when every group of the row is under MIN_GROUP.
// The row passed to replyBoost is a pending row as { url, company, title }. Fake companies only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePipeline } from '../../lib/pipeline-md.mjs';
import { MIN_GROUP, baseRate, replyRates } from '../../lib/reply-rates.mjs';
import { rankQueue, replyBoost, trackerApps } from '../../scripts/rank-queue.mjs';
import { TODAY, jobUrl, line, pipelineText } from '../helpers/script-harness.mjs';

const CONFIG = { daily_target: 10, score_floor: 3.0, rank: { weights: { triage: 1 } } };
const PENDING = [
  line(jobUrl(1), 'Tailspin Data', 'Software Engineer Intern', 'Remote', 'triage=4.6'),
  line(jobUrl(2), 'Woodgrove Systems', 'Data Analyst Intern', 'Remote', 'triage=4.4'),
  line(jobUrl(3), 'Litware Health', 'Software Engineer Intern', 'Remote', 'triage=4.2'),
];
// Four data-analyst applications, every one answered: a group under MIN_GROUP.
const APPS = [
  '# Applications',
  '',
  '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
  '|---|---|---|---|---|---|---|---|---|',
  '| 1 | 2026-09-10 | Northwind Robotics | Data Analyst Intern | 4.2/5 | Interview | no | none | |',
  '| 2 | 2026-09-11 | Contoso Analytics | Data Analyst Intern | 4.0/5 | Interview | no | none | |',
  '| 3 | 2026-09-12 | Fabrikam Labs | Data Analyst Intern | 4.1/5 | Responded | no | none | |',
  '| 4 | 2026-09-13 | Adatum Energy | Data Analyst Intern | 4.3/5 | Offer | no | none | |',
  '',
].join('\n');
const ranked = (applicationsText) => rankQueue({ doc: parsePipeline(pipelineText({ pending: PENDING })), config: CONFIG, today: TODAY, applicationsText }).picks.map((p) => [p.url, p.score]);

// M-005-S8-osdr
test('M-005-S8-osdr a reply-rate group with 4 applications leaves the ranked order identical', () => {
  assert.equal(MIN_GROUP, 5);
  const apps = trackerApps(APPS);
  assert.equal(replyBoost({ url: jobUrl(2), company: 'Woodgrove Systems', title: 'Data Analyst Intern' }, replyRates(apps), baseRate(apps)), 0);
  assert.deepEqual(ranked(APPS), ranked(''), 'the 4-application group changes no score and no order');
  assert.deepEqual(ranked(APPS).map(([url]) => url), [jobUrl(1), jobUrl(2), jobUrl(3)]);
});
