"""
StdOut Observatory AI Agents
Watcher (Llama 3.2 3B) - Fast detection
Analyst (Qwen 2.5 14B) - Deep diagnosis
"""

import aiohttp
import asyncio
import json
import os
from datetime import datetime
from typing import Dict, List, Optional

# Configuration
OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://host.docker.internal:11434")
PROMETHEUS_URL = os.getenv("PROMETHEUS_URL", "http://prometheus:9090")
LOKI_URL = os.getenv("LOKI_URL", "http://loki:3100")
TEMPO_URL = os.getenv("TEMPO_URL", "http://tempo:3200")

WATCHER_MODEL = os.getenv("WATCHER_MODEL", "llama3.2:3b-instruct-q4_K_M")
ANALYST_MODEL = os.getenv("ANALYST_MODEL", "qwen2.5:14b-instruct-q4_K_M")

CRITICAL_INTERVAL = int(os.getenv("CRITICAL_CHECK_INTERVAL", "300"))
PRODUCT_INTERVAL = int(os.getenv("PRODUCT_CHECK_INTERVAL", "600"))
DEFAULT_INTERVAL = int(os.getenv("DEFAULT_CHECK_INTERVAL", "3600"))


class WatcherAgent:
    """Fast detection agent using Llama 3.2 3B"""

    def __init__(self):
        self.model = WATCHER_MODEL
        self.running = False

    async def query_ollama(self, prompt: str) -> str:
        """Query Ollama API"""
        async with aiohttp.ClientSession() as session:
            try:
                async with session.post(
                    f"{OLLAMA_HOST}/api/generate",
                    json={
                        "model": self.model,
                        "prompt": prompt,
                        "stream": False
                    },
                    timeout=aiohttp.ClientTimeout(total=30)
                ) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        return data.get("response", "")
                    return f"Error: HTTP {resp.status}"
            except Exception as e:
                return f"Error: {str(e)}"

    async def check_metrics(self) -> Dict:
        """Query Prometheus for metrics"""
        async with aiohttp.ClientSession() as session:
            try:
                # Query container up status
                async with session.get(
                    f"{PROMETHEUS_URL}/api/v1/query",
                    params={"query": "up"},
                    timeout=aiohttp.ClientTimeout(total=10)
                ) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        return data.get("data", {}).get("result", [])
            except Exception as e:
                print(f"Prometheus error: {e}")
        return []

    async def analyze_metrics(self, metrics: List[Dict]) -> Optional[Dict]:
        """Use LLM to analyze metrics and detect issues"""
        if not metrics:
            return None

        # Count services
        total = len(metrics)
        up = sum(1 for m in metrics if m.get("value", [None, 0])[1] == "1")
        down = total - up

        if down == 0:
            return None  # All healthy

        # Build prompt for LLM
        down_services = [
            m.get("metric", {}).get("job", "unknown")
            for m in metrics
            if m.get("value", [None, 0])[1] == "0"
        ]

        prompt = f"""You are a monitoring system. Analyze this situation:

Total services: {total}
Up: {up}
Down: {down}
Down services: {', '.join(down_services)}

Is this an incident requiring immediate attention? Answer in ONE sentence, then state severity (LOW/MEDIUM/HIGH/CRITICAL).

Format:
ANALYSIS: [one sentence]
SEVERITY: [LOW/MEDIUM/HIGH/CRITICAL]
"""

        response = await self.query_ollama(prompt)

        # Parse response
        lines = response.strip().split('\n')
        analysis = ""
        severity = "MEDIUM"

        for line in lines:
            if line.startswith("ANALYSIS:"):
                analysis = line.replace("ANALYSIS:", "").strip()
            elif line.startswith("SEVERITY:"):
                severity = line.replace("SEVERITY:", "").strip()

        if analysis:
            return {
                "type": "watcher_alert",
                "timestamp": datetime.now().isoformat(),
                "services_down": down,
                "down_list": down_services,
                "analysis": analysis,
                "severity": severity
            }

        return None

    async def watch_loop(self, alert_callback):
        """Main watch loop"""
        self.running = True

        while self.running:
            try:
                # Check metrics
                metrics = await self.check_metrics()

                # Analyze
                alert = await self.analyze_metrics(metrics)

                if alert:
                    # Send alert
                    await alert_callback(alert)

                # Wait for next check
                await asyncio.sleep(CRITICAL_INTERVAL)

            except Exception as e:
                print(f"Watcher error: {e}")
                await asyncio.sleep(30)

    def stop(self):
        """Stop the watch loop"""
        self.running = False


class AnalystAgent:
    """Deep diagnosis agent using Qwen 2.5 14B"""

    def __init__(self):
        self.model = ANALYST_MODEL

    async def query_ollama(self, prompt: str) -> str:
        """Query Ollama API with larger model"""
        async with aiohttp.ClientSession() as session:
            try:
                async with session.post(
                    f"{OLLAMA_HOST}/api/generate",
                    json={
                        "model": self.model,
                        "prompt": prompt,
                        "stream": False
                    },
                    timeout=aiohttp.ClientTimeout(total=120)
                ) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        return data.get("response", "")
                    return f"Error: HTTP {resp.status}"
            except Exception as e:
                return f"Error: {str(e)}"

    async def get_logs(self, service: str, last_minutes: int = 10) -> List[str]:
        """Get recent logs from Loki"""
        async with aiohttp.ClientSession() as session:
            try:
                query = f'{{job="{service}"}}'
                async with session.get(
                    f"{LOKI_URL}/loki/api/v1/query_range",
                    params={
                        "query": query,
                        "limit": 100
                    },
                    timeout=aiohttp.ClientTimeout(total=15)
                ) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        # Extract log lines
                        logs = []
                        for stream in data.get("data", {}).get("result", []):
                            for entry in stream.get("values", []):
                                logs.append(entry[1])  # log message
                        return logs[-50:]  # Last 50 lines
            except Exception as e:
                print(f"Loki error: {e}")
        return []

    async def diagnose(self, alert: Dict) -> Dict:
        """Deep diagnosis of an alert"""
        services = alert.get("down_list", [])

        # Get logs for down services
        all_logs = []
        for service in services[:3]:  # Limit to first 3 services
            logs = await self.get_logs(service)
            all_logs.extend(logs[-10:])  # Last 10 lines per service

        # Build detailed prompt
        prompt = f"""You are a senior DevOps engineer diagnosing a production incident.

ALERT:
{alert.get('analysis', 'Services are down')}

AFFECTED SERVICES:
{', '.join(services)}

RECENT LOGS (last 10 lines):
{chr(10).join(all_logs) if all_logs else 'No logs available'}

Provide:
1. ROOT CAUSE (one sentence)
2. IMPACT (one sentence)
3. RECOMMENDED FIX (specific steps, max 3 bullet points)
4. PREVENTIVE MEASURES (one sentence)

Be concise and actionable.
"""

        response = await self.query_ollama(prompt)

        return {
            "type": "analyst_diagnosis",
            "timestamp": datetime.now().isoformat(),
            "alert": alert,
            "diagnosis": response,
            "logs_analyzed": len(all_logs)
        }


# Global instances
watcher = WatcherAgent()
analyst = AnalystAgent()
