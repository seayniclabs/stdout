from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import asyncio
import json
from datetime import datetime
from typing import List
import os

from agents import watcher, analyst

app = FastAPI(title="StdOut Observatory Sentinel AI")

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# WebSocket connections
active_connections: List[WebSocket] = []

# Configuration
OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://host.docker.internal:11434")
PROMETHEUS_URL = os.getenv("PROMETHEUS_URL", "http://prometheus:9090")
LOKI_URL = os.getenv("LOKI_URL", "http://loki:3100")

@app.get("/")
async def root():
    return {
        "service": "StdOut Observatory Sentinel AI",
        "status": "operational",
        "timestamp": datetime.now().isoformat()
    }

@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "ollama": OLLAMA_HOST,
        "prometheus": PROMETHEUS_URL,
        "loki": LOKI_URL,
        "connections": len(active_connections)
    }

@app.get("/status")
async def status():
    """Get Sentinel AI status"""
    return {
        "watcher": {
            "model": "llama3.2:3b-instruct-q4_K_M",
            "interval": "60s",
            "status": "active"
        },
        "analyst": {
            "model": "qwen2.5:14b-instruct-q4_K_M",
            "status": "standby"
        },
        "active_connections": len(active_connections)
    }

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    active_connections.append(websocket)
    
    try:
        # Send welcome message
        await websocket.send_json({
            "type": "system",
            "message": "Connected to Sentinel AI",
            "timestamp": datetime.now().isoformat()
        })
        
        # Keep connection alive
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            
            # Broadcast to all connections
            for connection in active_connections:
                if connection != websocket:
                    await connection.send_text(data)
                    
    except WebSocketDisconnect:
        active_connections.remove(websocket)

@app.post("/api/chat")
async def post_message(message: dict):
    """Post a message to all connected clients"""
    for connection in active_connections:
        await connection.send_json(message)
    return {"status": "sent", "connections": len(active_connections)}


async def alert_handler(alert: dict):
    """Handle alerts from Watcher"""
    # Broadcast to WebSocket clients
    for connection in active_connections:
        try:
            await connection.send_json(alert)
        except:
            pass

    # Trigger Analyst for HIGH/CRITICAL alerts
    if alert.get("severity") in ["HIGH", "CRITICAL"]:
        diagnosis = await analyst.diagnose(alert)

        # Broadcast diagnosis
        for connection in active_connections:
            try:
                await connection.send_json(diagnosis)
            except:
                pass


@app.on_event("startup")
async def startup_event():
    """Start the Watcher agent"""
    asyncio.create_task(watcher.watch_loop(alert_handler))
    print("✅ Watcher agent started")


@app.on_event("shutdown")
async def shutdown_event():
    """Stop the Watcher agent"""
    watcher.stop()
    print("🛑 Watcher agent stopped")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8081)
