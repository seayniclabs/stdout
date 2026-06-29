---
date: 2026-06-26
project: stdout
status: automated-scan
---

# Architecture Summary: stdout

**Generated:** Fri Jun 26 08:15:05 CDT 2026
**Location:** /Users/charlieseay/Projects/stdout

## Project Inventory

```json
{
  "totalFiles": 437,
  "estimatedComplexity": "large",
  "stats": {
    "filesScanned": 437,
    "byCategory": {
      "docs": 56,
      "config": 20,
      "infra": 8,
      "code": 315,
      "data": 13,
      "script": 14,
      "markup": 11
    },
    "byLanguage": {
      "markdown": 52,
      "json": 14,
      "unknown": 4,
      "config": 1,
      "yaml": 10,
      "javascript": 18,
      "service": 1,
      "license": 1,
      "dockerfile": 2,
      "typescript": 218,
      "sql": 13,
      "shell": 14,
      "pem": 1,
      "python": 4,
      "txt": 4,
      "html": 9,
      "srt": 1,
      "old": 1,
      "astro": 67,
      "css": 2
    }
  }
}
```

### Files by Category

- **docs**: 56 files
- **config**: 20 files
- **infra**: 8 files
- **code**: 315 files
- **data**: 13 files
- **script**: 14 files
- **markup**: 11 files

### Languages Detected

- **typescript**: 218 files
- **astro**: 67 files
- **markdown**: 52 files
- **javascript**: 18 files
- **json**: 14 files
- **shell**: 14 files
- **sql**: 13 files
- **yaml**: 10 files
- **html**: 9 files
- **unknown**: 4 files
- **python**: 4 files
- **txt**: 4 files
- **dockerfile**: 2 files
- **css**: 2 files
- **config**: 1 files
- **service**: 1 files
- **license**: 1 files
- **pem**: 1 files
- **srt**: 1 files
- **old**: 1 files


### Import Relationships

**Stats:**
- Files with imports: 153
- Total import edges: 275

**Import map available:** `.architecture/understand-anything/import-map.json`


## Lore Map

*Lore Map requires interactive workflow — run manually:*
```bash
cd /Users/charlieseay/Projects/stdout
lore plan  # or: lore scan
```


## Next Steps

### Interactive Exploration

**Understand Anything** (knowledge graph):
```bash
cd /Users/charlieseay/Projects/stdout
# Generate full knowledge graph (uses Claude API)
claude /understand

# Launch interactive dashboard
claude /understand-dashboard

# Ask questions
claude /understand-chat "How does authentication work?"
```

**Lore Map** (architecture editor):
```bash
cd /Users/charlieseay/Projects/stdout
# Plan new feature
lore plan

# Quick scan
lore scan

# Deep scan with internals
lore deep-scan
```

### Automated Re-scan

Run this script again to refresh the analysis:
```bash
~/Projects/analyze-project-automated.sh /Users/charlieseay/Projects/stdout
```

---

**Scan logs:**
- Understand scan: `.architecture/understand-scan.log`
- Import extraction: `.architecture/understand-imports.log`
- Lore scan: `.architecture/lore-scan.log`

**Raw data:**
- File inventory: `.architecture/understand-anything/scan-files.json`
- Import map: `.architecture/understand-anything/import-map.json`

