#!/usr/bin/env bash
# Client-machine prep (Linux): point the pilot's host names at the pilot host's
# IP in /etc/hosts, because there is no DNS on the objekt.
#
# Why this is not optional on the desktop client: the installed Volt build has its
# backend address BAKED IN at build time (one build for every customer), and the
# TLS certificate is issued for that same name — so the client cannot be pointed
# at a bare IP. The name has to resolve locally. The same applies to voltd's wss://
# endpoint and Keycloak, which ride the same name on their own ports.
#
# Run as root, once per client machine, next to certs/install-ca.sh (which installs
# the CA root — both are needed: the name must resolve AND the cert must be trusted).
#
# Usage:
#   sudo scripts/install-hosts.sh 10.20.30.40 backend.volt.oktaplus.ru [more names...]
#   sudo scripts/install-hosts.sh --remove backend.volt.oktaplus.ru [more names...]
set -euo pipefail

remove=0
if [[ "${1:-}" == "--remove" ]]; then
  remove=1
  shift
  ip=""
else
  ip="${1:-}"
  shift || true
  [[ "$ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ || "$ip" == *:* ]] || {
    echo "First argument must be a literal IP address, not a name (that is the whole" >&2
    echo "point: there is no DNS on the objekt)." >&2
    exit 1
  }
fi

[[ $# -ge 1 ]] || { echo "Usage: $0 <ip> <name> [more names...]   |   $0 --remove <name> [...]" >&2; exit 1; }

names=("$@")
marker="# volt-pilot"
# VOLT_HOSTS_FILE exists so the rewrite logic can be exercised against a fixture
# instead of the real file; the root check applies to the real one only.
hosts="${VOLT_HOSTS_FILE:-/etc/hosts}"
if [[ "$hosts" == /etc/hosts ]]; then
  [[ "$(id -u)" -eq 0 ]] || { echo "Run as root — /etc/hosts is not writable otherwise." >&2; exit 1; }
fi

# Drop any line this script wrote before, and any line mapping one of these names,
# so a re-run after the IP changes replaces rather than appends: a stale duplicate
# wins or loses depending on file order, which is the worst kind of bug to debug
# on someone else's machine.
tmp="$(mktemp)"
awk -v marker="$marker" -v namelist="${names[*]}" '
  BEGIN { n = split(namelist, want, " ") }
  index($0, marker) { next }
  {
    line = $0
    sub(/#.*$/, "", line)
    split(line, f, /[ \t]+/)
    for (i = 2; i in f; i++)
      for (j = 1; j <= n; j++)
        if (f[i] == want[j]) next
    print $0
  }
' "$hosts" > "$tmp"

if [[ "$remove" -ne 1 ]]; then
  printf '%s\t%s\t%s\n' "$ip" "${names[*]}" "$marker" >> "$tmp"
fi

# Preserve the original mode/owner: install(1) over a copy, never mv across a
# possible /tmp filesystem boundary (which would also drop SELinux labels).
cat "$tmp" > "$hosts"
rm -f "$tmp"

# Best-effort cache flush — most Astra/RED OS installs run one of these, and none
# of them existing is fine (glibc re-reads /etc/hosts per lookup anyway).
if command -v resolvectl >/dev/null 2>&1; then resolvectl flush-caches || true
elif command -v systemd-resolve >/dev/null 2>&1; then systemd-resolve --flush-caches || true
elif command -v nscd >/dev/null 2>&1; then nscd -i hosts || true
fi

if [[ "$remove" -eq 1 ]]; then
  echo "Removed the pilot hosts entry for: ${names[*]}"
else
  echo "Mapped ${names[*]} -> $ip"
  if command -v getent >/dev/null 2>&1; then
    for n in "${names[@]}"; do
      printf '  %-34s -> %s\n' "$n" "$(getent hosts "$n" | awk '{print $1; exit}' || echo FAILED)"
    done
  fi
  echo "If Volt is already running, restart it: the webview caches resolution per process."
fi
