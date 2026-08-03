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
  print -u2 "Usage: $0 local|staging|production initialize|initialize-voting|initialize-turnstile|rotate-providers|rotate-turnstile"
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
  initialize|initialize-voting|initialize-turnstile|rotate-providers|rotate-turnstile)
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

# Extract the normalized binding key from a .dev.vars line, covering the
# dotenv forms wrangler also treats as the same key: optional leading
# whitespace, an optional shell-style `export ` prefix, and either an `=` or
# `:` separator. Not modeled (accepted by dotenv but never present in this
# repo's .dev.vars): multi-line quoted values, inline `#` comments after a
# value, and backtick-quoted values. Prints nothing and returns nonzero for
# comments, blank lines, and other non-bindings.
binding_key() {
  local line="$1"
  if [[ "$line" =~ '^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)[[:space:]]*[=:]' ]]; then
    print -r -- "${match[2]}"
    return 0
  fi
  return 1
}

# Extract the value dotenv would see for a .dev.vars line: everything after
# the first `=`/`:` separator, trimmed, with one layer of surrounding single
# or double quotes stripped (dotenv strips quotes after trimming, so `KEY=""`
# and `KEY="   "` both parse to empty at runtime).
binding_value() {
  local line="$1"
  local value="${line#*[=:]}"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  if (( ${#value} >= 2 )); then
    if [[ ( "${value[1]}" == '"' && "${value[-1]}" == '"' ) ||
          ( "${value[1]}" == "'" && "${value[-1]}" == "'" ) ]]; then
      value="${value[2,-2]}"
    fi
  fi
  print -r -- "$value"
}

# The keys this script manages. A .dev.vars that lists any of them more than
# once is ambiguous — wrangler/dotenv applies the LAST occurrence of a
# duplicated key, and guessing which line the user meant has already caused
# one wrong fix — so every mode refuses to run against such a file.
typeset -A managed_keys
managed_keys=(
  BETTER_AUTH_SECRET 1
  BETTER_AUTH_URL 1
  VOTE_DIGEST_SECRET 1
  TURNSTILE_SECRET_KEY 1
  GOOGLE_CLIENT_ID 1
  GOOGLE_CLIENT_SECRET 1
  GITHUB_CLIENT_ID 1
  GITHUB_CLIENT_SECRET 1
)

reject_duplicated_managed_keys() {
  [[ -f "$destination" ]] || return 0
  local line key
  typeset -A occurrences
  local -a duplicated
  while IFS= read -r line || [[ -n "$line" ]]; do
    key="$(binding_key "$line")" || continue
    if (( ${+managed_keys[$key]} )); then
      occurrences[$key]=$(( ${occurrences[$key]:-0} + 1 ))
      if (( occurrences[$key] == 2 )); then
        duplicated+=("$key")
      fi
    fi
  done < "$destination"

  if (( ${#duplicated} )); then
    print -u2 "Refusing to run: .dev.vars lists managed key(s) more than once: ${(j:, :)duplicated}."
    print -u2 "wrangler/dotenv applies the last occurrence of a duplicated key; remove the duplicates by hand so the file is unambiguous, then re-run."
    exit 1
  fi
}

has_nonempty_local_binding() {
  local expected="$1"
  local line key value
  local nonempty=1

  # wrangler/dotenv applies the LAST occurrence of a duplicated key. Managed
  # duplicates are rejected before this runs (see reject_duplicated_managed_keys),
  # but evaluate the last match anyway so the check stays aligned with the
  # runtime parser.
  while IFS= read -r line || [[ -n "$line" ]]; do
    key="$(binding_key "$line")" || continue
    if [[ "$key" == "$expected" ]]; then
      value="$(binding_value "$line")"
      if [[ -n "${value//[[:space:]]/}" ]]; then
        nonempty=0
      else
        nonempty=1
      fi
    fi
  done < "$destination"

  return $nonempty
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
  emit_provider_bindings
  # Local always-pass Turnstile dummy (public test secret). Staging/production
  # use rotate-turnstile with a provider-issued secret.
  printf 'TURNSTILE_SECRET_KEY=%s\n' "1x0000000000000000000000000000000AA"
  # VOTE_DIGEST_SECRET stays last for provisioning-script consistency.
  # Binding/type/deploy truth is secrets.required in wrangler.jsonc.
  printf 'VOTE_DIGEST_SECRET=%s\n' "$vote_digest_secret"
}


# Cloudflare's documented Turnstile dummy secrets — never valid for staging/production.
is_dummy_turnstile_secret() {
  local value="$1"
  case "$value" in
    1x0000000000000000000000000000000AA|2x0000000000000000000000000000000AA|3x0000000000000000000000000000000AA)
      return 0
      ;;
  esac
  return 1
}

# No mode proceeds against an ambiguous .dev.vars.
reject_duplicated_managed_keys

if [[ "$operation" == "initialize-voting" ]]; then
  if [[ "$target" != "local" ]]; then
    print -u2 "Remote vote-digest initialization is not automated because Cloudflare secret writes are not create-only."
    print -u2 "Bootstrap VOTE_DIGEST_SECRET in the target Worker dashboard (generate it with: openssl rand -base64 32)."
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
  # Drop every stale VOTE_DIGEST_SECRET line — including `export `-prefixed
  # and leading-whitespace forms — so no duplicate survives next to the
  # fresh binding appended below (wrangler/dotenv would honor the last).
  while IFS= read -r line || [[ -n "$line" ]]; do
    local_key="$(binding_key "$line")" || local_key=""
    if [[ "$local_key" == VOTE_DIGEST_SECRET ]]; then
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

if [[ "$operation" == "initialize-turnstile" ]]; then
  if [[ "$target" != "local" ]]; then
    print -u2 "Remote Turnstile initialization is not automated because Cloudflare secret writes are not create-only."
    print -u2 "Bootstrap TURNSTILE_SECRET_KEY in the target Worker dashboard (provider-issued secret), or use rotate-turnstile after bootstrap."
    exit 1
  fi
  if [[ ! -f "$destination" ]]; then
    print -u2 "Local auth is not initialized; run initialize first."
    exit 1
  fi
  if has_nonempty_local_binding TURNSTILE_SECRET_KEY; then
    print -u2 "Local Turnstile is already initialized."
    exit 1
  fi
  if ! has_nonempty_local_binding BETTER_AUTH_SECRET ||
     ! has_nonempty_local_binding BETTER_AUTH_URL ||
     ! has_nonempty_local_binding VOTE_DIGEST_SECRET; then
    print -u2 "Local Turnstile initialization requires nonempty BETTER_AUTH_SECRET, BETTER_AUTH_URL, and VOTE_DIGEST_SECRET bindings."
    exit 1
  fi

  temporary_file="$(mktemp "$project_root/.dev.vars.tmp.XXXXXX")"
  trap 'rm -f -- "$temporary_file"' EXIT HUP INT TERM
  digest_line=""
  while IFS= read -r line || [[ -n "$line" ]]; do
    local_key="$(binding_key "$line")" || local_key=""
    if [[ "$local_key" == TURNSTILE_SECRET_KEY ]]; then
      continue
    fi
    if [[ "$local_key" == VOTE_DIGEST_SECRET ]]; then
      digest_line="$line"
      continue
    fi
    printf '%s\n' "$line" >> "$temporary_file"
  done < "$destination"
  printf 'TURNSTILE_SECRET_KEY=%s\n' "1x0000000000000000000000000000000AA" >> "$temporary_file"
  if [[ -n "$digest_line" ]]; then
    printf '%s\n' "$digest_line" >> "$temporary_file"
  fi
  chmod 600 "$temporary_file"
  mv -f -- "$temporary_file" "$destination"
  trap - EXIT HUP INT TERM
  print "Local Turnstile secret initialized without changing auth or provider credentials."
  exit 0
fi

if [[ "$operation" == "rotate-turnstile" ]]; then
  if [[ -t 0 ]]; then
    read -r -s "turnstile_secret?Turnstile secret key: "
    print
  else
    IFS= read -r turnstile_secret || true
  fi
  if [[ -z "${turnstile_secret//[[:space:]]/}" ]]; then
    print -u2 "Turnstile secret key is required."
    exit 1
  fi
  if [[ "$target" != "local" ]] && is_dummy_turnstile_secret "$turnstile_secret"; then
    print -u2 "Refusing to set a Cloudflare dummy Turnstile secret on $target."
    exit 1
  fi

  if [[ "$target" == "local" ]]; then
    if [[ ! -f "$destination" ]]; then
      print -u2 "Local auth is not initialized; run initialize first."
      exit 1
    fi
    if ! has_nonempty_local_binding VOTE_DIGEST_SECRET; then
      print -u2 "Local Turnstile rotation requires nonempty VOTE_DIGEST_SECRET binding."
      exit 1
    fi
    temporary_file="$(mktemp "$project_root/.dev.vars.tmp.XXXXXX")"
    trap 'rm -f -- "$temporary_file"' EXIT HUP INT TERM
    replaced=0
    digest_line=""
    while IFS= read -r line || [[ -n "$line" ]]; do
      key="$(binding_key "$line")" || key=""
      if [[ "$key" == TURNSTILE_SECRET_KEY ]]; then
        if (( replaced )); then
          continue
        fi
        printf 'TURNSTILE_SECRET_KEY=%s\n' "$turnstile_secret" >> "$temporary_file"
        replaced=1
      elif [[ "$key" == VOTE_DIGEST_SECRET ]]; then
        digest_line="$line"
      else
        printf '%s\n' "$line" >> "$temporary_file"
      fi
    done < "$destination"
    if (( ! replaced )); then
      printf 'TURNSTILE_SECRET_KEY=%s\n' "$turnstile_secret" >> "$temporary_file"
    fi
    if [[ -n "$digest_line" ]]; then
      printf '%s\n' "$digest_line" >> "$temporary_file"
    fi
    chmod 600 "$temporary_file"
    mv -f -- "$temporary_file" "$destination"
    trap - EXIT HUP INT TERM
    print "Rotated local TURNSTILE_SECRET_KEY without changing other credentials."
    exit 0
  fi

  existing_secret_names="$(remote_secret_names)"
  if [[ "$existing_secret_names" != *'"BETTER_AUTH_SECRET"'* ||
        "$existing_secret_names" != *'"VOTE_DIGEST_SECRET"'* ]]; then
    print -u2 "$target auth and voting privacy are not fully initialized; bootstrap master secrets first."
    exit 1
  fi
  cd "$project_root"
  printf '%s' "$turnstile_secret" | wrangler secret put TURNSTILE_SECRET_KEY --env "$target"
  print "Rotated $target TURNSTILE_SECRET_KEY without changing other credentials."
  exit 0
fi

if [[ "$operation" == "initialize" ]]; then
  if [[ "$target" != "local" ]]; then
    print -u2 "Remote master-secret initialization is not automated because Cloudflare secret writes are not create-only."
    print -u2 "Bootstrap BETTER_AUTH_SECRET, BETTER_AUTH_URL, VOTE_DIGEST_SECRET, and TURNSTILE_SECRET_KEY in the target Worker dashboard, then run rotate-providers / rotate-turnstile."
    print -u2 "Generate each secret with: openssl rand -base64 32"
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
    print -u2 "If only the vote digest secret is missing, run initialize-voting to add it."
    exit 1
  fi
else
  existing_secret_names="$(remote_secret_names)"
  if [[ "$existing_secret_names" != *'"BETTER_AUTH_SECRET"'* ||
        "$existing_secret_names" != *'"BETTER_AUTH_URL"'* ||
        "$existing_secret_names" != *'"VOTE_DIGEST_SECRET"'* ]]; then
    print -u2 "$target auth and voting privacy are not fully initialized; bootstrap both master secrets and the base URL in the Worker dashboard first."
    print -u2 "Generate each secret with: openssl rand -base64 32"
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
    key="$(binding_key "$line")" || key=""
    if [[ -n "$key" ]] && (( ${+replacement_values[$key]} )); then
      # Replace only the first occurrence of each key and drop any later
      # duplicates rather than re-emitting the new value next to them.
      # Duplicated managed keys are rejected before rotation runs, so this
      # is defense-in-depth for the loop itself.
      if (( ${+replaced_keys[$key]} )); then
        continue
      fi
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
# Load-bearing assumption: `wrangler secret bulk` preserves secrets omitted
# from a bulk update. rotate-providers relies on this to replace only the
# four provider credentials without clobbering BETTER_AUTH_SECRET or
# VOTE_DIGEST_SECRET; if Cloudflare ever changes bulk semantics to replace
# the full secret set, this command must change with it.
emit_provider_bindings | wrangler secret bulk --env "$target"
print "Rotated $target provider credentials without changing BETTER_AUTH_SECRET, BETTER_AUTH_URL, or VOTE_DIGEST_SECRET."
