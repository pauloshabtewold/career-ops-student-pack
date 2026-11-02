#!/usr/bin/env node
// Maintainer tool: builds the synthetic review prompt behind the review cost figures in docs/usage-cost.md.
// Usage: review-fixture.mjs   prints the prompt for one synthetic application on stdout
// Sizes: a 4,000 character CV, a 5,400 character posting (the same size the triage fixture uses), a 2,800 character resume
// draft, a 1,800 character cover letter and a 400 character answers note. Every name is invented and every address is
// example.com. It makes no network or agent call itself; the measurement pipes this output to a no-tools agent call.
import { runCli, isMain } from '../../lib/args.mjs';
import { buildReviewPrompt } from '../review-app.mjs';

const fill = (sentence, chars) => sentence.repeat(Math.ceil(chars / sentence.length)).slice(0, chars);

export function syntheticApplication() {
  const n = (i) => `Example Project ${i}`;
  const cv = ['# Sam Example', 'sam@example.com | example.com/sam', ''];
  let i = 1;
  while (cv.join('\n').length < 4000) cv.push(`- Built ${n(i)}: a small data tool for a student club, cleaned 3 tables and wrote 2 reports for ${i + 1} users.`, `- Led ${n(i)} onboarding for ${i + 2} new members at Example University.`), i++;
  return {
    cv: cv.join('\n').slice(0, 4000),
    posting: fill('Example Company is hiring a data analyst intern to build reports, clean data and support a small team. ', 5400),
    resume: fill('- Built Example Project 1 for a student club and cleaned 3 tables. Used Python and SQL at Example University. ', 2800),
    cover: fill('I would like to join Example Company as a data analyst intern because I enjoy turning messy tables into clear reports. ', 1800),
    answers: fill('The student said they led onboarding for new members and used Python in a class. ', 400),
  };
}

export const fixturePrompt = () => buildReviewPrompt(syntheticApplication());

async function main() {
  process.stdout.write(fixturePrompt());
  return 0;
}

if (isMain(import.meta.url)) await runCli(main);
