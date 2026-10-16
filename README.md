# SiteKeeper

**A small business writes "our Saturday hours are now 8 to 2" in an issue. The next
time anyone looks, the site is live with the change - tested, scanned, verified,
deployed and health-checked - and nobody touched it after the issue.**

Built for the GitLab "Life After Code" hackathon (Path A, hands-off) on the GitLab
Duo Agent Platform.

## The problem

Most small-business websites are kept by one-person web agencies juggling dozens of
clients. Every "change our phone number" email is ten minutes of manual work, and the
mistakes are always the same. In October 2026 we scanned 29,412 real local-business
sites (27,784 answered): images with no alt text (32% of sites), no meta description
(20%), a phone number you cannot tap on a phone (14%), dead links (6%) and no mobile
viewport (4%) keep coming back. `sitecheck` tests for those, plus what a hand edit
introduces: a phone number that differs between the page and the Google-facing
structured data, broken JSON-LD, mixed http content and unlabelled form fields.
Each one costs the business calls.

## What happens, end to end

```
owner writes an issue
  -> Duo flow "ship"   triage: reads the issue + the site, posts a plain-English plan
                       build: branch, edit every copy of the fact, run sitecheck +
                              tests locally, push, open MR "Closes #n"
  -> MR pipeline       unit tests | sitecheck (Code Quality + test report inline)
                       | secret detection | SAST | build | preview-verify
                       (serves the exact artifact, smoke-tests every page)
  -> arm-merge         the MR pipeline arms "merge when pipeline succeeds" on the
                       flow's own MR, so it merges the moment it is green
                       (see "Hands-off merge" below)
  -> main pipeline     deploy to GitLab Pages (environment: production)
                       live-health: waits for Pages to publish THIS commit, proves
                       every page is 200, carries this build's version, has a tel: link
                       rollback: on a failed live check, republishes the previous commit
  -> Duo flow "fix"    on any failed pipeline: reads failing jobs + logs, fixes the
                       cause on a branch, pushes, opens the MR, explains on the MR/issue
  -> daily schedule    monitor-live re-checks the live site
```

Post-code stages automated: code review of the change (sitecheck + the agent's
plan), testing, secret detection, SAST, pre-production verification, deployment,
post-deploy health check, automatic rollback, failure diagnosis and repair,
scheduled monitoring, and a summary back to the owner on their issue.

## Repository

| Path | What |
|---|---|
| `site/` | the business's website (a fictional plumber; plain HTML) |
| `checks/sitecheck.mjs` | the defect checker, zero dependencies; text, JSON, JUnit and GitLab Code Quality output |
| `checks/sitecheck.test.mjs` | its tests (`node --test`) |
| `scripts/build.mjs` | copies `site/` to `public/`, stamps the commit into every page |
| `scripts/serve.mjs`, `scripts/smoke.mjs` | pre-production server and the smoke/health check |
| `scripts/arm-merge.mjs` | the `arm-merge` job: sets merge-when-pipeline-succeeds on the flows' MRs, pinned to the tested sha |
| `.gitlab-ci.yml` | the pipeline above |
| `.gitlab/duo/flows/` | the two Duo Agent Platform flows (`ship`, `fix`) |
| `scripts/check_duo_flows.py` | checks both flows against GitLab ai-assist's own flow models and tool list (how to run: its docstring) |

## Run it locally

Node 22, nothing to install:

```
npm test                 # checker tests
npm run check            # sitecheck the site
npm run build            # site/ -> public/
node scripts/serve.mjs public 8080 &
node scripts/smoke.mjs http://localhost:8080 --version local
```

## Set it up on GitLab

1. Fork or import this project; Pages publishes on the first default-branch pipeline.
   Then Settings > General > Visibility > Pages: **Everyone**. An imported project can
   start with Pages access private, which makes every anonymous GET a 302 to the
   gitlab.io sign-in, so `live-health` times out and the pipeline rolls back a good
   deploy. On gitlab.com, CI jobs also need the account's identity verified once.
2. AI > Flows > New flow: paste `.gitlab/duo/flows/sitekeeper-ship.yml`, enable it in
   the project, add the assign/mention trigger. Repeat for `sitekeeper-fix.yml` with
   the pipeline-failed trigger. Both flows run on the default flow image (git, glab
   and Node 20 are in it; `glab` picks up the flow's `GITLAB_TOKEN`), so no
   `agent-config.yml` is needed. GitLab's AI Catalog does not accept response
   schemas or conditional routes on them, so each flow's first agent opens its
   answer with one fixed line (`SCOPE: out_of_scope`, `CAUSE: infra`) and the
   second agent's first instruction is to stop on that line: an out-of-scope
   request or a runner outage is never built or repaired.
   Then add the merge token described under "Hands-off merge" below.
3. Build > Pipeline schedules: a daily schedule on the default branch runs `monitor-live`.
4. Open an issue such as "Our new phone number is 217-555-0199" and assign it to the
   `ship` flow's service account.

## Hands-off merge

The flows' own token cannot arm a merge: GitLab answers `403 insufficient_scope`, and no
Duo tool sets "merge when pipeline succeeds". So the pipeline does it: the `arm-merge` job
runs on MR pipelines from `sitekeeper/*` branches into the default branch and arms the
merge, pinned to the commit that pipeline is testing (a later push has to pass again).
It needs an access token with `api` scope as the CI/CD variable `SITEKEEPER_MERGE_TOKEN`
(masked, not protected - the flows' branches are not protected). That token is the one
secret this repo asks you for. Leave it out and the job does not run: each MR then waits
for one "merge when pipeline succeeds" click from the owner, and everything before and
after that click is still automatic - a deliberate option for owners who want to say
yes before anything reaches their production site.

## Known limitations

- Pages has no staging slot on the Free tier, so "staging" is the preview-verify job:
  the exact build artifact served the way Pages serves it, inside CI.
- Rollback restores the previous commit's site; it does not revert the commit. The
  `fix` flow opens the forward fix.
- A committed secret is removed from the file by the fix flow, but it still has to be
  rotated by its owner - the flow says so on the issue.

## Licence

MIT - see `LICENSE`.
