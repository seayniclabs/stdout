# StdOut Customer Onboarding Checklist

**Welcome to StdOut!** This guide walks you through getting your self-hosted instance up and running.

## ✅ Pre-Installation Checklist

### 1. Verify System Requirements

- [ ] **Docker & Docker Compose installed**
  ```bash
  docker --version  # Should show 20.10+
  docker compose version  # Should show 2.0+
  ```

- [ ] **Minimum Resources Available**
  - 2GB RAM (4GB recommended)
  - 10GB disk space
  - Docker socket access

- [ ] **Network Access**
  - Port 8112 available for web UI
  - Docker socket mounted (for discovery)

### 2. Obtain Your License Key

You should have received:
- [ ] **License key** (format: `STDOUT-XXXX-XXXX-XXXX-XXXX`)
- [ ] **GitHub repo access** to `seayniclabs/stdout` (check your email for invitation)

**Verify GitHub access:**
```bash
gh repo view seayniclabs/stdout
# Should show: "StdOut - Self-Hosted Infrastructure Monitoring"
```

### 3. Choose AI Configuration

Pick **ONE** option before proceeding:

**Option A: Local Ollama (Recommended)**
- ✅ Private (data stays on your network)
- ✅ No recurring costs
- ⚠️ Requires 4GB+ RAM, 10GB disk for models

**Option B: Cloud API (Anthropic/OpenAI)**
- ✅ No local resources needed
- ✅ Latest models
- ⚠️ Pay per diagnosis, data sent to cloud

---

## 📦 Installation Steps

### Step 1: Clone the Repository

```bash
# Clone from GitHub (requires repo access)
gh repo clone seayniclabs/stdout
cd stdout
```

### Step 2: Configure Environment

```bash
# Copy example environment file
cp .env.example .env

# Edit configuration
nano .env  # or vim, code, etc.
```

**Required changes in `.env`:**

1. **Set your APP_URL** (replace localhost with your server IP/domain):
   ```bash
   APP_URL=http://192.168.1.100:8112
   # OR
   APP_URL=http://stdout.yourcompany.com
   ```

2. **Generate SECRET_KEY**:
   ```bash
   openssl rand -hex 32
   # Copy the output and paste into .env
   SECRET_KEY=<paste-here>
   ```

3. **Configure AI** (choose one):

   **For Ollama (local):**
   ```bash
   # Install Ollama
   curl -fsSL https://ollama.com/install.sh | sh
   
   # Pull models (this takes 5-10 minutes)
   ollama pull llama3.2:3b-instruct-q4_K_M
   ollama pull qwen2.5:14b-instruct-q4_K_M
   
   # Verify in .env:
   OLLAMA_URL=http://172.17.0.1:11434
   ```

   **For Cloud API:**
   ```bash
   # Get API key from https://console.anthropic.com/
   # Add to .env:
   ANTHROPIC_API_KEY=sk-ant-...
   
   # Comment out OLLAMA_URL in .env
   ```

### Step 3: Activate License

```bash
# Save your license key
echo "STDOUT-XXXX-XXXX-XXXX-XXXX" > stdout.license

# Verify license format
cat stdout.license
```

### Step 4: Launch StdOut

```bash
# Start containers
docker compose up -d

# Watch logs (Ctrl+C to exit)
docker compose logs -f
```

**Expected output:**
```
✓ Container stdout-app       Started
✓ Container stdout-windlass  Started
```

### Step 5: Verify Installation

**Check containers:**
```bash
docker compose ps
# All services should show "Up" status
```

**Access web UI:**
1. Open browser to: `http://YOUR_SERVER_IP:8112`
2. You should see the StdOut login screen

**Test discovery:**
1. Navigate to **Discovery** tab
2. Wait 1-2 minutes for first scan
3. Verify your Docker containers appear

---

## 🎯 Post-Installation Setup

### 1. Create Admin Account

On first access:
- [ ] Navigate to `http://YOUR_SERVER_IP:8112`
- [ ] Click "Create Account"
- [ ] Set admin email and password
- [ ] Save credentials securely

### 2. Configure Discovery

**Adjust scan intervals** (optional):
```bash
# Edit .env
CRITICAL_CHECK_INTERVAL=300   # 5 minutes
PRODUCT_CHECK_INTERVAL=600    # 10 minutes
DEFAULT_CHECK_INTERVAL=3600   # 1 hour

# Restart containers
docker compose restart
```

### 3. Set Up Integrations (Optional)

**Email Notifications:**
```bash
# Get Resend API key from https://resend.com
# Add to .env:
RESEND_API_KEY=re_...
EMAIL_FROM=alerts@yourcompany.com

docker compose restart
```

**Slack Alerts:**
```bash
# Create webhook in Slack
# Add to .env:
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
SLACK_ALERTS_CHANNEL=#infrastructure

docker compose restart
```

### 4. Test AI Diagnosis

- [ ] Navigate to **Incidents** tab
- [ ] Click "Create Incident"
- [ ] Add description and save
- [ ] Click "Ask Riggins" 
- [ ] Verify AI response appears

---

## 📚 Next Steps

### Learn the Platform

- [ ] Read [Configuration Guide](https://github.com/seayniclabs/stdout-docs/blob/main/docs/configuration.md)
- [ ] Review [Troubleshooting Guide](https://github.com/seayniclabs/stdout-docs/blob/main/docs/troubleshooting.md)
- [ ] Explore [API Documentation](https://github.com/seayniclabs/stdout-docs/blob/main/docs/api.md)

### Monitor Real Infrastructure

- [ ] Add custom monitors for your services
- [ ] Configure alert thresholds
- [ ] Create runbooks for common incidents

### Optional: Observatory Stack

For advanced observability (Prometheus, Loki, Tempo):
```bash
docker compose --profile observatory up -d
```

---

## 🆘 Getting Help

### Common Issues

**"Cannot connect to Docker daemon"**
```bash
# Verify Docker is running
sudo systemctl status docker  # Linux
open -a Docker  # macOS

# Verify socket access
ls -l /var/run/docker.sock
```

**"Ollama connection refused"**
```bash
# Verify Ollama is running
ollama list

# Check if accessible from container
docker run --rm curlimages/curl:latest curl http://host.docker.internal:11434/api/tags
```

**"License validation failed"**
```bash
# Verify license file exists and format
cat stdout.license
# Should be: STDOUT-XXXX-XXXX-XXXX-XXXX

# Check container logs
docker compose logs stdout-app | grep -i license
```

### Support Channels

- **Documentation:** https://github.com/seayniclabs/stdout-docs
- **GitHub Issues:** https://github.com/seayniclabs/stdout/issues
- **Email Support:** support@seayniclabs.com (include license key)

---

## ✅ Installation Complete Checklist

Before you consider onboarding complete, verify:

- [ ] Web UI accessible at `http://YOUR_SERVER_IP:8112`
- [ ] Admin account created and can log in
- [ ] Discovery running (containers showing in Discovery tab)
- [ ] AI diagnosis working (Riggins responds in incidents)
- [ ] License activated (no warnings in logs)
- [ ] Optional integrations configured (email, Slack)

**Welcome to StdOut!** Your infrastructure monitoring is now autonomous.

---

**Document Version:** 1.0  
**Last Updated:** 2026-08-28  
**For:** StdOut v1.0+
