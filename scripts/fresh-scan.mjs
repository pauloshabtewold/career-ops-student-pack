// Stub for M-003: hourly zero-token board and LinkedIn scan. The implementer replaces these bodies.
export const SEEN_FILE = 'fresh-seen.tsv';
const todo = () => {
  throw new Error('fresh-scan: not implemented');
};
export function boardsFrom(portalsText) {
  void portalsText;
  return todo();
}
export function newRows(jobs, { seen, pipelineRows }) {
  void jobs, seen, pipelineRows;
  return todo();
}
export const rowLine = (j, today) => {
  void j, today;
  return todo();
};
export function linkedinJobs(readOutput) {
  void readOutput;
  return todo();
}
export async function freshScan({ paths, today, deps = {}, linkedinOnly = false }) {
  void paths, today, deps, linkedinOnly;
  return todo();
}
