#!/usr/bin/env bash
# Job-started hook for the web runners (ACTIONS_RUNNER_HOOK_JOB_STARTED).
# Refuses fork pull requests and pull_request_target, whatever the workflow
# says, and refuses any job when the disk is low. A failing hook fails the job.
set -eu
case "${GITHUB_EVENT_NAME:-}" in
  pull_request_target)
    echo "refused: pull_request_target on a self-hosted runner"; exit 1 ;;
  pull_request|pull_request_review|pull_request_review_comment)
    head=$(python3 -c 'import json,os;e=json.load(open(os.environ["GITHUB_EVENT_PATH"]));print(e["pull_request"]["head"]["repo"]["full_name"])')
    [ "$head" = "$GITHUB_REPOSITORY" ] || { echo "refused: PR from fork $head"; exit 1; } ;;
esac
free_gb=$(df -Pk "$HOME" | awk 'NR==2 {print int($4/1048576)}')
[ "$free_gb" -ge "${RUNNER_MIN_FREE_GB:-10}" ] || { echo "refused: only ${free_gb} GB free"; exit 1; }
