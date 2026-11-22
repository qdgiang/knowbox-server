#!/bin/sh
set -eu

deploy=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
compose() {
    if test -n "${KNOWBOX_DEPLOY_ENV:-}"; then
        docker compose --env-file "$KNOWBOX_DEPLOY_ENV" -f "$deploy/compose.yaml" "$@"
    else
        docker compose -f "$deploy/compose.yaml" "$@"
    fi
}

compose up -d --wait gateway
compose up -d --wait --no-deps --force-recreate explorer
launch=
for attempt in $(seq 1 30); do
    if launch=$(compose exec -T explorer cat /tmp/launch 2>/dev/null) && test -n "$launch"; then
        break
    fi
    sleep 0.25
done
prefix='http://127.0.0.1:7879/#token='
token=${launch#"$prefix"}
if test "$launch" != "$prefix$token" || test "${#token}" -ne 64; then
    echo "Could not read the Explorer's current launch credential." >&2
    exit 1
fi
case "$token" in
    *[!0123456789abcdef]*)
        echo "The Explorer returned an invalid launch credential." >&2
        exit 1
        ;;
esac

printf '%s\n' "$token" | compose exec -T gateway sh -ec '
    umask 077
    mkdir -p /tmp/knowbox-auth
    read -r token
    next=$(mktemp /tmp/knowbox-auth/credential.XXXXXX)
    printf "default \"Bearer %s\";\n" "$token" >"$next"
    mv -- "$next" /tmp/knowbox-auth/current.conf
    nginx -t
    nginx -s reload
'
