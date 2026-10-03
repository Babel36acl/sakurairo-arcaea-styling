#!/bin/sh
set -eu

artifact_dir=${1:?usage: publish-astro-static.sh ARTIFACT_DIR [RELEASE_ROOT] [CURRENT_LINK]}
release_root=${2:-/opt/1panel/www/sites/babel36acl.xyz/astro-releases}
current_link=${3:-/opt/1panel/www/sites/babel36acl.xyz/astro-current}
keep_releases=${ASTRO_KEEP_RELEASES:-5}
stamp=$(date -u +%Y%m%dT%H%M%SZ)
release_dir="$release_root/$stamp"
previous_target=''

case "$release_root" in
  /opt/*|/srv/*|/var/www/*) ;;
  *) echo "Refusing unexpected release root: $release_root" >&2; exit 2 ;;
esac

test -f "$artifact_dir/index.html"
test -f "$artifact_dir/sitemap.xml"
mkdir -p "$release_root"
mkdir -p "$(dirname "$current_link")"
if test -L "$current_link" || test -e "$current_link"; then
  previous_target=$(readlink "$current_link" || true)
fi

mkdir "$release_dir"
cp -a "$artifact_dir/." "$release_dir/"
chmod -R a+rX "$release_dir"
rm -f "$current_link.next"
ln -s "$release_dir" "$current_link.next"
mv -Tf "$current_link.next" "$current_link"

rollback() {
  if test -n "$previous_target"; then
    rm -f "$current_link.rollback"
    ln -s "$previous_target" "$current_link.rollback"
    mv -Tf "$current_link.rollback" "$current_link"
  else
    rm -f "$current_link"
  fi
  rm -rf "$release_dir"
}

if test -n "${ASTRO_HEALTH_URL:-}"; then
  if ! curl --fail --silent --show-error --location --max-time 20 "$ASTRO_HEALTH_URL" >/dev/null; then
    rollback
    echo "Astro health check failed; previous release restored." >&2
    exit 1
  fi
fi

if test -n "${ASTRO_RELOAD_COMMAND:-}"; then
  sh -c "$ASTRO_RELOAD_COMMAND"
fi

find "$release_root" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' \
  | sort -nr | tail -n +$((keep_releases + 1)) | cut -d' ' -f2- \
  | while IFS= read -r old_release; do test -n "$old_release" && rm -rf -- "$old_release"; done

echo "Published $release_dir; current -> $(readlink "$current_link")"
