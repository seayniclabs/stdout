# UX Polish Recommendations — StdOut Dashboard

This document outlines the UX audit and specific, actionable recommendations for the dashboard of **StdOut**, a self-hosted infrastructure monitoring application. The goal is to elevate the interface to a premium, professional, and intuitive operational tool.

A visual mockup of the proposed design has been generated for review:
![StdOut Proposed Dashboard Mockup](file:///Users/charlieseay/.gemini/antigravity-cli/brain/be2bbb49-e738-41df-a51e-11c765cca3b3/stdout_dashboard_mockup_1783627218472.jpg)

---

## Summary of Findings

| UX Category | Current Status | Issues Identified | Proposed Solution |
| :--- | :--- | :--- | :--- |
| **1. Layout & Hierarchy** | Multiple banner notices + full-width onboarding checklist stack vertically at top. | Intense "banner fatigue". The actual monitoring data is pushed below the fold. | Group banners into a unified notification tray; move onboarding to a collapsible element or dedicated sidebar. |
| **2. Visual Grouping** | Bright orange accents used for checklist; cyan for add-ons banner. | Visual hierarchy conflicts with operational severity colors (red/yellow alerts). | Reserve bright colored accents for active alerts. Use muted slate/glassmorphism borders for secondary elements. |
| **3. Interactive Elements** | Physical displacement (`translateY(-3px)`) on hover for almost all elements. | Passive mouse movement causes the page to look unstable or "bouncy". | Keep layout stable. Limit translateY to primary buttons. Use border glow or background shade changes for cards. |
| **4. Empty States** | Dashed grey boxes stating "No incidents/activity yet". | Dead-ends that miss an opportunity to reassure the user or prompt action. | Turn empty states into success states (e.g., "All systems nominal" green shield) or educational timeline previews. |
| **5. Clarity & Logic** | "30d Uptime" card shows `26.3%` (ratio of healthy services to total monitors). | **Severe Logical Error:** Confuses current service ratio with historical availability. | Rename to "Healthy Services" or calculate actual rolling historical uptime based on check history. |
| **5. Metric Selection** | "Docs" count is shown in the primary operational metrics row. | Dilutes operational focus with static metadata. | Replace "Docs" card with "Average Latency" or "Active Alerts". Move docs count to the sidebar. |
| **5. Search Redundancy** | Search bar in header + "Search Docs" + "Search" quick actions. | Redundant navigation options that clutter the UI. | Replace with a unified Search/Command Palette (`Cmd + K`) and consolidate buttons. |

---

## Detailed Actionable Recommendations

### 1. Layout & Hierarchy: Eliminate Banner Fatigue
Currently, a returning user who has completed 4/8 onboarding steps can see:
1. A **Pending Import banner** (dim orange/accent)
2. An **Update Available banner** (cyan)
3. An **Add-ons banner** (cyan)
4. A **Getting Started checklist** (large orange card)

This stacks up to **four banners** before the user even sees the first operational metric card.
* **Action:** Wrap multiple banners into a single, cohesive, dismissible notification tray (e.g., `"2 system alerts — Expand"`).
* **Action:** Move the "Getting Started" checklist. Since the user is already actively monitoring services, the checklist should be collapsible into a small widget in the sidebar, rather than occupying the primary layout column.

> [!TIP]
> **Onboarding Collapsing Rule:** When `totalMonitors > 0` or `completedCount >= 4`, the onboarding checklist should default to a collapsed sidebar module or a floating checklist button, giving 100% of the screen center to active monitoring.

---

### 2. Visual Grouping: Safeguard Alert Color Meanings
In monitoring applications, color is information. If a user sees a bright orange border on a checklist card and a bright cyan banner, they process those as active system statuses.
* **Action:** Modify the checklist and add-ons card borders to use a low-key border tint (e.g., `rgba(255, 255, 255, 0.06)`) or a subtle glassmorphic backdrop.
* **Action:** Strictly reserve the primary orange (`--accent`), yellow (`--high`), and red (`--critical`) states for actual service health anomalies and active incident alerts.

---

### 3. Interactive Elements: Enhance Stability on Hover
Having multiple cards translate on hover makes a dense dashboard feel hyperactive.
* **Action:** Remove the `transform: translateY(-3px)` from the `Service Health` cards (`.svc-card:hover`) and `Quick Actions` buttons.
* **Action:** Instead, apply a static visual feedback loop:
  * Transition the border color to a slightly brighter slate/accent glow.
  * Increase the opacity of the internal text/metric.
  * Apply a subtle background brightness change (`background: var(--bg-hover)`).

```diff
  .svc-card {
    transition: all 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94);
  }
  .svc-card:hover {
-   transform: translateY(-2px);
-   box-shadow: var(--shadow-md);
+   border-color: var(--border-hover);
+   background: var(--bg-hover);
  }
```

---

### 4. Empty States: Celebrate Healthy States
In an infrastructure app, "No incidents logged yet" is a massive win, not an empty data state.
* **Action:** Replace the dashed grey box in **Recent Incidents** with a green success state showing a shield or checkmark:
  > **✓ Systems Operational**
  > All monitored services are responding normally. No incidents active.
* **Action:** Replace the dashed box in **Activity** with a timeline skeleton preview showing how alerts appear once triggered, or a neutral log of the last database backup/maintenance task.

---

## Confusing & Unclear Elements: Fix the Logic and Labels

### A. The Uptime Metric Fallacy
Calculating `totalUptime` as `sum(uptimePercent) / count(monitors)` where unconfigured/stopped monitors score `0%` produces a `26.3%` uptime figure on the dashboard. This makes the user's infrastructure look completely unstable.
* **Action:** **Rename or Recalculate.** If historical data is not fully populated, show a placeholder (e.g., `--%` or `Calculating...`). If the figure is current availability, label it `Healthy Services Ratio`. Historical 30d uptime should only average checks from *active, running monitors* over time.

### B. Replace "Docs" in Primary Metrics Row
Docs count is metadata. A user does not open an operational dashboard to see how many markdown guides they have written.
* **Action:** Replace the Docs card with a dynamic system metric:
  * **Option A:** `Average Latency` (e.g. `68ms`) — highly relevant for service check-ins.
  * **Option B:** `Scanner Status` (e.g. `Active — Last scan 5m ago`).
  * **Option C:** `Active Alerts` (e.g. `0 Rules Triggered`).
* **Action:** Move the Docs count permanently to the **Infrastructure** sidebar stat grid.

### C. Consolidate Search
The screen currently has:
1. Search input in navbar
2. "Search Docs" button in sidebar
3. "Search" button in sidebar
* **Action:** Standardize on a single, global command palette shortcut (e.g. `Cmd + K` search) available in the header. Remove the duplicate quick action buttons in the sidebar to make room for more relevant shortcuts like `Add Monitor` or `Mute Alerts`.

---

## Implementation Manual Steps

To implement these recommendations, modify the following files:

1. **Dashboard Structure (`/src/pages/app/index.astro`):**
   * Change `totalUptime` fallback check and change the label of the third overview card to "Average Availability" or "System Health Index".
   * Remove the fourth card ("Docs") from the `overview-cards` grid and replace it with a latency average or scanner heartbeat.
   * Move the onboarding widget (`#onboarding-widget`) into a collapsible panel or the sidebar column if `isNewUser` is false.
   * Consolidate the `addons-banner` and `update-banner` into a single notifications layout.

2. **Global Styling (`/src/styles/global.css`):**
   * Remove translation values on hover for `.svc-card` and `.action-btn` to stabilize the UI.
   * Update the empty state `.mini-empty` selector styles to allow for colored success states.
