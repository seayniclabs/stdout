#!/bin/bash
#
# 24-Hour Production Health Monitor
# Checks StdOut production instance every 5 minutes for 24 hours
# Logs health status, response times, and alerts on failures
#

STDOUT_URL="http://192.168.68.89:8112"
LOG_DIR="$HOME/stdout-monitoring"
LOG_FILE="$LOG_DIR/health-$(date +%Y%m%d).log"
ALERT_THRESHOLD=3  # Alert after 3 consecutive failures

mkdir -p "$LOG_DIR"

check_health() {
    local timestamp=$(date -Iseconds)
    local start=$(date +%s%N)
    
    # Check login page
    login_status=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$STDOUT_URL/app/login" 2>/dev/null)
    
    # Check dashboard (requires auth, but should redirect)
    dashboard_status=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$STDOUT_URL/app" 2>/dev/null)
    
    # Check new features
    remediation_status=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$STDOUT_URL/app/remediations" 2>/dev/null)
    costs_status=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$STDOUT_URL/app/costs" 2>/dev/null)
    
    local end=$(date +%s%N)
    local response_time=$(( ($end - $start) / 1000000 ))  # Convert to milliseconds
    
    # Determine overall health
    if [[ "$login_status" == "200" ]] && [[ "$dashboard_status" =~ ^(200|302)$ ]]; then
        health="HEALTHY"
    else
        health="DEGRADED"
    fi
    
    # Log results
    echo "$timestamp | $health | login:$login_status dashboard:$dashboard_status remediation:$remediation_status costs:$costs_status | ${response_time}ms" >> "$LOG_FILE"
    
    # Check for consecutive failures
    if [[ "$health" == "DEGRADED" ]]; then
        failures=$(tail -n $ALERT_THRESHOLD "$LOG_FILE" | grep "DEGRADED" | wc -l)
        if [[ $failures -ge $ALERT_THRESHOLD ]]; then
            # Alert Charlie via slack-post-filtered
            if command -v slack-post-filtered &> /dev/null; then
                slack-post-filtered general "🚨 StdOut production health alert: $ALERT_THRESHOLD consecutive failures detected at $STDOUT_URL" --priority=high
            fi
        fi
    fi
    
    echo "$timestamp | $health | Response: ${response_time}ms"
}

# Run check every 5 minutes for 24 hours (288 checks)
echo "Starting 24-hour production monitoring for $STDOUT_URL"
echo "Logging to: $LOG_FILE"
echo ""

for i in {1..288}; do
    check_health
    if [[ $i -lt 288 ]]; then
        sleep 300  # 5 minutes
    fi
done

echo ""
echo "24-hour monitoring complete. Summary:"
echo "Total checks: 288"
echo "Healthy: $(grep "HEALTHY" "$LOG_FILE" | wc -l)"
echo "Degraded: $(grep "DEGRADED" "$LOG_FILE" | wc -l)"
echo ""
echo "Full log: $LOG_FILE"
