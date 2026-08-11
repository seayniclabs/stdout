# StdOut v1.0 Release Notes

**Release Date:** August 11, 2026  
**Docker Image:** `charlieseay/stdout:latest` (digest: fd1da23f)

---

## 🎉 What's New in v1.0

### Core Features

#### Self-Hosted Infrastructure Monitoring
- **Single-container deployment** - Everything you need in one Docker image
- **SQLite-powered** - Zero external dependencies, runs anywhere
- **3-minute setup** - License activation → environment naming → API token → done

#### AI-Powered Incident Management
- **Knowledge Base** - Store troubleshooting guides, runbooks, and post-mortems
- **Full-text search** - SQLite FTS5 hybrid search across all documentation
- **Community packs** - 5 pre-built troubleshooting guides included
- **Riggins AI assistant** - Auto-routing to best available AI (Ollama/Claude/Gemini)

#### Observatory Autonomous System
- **Auto-learning worker** - Generates post-mortems from resolved incidents
- **Watcher agent** - 180s interval autonomous monitoring
- **Network discovery** - ARP table + subnet scanning (passive + active tiers)
- **Auto-wire monitors** - Automatically creates monitors from discovered hosts

#### Production-Grade Infrastructure
- **20 database migrations** - Fully schema-validated from day one
- **Session management** - Secure authentication with argon2id password hashing
- **RBAC** - Admin/operator/viewer roles with granular permissions
- **Health checks** - Built-in healthcheck endpoint for monitoring

---

## 📦 Community Knowledge Packs (Included)

StdOut v1.0 ships with **5 production-ready troubleshooting guides**:

1. **SSH Server Security Hardening** - Remote access best practices
2. **Network Packet Loss Diagnosis** - Troubleshooting connectivity issues
3. **Database Slow Query Optimization** - Performance tuning for databases
4. **Kubernetes Service Discovery Issues** - DNS and pod networking
5. **Kubernetes Pod CrashLoopBackOff** - Container startup failures

Each guide includes:
- Step-by-step troubleshooting procedures
- Common root causes and solutions
- Verification commands
- Best practices

---

## 🔧 Technical Improvements

### Database & Schema
- **Complete migration system** - 20 migrations applied automatically on first run
- **Schema validation** - All tables verified against TypeScript schema definitions
- **UPSERT support** - Idempotent operations using raw SQLite prepared statements
- **Fresh database on upgrade** - Clean migration path from any previous version

### Performance
- **Scanner schedule rebuilt** - New schema with interval/hour/minute/weekday columns
- **Optimized queries** - Raw SQL for performance-critical UPSERT operations
- **Efficient indexing** - FTS5 full-text search with semantic chunking

### UI/UX
- **Riggins chat panel** - Fixed duplicate panel bug, now hidden by default
- **Responsive design** - Mobile-friendly interface
- **Onboarding wizard** - 8-step guided setup (dismissible)
- **Empty states** - Clear guidance when no data exists yet

---

## 🐛 Bug Fixes

### Critical Fixes
- **Database schema mismatch** - Fixed missing `monitors.latency_ms` column (blocked login)
- **Scanner schedule errors** - Rebuilt table with correct schema (interval, hour, minute, weekday)
- **Duplicate Riggins panel** - Removed duplicate AgentPanel component from Dashboard
- **SQL UPSERT errors** - Converted 5 queries to raw SQLite (4 fully resolved, 1 non-fatal remains)

### Minor Fixes
- **Migration journal gaps** - Fixed missing idx 10, corrected idx 8
- **Migrations 11-19** - Restored to active directory and applied successfully

---

## 📋 Installation

### Docker (Recommended)

```bash
# Create data directory
mkdir -p ~/stdout-data

# Run StdOut
docker run -d \
  --name stdout \
  -p 8112:4321 \
  -v ~/stdout-data:/app/data \
  charlieseay/stdout:latest

# Access at http://localhost:8112
```

### First-Time Setup

1. Navigate to `http://localhost:8112`
2. Create admin account
3. Activate license (free dev license: `SL-DEV-STDOUT-2026`)
4. Name your environment
5. Generate scanner API token
6. Run discovery (optional)

---

## 🔐 Security

### Authentication
- **argon2id password hashing** - Industry-standard secure password storage
- **Session-based auth** - Secure session tokens with expiration
- **CSRF protection** - All forms protected with CSRF tokens

### Authorization
- **Role-based access control** - Admin, operator, viewer roles
- **Granular permissions** - Per-action authorization checks
- **License validation** - Server-side license enforcement

---

## 📊 System Requirements

### Minimum
- **CPU:** 1 core
- **RAM:** 512 MB
- **Disk:** 100 MB (plus data storage)
- **Platform:** Docker-compatible OS (Linux, macOS, Windows)

### Recommended
- **CPU:** 2 cores
- **RAM:** 1 GB
- **Disk:** 1 GB (for logs and knowledge base growth)
- **Network:** Local network access for discovery

---

## 🔄 Upgrade Path

### From Pre-Release Versions
1. **Backup your data directory** - `cp -r ~/stdout-data ~/stdout-data.backup`
2. **Delete old database** - `rm ~/stdout-data/stdout.db`
3. **Pull latest image** - `docker pull charlieseay/stdout:latest`
4. **Restart container** - Fresh database with all 20 migrations applied
5. **Re-run setup wizard** - License, environment, scanner token

**Note:** v1.0 uses a fresh database schema. Data migration from pre-release versions is not supported.

---

## 🗺️ Roadmap

### Planned for v1.1
- Fix remaining non-fatal SQL error in initial-discovery
- Additional community knowledge packs
- Enhanced network discovery (deeper service fingerprinting)
- Prometheus/Loki/Tempo integration improvements

### Planned for v1.2
- PostgreSQL support (in addition to SQLite)
- Multi-instance federation
- Advanced alerting rules
- Custom playbook execution

---

## 📚 Documentation

- **Quick Start Guide:** `docs/QUICK-START.md`
- **Installation Guide:** `docs/INSTALLATION.md`
- **User Guide:** `docs/USER-GUIDE.md`
- **Admin Guide:** `docs/ADMIN-GUIDE.md`

---

## 🙏 Acknowledgments

Built with:
- **Astro** - Web framework
- **SQLite** - Database
- **Drizzle ORM** - Type-safe SQL
- **Claude API** - AI-powered assistance
- **Docker** - Containerization

---

## 📞 Support

- **GitHub Issues:** https://github.com/seayniclabs/stdout/issues
- **Documentation:** https://github.com/seayniclabs/stdout/tree/main/docs
- **Email:** support@seayniclabs.com

---

## 📄 License

StdOut is proprietary software licensed by Seaynic Labs LLC.

- **Self-Hosted License:** $149 one-time (unlimited use)
- **Cloud Solo:** $12/month
- **Cloud Shop:** $24/month

---

**Happy monitoring! 🚀**

*Built by [Seaynic Labs LLC](https://seayniclabs.com)*
