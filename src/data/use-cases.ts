export interface UseCase {
  slug: string;
  title: string;
  metaDescription: string;
  headline: string;
  subheadline: string;
  problem: string;
  solution: string;
  features: string[];
  keywords: string[];
  category: 'homelab' | 'devops' | 'monitoring' | 'security' | 'comparison';
  relatedSlugs: string[];
}

export const useCases: UseCase[] = [
  // ── Homelab ─────────────────────────────────────
  {
    slug: 'stdout-for-homelab',
    title: 'StdOut for Homelab — Incident Companion for Self-Hosters',
    metaDescription: 'StdOut is the incident companion built for homelab builders. AI diagnosis, living runbooks, and stack auto-discovery for your self-hosted infrastructure.',
    headline: 'Your homelab deserves an incident memory.',
    subheadline: 'You built it from scratch. StdOut makes sure you never lose the knowledge of how it works — or how you fixed it last time.',
    problem: 'Homelabs grow organically. You add a container here, a reverse proxy there, a VPN tunnel on the weekend. Six months later, something breaks and you can\'t remember which config fixed it last time. Your resolution history lives in browser tabs, Discord threads, and half-finished notes you\'ll never find again.',
    solution: 'StdOut auto-discovers your entire stack — Docker containers, compose projects, network devices, TLS certs — and gives you a single place to log incidents and resolutions. When something breaks, AI matches the error against your stack context and past fixes. Your knowledge compounds instead of evaporating.',
    features: [
      'Auto-discovers Docker containers, compose projects, ports, and networks',
      'AI diagnosis that knows your specific infrastructure',
      'Full-text search across every incident and resolution',
      'Living runbooks built from your actual fixes',
      'HUD monitoring with automatic incident creation on downtime',
      'Self-hosted on your own hardware — your data stays home'
    ],
    keywords: ['homelab incident management', 'homelab monitoring', 'self-hosted incident tracker', 'homelab runbooks', 'homelab documentation'],
    category: 'homelab',
    relatedSlugs: ['docker-incident-management', 'self-hosted-monitoring-dashboard', 'homelab-runbook-builder']
  },
  {
    slug: 'docker-incident-management',
    title: 'Docker Incident Management — Track and Resolve Container Issues',
    metaDescription: 'Track Docker container incidents, get AI diagnosis with stack context, and build runbooks from your resolutions. Self-hosted, $149 one-time.',
    headline: 'Docker containers break. StdOut remembers how you fixed them.',
    subheadline: 'From "container won\'t start" to "network bridge misconfigured" — log it once, find it instantly next time.',
    problem: 'Docker makes it easy to run services. It does not make it easy to remember why container X stopped working last Tuesday, which environment variable was wrong, or which port conflict you resolved at midnight. Container issues repeat, and you end up debugging the same OOM kill, DNS resolution failure, or volume mount error over and over.',
    solution: 'StdOut scans your Docker socket and maps every container, compose project, port, and network. When a container fails, log the incident and let AI analyze it against your specific Docker setup. The resolution gets indexed and searchable — next time the same image crashes, StdOut surfaces exactly what you did.',
    features: [
      'Docker socket scanner maps all containers, images, and networks',
      'Compose project awareness — sees multi-container relationships',
      'AI diagnosis references your Docker-specific stack context',
      'Tag incidents by container, image, or compose project',
      'Resolution history indexed for instant retrieval',
      'Automatic incident creation when monitored containers go down'
    ],
    keywords: ['docker incident management', 'docker troubleshooting tool', 'container monitoring', 'docker debugging', 'docker compose monitoring'],
    category: 'homelab',
    relatedSlugs: ['stdout-for-homelab', 'self-hosted-monitoring-dashboard', 'proxmox-incident-tracking']
  },
  {
    slug: 'self-hosted-monitoring-dashboard',
    title: 'Self-Hosted Monitoring Dashboard — Infrastructure HUD',
    metaDescription: 'Monitor your self-hosted services with StdOut\'s HUD. Uptime checks, automatic incident creation, and AI diagnosis. No cloud dependency. $149 one-time.',
    headline: 'A control room for your infrastructure.',
    subheadline: 'Uptime monitoring, incident tracking, and AI diagnosis in a single self-hosted dashboard. No SaaS subscription required.',
    problem: 'You\'re running 20, 30, 50+ services and the only way to know something is down is when you notice it — or when someone complains. Free monitoring tools give you graphs and alerts but no context. Paid ones cost more per month than your entire server. None of them connect monitoring to incident history.',
    solution: 'StdOut\'s HUD monitors every service in your stack and auto-creates incidents when something goes down. But it goes further than status checks: each incident connects to your resolution history, stack context, and AI diagnosis. You don\'t just know something is down — you know how to fix it.',
    features: [
      'HUD dashboard with real-time service status',
      'Automatic incident creation on downtime detection',
      'Connects monitoring data to resolution history',
      'AI diagnosis pulls from your stack context',
      'Public status page for your users',
      'Weekly digest email with infrastructure health summary'
    ],
    keywords: ['self-hosted monitoring dashboard', 'self-hosted uptime monitor', 'homelab dashboard', 'infrastructure monitoring', 'service health dashboard'],
    category: 'homelab',
    relatedSlugs: ['stdout-for-homelab', 'stdout-uptime-kuma-integration', 'stdout-grafana-alternative']
  },
  {
    slug: 'homelab-runbook-builder',
    title: 'Homelab Runbook Builder — Turn Fixes Into Documentation',
    metaDescription: 'Build living runbooks from your actual incident resolutions. StdOut turns homelab troubleshooting into searchable, reusable documentation.',
    headline: 'Your fixes are documentation. Treat them that way.',
    subheadline: 'Every time you resolve an incident, StdOut captures it as a runbook entry. Your troubleshooting knowledge becomes searchable, permanent, and useful.',
    problem: 'You fix things constantly. You rarely document them. When the same problem returns three months later, you start from zero — searching Reddit, re-reading Docker docs, and trying random Stack Overflow answers until something works. The knowledge was in your head once. Now it\'s gone.',
    solution: 'StdOut makes documentation a side effect of fixing things. When you resolve an incident, the resolution becomes a searchable runbook entry automatically. Full-text search finds it instantly. AI uses it as context for future diagnoses. Your operational knowledge compounds over time instead of decaying.',
    features: [
      'Resolutions automatically become searchable runbook entries',
      'Full-text search across all incidents and resolutions',
      'AI references your runbooks during future diagnoses',
      'Markdown support for detailed resolution notes',
      'Tag and categorize for organized knowledge base',
      'Export and backup your entire knowledge base'
    ],
    keywords: ['homelab runbook builder', 'homelab documentation tool', 'self-hosted knowledge base', 'incident resolution documentation', 'operational runbooks'],
    category: 'homelab',
    relatedSlugs: ['stdout-for-homelab', 'docker-incident-management', 'solo-devops-incident-management']
  },
  {
    slug: 'proxmox-incident-tracking',
    title: 'Proxmox Incident Tracking — Monitor VMs and Containers',
    metaDescription: 'Track Proxmox VE incidents, diagnose VM and container issues with AI, and build runbooks for your virtualization infrastructure. Self-hosted, $149.',
    headline: 'Proxmox keeps your VMs running. StdOut remembers how.',
    subheadline: 'VM won\'t boot? Storage migration failed? ZFS pool degraded? Log it, diagnose it, and find the fix next time in seconds.',
    problem: 'Proxmox VE is powerful but opaque when things go wrong. VM snapshots fail silently, ZFS pools degrade without clear cause, and LXC containers develop weird networking issues after kernel updates. The Proxmox forum is helpful, but finding your specific fix among thousands of threads is painful — especially when you\'ve solved this exact problem before.',
    solution: 'StdOut gives your Proxmox cluster an incident memory. Log VM crashes, storage failures, and networking issues with full context. AI diagnosis understands virtualization-specific problems and references your past Proxmox fixes. When the same ZFS scrub error or QEMU crash appears, the resolution is one search away.',
    features: [
      'Track VM, LXC, and storage incidents in one place',
      'AI diagnosis understands Proxmox-specific failure modes',
      'Tag incidents by VM, node, storage type, or cluster',
      'Resolution history for recurring virtualization issues',
      'Stack context includes your Proxmox topology',
      'Self-hosted — runs on your Proxmox node or separate hardware'
    ],
    keywords: ['proxmox incident tracking', 'proxmox monitoring tool', 'proxmox troubleshooting', 'proxmox VE monitoring', 'virtualization incident management'],
    category: 'homelab',
    relatedSlugs: ['stdout-for-homelab', 'docker-incident-management', 'unraid-server-monitoring']
  },
  {
    slug: 'unraid-server-monitoring',
    title: 'Unraid Server Monitoring — Incident Tracking for Unraid',
    metaDescription: 'Monitor your Unraid server with StdOut. Track disk failures, Docker container issues, and parity errors. AI diagnosis and living runbooks. $149 one-time.',
    headline: 'Your Unraid server is critical infrastructure. Treat it like one.',
    subheadline: 'Disk failures, parity errors, Docker crashes, and plugin conflicts — log them all, search them instantly, and stop re-diagnosing the same problems.',
    problem: 'Unraid makes NAS and server management accessible, but its error reporting is scattered. Disk SMART warnings appear in one place, Docker container logs in another, and system notifications in a third. When a disk drops out of the array or a Docker container enters a restart loop, you\'re stitching together information from multiple sources to figure out what happened — and what you did about it last time.',
    solution: 'StdOut consolidates your Unraid incident history into a single searchable system. Log disk failures alongside Docker issues and network problems. AI diagnosis considers your entire Unraid setup — array configuration, Docker containers, VMs, and plugins. Build runbooks for recurring maintenance tasks like parity checks, disk replacements, and plugin updates.',
    features: [
      'Consolidated incident tracking for disks, Docker, VMs, and plugins',
      'AI diagnosis understands Unraid-specific failure patterns',
      'Tag incidents by disk, container, or subsystem',
      'Runbooks for parity checks, disk replacements, and migrations',
      'Full-text search across all Unraid-related incidents',
      'HUD monitoring for Docker containers running on Unraid'
    ],
    keywords: ['unraid server monitoring', 'unraid incident tracking', 'unraid troubleshooting', 'unraid docker monitoring', 'unraid disk failure tracking'],
    category: 'homelab',
    relatedSlugs: ['stdout-for-homelab', 'docker-incident-management', 'proxmox-incident-tracking']
  },

  // ── DevOps ──────────────────────────────────────
  {
    slug: 'solo-devops-incident-management',
    title: 'Solo DevOps Incident Management — Your On-Call Companion',
    metaDescription: 'Incident management built for solo DevOps engineers. AI diagnosis, resolution history, and runbooks without the enterprise overhead. $149 one-time.',
    headline: 'Enterprise incident management is built for teams. You\'re a team of one.',
    subheadline: 'PagerDuty, Opsgenie, and Incident.io assume you have a rotation. StdOut assumes you\'re the entire SRE department.',
    problem: 'Solo DevOps engineers and indie developers wear every hat: on-call, SRE, platform engineer, and firefighter. Enterprise incident management tools are built for teams with rotations, escalation policies, and war rooms. You don\'t need an escalation policy — you need to remember how you fixed the nginx proxy issue last month at 2am.',
    solution: 'StdOut strips away the team-oriented overhead and gives you what matters: a searchable history of every incident, AI diagnosis that knows your stack, and runbooks built from your own resolutions. No rotations, no escalation chains, no per-seat pricing. Just you, your infrastructure, and a tool that remembers.',
    features: [
      'Designed for single-operator infrastructure',
      'AI diagnosis references your specific stack and history',
      'No per-seat pricing — one license, unlimited use',
      'Living runbooks built from your actual fixes',
      'Full-text search finds past resolutions instantly',
      'Self-hosted on your own infrastructure'
    ],
    keywords: ['solo devops incident management', 'indie developer incident tool', 'one-person SRE', 'solo engineer on-call', 'devops incident tracker'],
    category: 'devops',
    relatedSlugs: ['on-call-incident-companion', 'self-hosted-postmortem-tool', 'stdout-vs-pagerduty']
  },
  {
    slug: 'infrastructure-as-code-debugging',
    title: 'Infrastructure as Code Debugging — Track IaC Failures',
    metaDescription: 'Debug Terraform, Ansible, and Docker Compose failures with AI-assisted incident tracking. Log IaC errors, get diagnosis, build runbooks. $149 one-time.',
    headline: 'Infrastructure as code fails. StdOut remembers why.',
    subheadline: 'Terraform state drift, Ansible playbook failures, and Docker Compose conflicts deserve the same incident tracking as production outages.',
    problem: 'Infrastructure as code is supposed to be reproducible. In practice, Terraform plans fail because of provider changes, Ansible playbooks break on OS upgrades, and Docker Compose configs conflict after dependency updates. These failures are repetitive but unpredictable. You solve them, move on, and solve them again three months later from scratch.',
    solution: 'StdOut treats IaC failures as first-class incidents. Log the Terraform error, paste the Ansible output, record the Docker Compose conflict. AI diagnosis considers your infrastructure context — which providers you use, which Ansible roles are active, which images are in your stack. The resolution becomes a searchable runbook entry for next time.',
    features: [
      'Track Terraform, Ansible, and Docker Compose failures',
      'AI diagnosis understands IaC-specific error patterns',
      'Stack context includes your IaC toolchain configuration',
      'Resolution history for recurring provider and dependency issues',
      'Full-text search across all IaC-related incidents',
      'Tag incidents by tool, provider, or environment'
    ],
    keywords: ['infrastructure as code debugging', 'terraform debugging tool', 'ansible troubleshooting', 'IaC incident tracking', 'devops debugging tool'],
    category: 'devops',
    relatedSlugs: ['solo-devops-incident-management', 'docker-incident-management', 'on-call-incident-companion']
  },
  {
    slug: 'on-call-incident-companion',
    title: 'On-Call Incident Companion — AI-Assisted Troubleshooting',
    metaDescription: 'StdOut is your on-call companion. AI diagnosis with stack context, instant resolution search, and runbooks that are actually up to date. $149 one-time.',
    headline: 'It\'s 2am. Something is down. StdOut already knows what to do.',
    subheadline: 'When your phone buzzes, StdOut pulls up how you fixed it last time. AI diagnosis, resolution matching, and runbooks — all from your own history.',
    problem: 'Being on-call alone is stressful enough without starting every incident from zero. You get the alert, you log in, and you start scrolling through logs trying to remember what the fix was last time. Was it a DNS issue? A cert expiration? Did you write it down somewhere? The answer is usually "sort of, somewhere, maybe."',
    solution: 'StdOut acts as your incident companion during on-call. Search your resolution history by error message, service name, or symptom. If you haven\'t seen this exact issue before, AI diagnosis analyzes the incident against your stack context and past fixes. The resolution you write tonight becomes the instant fix you find at your next 2am wake-up.',
    features: [
      'Instant search across all past incidents and resolutions',
      'AI diagnosis matches errors to your stack context',
      'Resolution history turns into on-call runbooks',
      'HUD shows real-time service status at a glance',
      'Severity tracking helps prioritize during outages',
      'Weekly digest keeps you aware of infrastructure trends'
    ],
    keywords: ['on-call incident companion', 'on-call troubleshooting tool', 'incident response assistant', 'AI on-call support', 'self-hosted on-call tool'],
    category: 'devops',
    relatedSlugs: ['solo-devops-incident-management', 'self-hosted-postmortem-tool', 'stdout-for-homelab']
  },
  {
    slug: 'self-hosted-postmortem-tool',
    title: 'Self-Hosted Postmortem Tool — Blameless Incident Reviews',
    metaDescription: 'Run blameless postmortems with StdOut. AI-generated incident analysis, resolution tracking, and searchable postmortem history. Self-hosted, $149.',
    headline: 'Postmortems that actually prevent repeat incidents.',
    subheadline: 'Most postmortems are written, filed, and forgotten. StdOut makes them searchable and feeds them into AI diagnosis for future incidents.',
    problem: 'Postmortems are supposed to prevent repeat incidents. In practice, they end up in a Google Doc or Notion page that nobody searches. The knowledge captured during the review never makes it back into your operational workflow. The same incident type recurs, and nobody checks the postmortem archive before starting the diagnosis from scratch.',
    solution: 'StdOut closes the loop. Incident resolutions and diagnosis data become the postmortem automatically. Full-text search makes every past incident findable by error message, service name, or root cause. When a similar incident occurs, AI diagnosis references your postmortem history as part of its analysis. Your postmortems become living operational intelligence.',
    features: [
      'Resolutions serve as structured postmortem records',
      'Full-text search across all incident history',
      'AI diagnosis references past postmortems automatically',
      'Timeline from incident creation to resolution',
      'Tag incidents for root cause categorization',
      'Export incident reports for team review'
    ],
    keywords: ['self-hosted postmortem tool', 'incident postmortem software', 'blameless postmortem', 'incident review tool', 'postmortem documentation'],
    category: 'devops',
    relatedSlugs: ['solo-devops-incident-management', 'on-call-incident-companion', 'homelab-runbook-builder']
  },

  // ── Monitoring Integrations ─────────────────────
  {
    slug: 'stdout-prometheus-integration',
    title: 'StdOut + Prometheus — Incident Context from Metrics',
    metaDescription: 'Connect StdOut to Prometheus for AI incident diagnosis with real metrics context. Correlate alerts with resolution history. Self-hosted, $149.',
    headline: 'Prometheus tells you what happened. StdOut tells you what to do about it.',
    subheadline: 'Pull Prometheus metrics into your incident context so AI diagnosis has real data, not guesswork.',
    problem: 'Prometheus is excellent at collecting metrics and firing alerts. It is not built to help you resolve the underlying incident. You get an alert, open Grafana, stare at dashboards, and try to correlate spikes with symptoms. The diagnosis process starts from scratch every time because Prometheus doesn\'t connect metrics to resolution history.',
    solution: 'StdOut integrates with Prometheus as a data source, pulling relevant metrics into your incident context. When you log an incident, AI diagnosis has access to your Prometheus data alongside your stack topology and past resolutions. The connection between "CPU spiked at 3am" and "the backup cron was running without ionice" gets captured once and found instantly next time.',
    features: [
      'Prometheus as a data source for incident context',
      'AI diagnosis references real metrics during analysis',
      'Correlate Prometheus alerts with resolution history',
      'Stack scanner maps services to Prometheus targets',
      'Runbooks linked to specific metric thresholds',
      'Self-hosted — no external metric forwarding required'
    ],
    keywords: ['prometheus incident management', 'prometheus alerting tool', 'prometheus integration', 'metrics incident correlation', 'prometheus troubleshooting'],
    category: 'monitoring',
    relatedSlugs: ['stdout-grafana-alternative', 'stdout-influxdb-monitoring', 'stdout-loki-log-analysis']
  },
  {
    slug: 'stdout-grafana-alternative',
    title: 'StdOut vs Grafana — Monitoring That Helps You Fix Things',
    metaDescription: 'Grafana shows dashboards. StdOut shows you how to fix the problem. AI diagnosis, resolution matching, and runbooks alongside your monitoring data.',
    headline: 'Grafana shows you the fire. StdOut shows you the extinguisher.',
    subheadline: 'Dashboards are valuable. But when something is down, you need the fix — not another graph.',
    problem: 'Grafana is a phenomenal visualization tool, and you should probably keep using it. But dashboards don\'t fix incidents. When an alert fires, you open Grafana, identify the metric that spiked, and then... start searching for the fix. Grafana has no concept of incident history, resolution tracking, or operational knowledge management.',
    solution: 'StdOut isn\'t a Grafana replacement — it\'s the layer that Grafana is missing. Keep your dashboards. Add incident tracking, resolution history, and AI diagnosis on top. When Grafana shows you the spike, StdOut shows you the last three times that spike happened and how you resolved it. They\'re complementary, not competitive.',
    features: [
      'Complements Grafana with incident tracking and resolution history',
      'AI diagnosis incorporates monitoring context',
      'Resolution matching across similar metric patterns',
      'Living runbooks linked to alert conditions',
      'Full-text search for past incidents by symptom or metric',
      'Self-hosted — same infrastructure as your Grafana instance'
    ],
    keywords: ['grafana alternative', 'grafana incident management', 'monitoring with incident tracking', 'grafana companion tool', 'grafana plus incident resolution'],
    category: 'monitoring',
    relatedSlugs: ['stdout-prometheus-integration', 'stdout-influxdb-monitoring', 'self-hosted-monitoring-dashboard']
  },
  {
    slug: 'stdout-uptime-kuma-integration',
    title: 'StdOut + Uptime Kuma — Uptime Monitoring with Incident Memory',
    metaDescription: 'Pair Uptime Kuma\'s monitoring with StdOut\'s incident tracking. Auto-log downtime, get AI diagnosis, and build runbooks. Self-hosted, $149 one-time.',
    headline: 'Uptime Kuma watches your services. StdOut remembers how to fix them.',
    subheadline: 'When Uptime Kuma detects downtime, StdOut logs the incident and surfaces how you fixed it before.',
    problem: 'Uptime Kuma is a great self-hosted monitoring tool. It tells you when something is down and sends notifications. But that\'s where it stops. After the alert, you\'re on your own — opening terminals, checking logs, and hoping you remember the fix. Uptime Kuma doesn\'t track what caused the downtime or how you resolved it.',
    solution: 'StdOut extends Uptime Kuma\'s monitoring with incident tracking and resolution history. When a service goes down, log the incident in StdOut with the Uptime Kuma alert context. AI diagnosis considers your stack topology and past downtime incidents. The fix you apply tonight becomes the instant answer for next time. Two self-hosted tools, one workflow.',
    features: [
      'Extends Uptime Kuma with incident tracking and resolution history',
      'StdOut HUD provides independent service monitoring',
      'AI diagnosis for downtime incidents with stack context',
      'Resolution history for recurring downtime patterns',
      'Both tools self-hosted on your own hardware',
      'Public status page as built-in alternative to Uptime Kuma status'
    ],
    keywords: ['uptime kuma integration', 'uptime kuma incident tracking', 'self-hosted uptime monitoring', 'uptime kuma companion', 'uptime monitoring with runbooks'],
    category: 'monitoring',
    relatedSlugs: ['self-hosted-monitoring-dashboard', 'stdout-vs-uptime-kuma', 'stdout-for-homelab']
  },
  {
    slug: 'stdout-influxdb-monitoring',
    title: 'StdOut + InfluxDB — Time-Series Data Meets Incident Tracking',
    metaDescription: 'Connect InfluxDB to StdOut for AI incident diagnosis with time-series context. Correlate metrics with incidents and resolutions. Self-hosted, $149.',
    headline: 'InfluxDB stores your metrics. StdOut turns them into incident intelligence.',
    subheadline: 'Time-series data is only valuable if you can connect it to what went wrong and how you fixed it.',
    problem: 'InfluxDB gives you detailed time-series data — CPU, memory, disk, network, application metrics — but no framework for connecting metrics to incidents. When a metric crosses a threshold, you create an alert. When the alert fires, you diagnose manually. The connection between "disk I/O spiked" and "Plex was transcoding 4K while a backup ran" lives in your memory, not in any system.',
    solution: 'StdOut pulls InfluxDB metrics into your incident context, giving AI diagnosis access to real time-series data alongside your stack topology and resolution history. Incidents get diagnosed with metric awareness: "Last time disk I/O spiked like this, the root cause was concurrent transcoding and backup." That pattern gets saved and surfaced automatically.',
    features: [
      'InfluxDB as a data source for incident context',
      'AI diagnosis with time-series metric awareness',
      'Correlate metric patterns with incident history',
      'Resolution tracking linked to metric thresholds',
      'Stack context includes InfluxDB topology',
      'Self-hosted — metrics never leave your network'
    ],
    keywords: ['influxdb incident management', 'influxdb monitoring', 'influxdb integration', 'time-series incident tracking', 'influxdb troubleshooting'],
    category: 'monitoring',
    relatedSlugs: ['stdout-prometheus-integration', 'stdout-grafana-alternative', 'self-hosted-monitoring-dashboard']
  },
  {
    slug: 'stdout-trivy-vulnerability-management',
    title: 'StdOut + Trivy — Vulnerability Scanning Meets Incident Tracking',
    metaDescription: 'Connect Trivy vulnerability scans to StdOut for tracked remediation. AI-assisted CVE diagnosis and resolution history. Self-hosted, $149 one-time.',
    headline: 'Trivy finds vulnerabilities. StdOut tracks the remediation.',
    subheadline: 'Vulnerability scanners produce reports. StdOut turns those reports into tracked, searchable remediation records.',
    problem: 'Trivy scans your container images and finds CVEs. You read the report, update the images that matter, and move on. Three weeks later, Trivy finds similar CVEs in different images. You repeat the same analysis: is this exploitable in our context? Can we update the base image? Is there a workaround? That analysis isn\'t saved anywhere.',
    solution: 'StdOut integrates with Trivy as a data source, treating vulnerability findings as incidents that deserve tracking. When Trivy reports a CVE, log it in StdOut with the scan context. AI diagnosis considers whether similar vulnerabilities have been resolved before and how. Your remediation decisions become searchable institutional knowledge.',
    features: [
      'Trivy as a data source for vulnerability context',
      'Track CVE remediation as searchable incidents',
      'AI diagnosis considers past vulnerability resolutions',
      'Resolution history prevents repeated analysis',
      'Tag incidents by CVE, image, or severity',
      'Self-hosted — scan results stay on your network'
    ],
    keywords: ['trivy integration', 'vulnerability management tool', 'CVE tracking', 'container security scanning', 'vulnerability remediation tracking'],
    category: 'monitoring',
    relatedSlugs: ['stdout-crowdsec-integration', 'self-hosted-security-incident-response', 'docker-incident-management']
  },
  {
    slug: 'stdout-loki-log-analysis',
    title: 'StdOut + Loki — Log Aggregation Meets Incident Memory',
    metaDescription: 'Connect Grafana Loki to StdOut for AI-assisted log analysis during incidents. Correlate log patterns with resolution history. Self-hosted, $149.',
    headline: 'Loki stores your logs. StdOut connects them to solutions.',
    subheadline: 'Log aggregation is step one. Knowing what those log patterns mean — and how you fixed them before — is step two.',
    problem: 'Loki gives you centralized log aggregation and querying. But logs alone don\'t solve incidents. You query Loki for the error, find the relevant log lines, and then start the real work: figuring out what went wrong and how to fix it. That diagnosis process — the connection between log pattern and root cause — isn\'t captured anywhere.',
    solution: 'StdOut integrates with Loki as a data source, pulling relevant log context into incident diagnosis. When you log an incident, AI can reference Loki log patterns alongside your stack topology and past resolutions. The pattern "these Loki log entries always mean X, and the fix is Y" becomes permanent, searchable knowledge.',
    features: [
      'Loki as a data source for log-enriched incident context',
      'AI diagnosis references log patterns during analysis',
      'Correlate Loki queries with incident resolution history',
      'Resolution tracking linked to specific log signatures',
      'Full-text search across incidents includes log context',
      'Self-hosted — log data stays in your infrastructure'
    ],
    keywords: ['loki log analysis', 'grafana loki integration', 'log aggregation incident tracking', 'loki troubleshooting', 'log-based incident management'],
    category: 'monitoring',
    relatedSlugs: ['stdout-prometheus-integration', 'stdout-grafana-alternative', 'stdout-influxdb-monitoring']
  },

  // ── Security ────────────────────────────────────
  {
    slug: 'stdout-crowdsec-integration',
    title: 'StdOut + CrowdSec — Security Incident Tracking',
    metaDescription: 'Track CrowdSec security alerts as incidents in StdOut. AI diagnosis for attack patterns, resolution history for IP bans and firewall rules. $149 one-time.',
    headline: 'CrowdSec blocks the threats. StdOut tracks the incidents.',
    subheadline: 'Security events deserve incident tracking too. Know what was blocked, why, and what you did about the ones that got through.',
    problem: 'CrowdSec detects and blocks malicious traffic using crowd-sourced threat intelligence. But security events don\'t exist in isolation — brute force attempts, port scans, and exploit probes are incidents that deserve tracking, analysis, and documentation. CrowdSec\'s dashboard shows what was blocked, but it doesn\'t capture your investigation, escalation decisions, or remediation actions.',
    solution: 'StdOut treats CrowdSec alerts as security incidents. When CrowdSec detects unusual activity, log it in StdOut with the alert context. AI diagnosis considers your network topology, past security incidents, and CrowdSec ban history. Build runbooks for security response — which IPs to permanently ban, which services to harden, which alerts to investigate versus ignore.',
    features: [
      'CrowdSec as a data source for security incident context',
      'Track security events alongside infrastructure incidents',
      'AI diagnosis for attack pattern analysis',
      'Resolution history for IP bans and firewall changes',
      'Runbooks for security incident response procedures',
      'Self-hosted — security data never leaves your network'
    ],
    keywords: ['crowdsec integration', 'crowdsec incident tracking', 'security incident management', 'self-hosted security tool', 'crowdsec monitoring'],
    category: 'security',
    relatedSlugs: ['self-hosted-security-incident-response', 'stdout-trivy-vulnerability-management', 'stdout-for-homelab']
  },
  {
    slug: 'self-hosted-security-incident-response',
    title: 'Self-Hosted Security Incident Response — Track and Resolve',
    metaDescription: 'Track security incidents in your self-hosted infrastructure. AI diagnosis for attack patterns, resolution history, and security runbooks. $149 one-time.',
    headline: 'Security incidents in your homelab deserve real tracking.',
    subheadline: 'Brute force attempts, unauthorized access, CVE exploits — log them, analyze them, and build a security playbook.',
    problem: 'Self-hosters face real security threats: brute force attacks on exposed services, unpatched vulnerabilities in container images, misconfigured firewalls, and certificate expirations. Most handle security events informally — block the IP, update the container, move on. There\'s no record of what happened, what the impact was, or whether the mitigation actually worked.',
    solution: 'StdOut brings structured incident response to self-hosted security. Log security events with full context: what was detected, how it was investigated, what remediation was applied. AI diagnosis considers your network topology and past security incidents. Build security runbooks that codify your response procedures for common attack patterns.',
    features: [
      'Structured security incident tracking',
      'AI diagnosis for attack pattern analysis',
      'Resolution history for security remediations',
      'Security runbooks for response procedures',
      'Tag incidents by attack type, source, and severity',
      'Self-hosted — security incident data stays private'
    ],
    keywords: ['self-hosted security incident response', 'homelab security tool', 'security incident tracking', 'incident response for self-hosters', 'security runbooks'],
    category: 'security',
    relatedSlugs: ['stdout-crowdsec-integration', 'stdout-trivy-vulnerability-management', 'stdout-for-homelab']
  },

  // ── Comparison ──────────────────────────────────
  {
    slug: 'stdout-vs-pagerduty',
    title: 'StdOut vs PagerDuty — Incident Management for Solo Engineers',
    metaDescription: 'StdOut vs PagerDuty: one is built for enterprise teams with rotations. The other is built for solo engineers who run their own infrastructure. Compare them.',
    headline: 'PagerDuty is built for teams. StdOut is built for you.',
    subheadline: 'Different tools for different scales. Here\'s an honest comparison.',
    problem: 'PagerDuty is the industry standard for enterprise incident management. It handles on-call rotations, escalation policies, multi-team coordination, and integrations with every monitoring tool imaginable. It\'s also $21+/user/month, requires team setup, and assumes you have separate people to escalate to. If you\'re a solo engineer or small team managing your own infrastructure, PagerDuty\'s overhead doesn\'t match your reality.',
    solution: 'StdOut takes a different approach. Instead of team coordination, it focuses on incident memory — the ability to search your resolution history, get AI diagnosis with your specific stack context, and build runbooks from your actual fixes. There are no rotations because there\'s nobody to rotate to. There\'s no per-seat pricing because there\'s one seat. $149 once versus $252+/year. Different problems, different tools.',
    features: [
      'One-time $149 vs PagerDuty\'s $21+/user/month',
      'AI diagnosis with your specific stack context',
      'Resolution history and searchable knowledge base',
      'Self-hosted — no data leaves your infrastructure',
      'No per-seat pricing or team setup required',
      'Living runbooks built from your actual fixes'
    ],
    keywords: ['stdout vs pagerduty', 'pagerduty alternative', 'pagerduty for solo engineers', 'cheap pagerduty alternative', 'self-hosted pagerduty alternative'],
    category: 'comparison',
    relatedSlugs: ['stdout-vs-betterstack', 'solo-devops-incident-management', 'stdout-vs-statuspage']
  },
  {
    slug: 'stdout-vs-betterstack',
    title: 'StdOut vs Better Stack — Self-Hosted vs Cloud Monitoring',
    metaDescription: 'StdOut vs Better Stack: self-hosted incident companion with AI diagnosis vs cloud-based monitoring platform. Compare pricing, features, and approach.',
    headline: 'Better Stack runs in their cloud. StdOut runs on your hardware.',
    subheadline: 'Both solve incident management. One gives you the data. The other gives you control.',
    problem: 'Better Stack (formerly Logtail + Uptime) offers a unified monitoring platform with uptime monitoring, log management, and incident tracking. It\'s well-designed and affordable at $29/month for the starter tier. But it\'s SaaS — your logs, metrics, and incident data live on their servers. If you\'re self-hosting because you value data ownership, sending your operational data to a third party defeats the purpose.',
    solution: 'StdOut is self-hosted from the ground up. Your incident data, resolution history, and stack topology never leave your network. Better Stack is better at log aggregation and has more polished dashboards — that\'s fair. StdOut is better at AI-powered diagnosis with your specific context, resolution matching from your history, and living runbooks. If you\'re already self-hosting, StdOut fits your philosophy. $149 once versus $348+/year.',
    features: [
      'Self-hosted — all data stays on your infrastructure',
      'One-time $149 vs Better Stack\'s $29+/month',
      'AI diagnosis with your specific stack context',
      'Resolution history and knowledge base',
      'No log ingestion limits or data retention caps',
      'Docker Compose deployment on your hardware'
    ],
    keywords: ['stdout vs betterstack', 'betterstack alternative', 'better stack alternative', 'self-hosted monitoring alternative', 'betterstack self-hosted'],
    category: 'comparison',
    relatedSlugs: ['stdout-vs-pagerduty', 'stdout-vs-uptime-kuma', 'self-hosted-monitoring-dashboard']
  },
  {
    slug: 'stdout-vs-uptime-kuma',
    title: 'StdOut vs Uptime Kuma — Monitoring Plus Incident Memory',
    metaDescription: 'StdOut vs Uptime Kuma: both are self-hosted. Uptime Kuma monitors uptime. StdOut adds AI diagnosis, resolution tracking, and runbooks on top. Compare them.',
    headline: 'Uptime Kuma tells you it\'s down. StdOut tells you how to fix it.',
    subheadline: 'They\'re complementary, not competitive. Here\'s when to use each — or both.',
    problem: 'Uptime Kuma is one of the best self-hosted monitoring tools available — and it\'s free. It monitors HTTP, TCP, DNS, and more, sends notifications through dozens of channels, and has a beautiful status page. But Uptime Kuma stops at detection. It tells you something is down. It doesn\'t help you figure out why, track how you fixed it, or remember the solution for next time.',
    solution: 'StdOut and Uptime Kuma solve different halves of the same problem. Uptime Kuma excels at detection and notification — keep using it. StdOut excels at diagnosis, resolution tracking, and knowledge management. When Uptime Kuma alerts you that nginx is down, StdOut shows you the last three times nginx went down and what fixed it. Use both. They\'re both self-hosted, both respect your data, and both cost less than a month of any SaaS alternative.',
    features: [
      'Use alongside Uptime Kuma — complementary, not competitive',
      'AI diagnosis goes beyond uptime detection',
      'Resolution tracking Uptime Kuma doesn\'t provide',
      'Living runbooks linked to monitoring alerts',
      'Stack auto-discovery maps your entire infrastructure',
      'StdOut HUD also provides independent service monitoring'
    ],
    keywords: ['stdout vs uptime kuma', 'uptime kuma alternative', 'uptime kuma incident tracking', 'uptime kuma companion', 'self-hosted monitoring comparison'],
    category: 'comparison',
    relatedSlugs: ['stdout-uptime-kuma-integration', 'stdout-vs-betterstack', 'self-hosted-monitoring-dashboard']
  },
  {
    slug: 'stdout-vs-statuspage',
    title: 'StdOut vs Statuspage — Self-Hosted Status with Incident Memory',
    metaDescription: 'StdOut vs Atlassian Statuspage: self-hosted status page with AI diagnosis and resolution tracking vs cloud-only status communication. Compare them.',
    headline: 'Statuspage communicates outages. StdOut solves them.',
    subheadline: 'Atlassian\'s Statuspage is for communication. StdOut is for resolution. You might need both — or just StdOut.',
    problem: 'Atlassian Statuspage ($29+/month) is a communication tool. It tells your users that something is down and when it\'s expected to be fixed. It doesn\'t help you fix anything — it\'s purely outward-facing. You still need a separate system for incident tracking, diagnosis, and resolution management. For solo engineers and small teams, paying $348+/year just to display a green/red status feels excessive when the real problem is fixing the incidents.',
    solution: 'StdOut includes a public status page as a built-in feature, not a separate product. But more importantly, it solves the problem behind the status page: figuring out what\'s wrong, finding the fix, and preventing the same incident from recurring. Your HUD monitors services, auto-creates incidents on downtime, and surfaces past resolutions. The status page updates from the same system that manages the incident. $149 once versus $348+/year for Statuspage alone.',
    features: [
      'Built-in public status page — no separate product needed',
      'Status page connected to actual incident resolution',
      'AI diagnosis and resolution matching included',
      'HUD monitoring with automatic incident creation',
      'One-time $149 vs Statuspage\'s $29+/month',
      'Self-hosted — status page runs on your infrastructure'
    ],
    keywords: ['stdout vs statuspage', 'statuspage alternative', 'atlassian statuspage alternative', 'self-hosted status page', 'free status page with incident tracking'],
    category: 'comparison',
    relatedSlugs: ['stdout-vs-pagerduty', 'stdout-vs-betterstack', 'self-hosted-monitoring-dashboard']
  },
];

export function getUseCasesByCategory(category: UseCase['category']): UseCase[] {
  return useCases.filter(uc => uc.category === category);
}

export function getRelatedUseCases(slug: string): UseCase[] {
  const current = useCases.find(uc => uc.slug === slug);
  if (!current) return [];
  return current.relatedSlugs
    .map(s => useCases.find(uc => uc.slug === s))
    .filter((uc): uc is UseCase => uc !== undefined);
}

export const categoryLabels: Record<UseCase['category'], string> = {
  homelab: 'Homelab',
  devops: 'DevOps',
  monitoring: 'Monitoring Integrations',
  security: 'Security',
  comparison: 'Comparisons',
};

export const categoryDescriptions: Record<UseCase['category'], string> = {
  homelab: 'Built for self-hosters who run their own infrastructure.',
  devops: 'Incident management designed for solo engineers and small teams.',
  monitoring: 'Connect StdOut to the monitoring tools you already use.',
  security: 'Track and resolve security incidents in your self-hosted infrastructure.',
  comparison: 'How StdOut compares to the tools you might already know.',
};
