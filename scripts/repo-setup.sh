#!/usr/bin/env bash
# Phase 58: set up the GitHub repository page with the gh CLI (docs/launch/REPO_SETUP.md).
#
# By default it only PRINTS the commands, so you can read them first. Nothing changes on GitHub
# unless you add --apply.
#
#   bash scripts/repo-setup.sh                    # print the commands
#   bash scripts/repo-setup.sh --apply            # description, website, topics, features, labels
#   bash scripts/repo-setup.sh --apply --issues   # also open the good first issues (skips existing)
#   bash scripts/repo-setup.sh --repo=owner/name  # another repository (default farena-ai/sara)
#
# Needs the GitHub CLI (https://cli.github.com), signed in as an owner: gh auth login.
# Not done here (clicks in the browser, see REPO_SETUP.md): social preview image, Discussions
# categories, the Projects board, branch protection rules.
set -euo pipefail

REPO="farena-ai/sara"
APPLY=0
ISSUES=0
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=1 ;;
    --issues) ISSUES=1 ;;
    --repo=*) REPO="${arg#--repo=}" ;;
    -h | --help)
      sed -n '2,15p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown option: $arg (try --help)" >&2
      exit 2
      ;;
  esac
done

DESCRIPTION="Sara: a self-hosted AI companion with a personality you choose, who is also a real coding partner. Chats, remembers, plans, reads your documents, and builds and tests software in a sandbox, on your own server, with any model, local or cloud. MIT, zero runtime dependencies."
HOMEPAGE="https://sara.backstagecoding.com"
TOPICS="self-hosted,ai-companion,ai-assistant,coding-agent,llm,local-llm,ollama,openai-compatible,mcp,mcp-server,home-assistant,voice-assistant,chatbot,personal-assistant,typescript,nodejs,zero-dependencies,privacy"

# name|colour|description
LABELS=(
  "bug|d73a4a|Something doesn't work"
  "idea|a2eeef|A feature idea"
  "good first issue|7057ff|Small, well-described task for new contributors"
  "help wanted|008672|A pull request would be welcome"
  "documentation|0075ca|Docs, README, help text"
  "translation|c5def5|The app or README in another language"
  "question|d876e3|Better asked in Discussions → Q&A"
  "needs info|fbca04|Waiting for details from the reporter"
  "security|b60205|Hardening (report vulnerabilities privately)"
  "benchmark|bfdadc|Evals, benchmarks and results"
  "area: companion|f9d0c4|Personality, memory, moods, story"
  "area: coding|1d76db|Workspace, tools, preview, team, code map"
  "area: apps|5319e7|Phone, desktop, VS Code, terminal, PWA"
  "area: integrations|0e8a16|Telegram, Discord, Home Assistant, MCP, API, Google"
  "area: voice|e99695|Calls, voices, speech recognition"
  "area: install|c2e0c6|Installer, Docker, updates, backups"
)

if [ "${#DESCRIPTION}" -gt 350 ]; then
  echo "The description is ${#DESCRIPTION} characters; GitHub allows 350." >&2
  exit 1
fi

# Runs a command with --apply, otherwise prints it (shell-quoted, ready to copy).
run() {
  if [ "$APPLY" = 1 ]; then
    echo "+ $*"
    "$@"
  else
    printf '%q ' "$@"
    echo
  fi
}

if [ "$APPLY" = 1 ]; then
  command -v gh >/dev/null || { echo "The GitHub CLI (gh) isn't installed: https://cli.github.com" >&2; exit 1; }
  gh auth status >/dev/null 2>&1 || { echo "Sign in first: gh auth login" >&2; exit 1; }
  visibility="$(gh repo view "$REPO" --json visibility --jq .visibility)"
  echo "Repository $REPO is $visibility."
else
  echo "# Dry run: these are the commands --apply would run for $REPO."
fi

echo
echo "# About box, features and merge settings"
run gh repo edit "$REPO" \
  --description "$DESCRIPTION" \
  --homepage "$HOMEPAGE" \
  --add-topic "$TOPICS" \
  --enable-issues=true \
  --enable-discussions=true \
  --enable-projects=true \
  --enable-wiki=false \
  --enable-squash-merge=true \
  --enable-merge-commit=false \
  --enable-rebase-merge=false \
  --delete-branch-on-merge=true

echo
echo "# Labels (created, or updated when they exist)"
for entry in "${LABELS[@]}"; do
  IFS='|' read -r name color desc <<<"$entry"
  run gh label create "$name" --repo "$REPO" --color "$color" --description "$desc" --force
done

if [ "$ISSUES" = 1 ]; then
  echo
  echo "# Good first issues from docs/GOOD_FIRST_ISSUES.md"
  doc="$ROOT/docs/GOOD_FIRST_ISSUES.md"
  base="https://github.com/$REPO/blob/main"
  # Each item: "N. **Title** (S|M)" then indented lines. The section heading picks the area label.
  section=""
  title=""
  body=""
  flush() {
    [ -n "$title" ] || return 0
    local area
    case "$section" in
      Code) area="area: coding" ;;
      "Web app") area="area: apps" ;;
      Content) area="area: companion" ;;
      Docs) area="documentation" ;;
      *) area="help wanted" ;;
    esac
    # Relative links in the doc point from docs/; make them absolute for the issue.
    local text
    text="$(printf '%s\n' "$body" | sed -E "s#\]\(\.\./#](${base}/#g; s#\]\(([A-Za-z_]+\.md)#](${base}/docs/\1#g")"
    text="${text}

From [docs/GOOD_FIRST_ISSUES.md](${base}/docs/GOOD_FIRST_ISSUES.md). Say in a comment that you're picking it up, and read [CONTRIBUTING.md](${base}/CONTRIBUTING.md) first."
    if [ "$APPLY" = 1 ] && [ -n "$(gh issue list --repo "$REPO" --state all --search "in:title \"$title\"" --json title --jq ".[] | select(.title == \"$title\") | .title")" ]; then
      echo "skip (exists): $title"
    else
      run gh issue create --repo "$REPO" --title "$title" --label "good first issue" --label "help wanted" --label "$area" --body "$text"
    fi
    title=""
    body=""
  }
  while IFS= read -r line || [ -n "$line" ]; do
    if [[ "$line" =~ ^##\ (.+)$ ]]; then
      flush
      section="${BASH_REMATCH[1]}"
    elif [[ "$line" =~ ^[0-9]+\.\ \*\*(.+)\*\*\ \(([SM])\)$ ]]; then
      flush
      title="${BASH_REMATCH[1]}"
      body="Size: ${BASH_REMATCH[2]} ($([ "${BASH_REMATCH[2]}" = S ] && echo 'an evening' || echo 'a weekend'))"$'\n'
    elif [ -n "$title" ] && [[ "$line" =~ ^\ {3,}(.*)$ ]]; then
      body+="${BASH_REMATCH[1]}"$'\n'
    fi
  done <"$doc"
  flush
fi

echo
if [ "$APPLY" = 1 ]; then
  echo "Done. Still to do by hand (docs/launch/REPO_SETUP.md): social preview, Discussions categories, Projects board, branch rules."
else
  echo "# Nothing was changed. Run again with --apply to do it (add --issues for the good first issues)."
fi
