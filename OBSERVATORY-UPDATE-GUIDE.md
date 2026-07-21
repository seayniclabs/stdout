# Observatory Page — P1 UI/UX Updates

This guide shows the specific changes to apply to `/app/observatory.astro`.

## Changes Summary

1. Add ObservatoryOnboarding wizard
2. Add aria-labels to all icon buttons and toggles
3. Improve state indicators with better accessibility
4. Add help tooltips to complex controls
5. Ensure mobile responsiveness

## Code Changes

### 1. Add Import and Onboarding Wizard (Line 5, after NeuralBackground)

```astro
import ObservatoryOnboarding from '../../components/ObservatoryOnboarding.astro';
import HelpTooltip from '../../components/HelpTooltip.astro';
```

After the `<NeuralBackground />` component (line 20), add the onboarding wizard:

```astro
<NeuralBackground />

{/* Onboarding wizard for first-time users */}
<ObservatoryOnboarding visible={!user.hasSeenObservatoryWizard} />

<div class="observatory-page">
  {/* rest of page */}
</div>
```

### 2. Update Header Action Buttons (Lines 28-42)

**Before:**
```astro
<a href="/app/observatory/status" class="btn-glass" style="text-decoration:none;display:inline-flex;align-items:center;gap:6px">
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
  Status
</a>
<button id="runCheckBtn" class="btn-glass btn-primary">
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
  Run Check Now
</button>
```

**After:**
```astro
<a href="/app/observatory/status" class="btn-glass" style="text-decoration:none;display:inline-flex;align-items:center;gap:6px" aria-label="View Observatory status">
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
  Status
</a>
<button id="runCheckBtn" class="btn-glass btn-primary" aria-label="Run Observatory health check immediately">
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
  Run Check Now
</button>
<button id="pauseWatcherBtn" class="btn-glass" aria-label="Pause monitoring watcher agent">
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
  Pause Watcher
</button>
<button id="refreshBtn" class="btn-glass" aria-label="Refresh Observatory data">
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
  Refresh
</button>
```

### 3. Update Mode Ladder Buttons (Lines 67-79)

**Before:**
```astro
<button class="mode-btn" data-mode="discover">
  <span class="mode-name">Discover</span>
  <span class="mode-desc">Eyes only — scan &amp; log</span>
</button>
```

**After:**
```astro
<button class="mode-btn" data-mode="discover" aria-label="Discover mode: scan and log only, no automated fixes">
  <span class="mode-name">Discover</span>
  <span class="mode-desc">Eyes only — scan &amp; log</span>
</button>
<button class="mode-btn" data-mode="diagnose" aria-label="Diagnose mode: analyze incidents and explain root causes">
  <span class="mode-name">Diagnose</span>
  <span class="mode-desc">Brain explains incidents</span>
</button>
<button class="mode-btn" data-mode="autofix" aria-label="Auto-fix mode: apply non-destructive fixes automatically">
  <span class="mode-name">Auto-fix</span>
  <span class="mode-desc">Apply non-destructive fixes</span>
</button>
```

### 4. Update Toggle Switches (Lines 84-109)

**Before:**
```astro
<label class="auto-toggle">
  <input type="checkbox" id="autopilotToggle" />
  <span class="toggle-track"><span class="toggle-thumb"></span></span>
  <span class="toggle-text">
    <strong>Auto-pilot</strong>
    <small id="autopilotState">Self-escalates discover → diagnose → auto-fix as it earns trust. Ceiling: non-destructive.</small>
  </span>
</label>
```

**After:**
```astro
<label class="auto-toggle">
  <input 
    type="checkbox" 
    id="autopilotToggle" 
    role="switch"
    aria-label="Auto-pilot mode"
    aria-checked="false"
    aria-describedby="autopilotState"
  />
  <span class="toggle-track" aria-hidden="true"><span class="toggle-thumb"></span></span>
  <span class="toggle-text">
    <strong>Auto-pilot</strong>
    <small id="autopilotState">Self-escalates discover → diagnose → auto-fix as it earns trust. Ceiling: non-destructive.</small>
  </span>
</label>

<label class="auto-toggle">
  <input 
    type="checkbox" 
    id="godModeToggle" 
    role="switch"
    aria-label="God mode (experimental)"
    aria-checked="false"
    aria-describedby="godModeState"
  />
  <span class="toggle-track toggle-danger" aria-hidden="true"><span class="toggle-thumb"></span></span>
  <span class="toggle-text">
    <strong>
      God mode 
      <span class="danger-tag">experimental</span>
      <HelpTooltip text="Experimental mode may generate unexpected results. Monitor costs carefully. Requires human approval for all fixes." position="left" />
    </strong>
    <small id="godModeState">Experimental mode - May generate unexpected results. Monitor costs carefully. Human approval required.</small>
  </span>
</label>

<label class="auto-toggle">
  <input 
    type="checkbox" 
    id="ragPublicToggle" 
    role="switch"
    aria-label="Include public resources in learning"
    aria-checked="false"
    aria-describedby="ragPublicState"
  />
  <span class="toggle-track" aria-hidden="true"><span class="toggle-thumb"></span></span>
  <span class="toggle-text">
    <strong>Include public resources in learning</strong>
    <small id="ragPublicState">Internal + community docs are always used. Public web sources are off by default.</small>
  </span>
</label>
```

### 5. Update Metric Tabs (Lines 179-184)

**Before:**
```astro
<div class="metric-tabs" id="metricTabs">
  <button class="metric-tab active" data-metric="cpu">CPU</button>
  <button class="metric-tab" data-metric="memory">Memory</button>
  <button class="metric-tab" data-metric="network">Network</button>
  <button class="metric-tab" data-metric="requests">Requests</button>
</div>
```

**After:**
```astro
<div class="metric-tabs" id="metricTabs" role="tablist">
  <button class="metric-tab active" data-metric="cpu" role="tab" aria-selected="true" aria-controls="cpu-panel">CPU</button>
  <button class="metric-tab" data-metric="memory" role="tab" aria-selected="false" aria-controls="memory-panel">Memory</button>
  <button class="metric-tab" data-metric="network" role="tab" aria-selected="false" aria-controls="network-panel">Network</button>
  <button class="metric-tab" data-metric="requests" role="tab" aria-selected="false" aria-controls="requests-panel">Requests</button>
</div>
```

### 6. Update SVG Icons (Add aria-hidden)

For all SVG icons used as decorative elements, add `aria-hidden="true"`:

```astro
<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
  <!-- SVG path -->
</svg>
```

### 7. Add Mobile Responsive Grid (After </style> closing tag on line ~500)

The component needs grid layout updates. Add to the `<style>` section:

```css
/* Responsive grid for Observatory cards */
@media (max-width: 1024px) {
  .observatory-grid {
    grid-template-columns: 1fr;
  }

  .obs-card[style*="grid-column"] {
    grid-column: 1 !important;
  }
}

@media (max-width: 768px) {
  .observatory-header {
    flex-direction: column;
    gap: 1rem;
  }

  .header-actions {
    flex-direction: column;
    width: 100%;
  }

  .header-actions > * {
    width: 100%;
    justify-content: center;
  }

  .metrics-grid {
    grid-template-columns: repeat(2, 1fr);
  }

  .logs-stream,
  .alerts-list,
  .runs-list,
  .traces-list {
    max-height: 300px;
    overflow-y: auto;
  }
}
```

## Testing Checklist

After applying these changes, verify:

- [ ] ObservatoryOnboarding wizard appears on first visit
- [ ] All icon buttons have readable aria-labels
- [ ] Toggle switches announce state changes
- [ ] Metric tabs are keyboard navigable (Tab, Left/Right arrow)
- [ ] Help tooltips appear on hover for complex controls
- [ ] Lighthouse Accessibility score >90
- [ ] Page works on 375px viewport (mobile)
- [ ] All interactive elements have ≥2:1 contrast on focus
- [ ] Screen reader announces all card titles and status indicators

## Keyboard Navigation Expected

- Tab: Move between controls
- Enter/Space: Activate buttons and toggles
- Arrow Left/Right: Navigate metric tabs and mode ladder
- Escape: Close tooltips (if implemented)

## Files to Update

- `src/pages/app/observatory.astro` — Main Observatory page
- Already added components:
  - `src/components/ObservatoryOnboarding.astro`
  - `src/components/HelpTooltip.astro`
  - Updated `src/styles/global.css`

## Performance Impact

- ObservatoryOnboarding: ~2KB minified, zero runtime JS if dismissed
- HelpTooltip: CSS-only tooltips, zero JS overhead
- ARIA labels: Text nodes, negligible file size
- No third-party dependencies added

Total bundle impact: <5KB

## Next Steps After Observatory

Apply same pattern to:
1. `/app/incidents/index.astro` — Add StateWrapper for empty state
2. `/app/infrastructure.astro` — Add FormInput to monitor form
3. `/app/stacks.astro` — Add aria-labels to stack toggles
4. `/app/tools/windlass/index.astro` — Add help tooltips to schedule fields
