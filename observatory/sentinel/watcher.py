"""
Watcher Agent - Fast Detection with Llama 3.2 3B

Continuously monitors Prometheus metrics, Loki logs, and service health.
Detects anomalies, threshold breaches, and error spikes.
Escalates HIGH/CRITICAL findings to Analyst agent.
"""

import asyncio
import aiohttp
import os
from datetime import datetime, timedelta
from typing import Dict, List, Callable, Optional
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Configuration
OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://host.docker.internal:11434")
PROMETHEUS_URL = os.getenv("PROMETHEUS_URL", "http://prometheus:9090")
LOKI_URL = os.getenv("LOKI_URL", "http://loki:3100")
CRITICAL_CHECK_INTERVAL = int(os.getenv("CRITICAL_CHECK_INTERVAL", "300"))  # 5 minutes
PRODUCT_CHECK_INTERVAL = int(os.getenv("PRODUCT_CHECK_INTERVAL", "600"))    # 10 minutes
DEFAULT_CHECK_INTERVAL = int(os.getenv("DEFAULT_CHECK_INTERVAL", "3600"))   # 1 hour

# Service tiers
CRITICAL_SERVICES = [
    "bridge",
    "helmsman-api",
    "n8n-control",
    "stdout",
    "windlass",
]

PRODUCT_SERVICES = [
    "hone",
    "store",
    "enchapter-api",
    "enchapter-site",
]

# Stop flag
_stop_flag = False


async def fetch_prometheus_metrics() -> Dict:
    """Fetch key metrics from Prometheus"""
    try:
        async with aiohttp.ClientSession() as session:
            queries = {
                "up": 'up',  # Service availability
                "cpu": 'sum(rate(container_cpu_usage_seconds_total[5m])) by (container)',
                "memory": 'sum(container_memory_usage_bytes) by (container)',
                "errors": 'sum(rate(http_requests_total{status=~"5.."}[5m])) by (service)',
            }

            results = {}
            for metric_name, query in queries.items():
                url = f"{PROMETHEUS_URL}/api/v1/query"
                params = {"query": query}

                async with session.get(url, params=params, timeout=aiohttp.ClientTimeout(total=10)) as response:
                    if response.status == 200:
                        data = await response.json()
                        results[metric_name] = data.get("data", {}).get("result", [])
                    else:
                        logger.warning(f"Prometheus query failed for {metric_name}: HTTP {response.status}")
                        results[metric_name] = []

            return results

    except Exception as e:
        logger.error(f"Failed to fetch Prometheus metrics: {e}")
        return {}


async def fetch_loki_logs(service: str, minutes: int = 5) -> List[Dict]:
    """Fetch recent logs from Loki for a service"""
    try:
        async with aiohttp.ClientSession() as session:
            # Query last N minutes of logs
            end_time = int(datetime.now().timestamp() * 1e9)  # nanoseconds
            start_time = int((datetime.now() - timedelta(minutes=minutes)).timestamp() * 1e9)

            url = f"{LOKI_URL}/loki/api/v1/query_range"
            params = {
                "query": f'{{service="{service}"}} |= "error" or "ERROR" or "critical" or "CRITICAL"',
                "start": start_time,
                "end": end_time,
                "limit": 100,
            }

            async with session.get(url, params=params, timeout=aiohttp.ClientTimeout(total=10)) as response:
                if response.status == 200:
                    data = await response.json()
                    streams = data.get("data", {}).get("result", [])

                    logs = []
                    for stream in streams:
                        for value in stream.get("values", []):
                            timestamp_ns, log_line = value
                            logs.append({
                                "timestamp": int(timestamp_ns) // 1e9,  # Convert to seconds
                                "message": log_line,
                                "service": service,
                            })

                    return logs
                else:
                    logger.warning(f"Loki query failed for {service}: HTTP {response.status}")
                    return []

    except Exception as e:
        logger.error(f"Failed to fetch Loki logs for {service}: {e}")
        return []


async def detect_anomalies_with_llm(metrics: Dict, logs: List[Dict], service: str) -> Optional[Dict]:
    """
    Use Llama 3.2 3B to detect anomalies in metrics and logs.
    Returns alert dict if anomaly detected, None otherwise.
    """
    try:
        # Build context for LLM
        context = f"""You are monitoring the service "{service}".

Recent Metrics:
"""

        # Add metrics context
        if metrics.get("up"):
            for metric in metrics["up"]:
                container = metric.get("metric", {}).get("container", "unknown")
                value = metric.get("value", [None, 0])[1]
                status = "UP" if float(value) == 1 else "DOWN"
                context += f"- {container}: {status}\n"

        if metrics.get("errors"):
            for metric in metrics["errors"]:
                svc = metric.get("metric", {}).get("service", service)
                value = metric.get("value", [None, 0])[1]
                if float(value) > 0:
                    context += f"- {svc}: {value} errors/sec (5m avg)\n"

        # Add log samples
        if logs:
            context += f"\nRecent Error Logs ({len(logs)} entries):\n"
            for log in logs[:5]:  # Only include first 5 to keep prompt short
                context += f"- {log['message'][:100]}\n"

        context += """
Analyze the above data. Is there an anomaly that requires attention?
Respond in JSON format:
{
  "anomaly_detected": true/false,
  "severity": "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
  "summary": "brief description",
  "details": "what's wrong and why it matters"
}
"""

        # Call Ollama (Llama 3.2 3B)
        async with aiohttp.ClientSession() as session:
            url = f"{OLLAMA_HOST}/api/generate"
            payload = {
                "model": "llama3.2:3b-instruct-q4_K_M",
                "prompt": context,
                "stream": False,
                "format": "json",
                "options": {
                    "temperature": 0.3,  # More deterministic for detection
                    "num_predict": 256,
                }
            }

            async with session.post(url, json=payload, timeout=aiohttp.ClientTimeout(total=30)) as response:
                if response.status == 200:
                    result = await response.json()
                    response_text = result.get("response", "")

                    # Parse JSON response
                    import json
                    try:
                        detection = json.loads(response_text)

                        if detection.get("anomaly_detected"):
                            return {
                                "type": "watcher_alert",
                                "service": service,
                                "severity": detection.get("severity", "MEDIUM"),
                                "summary": detection.get("summary", "Anomaly detected"),
                                "details": detection.get("details", ""),
                                "timestamp": datetime.now().isoformat(),
                                "metrics": metrics,
                                "logs": logs[:10],  # Include limited logs
                            }
                    except json.JSONDecodeError:
                        logger.warning(f"Failed to parse LLM response as JSON: {response_text[:100]}")

                return None

    except Exception as e:
        logger.error(f"LLM anomaly detection failed for {service}: {e}")
        return None


async def check_service_tier(services: List[str], tier_name: str, alert_callback: Callable):
    """Check a tier of services and send alerts"""
    logger.info(f"Checking {tier_name} services: {', '.join(services)}")

    # Fetch global metrics once
    metrics = await fetch_prometheus_metrics()

    for service in services:
        if _stop_flag:
            break

        try:
            # Fetch service-specific logs
            logs = await fetch_loki_logs(service, minutes=5)

            # Detect anomalies
            alert = await detect_anomalies_with_llm(metrics, logs, service)

            if alert:
                logger.info(f"🚨 Alert detected for {service}: {alert.get('severity')} - {alert.get('summary')}")
                await alert_callback(alert)
            else:
                logger.debug(f"✓ {service} looks healthy")

        except Exception as e:
            logger.error(f"Error checking {service}: {e}")


async def watch_loop(alert_callback: Callable):
    """
    Main watch loop - checks services on different intervals.

    Critical services: Every 5 minutes
    Product services: Every 10 minutes
    Everything else: Every 1 hour
    """
    logger.info("🔍 Watcher agent starting...")

    iteration = 0

    while not _stop_flag:
        try:
            iteration += 1
            logger.info(f"--- Watcher Cycle #{iteration} ---")

            # Check critical services (every iteration)
            await check_service_tier(CRITICAL_SERVICES, "CRITICAL", alert_callback)

            # Check product services (every 2 iterations = 10 minutes)
            if iteration % 2 == 0:
                await check_service_tier(PRODUCT_SERVICES, "PRODUCT", alert_callback)

            # TODO: Check all other services (every 12 iterations = 1 hour)
            # if iteration % 12 == 0:
            #     await check_service_tier(ALL_OTHER_SERVICES, "DEFAULT", alert_callback)

            # Sleep until next check
            logger.info(f"Sleeping for {CRITICAL_CHECK_INTERVAL}s until next check...")
            await asyncio.sleep(CRITICAL_CHECK_INTERVAL)

        except Exception as e:
            logger.error(f"Error in watch loop: {e}")
            await asyncio.sleep(60)  # Brief recovery sleep


def stop():
    """Stop the watcher agent"""
    global _stop_flag
    _stop_flag = True
    logger.info("🛑 Watcher agent stopping...")
