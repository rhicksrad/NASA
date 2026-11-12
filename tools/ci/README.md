# CI on the self-hosted runners

This repo follows the plan in
[Pharaoh's `docs/CI_RUNNERS.md`](https://github.com/rhicksrad/Pharaoh/blob/main/docs/CI_RUNNERS.md),
Part 2. That file holds the PC inventory and the reasoning; this one is what
NASA does with it.

## What runs where

| Workflow | Job | Runner | When |
| --- | --- | --- | --- |
| `ci.yml` | `gate`: install, typecheck, lint, build | PCs, label `web-trusted` | every pull request |
| `ci.yml` | `e2e`: Playwright smoke tests | PCs, labels `web-trusted, playwright` | pull requests that touch the site |
| `ci.yml` | `check`: one result for the two above | GitHub | every pull request |
| `cloudflare.yml` | `deploy`, `preview` | GitHub, always | push to `main`, same-repo pull requests |
| `pages.yml` | `deploy` | GitHub, always | push to `main` that touches `pages-redirect/` |
| `sbdb-index.yml` | rebuild `public/sbdb-index.json` as a download | PCs, label `python` | manual |

`check` is the name to watch (and to require, if branch protection is ever
turned on): it passes when the gate passed and the browser tests passed or
were not needed.

## The switch

The repo variable **`CI_RUNNER`** decides. Set it to `local` and trusted jobs
go to the PCs. Delete it and everything runs on GitHub's runners, which is
free for a public repo. Use that whenever the PCs are off: a job whose labels
match no online runner waits in the queue for up to a day instead of failing.

    gh api -X POST repos/rhicksrad/NASA/actions/variables -f name=CI_RUNNER -f value=local
    gh api -X DELETE repos/rhicksrad/NASA/actions/variables/CI_RUNNER

## Why a stranger cannot run code on the PCs

This repo is public, so a fork can rewrite any workflow. Three things stand in
the way, and the first two do not depend on the workflow text:

1. **Repo setting.** Settings > Actions > General > Fork pull request
   workflows from outside collaborators > *Require approval for all outside
   collaborators*.
2. **Runner hook.** `refuse_untrusted.sh` runs before every job on a web
   runner and fails fork pull requests and `pull_request_target`. It also
   fails a job when the disk has under 10 GB free (`RUNNER_MIN_FREE_GB`).
3. **An unprivileged user.** The runners run as `ghrunner`, which has no gh
   login, no SSH keys, no sudo and no access to `/home/ryan`.

In the workflows themselves, fork pull requests are routed to GitHub's
runners, permissions default to `contents: read`, only the deploy job gets
`pages: write` and `id-token: write`, and nothing uses `pull_request_target`.

## Setting up a PC

Web runners go on PresidentScroob and MajorAsshole. Not on DarkHelmet, which
times performance. A runner belongs to one repo, so each PC gets one runner
for NASA beside the ones it has for other repos.

Once per PC, by a person with sudo:

    sudo adduser --disabled-password --gecos '' ghrunner
    sudo loginctl enable-linger ghrunner
    sudo npx playwright install-deps chromium

Then, per repo, as `ghrunner` (`sudo -iu ghrunner`), with a registration token
from an account that has admin on the repo (it lasts one hour):

    curl -fsSLO https://raw.githubusercontent.com/rhicksrad/NASA/main/tools/ci/setup_web_runner.sh
    curl -fsSLO https://raw.githubusercontent.com/rhicksrad/NASA/main/tools/ci/refuse_untrusted.sh
    REPO=rhicksrad/NASA TOKEN=<token> bash setup_web_runner.sh

The script registers the runner as `<host>-nasa` (set `RUNNER_NAME` to choose another name) with labels
`web, web-trusted, playwright, python, <host>`, writes its `.env` (shared Node
tool cache, shared Playwright browsers, the hook), puts it in a systemd user
slice capped at four cores and 8 GB, and adds a weekly cleanup timer. It can
be run again safely.

Check that it is online:

    gh api repos/rhicksrad/NASA/actions/runners --jq '.runners[] | "\(.name) \(.status) \([.labels[].name]|join(","))"'

Then set `CI_RUNNER=local`, push a branch in this repo and confirm the job
names a `-nasa` runner.

## Caches and cleanup

- pnpm keeps one content-addressed store per user on the PC, so a warm
  install takes seconds. `setup-node`'s GitHub cache is used on hosted runs only.
- Node and Chromium are downloaded once per PC and shared by every web runner.
  On the PCs Chromium is installed without `--with-deps`, which needs sudo.
- Every self-hosted job ends with `git clean -ffdx`, and checkout cleans again
  before the next one.
- `cloudflare.yml` publishes the site and the API Worker to Cloudflare from a hosted
  runner once the repo variable `CF_DEPLOY` is `on`; same-repo pull requests get a preview.
- The browser tests use port 4317 (`E2E_PORT`) and bind to 127.0.0.1, so they
  do not collide with another repo's tests and are not visible on the LAN.
