#!/bin/sh
set -eu
if [ ! -f /var/lib/clamav/main.cvd ] && [ ! -f /var/lib/clamav/main.cld ]; then
  freshclam --stdout
fi
freshclam --daemon --stdout &
exec clamd --config-file=/etc/clamav/clamd.conf
