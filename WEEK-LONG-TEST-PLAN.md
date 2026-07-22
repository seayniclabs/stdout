# StdOut Week-Long Testing Plan
**Version:** 1.3.0  
**Start Date:** 2026-07-22  
**End Date:** 2026-07-29  
**Environment:** Production (ThinkPad 192.168.68.89:8112)

---

## Test Objectives

1. **Functional Verification** — All features work as designed
2. **Performance Validation** — Lighthouse scores maintain >90
3. **Stability Testing** — No crashes, memory leaks, or degradation over 7 days
4. **User Experience** — MSP-grade UI delivers professional experience
5. **Data Integrity** — Database remains consistent, no data loss

---

## Day 1 (Tuesday) — Core Functionality

### Morning: Authentication & User Management
- [ ] **Login flow** — Test with valid credentials
  - Expected: Redirect to dashboard, session cookie set
- [ ] **Logout flow** — Sign out and verify session cleared
- [ ] **Invalid credentials** — Test error handling
- [ ] **Session persistence** — Close browser, reopen, verify still logged in
- [ ] **License status** — Verify license displays correctly in settings

### Afternoon: Dashboard & Monitoring
- [ ] **Dashboard loads** — Verify all metrics display
  - Monitors count
  - Incidents count
  - Stacks count
  - Recent activity
- [ ] **HUD page** — Test monitor creation
  - Create HTTP monitor
  - Create TCP monitor
  - Create Ping monitor
  - Verify auto-start functionality
- [ ] **Monitor status updates** — Wait 5 minutes, verify monitors execute
  - Check for status changes (up/down)
  - Verify response times recorded

### Evening: Network Discovery
- [ ] **Run network scan** — Trigger discovery scan
  - Expected: Find local network hosts
  - Verify discovered_hosts table populated
- [ ] **Stack auto-creation** — Verify default stack created
- [ ] **Host linking** — Check discovered hosts linked to stack

**End of Day:** Document any issues found

---

## Day 2 (Wednesday) — Incidents & AI Diagnosis

### Morning: Incident Management
- [ ] **Create manual incident** — Add test incident via UI
  - Title, description, severity, status
  - Verify appears in incident list
- [ ] **AI Diagnosis** — Trigger AI analysis on incident
  - Expected: Ollama generates root cause analysis
  - Verify diagnosis stored in database
  - Check cost tracking (should be $0 for Ollama)
- [ ] **Incident detail page** — View full incident
  - All fields display correctly
  - Timeline shows events
  - AI diagnosis visible

### Afternoon: Auto-Remediation (NEW FEATURE)
- [ ] **Remediation dashboard** — Navigate to /app/remediations
  - Verify playbook library loads
  - Check built-in playbooks (K8s, Docker, cache, scaling, restart)
- [ ] **Create custom playbook** — Build simple test playbook
  - Name: "Test Playbook"
  - Trigger: Manual
  - Steps: Echo "Hello World"
  - Rollback: Echo "Rollback"
- [ ] **Dry-run execution** — Run playbook in dry-run mode
  - Verify no actual changes made
  - Check execution logged
- [ ] **Real execution** — Run playbook for real (safe test)
  - Verify steps execute in order
  - Check logs captured
  - Verify completion status

### Evening: Cost Tracking (NEW FEATURE)
- [ ] **Cost dashboard** — Navigate to /app/costs
  - Verify monthly summary displays
  - Check cost breakdown by provider
  - Verify Ollama shows $0 cost
- [ ] **Per-incident costs** — Check cost attribution
  - Find incidents with AI diagnosis
  - Verify cost_audit records exist
  - Validate cost calculations accurate

**End of Day:** Screenshot key pages showing new features working

---

## Day 3 (Thursday) — Observatory & Satellites

### Morning: Observatory
- [ ] **Observatory dashboard** — Navigate to /app/observatory
  - Verify Watcher agent status
  - Check Analyst model loaded
  - Verify neural network background animation visible
- [ ] **Agent logs** — View live Observatory logs
  - Check Watcher detecting anomalies
  - Verify trace spans display correctly
- [ ] **Manual trigger** — Force Observatory check
  - Click "Check Now" button
  - Verify agent runs
  - Check results logged

### Afternoon: Satellites
- [ ] **Satellites page** — Navigate to /app/satellites
  - Verify page loads with MSP-grade UI
  - Check install command modal
- [ ] **Install satellite** (if test host available)
  - Run install script on remote Linux host
  - Verify satellite registers with StdOut
  - Check metrics reporting (CPU, memory, disk)
- [ ] **Satellite status** — Monitor satellite health
  - Verify heartbeat every 5 minutes
  - Check stale detection (15 min timeout)

### Evening: Infrastructure
- [ ] **Stacks page** — Navigate to /app/infrastructure
  - Verify stack list displays
  - Check discovered hosts visible
  - Verify resource metrics shown
- [ ] **Stack detail** — Click into stack
  - Verify all linked hosts display
  - Check last seen timestamps accurate

**End of Day:** Verify all pages have consistent MSP-grade UI

---

## Day 4 (Friday) — Performance & Optimization

### Morning: Lighthouse Audits
- [ ] **Setup page** — Run Lighthouse audit
  - Target: Performance >90, Accessibility >95
  - Record actual scores
  - Document any regressions
- [ ] **Dashboard** — Run Lighthouse audit
  - Check LCP, FCP, CLS metrics
  - Verify no layout shifts
- [ ] **Observatory** — Run Lighthouse audit
  - Check performance with neural background
  - Verify animations smooth (60fps)

### Afternoon: Load Testing
- [ ] **Create 25 monitors** — Add many monitors
  - Mix of HTTP, TCP, Ping types
  - Verify all auto-start
  - Check database query performance
- [ ] **Database size** — Check database file size
  - Run: `ls -lh ~/stdout/data/stdout.db`
  - Expected: <100MB with moderate usage
- [ ] **Query performance** — Time critical queries
  - Incidents list: <50ms
  - Dashboard load: <200ms
  - Monitor list: <50ms

### Evening: Memory & Resource Usage
- [ ] **Container stats** — Check Docker resource usage
  - Run: `docker stats stdout --no-stream`
  - Expected: <500MB RAM, <10% CPU idle
- [ ] **Database integrity** — Verify no corruption
  - Run: `sqlite3 ~/stdout/data/stdout.db "PRAGMA integrity_check"`
  - Expected: "ok"

**End of Day:** Document performance metrics

---

## Day 5 (Saturday) — Stability & Edge Cases

### Morning: Edge Case Testing
- [ ] **Empty states** — Test with no data
  - Fresh install behavior
  - No monitors: verify empty state UI
  - No incidents: verify placeholder
  - No satellites: verify CTA displayed
- [ ] **Maximum limits** — Test boundaries
  - Very long incident description (10,000 chars)
  - Monitor with 1-second interval
  - Stack with 100+ hosts
- [ ] **Invalid inputs** — Test error handling
  - Malformed URLs in monitors
  - Invalid JSON in playbooks
  - SQL injection attempts (should be blocked)

### Afternoon: Concurrent Operations
- [ ] **Multiple monitors running** — All 25+ execute simultaneously
  - Verify no race conditions
  - Check database locks handled correctly
  - Verify all results recorded
- [ ] **Parallel playbook execution** — Run multiple playbooks
  - Test dry-run and real execution together
  - Verify executions isolated
  - Check logs don't intermix

### Evening: Data Export & Backup
- [ ] **Export incidents** — Test export functionality
  - Markdown format
  - JSON format
  - Verify data completeness
- [ ] **Database backup** — Create backup
  - Run: `cp ~/stdout/data/stdout.db ~/stdout/data/backup-$(date +%Y%m%d).db`
  - Verify integrity of backup

**End of Day:** List any edge cases that need fixing

---

## Day 6 (Sunday) — User Experience & UI

### Morning: Visual Consistency
- [ ] **Glass morphism** — Check all pages have consistent effects
  - Dashboard, Incidents, Observatory, Remediations, Costs
  - Verify backdrop-filter blur working
  - Check border colors and shadows
- [ ] **Hover states** — Test interactive elements
  - Cards lift on hover
  - Buttons change state smoothly
  - Links have visual feedback
- [ ] **Color palette** — Verify consistent colors
  - Text: #F8FAFC
  - Secondary: #94A3B8
  - Success: #22C55E
  - Critical: #EF4444

### Afternoon: Mobile Responsiveness
- [ ] **Dashboard on mobile** — Test on phone/narrow window
  - Cards stack vertically
  - Navigation accessible
  - Touch targets adequate (44px min)
- [ ] **Forms on mobile** — Test input fields
  - Monitor creation form
  - Incident creation form
  - Playbook builder
- [ ] **Tables on mobile** — Check horizontal scroll
  - Incidents table
  - Cost breakdown table
  - Execution history table

### Evening: Accessibility
- [ ] **Keyboard navigation** — Navigate with Tab key
  - All interactive elements reachable
  - Focus states visible
  - Modal dialogs escapable with Esc
- [ ] **Screen reader** — Test with VoiceOver (macOS)
  - Form labels announced
  - Error messages clear
  - Status indicators readable
- [ ] **Color contrast** — Verify WCAG AA compliance
  - Text readable on all backgrounds
  - Status badges have sufficient contrast

**End of Day:** Screenshot mobile and desktop views

---

## Day 7 (Monday) — Long-Running Stability

### Morning: 7-Day Health Check
- [ ] **Uptime verification** — Check container never restarted
  - Run: `docker ps --filter name=stdout --format '{{.Status}}'`
  - Expected: "Up 7 days"
- [ ] **Log analysis** — Review full week of logs
  - Check for memory leaks (growing memory usage)
  - Look for repeating errors
  - Verify no crashes or panics
- [ ] **Database growth** — Compare size to Day 1
  - Expected: Linear growth with activity
  - No exponential bloat

### Afternoon: Monitoring Data Review
- [ ] **24-hour health log** — Analyze monitoring script results
  - Location: `~/stdout-monitoring/health-*.log`
  - Count: HEALTHY vs DEGRADED
  - Response time trends (should be stable)
- [ ] **Monitor execution history** — Check all monitors ran
  - Verify 288 checks per monitor (every 5 min for 24h)
  - Check for missed executions
  - Verify no stuck monitors
- [ ] **Cost accumulation** — Review AI costs over 7 days
  - Total spend (should be $0 if using Ollama)
  - Cost per incident (verify calculations)
  - Provider breakdown (verify Ollama predominant)

### Evening: Final Regression Tests
- [ ] **Re-run Day 1 tests** — Verify core functionality still works
  - Login/logout
  - Monitor creation
  - Incident management
- [ ] **Re-run Lighthouse** — Compare to Day 4 scores
  - Performance should be stable (±5 points)
  - Accessibility should maintain >95
- [ ] **Export final test report** — Document all findings
  - Issues found and fixed
  - Performance trends
  - Stability metrics
  - Recommendations for next release

**End of Day:** Create comprehensive test summary

---

## Success Criteria

**Must Pass:**
- [ ] Zero crashes or container restarts over 7 days
- [ ] All core features functional (auth, monitoring, incidents, remediations, costs)
- [ ] Lighthouse Performance >90 on all key pages
- [ ] Lighthouse Accessibility >95 on all pages
- [ ] Database integrity check passes
- [ ] No SQL errors in logs
- [ ] Account and license preserved throughout testing

**Should Pass:**
- [ ] All 25+ monitors execute reliably every interval
- [ ] AI diagnosis works for all incidents
- [ ] Auto-remediation dry-run and real execution both work
- [ ] Cost tracking accurate for all providers
- [ ] Mobile responsive on all pages
- [ ] Keyboard navigation fully functional

**Nice to Have:**
- [ ] Zero WCAG violations
- [ ] <50ms average query time
- [ ] <2s page load time on all routes
- [ ] Satellite agent successfully deployed and reporting

---

## Issue Tracking

Use this format for any bugs found:

```markdown
### Issue #N: [Short Title]

**Date:** YYYY-MM-DD  
**Severity:** Critical | High | Medium | Low  
**Page/Feature:** [Where found]  

**Steps to Reproduce:**
1. ...
2. ...

**Expected Behavior:** ...

**Actual Behavior:** ...

**Screenshots:** [If applicable]

**Resolution:** [If fixed during testing week]
```

---

## Daily Checklist Template

Copy this for each day's testing:

```markdown
## Day N Testing — [Date]

**Tester:** [Name]  
**Start Time:** [HH:MM]  
**End Time:** [HH:MM]  

**Tests Completed:** X / Y  
**Issues Found:** N  
**Critical Blockers:** N  

**Notes:**
- ...

**Next Day Focus:**
- ...
```

---

## Test Environment Details

**Production Instance:**
- URL: http://192.168.68.89:8112
- Container: stdout (charlieseay/stdout:latest)
- Database: ~/stdout/data/stdout.db
- Account: charlie@seayniclabs.com
- License: SL-DEV-QAELhjVc0wAQHnLsC7U4x

**Monitoring:**
- 24-hour health checks: ~/stdout-monitoring/health-*.log
- Container logs: `docker logs stdout`
- Database integrity: `sqlite3 ~/stdout/data/stdout.db "PRAGMA integrity_check"`

**Test Tools:**
- Lighthouse CLI: `lighthouse http://192.168.68.89:8112 --view`
- Browser: Chrome DevTools
- Mobile: iPhone/Android or responsive mode

---

## Reporting

**Daily:** Update progress in this file (check boxes)  
**Issues:** Create entries in "Issue Tracking" section  
**Final:** Comprehensive summary on Day 7 evening

**Stakeholder:** Charlie (charlie@seayniclabs.com)  
**Escalation:** Slack #stdout-testing or create GitHub issue

---

**Ready to begin testing!** 🚀
