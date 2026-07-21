# StdOut UI/UX Improvements — Component Guide

This document describes the new P1 UI/UX components and how to use them across StdOut.

## Components Added

### 1. StateWrapper (Loading/Empty/Error States)

**File:** `StateWrapper.astro`

Provides consistent rendering of page states (loading, error, empty data).

**Usage:**
```astro
---
import StateWrapper from '../components/StateWrapper.astro';

const data = await fetchData();
const loading = !data;
const empty = data && data.length === 0;
---

<StateWrapper loading={loading} empty={empty} emptyMessage="No incidents yet">
  <ul>
    {data.map(item => <li>{item.title}</li>)}
  </ul>
</StateWrapper>
```

**Props:**
- `loading`: boolean — Show loading spinner
- `error`: string | null — Show error message
- `empty`: boolean — Show empty state
- `emptyMessage`: string — Empty state text
- `emptyCta`: string — CTA button text
- `minHeight`: string — Container min-height (default: '400px')
- `customLoader`: boolean — Use custom loader slot

### 2. Button Component

**File:** `Button.astro`

Unified button with consistent styling across all variants.

**Usage:**
```astro
import Button from '../components/Button.astro';

<Button variant="primary">Click me</Button>
<Button variant="secondary" size="sm">Small button</Button>
<Button href="/incidents" variant="ghost">Link button</Button>
<Button loading>Saving...</Button>
```

**Props:**
- `variant`: 'primary' | 'secondary' | 'ghost' | 'danger' | 'glass'
- `size`: 'sm' | 'md' | 'lg'
- `href`: string — Render as link
- `loading`: boolean — Show spinner
- `disabled`: boolean

### 3. FormInput Component

**File:** `FormInput.astro`

Text input with real-time validation, error messaging, and accessibility labels.

**Usage:**
```astro
import FormInput from '../components/FormInput.astro';

<FormInput
  name="email"
  label="Email Address"
  type="email"
  required
  hint="We'll never share your email"
  error={emailError}
/>

<FormInput
  name="monitor_name"
  label="Monitor Name"
  placeholder="e.g., Production API Health"
  icon="🔍"
/>
```

**Props:**
- `label`: string (required)
- `name`: string (required)
- `type`: string (default: 'text')
- `hint`: string — Helper text
- `error`: string — Error message
- `required`: boolean
- `icon`: string — Right-aligned icon

### 4. ObservatoryOnboarding

**File:** `ObservatoryOnboarding.astro`

3-step guided wizard for Observatory first-time users.

**Usage:**
```astro
import ObservatoryOnboarding from '../components/ObservatoryOnboarding.astro';

<ObservatoryOnboarding visible={user.isNewObservatoryUser} />
```

**Props:**
- `visible`: boolean — Show wizard
- `dismissed`: boolean — Check localStorage first

**Behavior:**
- Shows 3-step wizard (Connect Monitors → Define Stacks → Baseline Collection)
- "Don't show again" saves to localStorage
- Wizard links to relevant setup pages
- Keyboard navigable

### 5. HelpTooltip

**File:** `HelpTooltip.astro`

Contextual help icon with tooltip for form fields.

**Usage:**
```astro
import HelpTooltip from '../components/HelpTooltip.astro';

<label>
  <span>Baseline Period</span>
  <HelpTooltip text="Collects data over 7 days to establish normal baseline behavior" />
</label>
```

**Props:**
- `text`: string — Tooltip content
- `position`: 'top' | 'bottom' | 'left' | 'right'
- `icon`: string (default: '?')

## Global CSS Improvements

Updated `src/styles/global.css` with:

1. **Accessibility Enhancements**
   - ARIA label support for interactive elements
   - `aria-invalid` styling for form errors
   - `role="alert"` animation
   - Better focus-visible states

2. **Mobile Responsiveness**
   - Responsive grid layouts (4-col → 2-col → 1-col)
   - 44px touch targets for buttons
   - 16px font on text inputs (prevent iOS zoom)
   - Horizontal scroll for tables

3. **Form Styling**
   - Unified input appearance
   - Focus and hover states
   - Toggle switches with ARIA
   - Loading spinners

## Migration Guide — Convert Existing Pages

### Before (Old Pattern)
```astro
---
const incidents = await db.select().from(schema.incidents).all();
---

{incidents.length === 0 ? (
  <div class="empty-state">No incidents yet</div>
) : (
  <ul>
    {incidents.map(i => <li>{i.title}</li>)}
  </ul>
)}
```

### After (New Pattern)
```astro
---
import StateWrapper from '../components/StateWrapper.astro';
const incidents = await db.select().from(schema.incidents).all();
---

<StateWrapper empty={incidents.length === 0} emptyMessage="No incidents yet">
  <ul>
    {incidents.map(i => <li>{i.title}</li>)}
  </ul>
</StateWrapper>
```

### Update Forms
**Before:**
```astro
<label>
  <span>Incident Title</span>
  <input type="text" name="title" required />
</label>
```

**After:**
```astro
import FormInput from '../components/FormInput.astro';

<FormInput
  label="Incident Title"
  name="title"
  required
  hint="A brief summary of what happened"
  error={errors.title}
/>
```

### Update Buttons
**Before:**
```astro
<button class="btn btn-primary">Save</button>
<button class="btn btn-secondary">Cancel</button>
```

**After:**
```astro
import Button from '../components/Button.astro';

<Button variant="primary">Save</Button>
<Button variant="secondary">Cancel</Button>
```

## Accessibility Checklist

For P1 completion, verify:

- [ ] All pages with data show loading/empty/error states via StateWrapper
- [ ] All buttons use Button component with proper variants
- [ ] All form inputs use FormInput component
- [ ] All icon-only buttons have `aria-label`
- [ ] All toggles have `aria-label` and `aria-checked`
- [ ] All form selects have accessible labels
- [ ] SVG charts have `aria-label` describing content
- [ ] Form errors use `aria-invalid="true"` and `aria-describedby`
- [ ] All interactive elements have ≥2:1 contrast on focus
- [ ] Lighthouse Accessibility score >95

## Mobile Responsiveness Checklist

- [ ] Grid layouts stack to 1 column on <768px
- [ ] All buttons and links are ≥44px touch targets
- [ ] Text inputs are 16px+ font (iOS zoom prevention)
- [ ] Tables have horizontal scroll wrapper
- [ ] Forms stack vertically on mobile
- [ ] Navigation collapses to hamburger on mobile
- [ ] All pages tested on 375px viewport

## Pages to Update (Priority Order)

1. **Observatory** (`/app/observatory.astro`)
   - Add onboarding wizard
   - Add StateWrapper for data loading
   - Add aria-labels to mode buttons, toggles
   - Add responsive grid layout

2. **Incidents** (`/app/incidents/index.astro`)
   - Add StateWrapper for empty state
   - Update incident form with FormInput
   - Add icons with aria-labels
   - Mobile table scroll

3. **Monitors/Infrastructure** (`/app/infrastructure.astro`)
   - StateWrapper for loading/empty
   - FormInput for add monitor form
   - Button component refactor
   - Mobile responsive grid

4. **Stacks** (`/app/stacks.astro`)
   - StateWrapper
   - FormInput for stack creation
   - Button refactor
   - Aria-labels on toggles

5. **Windlass** (`/app/tools/windlass/index.astro`)
   - Add help tooltips for schedule fields
   - Button component
   - StateWrapper
   - Mobile layout fixes

## Testing Commands

```bash
# Run Lighthouse audit
npm run build && npx lighthouse http://localhost:3000/app/observatory --view

# Check accessibility via axe
# (Install axe DevTools browser extension)

# Mobile viewport testing
# Chrome DevTools → Toggle device toolbar (375px × 667px)

# Screen reader testing
# macOS: VoiceOver (Cmd + F5)
# Windows: NVDA (free), JAWS (paid)
```

## Performance Notes

- All components use Astro static rendering (zero JS overhead)
- StateWrapper CSS-only loading animation
- Button component uses native HTML (no framework bloat)
- Help tooltips use CSS pseudo-elements (no JS)
- Observatory wizard uses minimal inline script for state

## Questions?

Refer to:
- Design tokens: `src/styles/global.css` (lines 31-97)
- WCAG 2.1 AA: https://www.w3.org/WAI/WCAG21/quickref/
- Astro components: https://docs.astro.build/en/basics/astro-components/
