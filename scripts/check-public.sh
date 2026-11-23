#!/usr/bin/env bash
# Scan the working tree and the whole git history for things that must not go public: e-mail addresses other
# than the author's, private hosts and addresses, home paths, tokens and keys. Exit 1 if something is found.
set -uo pipefail
cd "$(dirname "$0")/.."
PAT='(\b[A-Za-z0-9][A-Za-z0-9._%+-]*@[A-Za-z0-9.-]+\.[a-z]{2,})|(\b(10|192\.168|172\.(1[6-9]|2[0-9]|3[01]))\.[0-9]+\.[0-9]+)|(\.lan\b)|(/home/[a-z])|(ghp_[A-Za-z0-9]{20,})|(sk-[A-Za-z0-9]{20,})|(BEGIN [A-Z ]*PRIVATE KEY)'
# extra private words (one regex per line), kept out of git
[ -f .check-public.local ] && while IFS= read -r w; do [ -n "$w" ] && PAT="$PAT|($w)"; done < .check-public.local
ALLOW='manzolo@libero\.it|noreply@anthropic\.com|git@github\.com'
hits=$( { git ls-files -z | xargs -0 grep -nIE "$PAT" -- 2>/dev/null
          git log --all -p --format='commit %H %ae' | grep -nIE "$PAT"; } | grep -vE "$ALLOW" | grep -v 'scripts/check-public.sh' | grep -vE ':\+?PAT=' )
if [ -n "$hits" ]; then echo "$hits" | head -40; echo "✗ check-public: something to look at"; exit 1; fi
echo "✓ check-public: nothing private in the tree or the history"
