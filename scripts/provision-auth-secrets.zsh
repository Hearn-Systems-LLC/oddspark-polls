#!/usr/bin/env zsh

# Initialize local OAuth or rotate only provider credentials without putting
# values in command arguments, shell history, tracked files, or Wrangler logs.
# Remote master-secret initialization and all master-secret rotation are
# deliberately unsupported: Cloudflare has no create-only secret write, and a
# replacement could invalidate sessions, orphan encrypted OAuth tokens, or
# defeat duplicate-vote claims made with the previous digest key.

emulate -L zsh
setopt errexit nounset pipe_fail
unsetopt xtrace
umask 077
ulimit -c 0 2>/dev/null || true

if (( $# != 2 )); then
  print -u2 "Usage: $0 local|staging|production initialize|initialize-voting|rotate-providers"
  exit 2
fi

target="$1"
operation="$2"
case "$target" in
  local)
    base_url="http://localhost:4321"
    ;;
  staging)
    base_url="https://oddspark-polls-staging.hearnsystems.workers.dev"
    ;;
  production)
    base_url="https://oddspark-polls.hearnsystems.workers.dev"
    ;;
  *)
    print -u2 "Unknown environment: $target"
    exit 2
    ;;
esac

case "$operation" in
  initialize|initialize-voting|rotate-providers)
    ;;
  *)
    print -u2 "Unknown operation: $operation"
    exit 2
    ;;
esac

project_root="${0:A:h:h}"
destination="$project_root/.dev.vars"

wrangler() {
  env -u CLOUDFLARE_API_TOKEN \
    WRANGLER_WRITE_LOGS=false \
    WRANGLER_LOG=log \
    WRANGLER_LOG_SANITIZE=true \
    WRANGLER_SEND_METRICS=false \
    pnpm exec wrangler "$@"
}

remote_secret_names() {
  (
    cd "$project_root"
    wrangler secret list --env "$target" --format json
  )
}

has_nonempty_local_binding() {
  local expected="$1"
  local line key
  local effective_value=""

  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$line" != *"="* ]]; then
      continue
    fi
    key="${line%%=*}"
    if [[ "$key" == "$expected" ]]; then
      effective_value="${line#*=}"
    fi
  done < "$destination"

  [[ -n "${effective_value//[[:space:]]/}" ]]
}

read_provider_credentials() {
  read -r -s "google_client_id?Google client ID: "
  print
  read -r -s "google_client_secret?Google client secret: "
  print
  read -r -s "github_client_id?GitHub client ID: "
  print
  read -r -s "github_client_secret?GitHub client secret: "
  print

  if [[ -z "$google_client_id" || -z "$google_client_secret" ||
        -z "$github_client_id" || -z "$github_client_secret" ]]; then
    print -u2 "All four provider credential values are required."
    exit 1
  fi
}

emit_provider_bindings() {
  printf 'GOOGLE_CLIENT_ID=%s\n' "$google_client_id"
  printf 'GOOGLE_CLIENT_SECRET=%s\n' "$google_client_secret"
  printf 'GITHUB_CLIENT_ID=%s\n' "$github_client_id"
  printf 'GITHUB_CLIENT_SECRET=%s\n' "$github_client_secret"
}

emit_initial_bindings() {
  printf 'BETTER_AUTH_SECRET=%s\n' "$better_auth_secret"
  printf 'BETTER_AUTH_URL=%s\n' "$base_url"
  printf 'VOTE_DIGEST_SECRET=%s\n' "$vote_digest_secret"
  emit_provider_bindings
}

if [[ "$operation" == "initialize-voting" ]]; then
  if [[ "$target" != "local" ]]; then
    print -u2 "Remote vote-digest initialization is not automated because Cloudflare secret writes are not create-only."
    print -u2 "Bootstrap VOTE_DIGEST_SECRET in the target Worker dashboard."
    exit 1
  fi
  if [[ ! -f "$destination" ]]; then
    print -u2 "Local auth is not initialized; run initialize first."
    exit 1
  fi
  if has_nonempty_local_binding VOTE_DIGEST_SECRET; then
    print -u2 "Local voting privacy is already initialized."
    exit 1
  fi
  if ! has_nonempty_local_binding BETTER_AUTH_SECRET ||
     ! has_nonempty_local_binding BETTER_AUTH_URL; then
    print -u2 "Local voting initialization requires nonempty BETTER_AUTH_SECRET and BETTER_AUTH_URL bindings."
    exit 1
  fi

  vote_digest_secret="$(openssl rand -base64 32)"
  temporary_file="$(mktemp "$project_root/.dev.vars.tmp.XXXXXX")"
  trap 'rm -f -- "$temporary_file"' EXIT HUP INT TERM
  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$line" == VOTE_DIGEST_SECRET=* ]]; then
      continue
    fi
    printf '%s\n' "$line" >> "$temporary_file"
  done < "$destination"
  printf 'VOTE_DIGEST_SECRET=%s\n' "$vote_digest_secret" >> "$temporary_file"
  chmod 600 "$temporary_file"
  mv -f -- "$temporary_file" "$destination"
  trap - EXIT HUP INT TERM
  print "Local voting privacy initialized without changing auth or provider credentials."
  exit 0
fi

if [[ "$operation" == "initialize" ]]; then
  if [[ "$target" != "local" ]]; then
    print -u2 "Remote master-secret initialization is not automated because Cloudflare secret writes are not create-only."
    print -u2 "Bootstrap BETTER_AUTH_SECRET, BETTER_AUTH_URL, and VOTE_DIGEST_SECRET in the target Worker dashboard, then run rotate-providers."
    exit 1
  fi
  if [[ -e "$destination" ]]; then
    print -u2 "Local auth is already initialized; use rotate-providers to update provider credentials."
    exit 1
  fi

  better_auth_secret="$(openssl rand -base64 32)"
  vote_digest_secret="$(openssl rand -base64 32)"
  read_provider_credentials

  temporary_file="$(mktemp "$project_root/.dev.vars.tmp.XXXXXX")"
  trap 'rm -f -- "$temporary_file"' EXIT HUP INT TERM
  emit_initial_bindings > "$temporary_file"
  chmod 600 "$temporary_file"
  mv -f -- "$temporary_file" "$destination"
  trap - EXIT HUP INT TERM
  print "Local auth bindings initialized in the ignored .dev.vars file (mode 600)."
  exit 0
fi

if [[ "$target" == "local" ]]; then
  if [[ ! -f "$destination" ]]; then
    print -u2 "Local auth is not initialized; run initialize first."
    exit 1
  fi
  if ! has_nonempty_local_binding BETTER_AUTH_SECRET ||
     ! has_nonempty_local_binding BETTER_AUTH_URL ||
     ! has_nonempty_local_binding VOTE_DIGEST_SECRET; then
    print -u2 "Local provider rotation requires nonempty BETTER_AUTH_SECRET, BETTER_AUTH_URL, and VOTE_DIGEST_SECRET bindings."
    exit 1
  fi
else
  existing_secret_names="$(remote_secret_names)"
  if [[ "$existing_secret_names" != *'"BETTER_AUTH_SECRET"'* ||
        "$existing_secret_names" != *'"BETTER_AUTH_URL"'* ||
        "$existing_secret_names" != *'"VOTE_DIGEST_SECRET"'* ]]; then
    print -u2 "$target auth and voting privacy are not fully initialized; bootstrap both master secrets and the base URL in the Worker dashboard first."
    exit 1
  fi
fi

read_provider_credentials

if [[ "$target" == "local" ]]; then
  temporary_file="$(mktemp "$project_root/.dev.vars.tmp.XXXXXX")"
  trap 'rm -f -- "$temporary_file"' EXIT HUP INT TERM

  typeset -A replacement_values
  typeset -A replaced_keys
  replacement_values=(
    GOOGLE_CLIENT_ID "$google_client_id"
    GOOGLE_CLIENT_SECRET "$google_client_secret"
    GITHUB_CLIENT_ID "$github_client_id"
    GITHUB_CLIENT_SECRET "$github_client_secret"
  )

  while IFS= read -r line || [[ -n "$line" ]]; do
    key="${line%%=*}"
    if [[ "$line" == *"="* ]] && (( ${+replacement_values[$key]} )); then
      printf '%s=%s\n' "$key" "$replacement_values[$key]" >> "$temporary_file"
      replaced_keys[$key]=1
    else
      printf '%s\n' "$line" >> "$temporary_file"
    fi
  done < "$destination"

  for key in GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET GITHUB_CLIENT_ID GITHUB_CLIENT_SECRET; do
    if (( ! ${+replaced_keys[$key]} )); then
      printf '%s=%s\n' "$key" "$replacement_values[$key]" >> "$temporary_file"
    fi
  done

  chmod 600 "$temporary_file"
  mv -f -- "$temporary_file" "$destination"
  trap - EXIT HUP INT TERM
  print "Rotated local provider credentials without changing BETTER_AUTH_SECRET, BETTER_AUTH_URL, or VOTE_DIGEST_SECRET."
  exit 0
fi

cd "$project_root"
emit_provider_bindings | wrangler secret bulk --env "$target"
print "Rotated $target provider credentials without changing BETTER_AUTH_SECRET, BETTER_AUTH_URL, or VOTE_DIGEST_SECRET."
