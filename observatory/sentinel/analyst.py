"""
Analyst Agent - Smart Diagnosis with Qwen 2.5 14B

Triggered by HIGH/CRITICAL alerts from Watcher.
Performs deep investigation: metric correlation, log analysis, historical context.
Generates actionable diagnosis with root cause hypothesis.
"""

import aiohttp
import os
from datetime import datetime, timedelta
from typing import Dict, List, Optional
import logging
import json

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Configuration
OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://host.docker.internal:11434")
PROMETHEUS_URL = os.getenv("PROMETHEUS_URL", "http://prometheus:9090")
LOKI_URL = os.getenv("LOKI_URL", "http://loki:3100")
HELMSMAN_API_URL = os.getenv("HELMSMAN_API_URL", "")


async def fetch_extended_metrics(service: str, minutes: int = 30) -> Dict:
    """Fetch extended metrics for deep analysis"""
    try:
        async with aiohttp.ClientSession() as session:
            queries = {
                "cpu_trend": f'avg_over_time(container_cpu_usage_seconds_total{{container="{service}"}}[{minutes}m])',
                "memory_trend": f'avg_over_time(container_memory_usage_bytes{{container="{service}"}}[{minutes}m])',
                "network_in": f'sum(rate(container_network_receive_bytes_total{{container="{service}"}}[5m]))',
                "network_out": f'sum(rate(container_network_transmit_bytes_total{{container="{service}"}}[5m]))',
                "restart_count": f'changes(container_start_time_seconds{{container="{service}"}}[{minutes}m])',
            }

            results = {}
            for metric_name, query in queries.items():
                url = f"{PROMETHEUS_URL}/api/v1/query"
                params = {"query": query}

                async with session.get(url, params=params, timeout=aiohttp.ClientTimeout(total=15)) as response:
                    if response.status == 200:
                        data = await response.json()
                        results[metric_name] = data.get("data", {}).get("result", [])
                    else:
                        results[metric_name] = []

            return results

    except Exception as e:
        logger.error(f"Failed to fetch extended metrics for {service}: {e}")
        return {}


async def fetch_extended_logs(service: str, minutes: int = 30, limit: int = 500) -> List[Dict]:
    """Fetch extended logs for deep analysis"""
    try:
        async with aiohttp.ClientSession() as session:
            end_time = int(datetime.now().timestamp() * 1e9)
            start_time = int((datetime.now() - timedelta(minutes=minutes)).timestamp() * 1e9)

            url = f"{LOKI_URL}/loki/api/v1/query_range"
            params = {
                "query": f'{{service="{service}"}}',
                "start": start_time,
                "end": end_time,
                "limit": limit,
            }

            async with session.get(url, params=params, timeout=aiohttp.ClientTimeout(total=15)) as response:
                if response.status == 200:
                    data = await response.json()
                    streams = data.get("data", {}).get("result", [])

                    logs = []
                    for stream in streams:
                        for value in stream.get("values", []):
                            timestamp_ns, log_line = value
                            logs.append({
                                "timestamp": int(timestamp_ns) // 1e9,
                                "message": log_line,
                            })

                    return logs
                else:
                    return []

    except Exception as e:
        logger.error(f"Failed to fetch extended logs for {service}: {e}")
        return []


async def fetch_helmsman_context(service: str) -> Dict:
    """Fetch recent task history and lessons from helmsman.db"""
    if not HELMSMAN_API_URL:
        return {}

    try:
        async with aiohttp.ClientSession() as session:
            # Fetch recent tasks related to this service
            url = f"{HELMSMAN_API_URL}/tasks"
            params = {
                "search": service,
                "limit": 10,
                "status": "completed",
            }

            async with session.get(url, params=params, timeout=aiohttp.ClientTimeout(total=10)) as response:
                if response.status == 200:
                    tasks = await response.json()
                    return {"recent_tasks": tasks}
                else:
                    return {}

    except Exception as e:
        logger.error(f"Failed to fetch Helmsman context for {service}: {e}")
        return {}


async def correlate_events(service: str, extended_metrics: Dict, extended_logs: List[Dict]) -> List[str]:
    """
    Correlate events to find patterns:
    - Did restarts coincide with memory spikes?
    - Did error logs appear after deployment?
    - Are there recurring patterns?
    """
    correlations = []

    # Check for restarts
    restart_count = extended_metrics.get("restart_count", [])
    if restart_count and len(restart_count) > 0:
        restart_value = restart_count[0].get("value", [None, 0])[1]
        if float(restart_value) > 0:
            correlations.append(f"Service restarted {int(float(restart_value))} times in the last 30 minutes")

    # Check for error spikes
    error_logs = [log for log in extended_logs if "error" in log.get("message", "").lower() or "ERROR" in log.get("message", "")]
    if len(error_logs) > 10:
        correlations.append(f"Error log spike: {len(error_logs)} error entries in last 30 minutes")

    # Check for memory growth
    memory_trend = extended_metrics.get("memory_trend", [])
    if memory_trend and len(memory_trend) > 1:
        first_value = float(memory_trend[0].get("value", [None, 0])[1])
        last_value = float(memory_trend[-1].get("value", [None, 0])[1])
        if last_value > first_value * 1.5:  # 50% growth
            correlations.append(f"Memory usage grew {int((last_value/first_value - 1) * 100)}% over last 30 minutes")

    return correlations


async def diagnose(alert: Dict) -> Dict:
    """
    Perform deep diagnosis using Qwen 2.5 14B.

    Steps:
    1. Fetch extended metrics (30 minutes)
    2. Fetch extended logs (30 minutes, 500 lines)
    3. Fetch Helmsman context (recent tasks, lessons)
    4. Correlate events
    5. Generate diagnosis with LLM
    """
    service = alert.get("service", "unknown")
    logger.info(f"🧠 Analyst investigating {service}...")

    try:
        # Gather evidence in parallel
        import asyncio
        extended_metrics, extended_logs, helmsman_context = await asyncio.gather(
            fetch_extended_metrics(service, minutes=30),
            fetch_extended_logs(service, minutes=30, limit=500),
            fetch_helmsman_context(service),
        )

        # Correlate events
        correlations = await correlate_events(service, extended_metrics, extended_logs)

        # Build comprehensive context for LLM
        context = f"""You are an expert infrastructure analyst investigating an alert for service "{service}".

ALERT SUMMARY:
Severity: {alert.get('severity')}
Summary: {alert.get('summary')}
Details: {alert.get('details')}
Timestamp: {alert.get('timestamp')}

EXTENDED METRICS (last 30 minutes):
"""

        # Add metrics
        for metric_name, metric_data in extended_metrics.items():
            if metric_data:
                context += f"\n{metric_name.upper()}:\n"
                for entry in metric_data[:3]:  # Limit to 3 entries
                    value = entry.get("value", [None, "N/A"])[1]
                    context += f"  - {value}\n"

        # Add log samples
        context += f"\n\nEXTENDED LOGS (last 30 minutes, {len(extended_logs)} total entries):\n"
        error_logs = [log for log in extended_logs if "error" in log.get("message", "").lower()]
        sample_logs = error_logs[:10] if error_logs else extended_logs[:10]

        for log in sample_logs:
            context += f"  - {log.get('message', '')[:150]}\n"

        # Add correlations
        if correlations:
            context += "\n\nCORRELATED EVENTS:\n"
            for correlation in correlations:
                context += f"  - {correlation}\n"

        # Add Helmsman context
        if helmsman_context.get("recent_tasks"):
            context += f"\n\nRECENT TASKS (last 10 related to {service}):\n"
            for task in helmsman_context["recent_tasks"][:5]:
                context += f"  - {task.get('title', 'Unknown')}: {task.get('status', 'Unknown')}\n"

        context += """

DIAGNOSIS TASK:
Analyze the evidence above and provide a comprehensive diagnosis.

Respond in JSON format:
{
  "root_cause": "Your hypothesis about what caused this issue",
  "severity": "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO",
  "affected_services": ["list", "of", "affected", "services"],
  "blast_radius": "description of impact scope",
  "recommended_action": "What should be done about this",
  "confidence": 0.0-1.0,
  "similar_incidents": "reference to any similar past incidents if found in tasks",
  "timeline": "when did this start, what triggered it"
}

Be specific. Reference actual log entries and metrics. If you're unsure, say so with lower confidence.
"""

        # Call Ollama (Qwen 2.5 14B)
        async with aiohttp.ClientSession() as session:
            url = f"{OLLAMA_HOST}/api/generate"
            payload = {
                "model": "qwen2.5:14b-instruct-q4_K_M",
                "prompt": context,
                "stream": False,
                "format": "json",
                "options": {
                    "temperature": 0.4,
                    "num_predict": 1024,
                }
            }

            async with session.post(url, json=payload, timeout=aiohttp.ClientTimeout(total=60)) as response:
                if response.status == 200:
                    result = await response.json()
                    response_text = result.get("response", "")

                    # Parse JSON response
                    try:
                        diagnosis = json.loads(response_text)

                        return {
                            "type": "analyst_diagnosis",
                            "service": service,
                            "alert": alert,
                            "diagnosis": diagnosis,
                            "timestamp": datetime.now().isoformat(),
                            "evidence": {
                                "metrics_count": sum(len(v) for v in extended_metrics.values()),
                                "logs_analyzed": len(extended_logs),
                                "correlations": correlations,
                            }
                        }

                    except json.JSONDecodeError as e:
                        logger.warning(f"Failed to parse Analyst response as JSON: {response_text[:200]}")
                        # Return fallback diagnosis
                        return {
                            "type": "analyst_diagnosis",
                            "service": service,
                            "alert": alert,
                            "diagnosis": {
                                "root_cause": "Unable to complete full analysis due to parsing error",
                                "severity": alert.get("severity", "MEDIUM"),
                                "recommended_action": "Manual investigation required",
                                "confidence": 0.3,
                            },
                            "timestamp": datetime.now().isoformat(),
                            "error": str(e),
                        }

                else:
                    logger.error(f"Ollama request failed: HTTP {response.status}")
                    return {
                        "type": "analyst_diagnosis",
                        "service": service,
                        "alert": alert,
                        "diagnosis": {
                            "root_cause": "Analyst agent unavailable",
                            "severity": alert.get("severity", "MEDIUM"),
                            "recommended_action": "Check Ollama service health",
                            "confidence": 0.0,
                        },
                        "timestamp": datetime.now().isoformat(),
                    }

    except Exception as e:
        logger.error(f"Diagnosis failed for {service}: {e}")
        return {
            "type": "analyst_diagnosis",
            "service": service,
            "alert": alert,
            "diagnosis": {
                "root_cause": f"Analysis error: {str(e)}",
                "severity": "MEDIUM",
                "recommended_action": "Check Sentinel logs for details",
                "confidence": 0.0,
            },
            "timestamp": datetime.now().isoformat(),
            "error": str(e),
        }
