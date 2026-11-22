#!/usr/bin/env bash
# 服务器侧发版脚本：由 .github/workflows/deploy.yml 通过 SSH 上传并执行（用户 deploy）。
#
# 用法：deploy-vps.sh <tarball> <sha256> <site_root> <health_url> <keep>
#
# 流程（与手工发版一致）：
#   解包到 astro-releases/<UTC 时间戳> → chown deploy:deploy → chmod a+rX
#   → ln -sfn 到 astro-current.next → mv -Tf 原子切换
#   → curl 健康检查必须 200，否则切回上一版并删除新目录
#   → 保留最新 <keep> 个 release
set -euo pipefail

TARBALL="${1:?tarball path required}"
EXPECTED_SHA="${2:?sha256 required}"
SITE_ROOT="${3:-/opt/1panel/www/sites/babel36acl.xyz/index}"
HEALTH_URL="${4:-https://babel36acl.xyz/}"
KEEP="${5:-5}"

RELEASES="$SITE_ROOT/astro-releases"
CURRENT="$SITE_ROOT/astro-current"

log() { printf '[deploy] %s\n' "$*"; }
die() { printf '[deploy] ERROR: %s\n' "$*" >&2; exit 1; }

[ -f "$TARBALL" ] || die "tarball not found: $TARBALL"
[ -d "$RELEASES" ] || die "release dir missing: $RELEASES"
[ -w "$SITE_ROOT" ] || die "site root not writable: $SITE_ROOT"

ACTUAL_SHA="$(sha256sum "$TARBALL" | awk '{print $1}')"
[ "$ACTUAL_SHA" = "$EXPECTED_SHA" ] || die "checksum mismatch: got $ACTUAL_SHA want $EXPECTED_SHA"
log "checksum ok ($ACTUAL_SHA)"

PREV_TARGET=""
if [ -L "$CURRENT" ]; then
  PREV_TARGET="$(readlink "$CURRENT")"
fi
log "previous release: ${PREV_TARGET:-<none>}"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
while [ -e "$RELEASES/$STAMP" ]; do
  sleep 1
  STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
done
NEW_DIR="$RELEASES/$STAMP"
log "creating release $NEW_DIR"

mkdir -p "$NEW_DIR"
tar -xzf "$TARBALL" -C "$NEW_DIR" --no-same-owner
chown -R deploy:deploy "$NEW_DIR"
chmod -R a+rX "$NEW_DIR"

[ -f "$NEW_DIR/index.html" ] || { rm -rf "$NEW_DIR"; die "release has no index.html"; }
FILE_COUNT="$(find "$NEW_DIR" -type f | wc -l | tr -d ' ')"
log "extracted $FILE_COUNT files"
[ "$FILE_COUNT" -ge 1000 ] || { rm -rf "$NEW_DIR"; die "suspiciously few files: $FILE_COUNT"; }

ln -sfn "astro-releases/$STAMP" "$CURRENT.next"
mv -Tf "$CURRENT.next" "$CURRENT"
log "switched astro-current -> astro-releases/$STAMP"

healthy=0
for attempt in $(seq 1 20); do
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "$HEALTH_URL" || true)"
  log "health check $attempt/20 -> ${code:-error}"
  if [ "$code" = "200" ]; then
    healthy=1
    break
  fi
  sleep 3
done

if [ "$healthy" -ne 1 ]; then
  log "health check failed; rolling back"
  if [ -n "$PREV_TARGET" ] && [ -d "$SITE_ROOT/$PREV_TARGET" ]; then
    ln -sfn "$PREV_TARGET" "$CURRENT.next"
    mv -Tf "$CURRENT.next" "$CURRENT"
    log "restored astro-current -> $PREV_TARGET"
  else
    log "no previous release to restore"
  fi
  rm -rf "$NEW_DIR"
  die "health check failed; new release removed"
fi

# 只保留最新 KEEP 个 release（名称是 UTC 时间戳，字典序即时间序）
mapfile -t sorted < <(find "$RELEASES" -mindepth 1 -maxdepth 1 -type d -name '20*T*Z' -printf '%f\n' | sort)
count=${#sorted[@]}
if [ "$count" -gt "$KEEP" ]; then
  for old in "${sorted[@]:0:$((count - KEEP))}"; do
    [ "$old" = "$STAMP" ] && continue
    log "pruning old release $old"
    rm -rf "${RELEASES:?}/$old"
  done
fi
remaining="$(find "$RELEASES" -mindepth 1 -maxdepth 1 -type d -name '20*T*Z' | wc -l | tr -d ' ')"

rm -f "$TARBALL"
log "RELEASE=$STAMP FILES=$FILE_COUNT HEALTH=200 KEEPING=$remaining"
