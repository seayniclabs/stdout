# StdOut Production QA - Issues Found
**Date:** 2026-06-17
**Build:** charlieseay/stdout:latest (commit TBD)
**Tester:** Claude Sonnet 4.5 (automated)

---

## 🔴 CRITICAL (Blocks Production)

*None yet*

---

## 🟠 HIGH (Must Fix Before Launch)

### H1: Setup wizard redirects to mDNS hostname instead of IP
- **Location:** Installation wizard final redirect
- **Issue:** After successful installation, the setup server redirects to `stdout.local:8112` instead of the IP address `192.168.0.244:8112`
- **Impact:** Users must manually navigate to IP address; mDNS doesn't resolve in some contexts (automated browsers, certain network configs)
- **Expected:** Redirect should use the IP address that the user accessed the setup server from
- **Reproduction:** Complete installation wizard → automatic redirect fails
- **Fix Priority:** HIGH
- **Suggested Fix:** Detect client's access IP and construct redirect URL using that IP instead of mDNS hostname

### H2: Confusing "Getting Started" checklist text for activated license
- **Location:** Dashboard → Getting Started widget → Step 1
- **Issue:** Step 1 shows green checkmark (activated) but description says "Copy your license purchase email, or skip to evaluate for 14 days"
- **Impact:** Confusing UX - license IS activated but text suggests trial mode
- **Expected:** If license is activated, text should confirm activation (e.g., "License activated successfully - Edition: Self-Hosted")
- **Reproduction:** Complete installation with license → view dashboard
- **Fix Priority:** HIGH
- **Suggested Fix:** Update checklist description based on license.activated_at status

### H3: Monitor status shows "—" instead of meaningful pending state
- **Location:** HUD → Service monitors
- **Issue:** Monitors show em dash (—) for status and response time before first check
- **Impact:** Users don't understand if monitor is working or broken
- **Expected:** Show "Pending first check..." or "Initializing..." until first check completes
- **Reproduction:** View HUD immediately after monitor creation
- **Fix Priority:** HIGH
- **Suggested Fix:** Display clear pending state message instead of em dash

### H4: Service names truncated without tooltips
- **Location:** HUD → Service list
- **Issue:** Service names like "[auto] windlass..sta..." are cut off without full text visible
- **Impact:** Users can't identify services
- **Expected:** Full name visible OR truncation with hover tooltip showing complete name
- **Reproduction:** View HUD with auto-detected services
- **Fix Priority:** HIGH
- **Suggested Fix:** Add title attribute tooltip OR increase character limit OR use better truncation logic

### H5: Incident time format incomplete
- **Location:** Incidents list page
- **Issue:** Shows "46 ago" instead of "46 minutes ago" or "46m ago"
- **Impact:** Ambiguous - could be seconds, minutes, hours
- **Expected:** Complete time unit or standard abbreviation
- **Reproduction:** View incidents list
- **Fix Priority:** HIGH
- **Suggested Fix:** Use full format "46 minutes ago" or standard abbreviation "46m ago"

### H6: Unclear "Manage keys" link destination
- **Location:** Incident detail → AUTO-FIX section
- **Issue:** "Manage keys" link present but destination unclear
- **Impact:** Users don't know where it leads
- **Expected:** Should link to Settings → API Keys section
- **Reproduction:** View incident detail page
- **Fix Priority:** HIGH
- **Suggested Fix:** Verify link destination and ensure it goes to correct settings page

### H7: Observatory "God mode" warning too casual for enterprise
- **Location:** Observatory → Autonomic Control
- **Issue:** Red warning says "hallucinations" and "eat your wallet" - too informal
- **Impact:** Undermines professional/enterprise positioning
- **Expected:** Professional warning language
- **Reproduction:** View Observatory page
- **Fix Priority:** HIGH
- **Suggested Fix:** Reword to "Experimental mode - May generate unexpected results. Monitor costs carefully."

### H8: Monitor creation form has no validation
- **Location:** HUD → Manual (Add Monitor modal)
- **Issue:** Clicking "Create monitor" with empty required fields (NAME, TARGET) closes modal without error message or validation feedback
- **Impact:** Confusing UX - users don't know why monitor wasn't created
- **Expected:** Inline validation errors OR browser-native required field validation OR error toast message
- **Reproduction:** Click HUD → Manual → Create monitor (without filling fields)
- **Fix Priority:** HIGH
- **Suggested Fix:** Add HTML5 `required` attributes to NAME and TARGET fields, or show inline validation errors

---

## 🟡 MEDIUM (Should Fix)

### M1: Add-ons banner appears too prominent in authenticated app
- **Location:** Dashboard top banner
- **Issue:** "Tools that work with your stack — explore add-ons" banner with dismiss button
- **Impact:** Feels like marketing/upsell in an enterprise product; distracts from core functionality
- **Expected:** Either make this contextual (show only if add-ons are actually relevant) or remove from authenticated areas
- **Reproduction:** Log in → dashboard shows persistent banner
- **Fix Priority:** MEDIUM
- **Suggested Fix:** Remove from dashboard OR make it appear only once as a tooltip/modal on first login OR only show if specific add-ons would actually benefit the detected stack

### M2: Windlass "not configured" status unclear
- **Location:** HUD → Windlass status card
- **Issue:** Says "not configured" but unclear if auto-init ran
- **Impact:** User doesn't know if action needed
- **Expected:** Clear next steps or confirmation of auto-config
- **Reproduction:** View HUD after installation
- **Fix Priority:** MEDIUM
- **Suggested Fix:** Investigate actual Windlass state and update messaging

### M3: Incident cards show limited metadata
- **Location:** Incidents list page
- **Issue:** Cards lack timestamp, assigned user, clear stack identification
- **Impact:** Harder to scan and triage incidents
- **Expected:** More structured metadata display
- **Reproduction:** View incidents list
- **Fix Priority:** MEDIUM
- **Suggested Fix:** Add structured metadata section to cards

### M4: PAST FIXES section not actionable enough
- **Location:** Incident detail page
- **Issue:** Just says "No matching past fixes found. Try AI Diagnosis below."
- **Impact:** Missed opportunity to guide user
- **Expected:** Suggest keywords, show similar incidents, or provide search
- **Reproduction:** View incident with no past fixes
- **Fix Priority:** MEDIUM
- **Suggested Fix:** Add intelligent suggestions or search capability

### M5: Auto-pilot toggle missing state label
- **Location:** Observatory → Autonomic Control
- **Issue:** Toggle switch without clear "Enabled/Disabled" label
- **Impact:** Users can't quickly see current state
- **Expected:** Clear state indicator
- **Reproduction:** View Observatory
- **Fix Priority:** MEDIUM
- **Suggested Fix:** Add "Enabled" or "Disabled" text next to toggle

### M6: No manual "Run Scan Now" button for Discovery
- **Location:** Settings → Integrations → Scanner Schedule
- **Issue:** Only scheduled scans are configurable; no way to trigger an immediate scan from the UI
- **Impact:** Users must wait for scheduled time or run Docker command manually
- **Expected:** "Run Scan Now" button to trigger immediate discovery scan
- **Reproduction:** Navigate to Settings → Integrations, look for manual trigger
- **Fix Priority:** MEDIUM
- **Suggested Fix:** Add "Run Scan Now" button next to "Save schedule" that triggers immediate scan execution

---

## 🔵 LOW (Nice to Have)

### L1: Tag display inconsistent on incident cards
- **Location:** Incidents list page
- **Issue:** First incident shows tags, second doesn't (might be missing tags)
- **Impact:** Minor visual inconsistency
- **Expected:** Consistent tag display, even if empty
- **Reproduction:** View incidents list
- **Fix Priority:** LOW
- **Suggested Fix:** Ensure all incidents display tag area consistently

### L2: Recent Alerts empty state could be more positive
- **Location:** Observatory → Recent Alerts
- **Issue:** Just says "No alerts in the last 24 hours"
- **Impact:** Neutral when it could be encouraging
- **Expected:** Positive reinforcement for healthy system
- **Reproduction:** View Observatory with no alerts
- **Fix Priority:** LOW
- **Suggested Fix:** Change to "No alerts in last 24h - System healthy ✓" with green indicator

---

## 💡 ENHANCEMENTS (Future Considerations)

*None yet*

---

## ✅ TESTED & WORKING

### Installation & Setup
- ✅ Clean install via install.sh
- ✅ License activation with live API validation
- ✅ Admin user creation
- ✅ Environment name setup
- ✅ Database migrations (all 7 migrations executed successfully)
- ✅ Container health checks (eventually healthy, but see timing issue in Lessons/)
- ✅ Setup wizard form validation
- ✅ Setup wizard UX/layout

### Authentication
- ✅ Login with valid credentials → successful
- ✅ Login with invalid credentials → clear error message
- ✅ Logout with confirmation dialog
- ✅ Logout redirect to homepage
- ✅ Error message display (red banner, clear text)
- ✅ Email field retention on error
- ✅ Password field clearing on error (security)

### Dashboard (Initial View)
- ✅ Page loads successfully
- ✅ Professional layout and styling
- ✅ Getting Started checklist visible
- ✅ Stats cards display (0 services up, 0 incidents, 0% uptime, 0 errors)
- ✅ Service Health section with detected service
- ✅ Recent Incidents section (empty state)
- ✅ Quick Actions buttons
- ✅ Activity section (empty state)
- ✅ Infrastructure summary (1 stack, 1 monitor, 0 incidents, 0 docs)

---

## 🧪 PENDING TESTS

### Dashboard/HUD (Detailed)
- ⏳ All widgets functionality
- ⏳ Gauge accuracy
- ⏳ Click-through navigation
- ⏳ Real-time updates
- ⏳ Responsive layout

### Monitors (CRUD Operations)
- ⏳ Create HTTP monitor (form, validation)
- ⏳ Create TCP monitor
- ⏳ Create Ping monitor (UI support?)
- ⏳ Create Output-freshness monitor (UI support?)
- ⏳ Edit monitor
- ⏳ Delete monitor
- ⏳ Monitor list/detail views
- ⏳ Pause/resume
- ⏳ History graphs
- ⏳ Success toasts

### Discovery & Scanning
- ✅ Scanner configuration (Settings → Integrations)
- ✅ Schedule settings (frequency, time, modules)
- ✅ Subnet configuration
- ⏳ Manual scan trigger (NO UI BUTTON FOUND - external Docker tool)
- ⏳ Progress display
- ⏳ Results accuracy
- ⏳ Auto-monitor creation from scan results

### Incidents
- ⏳ Create incident
- ⏳ Edit/close incident
- ⏳ Auto-incidents on monitor down
- ⏳ Timeline/history
- ⏳ Search/filter

### AI Diagnosis
- ⏳ Trigger diagnosis
- ⏳ Tool augmentation
- ⏳ Transactional proof display
- ⏳ Root cause ranking
- ⏳ Resolution suggestions

### Observatory
- ⏳ Autonomic control panel
- ⏳ Mode selection
- ⏳ Agent status
- ⏳ Logs/traces/metrics
- ⏳ Ollama integration

### Windlass
- ⏳ Config setup
- ⏳ Service discovery
- ⏳ Schedule windows
- ⏳ Weekly digest

### Stacks
- ⏳ Create/edit/delete
- ⏳ Assignments
- ⏳ Health aggregation

### Knowledge Base
- ⏳ Runbooks CRUD
- ⏳ Search
- ⏳ Linking to incidents

### Settings
- ✅ Profile display (email, name, edition)
- ✅ License management (key entry, validation display)
- ✅ Team member invite form
- ✅ Workspace branding (name, accent color, logo URL)
- ✅ Notification configuration (email/webhook)
- ✅ Add-ons toggle
- ✅ Public status page settings
- ✅ Feedback form
- ✅ AI Providers section (Anthropic, OpenAI, Gemini - all show "No key")
- ✅ Scanner schedule configuration
- ✅ Windlass integration settings
- ✅ Data sources section
- ✅ API token generation for scanner
- ✅ Backups section (create backup button)
- ✅ Danger zone (export data, delete account)

### Public Status Page
- ⏳ Public access (no auth) - 404 on `/status`, needs slug or enablement
- ⏳ Service list
- ⏳ Uptime display
- ⚠️ **Finding:** Default `/status` path returns 404; Settings shows `/STATUS/` prefix suggesting custom slug required or explicit enablement needed

### UI/UX Polish
- ⏳ Success toasts
- ⏳ Loading states
- ⏳ Responsive design
- ⏳ Accessibility

### Performance
- ⏳ Page load times
- ⏳ API response times
- ⏳ Memory usage

### Security
- ⏳ CSRF protection
- ⏳ XSS prevention
- ⏳ Rate limiting
- ⏳ Secure headers

---

## 📝 NOTES

- Testing performed on ThinkPad (192.168.0.244) with clean deployment
- All tests automated via Chrome DevTools MCP
- License validated against live API successfully
- Database migrations completed without errors (after volume cleanup)

---

## 🎯 NEXT STEPS

1. Continue systematic testing of all modules
2. Document every button, form, and workflow
3. Test edge cases and error scenarios
4. Identify UX improvements for enterprise-grade polish
5. Create UI mockups for identified improvements
6. Fix all critical and high-priority issues
7. Repeat QA cycle until zero issues
8. Checkpoint after each major win
