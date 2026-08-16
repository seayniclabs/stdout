# StdOut Setup Flow - UX Analysis & Recommendations

**Date:** 2026-08-15  
**Current Flow:** 3-step wizard  
**Goal:** Minimize user input, automate during progress animation

## Current Setup Flow

### Step 1: Create Account
**Fields:**
- Display Name (text, required)
- Email Address (text, required) 
- Password (password, required, min 8 chars)

**Purpose:** Authentication credentials

### Step 2: Branding & Environment  
**Fields:**
- Workspace Name (text, required) - e.g. "Home Lab", "Production"
- Logo (file upload, optional) - PNG/SVG/JPEG, max 2MB
- Accent Color (color picker, default orange #F97316)

**Purpose:** UI customization

### Step 3: License Activation
**Fields:**
- License Key (text, format SL-XXXX-...)
- Email Address (pre-filled from Step 1)
- Skip button (TEST_MODE only)

**Purpose:** License validation (or bypass in test mode)

### After Step 3: Automated Installation
**What happens during the progress animation:**
- Database initialization
- Scanner setup  
- Windlass installation (optional, currently skipped)
- Observatory setup (knowledge bases, agents, monitors)
- Data source discovery
- Monitor configuration (network scan + auto-create monitors)
- Health check

**Duration:** ~30-60 seconds  
**User visibility:** Real-time progress messages via SSE

---

## Analysis: What Can Be Automated or Eliminated?

### ✅ Keep (Essential User Input)
1. **Display Name** - personal identifier, needed for multi-user
2. **Email** - login credential, unique identifier
3. **Password** - security requirement
4. **License Key** - commercial requirement (or skip in TEST_MODE)

### ❌ Remove or Auto-Generate (Can happen during animation)

1. **Workspace Name** → Auto-generate from hostname or IP
   - Default: `StdOut-{hostname}` or `StdOut-{IP-last-octet}`
   - Can be changed later in Settings
   - Example: `StdOut-thinkpad` or `StdOut-89`

2. **Logo Upload** → Skip entirely at setup time
   - No logo needed for first boot
   - Add "Upload Logo" in Settings after installation
   - Default StdOut logo is fine

3. **Accent Color** → Use default, allow change in Settings
   - Default orange (#F97316) works for everyone
   - No need to choose during setup
   - Power users can customize later

4. **Email on License Page** → Already have it from Step 1
   - **REDUNDANT** - don't ask twice
   - Pre-fill and hide, or remove field entirely

### 🔄 Proposed New Flow

**Step 1: Create Account**
- Display Name
- Email  
- Password
- [Create Account & Install] button

**Step 2: Automated Installation (progress animation)**
- Database initialization
- **Auto-generate workspace name** from hostname
- **Set default orange accent color**
- Scanner setup
- Observatory initialization
- Network scan & monitor creation
- License validation (if provided) or skip (TEST_MODE)

**Result:** User enters 3 fields, clicks one button, watches ~30s animation, lands on dashboard.

---

## Redundancies & Issues Found

### 1. Email Asked Twice ❌
- Step 1: Email (for account)
- Step 3: Email (for license lookup)
- **Fix:** Remove from Step 3, use Step 1 email automatically

### 2. Environment Name Not Actually "Environment" ✏️
- Label says "Workspace Name"  
- Field name is `environmentName`
- Examples say "HOME LAB", "PRODUCTION"
- **Inconsistent terminology** - pick one: "Workspace" or "Environment"

### 3. Step 2 Entire Purpose is Cosmetic 🎨
- None of these fields affect functionality
- All can be changed later in Settings
- Slows down first boot experience
- **Recommendation:** Skip Step 2 entirely, do it during animation

### 4. Branding Customization Order is Backwards 🔄
- Setup asks for branding BEFORE user sees the product
- Users don't know what to customize yet
- Better: Let them use default, then customize once they know what they want

### 5. License Step Could Be Combined ⚡
- If TEST_MODE, skip entirely
- If production, validate during animation (background)
- Could be a single field on Step 1: "License Key (optional)"

---

## Recommended Changes

### Option A: Minimal (2 steps)
**Step 1: Account + License**
- Display Name
- Email
- Password  
- License Key (optional, "Add later" link)
- [Install StdOut] button

**Step 2: Automated Installation**
- All setup happens during progress animation
- Auto-generate workspace name from hostname
- Use default branding
- Navigate to dashboard when complete

**Result:** 3-4 fields → dashboard in < 1 minute

### Option B: Ultra-Minimal (1 step)
**Single Page: Get Started**
- Display Name
- Email
- Password
- [Install StdOut] button

**Background:**
- License optional (add in Settings if needed)
- All branding auto-generated
- Progress modal shows installation steps
- Redirects to dashboard on complete

**Result:** 3 fields → dashboard in < 1 minute

---

## Implementation Priority

### High Priority (Do First)
1. Remove duplicate email field from License step
2. Auto-generate workspace name during installation
3. Set default accent color (no user choice needed at setup)
4. Remove logo upload from setup (add to Settings page)

### Medium Priority
5. Combine License into Step 1 (optional field)
6. Skip entire Step 2 (Branding & Environment)
7. Update progress animation to show "Setting up your environment..."

### Low Priority  
8. Add "Customize Branding" link on dashboard after setup
9. Add Settings page for workspace name, logo, colors
10. Add hostname detection for better auto-generated names

---

## User Experience Goals

**Current:** 3 steps, 6+ fields, ~2 minutes to dashboard  
**Proposed:** 1 step, 3-4 fields, ~45 seconds to dashboard

**Key Principle:** Get users to value (working dashboard) FAST, then let them customize.

Most users won't customize branding on first boot anyway - they want to see if it works first.

---

## Questions for Charlie

1. Is workspace name actually used anywhere functionally? (or just cosmetic?)
2. Does license validation HAVE to be synchronous, or can it happen in background?
3. Are we okay with auto-generating workspace name like "StdOut-{hostname}"?
4. Can branding (logo/color) be Settings-only, not in setup wizard?

---

## Next Steps

If approved:
1. Create new single-page setup form
2. Move branding to Settings page
3. Update installation stream to auto-generate workspace name
4. Test flow end-to-end
5. Update INSTALL.md documentation
