# Suricata IDS with StdOut TOOL1 entrypoint (EVE sim fallback on Docker Desktop).
FROM jasonish/suricata:latest
COPY suricata-entrypoint.sh /opt/stdout/suricata-entrypoint.sh
RUN chmod +x /opt/stdout/suricata-entrypoint.sh
ENTRYPOINT ["/bin/sh", "/opt/stdout/suricata-entrypoint.sh"]
