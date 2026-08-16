# Purchase Confirmation Email Template

**To be sent:** Immediately after purchase via store.seayniclabs.com  
**Format:** HTML email (template below)  
**Subject:** Your StdOut Self-Hosted License - Order #{{ORDER_NUMBER}}

---

## Email Template (HTML Version)

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>StdOut Self-Hosted - Order Confirmation</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
      line-height: 1.6;
      color: #1f2937;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
      background: #f9fafb;
    }
    .container {
      background: white;
      border-radius: 8px;
      padding: 32px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    .header {
      text-align: center;
      margin-bottom: 32px;
    }
    .logo {
      font-size: 24px;
      font-weight: 700;
      color: #f97316;
      margin-bottom: 8px;
    }
    .tagline {
      font-size: 14px;
      color: #6b7280;
    }
    h1 {
      font-size: 20px;
      margin-bottom: 16px;
      color: #111827;
    }
    .license-box {
      background: #f3f4f6;
      border-left: 4px solid #f97316;
      padding: 16px;
      margin: 24px 0;
      font-family: 'Courier New', monospace;
      font-size: 16px;
      font-weight: 600;
      letter-spacing: 0.5px;
    }
    .steps {
      margin: 24px 0;
    }
    .step {
      margin-bottom: 16px;
      padding-left: 32px;
      position: relative;
    }
    .step-number {
      position: absolute;
      left: 0;
      top: 0;
      background: #f97316;
      color: white;
      width: 24px;
      height: 24px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      font-weight: 600;
    }
    .code-block {
      background: #1f2937;
      color: #f9fafb;
      padding: 16px;
      border-radius: 6px;
      font-family: 'Courier New', monospace;
      font-size: 13px;
      margin: 12px 0;
      overflow-x: auto;
    }
    .download-link {
      display: inline-block;
      background: #f97316;
      color: white;
      padding: 12px 24px;
      border-radius: 6px;
      text-decoration: none;
      font-weight: 600;
      margin: 8px 8px 8px 0;
    }
    .download-link:hover {
      background: #ea580c;
    }
    .note {
      background: #fef3c7;
      border-left: 4px solid #f59e0b;
      padding: 12px;
      margin: 16px 0;
      font-size: 14px;
    }
    .footer {
      text-align: center;
      margin-top: 32px;
      padding-top: 24px;
      border-top: 1px solid #e5e7eb;
      font-size: 14px;
      color: #6b7280;
    }
    .support-link {
      color: #f97316;
      text-decoration: none;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">StdOut</div>
      <div class="tagline">Self-Hosted Edition</div>
    </div>

    <h1>Thank you for your purchase!</h1>
    
    <p>Your StdOut Self-Hosted license is ready. Keep this email safe — you'll need your license key during installation.</p>

    <div class="license-box">
      {{LICENSE_KEY}}
    </div>

    <div class="note">
      <strong>⚠️ Important:</strong> Save this license key. You'll enter it during the setup wizard.
    </div>

    <h2>Installation Files</h2>
    <p>Download these files to get started:</p>
    
    <a href="https://raw.githubusercontent.com/seayniclabs/stdout/main/docker-compose.customer.yml" class="download-link">📦 docker-compose.yml</a>
    <a href="https://raw.githubusercontent.com/seayniclabs/stdout/main/.env.example" class="download-link">⚙️ .env.example</a>

    <h2>Quick Start (2 Minutes)</h2>
    
    <div class="steps">
      <div class="step">
        <div class="step-number">1</div>
        <strong>Download the files above</strong><br>
        Save them to a new directory on your server.
      </div>

      <div class="step">
        <div class="step-number">2</div>
        <strong>Configure your environment</strong><br>
        Rename the files and set your URL:
        <div class="code-block">mv docker-compose.customer.yml docker-compose.yml
cp .env.example .env

# Edit .env and set:
# - APP_URL (your server IP or domain)
# - SECRET_KEY (generate with: openssl rand -hex 32)</div>
      </div>

      <div class="step">
        <div class="step-number">3</div>
        <strong>Start StdOut</strong>
        <div class="code-block">docker compose up -d</div>
      </div>

      <div class="step">
        <div class="step-number">4</div>
        <strong>Complete setup wizard</strong><br>
        Open <code>http://your-server-ip:8112</code> in your browser<br>
        Enter your license key from above when prompted
      </div>
    </div>

    <div class="note">
      <strong>✓ That's it!</strong> Installation takes less than 1 minute. The setup wizard will guide you through creating your admin account.
    </div>

    <h2>What's Next?</h2>
    <ul>
      <li><strong>Automatic Discovery:</strong> StdOut will start discovering your infrastructure immediately</li>
      <li><strong>Knowledge Base:</strong> 5 community troubleshooting packs are pre-loaded</li>
      <li><strong>Riggins AI:</strong> Your Observatory Agent is ready (works with or without API keys)</li>
    </ul>

    <h2>Documentation</h2>
    <ul>
      <li><a href="https://github.com/seayniclabs/stdout/blob/main/README.md" class="support-link">Full Documentation</a></li>
      <li><a href="https://github.com/seayniclabs/stdout/blob/main/INSTALL.md" class="support-link">Installation Guide</a></li>
      <li><a href="https://stdout.seayniclabs.com" class="support-link">Product Website</a></li>
    </ul>

    <h2>Need Help?</h2>
    <ul>
      <li><strong>Email:</strong> <a href="mailto:hello@seayniclabs.com" class="support-link">hello@seayniclabs.com</a></li>
      <li><strong>GitHub Issues:</strong> <a href="https://github.com/seayniclabs/stdout/issues" class="support-link">github.com/seayniclabs/stdout/issues</a></li>
      <li><strong>Response time:</strong> We aim to respond within 24 hours</li>
    </ul>

    <div class="footer">
      <p><strong>Order Details</strong><br>
      Order #{{ORDER_NUMBER}}<br>
      Date: {{ORDER_DATE}}<br>
      Email: {{CUSTOMER_EMAIL}}</p>
      
      <p style="margin-top: 24px;">
        Thank you for supporting independent software!<br>
        <strong>Seaynic Labs LLC</strong>
      </p>
    </div>
  </div>
</body>
</html>
```

---

## Plain Text Version (Fallback)

```
STDOUT SELF-HOSTED - ORDER CONFIRMATION
Order #{{ORDER_NUMBER}}

Thank you for your purchase!

YOUR LICENSE KEY:
{{LICENSE_KEY}}

⚠️ IMPORTANT: Save this license key. You'll need it during installation.

================================================================================
INSTALLATION FILES
================================================================================

Download these files:
1. docker-compose.yml: https://raw.githubusercontent.com/seayniclabs/stdout/main/docker-compose.customer.yml
2. .env.example: https://raw.githubusercontent.com/seayniclabs/stdout/main/.env.example

================================================================================
QUICK START (2 MINUTES)
================================================================================

STEP 1: Download the files above
Save them to a new directory on your server.

STEP 2: Configure your environment
  mv docker-compose.customer.yml docker-compose.yml
  cp .env.example .env
  
  # Edit .env and set:
  # - APP_URL (your server IP or domain)
  # - SECRET_KEY (generate with: openssl rand -hex 32)

STEP 3: Start StdOut
  docker compose up -d

STEP 4: Complete setup wizard
  Open http://your-server-ip:8112 in your browser
  Enter your license key when prompted

That's it! Installation takes less than 1 minute.

================================================================================
WHAT'S NEXT?
================================================================================

✓ Automatic Discovery: StdOut will start discovering your infrastructure immediately
✓ Knowledge Base: 5 community troubleshooting packs are pre-loaded
✓ Riggins AI: Your Observatory Agent is ready (works with or without API keys)

================================================================================
DOCUMENTATION
================================================================================

Full Documentation: https://github.com/seayniclabs/stdout/blob/main/README.md
Installation Guide: https://github.com/seayniclabs/stdout/blob/main/INSTALL.md
Product Website: https://stdout.seayniclabs.com

================================================================================
NEED HELP?
================================================================================

Email: hello@seayniclabs.com
GitHub Issues: https://github.com/seayniclabs/stdout/issues
Response time: We aim to respond within 24 hours

================================================================================
ORDER DETAILS
================================================================================

Order #{{ORDER_NUMBER}}
Date: {{ORDER_DATE}}
Email: {{CUSTOMER_EMAIL}}

Thank you for supporting independent software!
Seaynic Labs LLC
```

---

## Template Variables

The following variables must be replaced when sending:

| Variable | Example | Source |
|----------|---------|--------|
| `{{LICENSE_KEY}}` | `SL-ABCD-1234-EFGH-5678` | Generated at purchase |
| `{{ORDER_NUMBER}}` | `SL-20260816-001` | Store order ID |
| `{{ORDER_DATE}}` | `2026-08-16` | Purchase timestamp |
| `{{CUSTOMER_EMAIL}}` | `customer@company.com` | Buyer email address |

---

## Implementation Notes

### For store.seayniclabs.com

1. **Trigger:** Send immediately after successful payment
2. **From:** `StdOut <hello@seayniclabs.com>`
3. **Reply-To:** `hello@seayniclabs.com`
4. **BCC:** `orders@seayniclabs.com` (for record keeping)
5. **Format:** HTML with plain text fallback
6. **Attachments:** None (links only, for deliverability)

### License Key Format

- Format: `SL-XXXX-XXXX-XXXX-XXXX`
- Length: 24 characters (4 segments of 4)
- Character set: A-Z, 0-9 (uppercase)
- Example: `SL-A3B7-C9D2-E4F6-G8H1`

### Testing Checklist

Before going live, test:
- [ ] All download links work
- [ ] License key displays correctly
- [ ] Code blocks render properly
- [ ] Email renders in Gmail, Outlook, Apple Mail
- [ ] Plain text fallback is readable
- [ ] Mobile rendering works
- [ ] All variables substitute correctly
- [ ] Links are clickable
- [ ] Support email link works

### Follow-Up Sequence (Optional)

**Day 1 (install day):**
- Send purchase confirmation (this template)

**Day 3 (if not installed):**
- "Getting started?" email with troubleshooting tips

**Day 7 (if installed):**
- "How's it going?" email asking for feedback

**Day 30:**
- Feature update email + request for testimonial

---

## Success Metrics

Track these to validate email effectiveness:

- **Open rate:** Target >60% (transactional email)
- **Click rate:** Target >40% (download links)
- **Installation rate:** Target >80% (within 7 days)
- **Support requests:** Baseline (lower = better docs)

---

## Alternative: Download Bundle

Instead of individual file links, could offer a single bundle:

```
https://store.seayniclabs.com/downloads/stdout-{{ORDER_NUMBER}}.zip
```

**Bundle contents:**
- docker-compose.yml (customer version)
- .env.example
- README.md
- LICENSE.txt (copy of license key in plain text)
- QUICKSTART.md (simplified install guide)

**Pros:**
- Single click to download everything
- Less chance of missing a file
- Can include customer-specific license file

**Cons:**
- Requires server infrastructure to generate bundles
- Files may become outdated if we update GitHub
- More complex implementation

**Recommendation:** Start with links (simpler), consider bundle later if support requests indicate confusion.

---

**Estimated implementation time:** 30 minutes  
**Priority:** HIGH (blocks customer install success)  
**Status:** TEMPLATE READY - needs integration with store
