#!/usr/bin/env node
// Arms "merge when the pipeline succeeds" on the merge request this pipeline is
// testing. The Duo flow's own token cannot set auto-merge (403 insufficient_scope),
// so the pipeline does it with SITEKEEPER_MERGE_TOKEN (a masked CI variable, api
// scope). It pins the MR's current head sha, so a later push re-arms rather than
// merging code nobody's pipeline checked. Never prints the token.
//
// Usage (in CI): node scripts/arm-merge.mjs
// Exit codes: 0 armed (or already armed), 1 refused by GitLab, 2 missing CI context.

const env = process.env;
const need = ["SITEKEEPER_MERGE_TOKEN", "CI_API_V4_URL", "CI_PROJECT_ID", "CI_MERGE_REQUEST_IID", "CI_COMMIT_SHA"];
const missing = need.filter((k) => !env[k]);
if (missing.length) {
  console.error(`arm-merge: missing ${missing.join(", ")}`);
  process.exit(2);
}

const url = `${env.CI_API_V4_URL}/projects/${env.CI_PROJECT_ID}/merge_requests/${env.CI_MERGE_REQUEST_IID}/merge`;
const body = new URLSearchParams({
  auto_merge: "true",
  merge_when_pipeline_succeeds: "true",
  should_remove_source_branch: "true",
  sha: env.CI_COMMIT_SHA,
});

const res = await fetch(url, {
  method: "PUT",
  headers: { "PRIVATE-TOKEN": env.SITEKEEPER_MERGE_TOKEN },
  body,
});
let detail = "";
try {
  const j = await res.json();
  detail = j.message ? JSON.stringify(j.message) : `state=${j.state} auto_merge=${j.merge_when_pipeline_succeeds}`;
} catch {
  detail = "(no JSON body)";
}

if (res.ok) {
  console.log(`arm-merge: !${env.CI_MERGE_REQUEST_IID} will merge when this pipeline succeeds (${detail})`);
  process.exit(0);
}
console.error(`arm-merge: GitLab refused (${res.status}) ${detail}`);
process.exit(1);
