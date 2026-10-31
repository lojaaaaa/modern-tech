FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends clamav-daemon clamav-freshclam ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /run/clamav /var/lib/clamav && chown -R clamav:clamav /run/clamav /var/lib/clamav
COPY clamd.conf /etc/clamav/clamd.conf
COPY start.sh /usr/local/bin/start-clamav
RUN chmod +x /usr/local/bin/start-clamav
USER clamav
EXPOSE 3310
CMD ["start-clamav"]
