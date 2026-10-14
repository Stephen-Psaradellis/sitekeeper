# SiteKeeper

**A small business writes "our Saturday hours are now 8 to 2" in an issue. The next
time anyone looks, the site is live with the change - tested, scanned, verified,
deployed and health-checked - and nobody touched it.**

Built for the GitLab "Life After Code" hackathon (Path A, hands-off) on the GitLab
Duo Agent Platform.

## The problem

Most small-business websites are kept by one-person web agencies juggling dozens of
clients. Every "change our phone number" email is ten minutes of manual work, and the
mistakes are always the same. We scanned 43,000 real local-business sites: the
defects that keep coming back are phone numbers you cannot tap on a phone, a phone
number that differs between the page and the Google-facing structured data, no
mobile viewport, broken JSON-LD, mixed http content, unlabelled form fields and dead
links. Each one costs the business calls.

## What happens, end to end

```
owner writes an issue
  -> Duo flow "ship"   triage: reads the issue + the site, posts a plain-English plan
                       build: branch, edit every copy of the fact, run sitecheck +
                              tests locally, push, open MR "Closes #n", set auto-merge
  -> MR pipeline       unit tests | sitecheck (Code Quality + test report inline)
                       | secret detection | SAST | build | preview-verify
                       (serves the exact artifact, smoke-tests every page)
  -> auto-merge        the moment the pipeline is green
  -> main pipeline     deploy to GitLab Pages (environment: production)
                       live-health: waits for Pages to publish THIS commit, proves
                       every page is 200, carries this build's version, has a tel: link
                       rollback: on a failed live check, republishes the previous commit
  -> Duo flow "fix"    on any failed pipeline: reads failing jobs + logs, fixes the
                       cause on a branch, pushes, auto-merges, explains on the MR/issue
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
| `.gitlab-ci.yml` | the pipeline above |
| `.gitlab/duo/flows/` | the two Duo Agent Platform flows (`ship`, `fix`) |

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
2. AI > Flows > New flow: paste `.gitlab/duo/flows/sitekeeper-ship.yml`, enable it in
   the project, add the assign/mention trigger. Repeat for `sitekeeper-fix.yml` with
   the pipeline-failed trigger. Both flows run on the default flow image (git, glab
   and Node 20 are in it; `glab` picks up the flow's `GITLAB_TOKEN`), so no
   `agent-config.yml` is needed. Each flow's first agent answers in a small JSON
   schema (`response_schemas`), and the router reads one enum field from it
   (`scope`, `cause`), so a stray word in a free-text answer cannot send an
   out-of-scope request or a runner outage into the build/repair agent.
3. Build > Pipeline schedules: a daily schedule on the default branch runs `monitor-live`.
4. Open an issue such as "Our new phone number is 217-555-0199" and assign it to the
   `ship` flow's service account.

## Known limitations

- Pages has no staging slot on the Free tier, so "staging" is the preview-verify job:
  the exact build artifact served the way Pages serves it, inside CI.
- Rollback restores the previous commit's site; it does not revert the commit. The
  `fix` flow opens the forward fix.
- A committed secret is removed from the file by the fix flow, but it still has to be
  rotated by its owner - the flow says so on the issue.

## Licence

MIT - see `LICENSE`.
