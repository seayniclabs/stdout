/**
 * Static documentation content for StdOut guide pages.
 * Rendered at /app/docs/guide/[slug]
 */

export interface DocPage {
  slug: string;
  title: string;
  description: string;
  content: string; // HTML content
}

export const docPages: DocPage[] = [
  {
    slug: 'getting-started',
    title: 'Getting Started',
    description: 'Set up your account, environment, and run your first scan.',
    content: `
<h2>Welcome to StdOut</h2>
<p>StdOut is an AI-assisted incident companion for self-hosters and solo developers. It turns your past fixes into future answers — a living runbook that knows your stack.</p>

<h3>The Core Loop</h3>
<ol>
  <li><strong>Detect</strong> — The scanner discovers your containers, networks, and services. The HUD monitors them.</li>
  <li><strong>Diagnose</strong> — When something breaks, AI analyzes the incident against your stack context.</li>
  <li><strong>Resolve</strong> — You log what actually fixed it. Resolutions are saved with full context.</li>
  <li><strong>Learn</strong> — Next time a similar issue appears, StdOut surfaces past resolutions automatically.</li>
</ol>

<h3>First Steps</h3>
<table>
  <thead><tr><th>Step</th><th>Where</th><th>Why</th></tr></thead>
  <tbody>
    <tr><td>Name your workspace</td><td><a href="/app/settings">Settings</a></td><td>Gives your environment an identity</td></tr>
    <tr><td>Generate API token</td><td><a href="/app/settings">Settings &gt; API Tokens</a></td><td>The scanner needs this to push results</td></tr>
    <tr><td>Install the scanner</td><td><a href="/app/docs/guide/scanner-setup">Scanner Setup</a></td><td>Auto-discover your infrastructure</td></tr>
    <tr><td>Log an incident</td><td><a href="/app/incidents/new">New Incident</a></td><td>Start building your knowledge base</td></tr>
  </tbody>
</table>

<h3>Navigation</h3>
<p>StdOut has five main areas:</p>
<ul>
  <li><strong>Dashboard</strong> — Overview of service health, recent incidents, and quick actions</li>
  <li><strong>Incidents</strong> — Create, diagnose, and resolve incidents</li>
  <li><strong>HUD</strong> — Real-time health monitoring with HTTP/TCP checks and uptime tracking</li>
  <li><strong>Infrastructure</strong> — Your stacks: containers, services, and their relationships</li>
  <li><strong>Knowledge Base</strong> — Runbooks, post-mortems, guides, and notes</li>
</ul>

<h3>Optional: Windlass</h3>
<p><strong>Windlass is a separate component</strong> — you do not need it to use StdOut. It is a schedule-aware Docker service manager that starts and stops your Compose stacks on a schedule. Connect it if you want:</p>
<ul>
  <li>Schedule-aware alerting (alerts only when a service is unexpectedly down, not just off)</li>
  <li>Automatic start/stop of Docker Compose stacks on a cron schedule</li>
  <li>Dashboard controls for starting, stopping, and restarting services</li>
  <li>Auto-fix plan execution directly on the host</li>
</ul>
<p>See the <a href="/app/docs/guide/windlass">Windlass setup guide</a> if you want to add it.</p>
`,
  },
  {
    slug: 'scanner-setup',
    title: 'Scanner Setup',
    description: 'Install and configure the StdOut scanner to discover your infrastructure.',
    content: `
<h2>What the Scanner Does</h2>
<p>The scanner runs on your host machine and discovers Docker containers, networks, port mappings, and resource usage. It pushes results to StdOut, where they become browsable stacks.</p>

<h3>Prerequisites</h3>
<ul>
  <li>Docker installed on your host</li>
  <li>A StdOut API token (generate one in <a href="/app/settings">Settings</a>)</li>
</ul>

<h3>Quick Start</h3>
<p>Run this on your Docker host (replace <code>YOUR_TOKEN</code> with your actual token):</p>
<pre><code>docker run --rm \\
  -v /var/run/docker.sock:/var/run/docker.sock:ro \\
  charlieseay/stdout-scanner scan \\
  --token YOUR_TOKEN \\
  --url https://stdout.seayniclabs.com \\
  --output json</code></pre>

<h3>Scan Modules</h3>
<table>
  <thead><tr><th>Module</th><th>What It Discovers</th></tr></thead>
  <tbody>
    <tr><td><code>docker</code></td><td>Running containers, images, port mappings, networks, volumes</td></tr>
    <tr><td><code>metrics</code></td><td>CPU, memory, disk usage per container</td></tr>
    <tr><td><code>network</code></td><td>Network interfaces, subnet discovery, open ports</td></tr>
  </tbody>
</table>

<h3>Scheduling Scans</h3>
<p>Set up automatic scanning in <a href="/app/settings">Settings</a> under the Scanner Schedule section. Options:</p>
<ul>
  <li><strong>Hourly</strong> — For rapidly changing environments</li>
  <li><strong>Daily</strong> — Recommended for most setups</li>
  <li><strong>Weekly</strong> — For stable, rarely-changing infrastructure</li>
</ul>

<h3>Delta Scanning</h3>
<p>After the first full scan, subsequent scans only report changes — new containers, removed services, configuration drift. This keeps your stacks up to date without noise.</p>

<h3>Importing Results</h3>
<p>When a scan completes, you'll see a banner on the dashboard: "New scan results available." Click it to review and import the results into your stacks. You can accept the full import or cherry-pick specific services.</p>
`,
  },
  {
    slug: 'incidents',
    title: 'Incidents',
    description: 'Create, diagnose, and resolve incidents. Build your living runbook.',
    content: `
<h2>The Incident Lifecycle</h2>
<p>Every incident in StdOut follows a lifecycle: <strong>Active</strong> &rarr; <strong>Investigating</strong> &rarr; <strong>Monitoring</strong> &rarr; <strong>Resolved</strong>.</p>

<h3>Creating an Incident</h3>
<p>Go to <a href="/app/incidents/new">Incidents &gt; New Incident</a> and fill in:</p>
<ul>
  <li><strong>Title</strong> — Short description of the problem</li>
  <li><strong>Description</strong> — Error output, symptoms, what you observed. Paste logs here.</li>
  <li><strong>Severity</strong> — Critical, High, Medium, or Low</li>
  <li><strong>Stack</strong> — Which infrastructure stack is affected (optional but improves AI diagnosis)</li>
  <li><strong>Tags</strong> — Comma-separated labels for filtering (e.g., <code>docker,nginx,ssl</code>)</li>
</ul>

<h3>AI Diagnosis</h3>
<p>After creating an incident, click <strong>Diagnose with AI</strong>. StdOut sends the incident description plus your stack context to Claude, which returns:</p>
<ul>
  <li>Ranked root cause hypotheses</li>
  <li>Suggested diagnostic commands to run</li>
  <li>Matches to similar past incidents (if any exist)</li>
</ul>
<p>The more stack context and incident detail you provide, the better the diagnosis.</p>

<h3>Adding a Resolution</h3>
<p>When you fix the issue, scroll to the Resolution section and document:</p>
<ul>
  <li>What you actually did to fix it</li>
  <li>Commands you ran</li>
  <li>Configuration changes made</li>
  <li>Root cause (if known)</li>
</ul>
<p>Resolutions are indexed and searchable. They are the core of StdOut's value — next time a similar issue occurs, your past fix surfaces automatically.</p>

<h3>Searching Past Incidents</h3>
<p>Use the search bar (or press <kbd>/</kbd>) to search across all incidents, resolutions, and docs. StdOut uses full-text search, so you can search by error message, service name, or any term in the incident body.</p>
`,
  },
  {
    slug: 'hud-monitoring',
    title: 'HUD & Monitoring',
    description: 'Set up health checks, uptime tracking, and auto-incident creation.',
    content: `
<h2>What is the HUD?</h2>
<p>The HUD (Heads-Up Display) is StdOut's real-time monitoring dashboard. It runs health checks against your services and tracks uptime, response times, and degradation patterns.</p>

<h3>Creating a Monitor</h3>
<p>Go to <a href="/app/hud">HUD</a> and click <strong>Add Monitor</strong>. Configure:</p>
<table>
  <thead><tr><th>Field</th><th>Description</th></tr></thead>
  <tbody>
    <tr><td>Name</td><td>Human-readable label (e.g., "nginx-proxy")</td></tr>
    <tr><td>Type</td><td>HTTP, TCP, Docker, Ping, or DNS</td></tr>
    <tr><td>Target</td><td>URL, host:port, or container name depending on type</td></tr>
    <tr><td>Interval</td><td>How often to check (default: 60 seconds)</td></tr>
    <tr><td>Timeout</td><td>How long to wait before marking as down (default: 5000ms)</td></tr>
    <tr><td>Expected Status</td><td>For HTTP: the expected status code (usually 200)</td></tr>
  </tbody>
</table>

<h3>Monitor Types</h3>
<ul>
  <li><strong>HTTP</strong> — Sends a GET request. Checks status code and response time.</li>
  <li><strong>TCP</strong> — Connects to a port. Verifies the service is listening.</li>
  <li><strong>Docker</strong> — Checks container status via the Docker API.</li>
  <li><strong>Ping</strong> — ICMP ping to verify host reachability.</li>
  <li><strong>DNS</strong> — DNS resolution check.</li>
</ul>

<h3>Auto-Incident Creation</h3>
<p>When a monitor detects consecutive failures (default: 3), StdOut automatically creates an incident linked to the affected service. The incident includes the failure timeline and last response details.</p>

<h3>Uptime Calendar</h3>
<p>Each monitor has a 30-day uptime calendar showing daily availability percentages. Click any day to see the check results for that period.</p>

<h3>Public Status Page</h3>
<p>You can create a public status page showing selected monitors. Configure it in <a href="/app/settings">Settings</a> under Status Page. Your status page will be available at a unique URL you can share.</p>
`,
  },
  {
    slug: 'stacks',
    title: 'Stacks & Infrastructure',
    description: 'Organize your infrastructure into stacks. Import from scanner or create manually.',
    content: `
<h2>What Are Stacks?</h2>
<p>A stack is a group of related services — your Docker Compose project, a Kubernetes namespace, or just "the stuff running on this server." Stacks give AI diagnosis the context it needs to understand your environment.</p>

<h3>Creating Stacks</h3>
<p>Two ways to create stacks:</p>
<ul>
  <li><strong>Scanner import</strong> — Run the scanner and import discovered services. This is the recommended approach.</li>
  <li><strong>Manual creation</strong> — Go to <a href="/app/stacks?new">Infrastructure &gt; New Stack</a> and describe your setup in Markdown.</li>
</ul>

<h3>Stack Templates</h3>
<p>When creating a stack manually, you can start from a template:</p>
<ul>
  <li><strong>Docker Compose</strong> — For Docker-based setups</li>
  <li><strong>Kubernetes</strong> — For K8s clusters</li>
  <li><strong>Bare Metal</strong> — For non-containerized services</li>
  <li><strong>Cloud</strong> — For cloud-hosted infrastructure</li>
</ul>

<h3>What to Include</h3>
<p>The more detail in your stack description, the better your AI diagnoses will be. Include:</p>
<ul>
  <li>Service names and versions</li>
  <li>Port mappings and network topology</li>
  <li>Volume mounts and persistent storage</li>
  <li>Environment-specific quirks</li>
  <li>Known issues or workarounds</li>
</ul>

<h3>Linking Stacks to Incidents</h3>
<p>When creating an incident, select the relevant stack. This gives AI diagnosis full context about the affected services, dependencies, and past issues in that stack.</p>
`,
  },
  {
    slug: 'knowledge-base',
    title: 'Knowledge Base',
    description: 'Build runbooks, post-mortems, guides, and notes. Search across everything.',
    content: `
<h2>Document Types</h2>
<table>
  <thead><tr><th>Type</th><th>Use For</th></tr></thead>
  <tbody>
    <tr><td><strong>Runbook</strong></td><td>Step-by-step procedures for recurring tasks or known issues</td></tr>
    <tr><td><strong>Post-Mortem</strong></td><td>After-action reviews of significant incidents</td></tr>
    <tr><td><strong>Guide</strong></td><td>How-to documentation for your setup</td></tr>
    <tr><td><strong>Note</strong></td><td>Quick reference or scratch notes</td></tr>
  </tbody>
</table>

<h3>Creating a Doc</h3>
<p>Go to <a href="/app/docs/new">Docs &gt; New Doc</a>. Write in Markdown — StdOut renders it with full formatting, code blocks, tables, and links.</p>

<h3>Community Library</h3>
<p>StdOut ships with community-contributed guides covering common self-hosting scenarios. These appear with a purple "Community" badge. You can fork community docs to customize them for your environment.</p>

<h3>Search</h3>
<p>All docs are full-text indexed alongside incidents and resolutions. Use the search bar (<kbd>/</kbd>) to find anything across your entire StdOut instance.</p>

<h3>Contributing</h3>
<p>You can contribute your docs back to the community library. On any doc you own, click <strong>Contribute to Community</strong>. Your doc will be sanitized (personal details stripped) and submitted for review.</p>
`,
  },
  {
    slug: 'ai-features',
    title: 'AI Features',
    description: 'How AI diagnosis works, model details, and tips for better results.',
    content: `
<h2>How AI Diagnosis Works</h2>
<p>When you click <strong>Diagnose with AI</strong> on an incident, StdOut constructs a prompt that includes:</p>
<ol>
  <li>The incident title and description</li>
  <li>The associated stack description (if linked)</li>
  <li>Similar past incidents and their resolutions</li>
  <li>Your full-text search results for related terms</li>
</ol>
<p>This context is sent to Claude, which returns structured analysis.</p>

<h3>What You Get</h3>
<ul>
  <li><strong>Root Causes</strong> — Ranked hypotheses, most likely first</li>
  <li><strong>Diagnostic Commands</strong> — Commands to run to confirm each hypothesis</li>
  <li><strong>Past Matches</strong> — Similar incidents from your history with links to their resolutions</li>
</ul>

<h3>Tips for Better Results</h3>
<ul>
  <li><strong>Include error output</strong> — Paste the actual error message or log output in the incident description</li>
  <li><strong>Link a stack</strong> — Stack context dramatically improves diagnosis accuracy</li>
  <li><strong>Be specific</strong> — "nginx returns 502" is better than "website is down"</li>
  <li><strong>Log resolutions</strong> — Every resolution you add improves future diagnoses for similar issues</li>
</ul>

<h3>Token Usage</h3>
<p>Each diagnosis uses AI tokens. Your usage is tracked and shown per diagnosis. Free tier includes limited diagnoses; Solo and Shop tiers include more. Check your usage in <a href="/app/settings">Settings</a>.</p>

<h3>Similar Incident Matching</h3>
<p>Even without running AI diagnosis, StdOut automatically searches for similar past incidents when you create a new one. This happens via full-text search and is free — no AI tokens used.</p>
`,
  },
  {
    slug: 'settings',
    title: 'Settings & Configuration',
    description: 'Workspace branding, notifications, API tokens, billing, and team management.',
    content: `
<h2>Settings Overview</h2>
<p>Access settings via the gear icon in the top navigation bar, or go to <a href="/app/settings">Settings</a> directly.</p>

<h3>Workspace</h3>
<ul>
  <li><strong>Workspace Name</strong> — Appears in the nav bar and status page</li>
  <li><strong>Accent Color</strong> — Customizes buttons, links, and highlights</li>
  <li><strong>Logo</strong> — Replaces the StdOut icon in the nav bar</li>
</ul>

<h3>API Tokens</h3>
<p>API tokens authenticate the scanner and any external integrations. Generate tokens in Settings. Each token:</p>
<ul>
  <li>Has a name for identification</li>
  <li>Is shown once at creation — copy it immediately</li>
  <li>Can be revoked at any time</li>
  <li>Tracks last-used timestamp</li>
</ul>
<p>Token format: <code>stdout_scan_XXXX...</code></p>

<h3>Notifications</h3>
<p>Configure email and webhook alerts for service health changes, new incidents, and weekly digests. See the <a href="/app/docs/guide/getting-started">Getting Started</a> guide for setup details.</p>

<h3>Scanner Schedule</h3>
<p>Set up automatic scanning at intervals (hourly, daily, weekly). Choose which modules to enable and optionally specify subnets for network scanning.</p>

<h3>Status Page</h3>
<p>Create a public-facing status page showing selected monitors. Configure the URL slug, title, and which monitors to display.</p>

<h3>Billing</h3>
<p>Manage your subscription tier (Free, Solo, Shop) and view usage. Billing is handled through Stripe.</p>

<h3>Team (Shop tier)</h3>
<p>Invite team members with role-based access: Admin, Editor, or Viewer. Team members share the same workspace data.</p>
`,
  },
  {
    slug: 'api-reference',
    title: 'API Reference',
    description: 'REST API endpoints for integrations, automation, and the scanner.',
    content: `
<h2>Authentication</h2>
<p>All API requests require an API token in the <code>Authorization</code> header:</p>
<pre><code>Authorization: Bearer stdout_scan_YOUR_TOKEN</code></pre>

<h3>Base URL</h3>
<p>SaaS: <code>https://stdout.seayniclabs.com</code><br>
Self-hosted: your configured domain and port.</p>

<h2>Endpoints</h2>

<h3>Scanner</h3>
<table>
  <thead><tr><th>Method</th><th>Path</th><th>Description</th></tr></thead>
  <tbody>
    <tr><td><code>POST</code></td><td><code>/app/api/stacks/import</code></td><td>Submit scan results for import</td></tr>
    <tr><td><code>GET</code></td><td><code>/app/api/scanner/schedule</code></td><td>Get current scan schedule</td></tr>
    <tr><td><code>POST</code></td><td><code>/app/api/scanner/schedule</code></td><td>Update scan schedule</td></tr>
  </tbody>
</table>

<h3>Incidents</h3>
<table>
  <thead><tr><th>Method</th><th>Path</th><th>Description</th></tr></thead>
  <tbody>
    <tr><td><code>POST</code></td><td><code>/app/api/incidents/webhook</code></td><td>Create incident via webhook</td></tr>
    <tr><td><code>GET</code></td><td><code>/app/api/export</code></td><td>Export incidents as JSON</td></tr>
  </tbody>
</table>

<h3>Monitors</h3>
<table>
  <thead><tr><th>Method</th><th>Path</th><th>Description</th></tr></thead>
  <tbody>
    <tr><td><code>GET</code></td><td><code>/app/api/monitors</code></td><td>List all monitors and status</td></tr>
    <tr><td><code>POST</code></td><td><code>/app/api/monitors</code></td><td>Create or update a monitor</td></tr>
  </tbody>
</table>

<h3>Search</h3>
<table>
  <thead><tr><th>Method</th><th>Path</th><th>Description</th></tr></thead>
  <tbody>
    <tr><td><code>GET</code></td><td><code>/app/api/search?q=term</code></td><td>Full-text search across incidents, resolutions, and docs</td></tr>
  </tbody>
</table>

<h3>Account</h3>
<table>
  <thead><tr><th>Method</th><th>Path</th><th>Description</th></tr></thead>
  <tbody>
    <tr><td><code>GET</code></td><td><code>/app/api/me</code></td><td>Get current user info</td></tr>
    <tr><td><code>GET</code></td><td><code>/app/api/tokens</code></td><td>List API tokens</td></tr>
    <tr><td><code>POST</code></td><td><code>/app/api/tokens</code></td><td>Create a new API token</td></tr>
    <tr><td><code>DELETE</code></td><td><code>/app/api/tokens</code></td><td>Revoke an API token</td></tr>
  </tbody>
</table>

<h3>Webhook Payload (Incident Creation)</h3>
<pre><code>{
  "title": "Service unavailable",
  "description": "nginx returned 502 bad gateway",
  "severity": "critical",
  "stackId": "optional-stack-id",
  "tags": "nginx,proxy"
}</code></pre>
`,
  },
  {
    slug: 'windlass',
    title: 'Windlass Setup',
    description: 'Connect Windlass for schedule-aware service management and dashboard controls.',
    content: `
<h2>What is Windlass?</h2>
<p>Windlass is a separate, optional component — a schedule-aware Docker service manager. It reads a <code>schedule.yaml</code> and automatically starts, stops, and monitors your Docker Compose stacks according to defined windows.</p>
<p><strong>You do not need Windlass to use StdOut.</strong> It adds schedule-aware alerting, dashboard service controls, and auto-fix execution on the host. If you just want incident tracking, AI diagnostics, and a knowledge base, skip it.</p>

<h3>Why Use Windlass?</h3>
<ul>
  <li><strong>Schedule-aware alerting</strong> — Alerts only when a service is unexpectedly down, not when it's scheduled to be off. No false pages at 3AM for a service that's supposed to stop at midnight.</li>
  <li><strong>Automatic start/stop</strong> — Bring Docker Compose stacks up and down on a cron schedule (e.g., start a social media scheduler at 11PM, stop it at 4AM).</li>
  <li><strong>Dashboard controls</strong> — Start, stop, and restart services from the StdOut UI without SSH.</li>
  <li><strong>Auto-fix execution</strong> — StdOut auto-fix plans can run commands directly on the host via Windlass.</li>
</ul>

<h3>Architecture</h3>
<p>Windlass runs alongside your Docker host and manages containers via the Docker socket. StdOut polls it over HTTP:</p>
<pre><code>StdOut (port 8112)  ←── HTTP poll ──→  Windlass engine (port 8116)
                                              │
                                    reads schedule.yaml
                                    manages Docker socket
                                    tracks state.json</code></pre>

<h2>Installation</h2>

<h3>Step 1: Create the config directory</h3>
<pre><code>sudo mkdir -p /opt/windlass</code></pre>

<h3>Step 2: Write your schedule</h3>
<p>Download the example and edit it to match your services:</p>
<pre><code>curl -o /opt/windlass/schedule.yaml \\
  https://raw.githubusercontent.com/seayniclabs/windlass/main/schedule.yaml.example</code></pre>

<p>Example <code>schedule.yaml</code>:</p>
<pre><code>services:
  my-service:
    compose_path: /opt/containers/my-service
    containers: [my-service]
    type: always
    description: "Runs 24/7"

  overnight-job:
    compose_path: /opt/containers/overnight-job
    containers: [overnight-job]
    type: schedule
    cron_start: "0 23 * * *"   # 11 PM
    cron_stop:  "0 4 * * *"    # 4 AM
    description: "Social scheduler, runs overnight"</code></pre>

<h3>Service Types</h3>
<table>
  <thead><tr><th>Type</th><th>Behavior</th></tr></thead>
  <tbody>
    <tr><td><code>always</code></td><td>Restarted automatically if found stopped</td></tr>
    <tr><td><code>schedule</code></td><td>Started/stopped on cron windows (<code>cron_start</code>, <code>cron_stop</code>)</td></tr>
    <tr><td><code>on-demand</code></td><td>Tracked; auto-stopped after <code>idle_shutdown_minutes</code></td></tr>
    <tr><td><code>manual</code></td><td>Tracked but never auto-managed</td></tr>
  </tbody>
</table>

<h3>Step 3: Start Windlass with StdOut</h3>
<p>If using the StdOut <code>docker-compose.yml</code>, Windlass is included as an optional profile:</p>
<pre><code># Start both StdOut and Windlass
docker compose --profile windlass up -d</code></pre>

<p>Windlass starts on port 8116. StdOut starts on port 8112.</p>

<h3>Step 4: Connect StdOut to Windlass</h3>
<ol>
  <li>Open StdOut and go to <strong>Windlass</strong> in the navigation</li>
  <li>Enter <code>http://host.docker.internal:8116</code> as the endpoint URL</li>
  <li>Click <strong>Connect</strong></li>
  <li>Click <strong>Sync</strong> to pull in your service registry</li>
</ol>
<p>StdOut will now show your services, their schedule windows, and alert when something is down outside its expected window.</p>

<h2>Windlass API</h2>
<table>
  <thead><tr><th>Method</th><th>Path</th><th>Description</th></tr></thead>
  <tbody>
    <tr><td><code>GET</code></td><td><code>/status.json</code></td><td>Full service status, memory, upcoming events</td></tr>
    <tr><td><code>POST</code></td><td><code>/commands.json</code></td><td>Start/stop/restart a service</td></tr>
    <tr><td><code>POST</code></td><td><code>/exec</code></td><td>Run an allowlisted command on the host</td></tr>
    <tr><td><code>GET</code></td><td><code>/health</code></td><td>Liveness check — returns <code>{"ok": true}</code></td></tr>
  </tbody>
</table>

<h2>Troubleshooting</h2>
<ul>
  <li><strong>StdOut can't reach Windlass</strong> — Use <code>host.docker.internal:8116</code>, not <code>localhost:8116</code>. StdOut runs inside Docker; localhost resolves to the container, not the host.</li>
  <li><strong>Services show as "unknown"</strong> — Check that container names in <code>schedule.yaml</code> match actual container names (<code>docker ps --format '{{.Names}}'</code>)</li>
  <li><strong>schedule.yaml changes not picked up</strong> — Windlass reloads the schedule on each evaluation cycle (default 5 minutes). Restart Windlass to force an immediate reload.</li>
  <li><strong>Compose path not found</strong> — Ensure the path in <code>compose_path</code> is an absolute path and is mounted into the Windlass container if using Docker.</li>
</ul>
`,
  },
  {
    slug: 'self-host',
    title: 'Self-Host Guide',
    description: 'Deploy StdOut on your own server with Docker.',
    content: `
<h2>Requirements</h2>
<ul>
  <li>Docker and Docker Compose</li>
  <li>At least 512MB RAM</li>
  <li>A domain with DNS (optional but recommended)</li>
</ul>

<h3>Quick Start</h3>
<pre><code>mkdir stdout && cd stdout

# Download the compose file (includes optional Windlass profile)
curl -o docker-compose.yml \\
  https://raw.githubusercontent.com/seayniclabs/stdout/main/docker-compose.yml

# Start StdOut only
docker compose up -d

# Or start StdOut + Windlass together
docker compose --profile windlass up -d</code></pre>

<p>Open <code>http://localhost:8112</code>. StdOut runs on port 3000 inside the container, mapped to 8112 on the host.</p>

<h3>Environment Variables</h3>
<table>
  <thead><tr><th>Variable</th><th>Default</th><th>Description</th></tr></thead>
  <tbody>
    <tr><td><code>STDOUT_MODE</code></td><td><code>selfhost</code></td><td>Set to <code>saas</code> for multi-tenant mode</td></tr>
    <tr><td><code>DB_PATH</code></td><td><code>./data/stdout.db</code></td><td>SQLite database location</td></tr>
    <tr><td><code>TZ</code></td><td><code>UTC</code></td><td>Container timezone</td></tr>
    <tr><td><code>ANTHROPIC_API_KEY</code></td><td>—</td><td>Optional platform AI key; users can also bring their own in Settings</td></tr>
    <tr><td><code>RESEND_API_KEY</code></td><td>—</td><td>Required for email notifications</td></tr>
    <tr><td><code>WINDLASS_URL</code></td><td><code>http://host.docker.internal:8116</code></td><td>Windlass engine URL — only needed if running Windlass</td></tr>
  </tbody>
</table>

<h3>Adding Windlass Later</h3>
<p>Windlass is an optional schedule-aware service manager. If you decide to add it after initial setup:</p>
<ol>
  <li>Create <code>/opt/windlass/schedule.yaml</code> (see <a href="/app/docs/guide/windlass">Windlass guide</a>)</li>
  <li>Uncomment the compose directory volume mount in <code>docker-compose.yml</code></li>
  <li>Run <code>docker compose --profile windlass up -d</code></li>
  <li>In StdOut, go to Windlass → enter <code>http://host.docker.internal:8116</code> → Connect → Sync</li>
</ol>

<h3>Reverse Proxy</h3>
<p>If running behind a reverse proxy (nginx, Caddy, Traefik), forward to port 8112 (or whatever you mapped). Example nginx config:</p>
<pre><code>server {
    listen 443 ssl;
    server_name stdout.yourdomain.com;

    location / {
        proxy_pass http://localhost:8112;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}</code></pre>

<h3>Updating</h3>
<pre><code>docker compose pull
docker compose up -d</code></pre>

<h3>Backups</h3>
<p>Back up the <code>./data/</code> directory. The SQLite database supports online backups — you can copy it while StdOut is running (WAL mode ensures consistency).</p>
`,
  },
];

/** Get all doc slugs for static paths */
export function getDocSlugs(): string[] {
  return docPages.map(d => d.slug);
}

/** Get a doc by slug */
export function getDocBySlug(slug: string): DocPage | undefined {
  return docPages.find(d => d.slug === slug);
}

/** Get the nav list (slug + title) for the sidebar */
export function getDocNav(): { slug: string; title: string }[] {
  return docPages.map(d => ({ slug: d.slug, title: d.title }));
}
