import { ServiceItem, WorkStep, FAQItem, CostCategory, DiagnosticFinding } from '../types';

export const COMPANY_NAME = 'CyraOps';

export const HERO_CONTENT = {
  eyebrow: 'MANAGED AWS CLOUD OPERATIONS',
  statusBadge: 'AWS Cloud Operations Partner',
  headline: 'Your cloud should run quietly in the background.',
  subhead:
    'We help startups and small businesses keep AWS reliable, monitored, and cost-efficient — without hiring a full-time cloud engineer.',
  primaryCta: 'Get an AWS Cloud Health Check',
  secondaryCta: 'Explore our services',
  trustLine: 'AWS operations • Monitoring • Cost optimization • Infrastructure support',
  nodeLabels: [
    { id: 'compute', name: 'COMPUTE', detail: 'EC2, ECS & Lambda Fleet Health', status: 'Optimal' },
    { id: 'storage', name: 'STORAGE', detail: 'S3 Buckets, EBS Lifecycle & IOPS', status: 'Healthy' },
    { id: 'monitoring', name: 'MONITORING', detail: 'CloudWatch Alarms & Telemetry', status: 'Active' },
    { id: 'backups', name: 'BACKUPS', detail: 'Automated Snapshots & Recovery Validation', status: 'Verified' },
    { id: 'cost', name: 'COST', detail: 'Spend Attribution & Idle Elimination', status: 'Audited' },
    { id: 'reliability', name: 'RELIABILITY', detail: 'Multi-AZ Availability & Circuit Breakers', status: 'Protected' },
  ]
};

export const PROBLEM_CONTENT = {
  headline: 'Cloud infrastructure becomes expensive and complicated faster than most small teams expect.',
  supportingCopy:
    'Unused resources, missing alerts, oversized instances, forgotten snapshots, unclear ownership, and reactive troubleshooting can quietly increase cost and operational risk.',
  unmanagedLabel: 'UNMANAGED INFRASTRUCTURE RISK',
  managedLabel: 'CYRAOPS OPERATIONAL SYSTEM',
  risks: [
    {
      id: 'idle',
      tag: 'IDLE RESOURCES',
      problem: 'Unattached EBS volumes, orphan Elastic IPs, and lingering staging compute running 24/7.',
      resolution: 'Automated lifecycle audits and scheduled decommission policies.'
    },
    {
      id: 'alerts',
      tag: 'MISSING ALERTS',
      problem: 'Discovering service outages from users instead of synthetic CloudWatch triggers.',
      resolution: 'Composite CloudWatch alarms linked to actionable priority channels.'
    },
    {
      id: 'spend',
      tag: 'CLOUD SPEND',
      problem: 'Quiet month-over-month bill creep without clear attribution or budget guardrails.',
      resolution: 'Cost anomaly detection, tagging enforcement, and right-sizing reviews.'
    },
    {
      id: 'backups',
      tag: 'BACKUP GAPS',
      problem: 'Snapshots created once and never tested for actual point-in-time restoration viability.',
      resolution: 'AWS Backup policies with documented recovery time objectives.'
    },
    {
      id: 'overhead',
      tag: 'OPERATIONAL OVERHEAD',
      problem: 'Senior product engineers losing focus to fight infrastructure fires and patching drift.',
      resolution: 'Dedicated operational stewardship so engineering builds products.'
    }
  ]
};

/**
 * The services portfolio, organized by pillar.
 *
 * Source: the Tech & Data Science Blueprint sheet (5 pillars, 22 service
 * categories). Two deliberate additions, both from the site's own live offer:
 *
 *  - "Managed Cloud Operations" (pillar 06). The sheet is entirely build-side,
 *    but monitoring, cost, maintenance, backup and incident support are what this
 *    business actually sells and prices (health check, Cloud Care). Publishing the
 *    sheet alone would have deleted the revenue line the rest of the page is built
 *    on. Remove that pillar only when those sections go too.
 *  - "Cloud Migration & Modernization" (pillar 03), which the site already sells
 *    and the sheet only implies.
 *
 * Wording follows the sheet but drops consultant-speak, expands acronyms
 * (MDM, NLP, CDP, IaC) and states the boundary where two categories overlap
 * (analytics vs ML engineering; governance vs quality automation; CX vs BI).
 */
/**
 * Solutions, grouped by outcome rather than by technology.
 *
 * Modelled on how data/AI consultancies actually structure their sites (Fractal
 * runs Solutions / Industries / Functions as three ways into the same portfolio):
 * a buyer arrives with a problem, not with a wish for "Operations Research".
 *
 * Every one of the 22 sheet services lives inside these four groups, so nothing
 * from the portfolio was dropped in the regroup; the groups just answer
 * "what do I get" before "what is it called".
 */
export const SERVICES_CONTENT: ServiceItem[] = [
  {
    id: 'decisions',
    number: '01',
    title: 'TURN DATA INTO DECISIONS',
    tagline: 'Make the data trustworthy, then make it useful.',
    description: 'Strategy, governance and analysis work that ends in a decision someone can act on — not a dashboard nobody opens.',
    deliverables: [
      'Enterprise Data Strategy',
      'Data Governance & Master Data Management (MDM)',
      'Decision Intelligence & Experimentation',
      'Business Intelligence & Dashboards',
      'Change Management & Adoption'
    ],
    metrics: 'Fewer projects that stall after the report'
  },
  {
    id: 'ai-production',
    number: '02',
    title: 'PUT AI INTO PRODUCTION',
    tagline: 'Models that survive contact with real data.',
    description: 'Forecasting, computer vision and language models — engineered, evaluated and monitored, with a human in the loop where it matters.',
    deliverables: [
      'Predictive & Prescriptive Analytics',
      'Machine Learning Engineering',
      'Generative AI & Agentic Workflows',
      'Computer Vision & Natural Language Processing (NLP)',
      'Operations Research',
      'MLOps'
    ],
    metrics: 'Accuracy measured before anything ships'
  },
  {
    id: 'platform',
    number: '03',
    title: 'BUILD THE PLATFORM',
    tagline: 'The foundation the models and the product sit on.',
    description: 'Pipelines, warehouse and cloud infrastructure that are documented, reproducible and priced for a lean team.',
    deliverables: [
      'Cloud Platform Architecture & Setup',
      'Cloud Migration & Modernization',
      'Data Warehouse & Lakehouse Design',
      'Automated Data Pipelines',
      'Data Quality Automation',
      'Infrastructure as Code (IaC)',
      'Containerization & Microservices',
      'Continuous Integration & Continuous Deployment (CI/CD)',
      'DevSecOps'
    ],
    metrics: 'Pipelines you can leave unattended for a week'
  },
  {
    id: 'run',
    number: '04',
    title: 'RUN IT RELIABLY',
    tagline: 'Someone accountable after go-live.',
    description: 'Ongoing operations across cloud, pipelines and models. Fixed monthly scope, response windows agreed in writing — the part most consultancies hand back to you.',
    deliverables: [
      'Monitoring & Alerting',
      'Cost Optimization (FinOps)',
      'Maintenance & Patching',
      'Backup & Disaster Recovery',
      'Incident Support',
      'Custom Application Development',
      'Customer Experience (CX) Tech',
      'Simulation & What-If Models'
    ],
    metrics: 'Quiet months, on purpose'
  }
];

/**
 * The second way in: by business function. A CFO searches for revenue
 * forecasting; a supply-chain lead searches for optimised routing.
 */
export const FUNCTIONS_CONTENT = [
  {
    title: 'Revenue & Growth',
    line: 'Pipeline you can forecast, churn you can see coming.',
    items: ['Demand forecasting', 'Churn scoring', 'Pricing analysis', 'Lead scoring models']
  },
  {
    title: 'Finance & Cost',
    line: 'Know what each system costs, and what it earns.',
    items: ['Cloud cost attribution', 'Unit economics reporting', 'Budget guardrails', 'Margin dashboards']
  },
  {
    title: 'Operations & Supply Chain',
    line: 'Decisions on routing, staffing and capacity.',
    items: ['Route optimization', 'Scheduling models', 'Capacity planning', 'What-if simulation']
  },
  {
    title: 'Customer & Support',
    line: 'Fewer tickets, faster answers, consistent quality.',
    items: ['Document intelligence', 'Support triage models', 'Knowledge-grounded assistants', 'Sentiment analysis']
  },
  {
    title: 'Product & Engineering',
    line: 'Ship the thing, then keep it running.',
    items: ['Application development', 'CI/CD and release automation', 'Model deployment', 'Reliability engineering']
  }
];

/** The third way in: by industry. Only the ones there is a real story for. */
export const INDUSTRIES_CONTENT = [
  { name: 'SaaS & Technology', line: 'Usage analytics, retention models, cloud cost control.' },
  { name: 'Logistics & Supply Chain', line: 'Routing, forecasting, warehouse automation, data platforms.' },
  { name: 'Financial Services', line: 'Risk models, fraud detection, governance and auditability.' },
  { name: 'Manufacturing', line: 'Quality vision, predictive maintenance, production simulation.' },
  { name: 'Professional Services', line: 'Delivery operations, utilisation reporting, AI-assisted workflows.' }
];

export const HEALTH_CHECK_CONTENT = {
  eyebrow: 'INITIAL ENGAGEMENT PRODUCT',
  headline: 'Start with clarity before committing to ongoing cloud support.',
  body:
    'Our AWS Cloud Health Check is a focused review of your cloud environment to identify avoidable costs, monitoring gaps, operational risks, and practical improvements.',
  priceNote: 'Starting at $150–$250',
  priceSub: 'One-time fixed assessment • No long-term commitment required',
  primaryCta: 'Book a Cloud Health Check',
  includes: [
    'EC2 / EBS / S3 review',
    'CloudWatch and monitoring review',
    'Backup and snapshot review',
    'Idle / underutilized resource identification',
    'Cost optimization opportunities',
    'Prioritized recommendations',
    'Short written report'
  ],
  sampleReport: {
    title: 'Sample Health Check Assessment Summary',
    badge: 'ILLUSTRATIVE AUDIT SCAN',
    status: 'COMPLETED • 14 CHECKS EXECUTED',
    findings: [
      {
        id: 'f1',
        node: 'STORAGE',
        severity: 'high' as const,
        title: '9 Unattached EBS Volumes & Aging Snapshots',
        detail: 'Discovered gp2 volumes preserved after terminated staging instances with no I/O for >45 days.',
        impact: 'Immediate low-risk deletion candidate'
      },
      {
        id: 'f2',
        node: 'MONITORING',
        severity: 'high' as const,
        title: 'Zero CloudWatch Alarms on Production RDS Database',
        detail: 'CPU, FreeableMemory, and DiskSpace metrics active but missing threshold alert channels.',
        impact: 'High operational risk during unexpected traffic spikes'
      },
      {
        id: 'f3',
        node: 'COMPUTE',
        severity: 'medium' as const,
        title: 'Over-provisioned EC2 Staging Fleet',
        detail: 'Three c5.2xlarge staging instances operating at <6% average weekly CPU utilization.',
        impact: 'Eligible for right-sizing down to t3/t4g series'
      },
      {
        id: 'f4',
        node: 'COST',
        severity: 'medium' as const,
        title: 'Unconfigured S3 Bucket Storage Tier Transitions',
        detail: 'Historical archive buckets (1.8 TB) retained in S3 Standard without Infrequent Access lifecycle.',
        impact: 'Ongoing recurring cost optimization candidate'
      }
    ]
  }
};

export const COST_DASHBOARD_CONTENT = {
  headline: 'Stop paying for infrastructure nobody is using.',
  subhead:
    'Explore common waste patterns in cloud environments. Use this interactive model to inspect how small operational adjustments eliminate silent cloud spend.',
  disclaimer: 'Illustrative example / demo data — not actual client numbers. Savings depend on actual environment.',
  ctaText: 'Find opportunities in my cloud environment',
  categories: [
    {
      id: 'compute',
      name: 'Compute (EC2 / ECS)',
      currentSpend: 1420,
      optimizedSpend: 910,
      wasteDrivers: ['Staging environments running outside business hours', 'Oversized legacy instance types (e.g. m4 vs t4g/c6i)', 'Idle development worker processes'],
      action: 'Right-size compute tiers & configure scheduled automated sleep cycles.'
    },
    {
      id: 'storage',
      name: 'Storage (EBS & S3)',
      currentSpend: 680,
      optimizedSpend: 390,
      wasteDrivers: ['Unattached volumes from terminated instances', 'Untiered historical log buckets', 'Dozens of obsolete weekly root snapshots'],
      action: 'Establish S3 lifecycle transition to Glacier and prune orphaned EBS volumes.'
    },
    {
      id: 'database',
      name: 'Database (RDS)',
      currentSpend: 890,
      optimizedSpend: 640,
      wasteDrivers: ['Multi-AZ provisioned on non-production test databases', 'Excessive unutilized provisioned IOPS'],
      action: 'Convert dev databases to Single-AZ and calibrate storage auto-scaling.'
    },
    {
      id: 'network',
      name: 'Network & Egress',
      currentSpend: 410,
      optimizedSpend: 280,
      wasteDrivers: ['Inter-AZ data transfer between microservices', 'Redundant NAT Gateway in unused public subnets'],
      action: 'Consolidate routing tables and prune unattached Elastic IP charges.'
    },
    {
      id: 'monitoring',
      name: 'Monitoring & Logs',
      currentSpend: 240,
      optimizedSpend: 140,
      wasteDrivers: ['CloudWatch logs retained indefinitely at full ingest cost', 'Excessive debug telemetry in production'],
      action: 'Set 30-day retention limits on application log groups and archive to S3.'
    }
  ]
};

export const MANAGED_CARE_CONTENT = {
  headline: 'Your team builds the product. We help keep the cloud running.',
  startingPrice: 'Starting at $750/month',
  subText: 'depending on scope',
  includedItems: [
    'Ongoing monitoring',
    'Monthly cloud-health review',
    'Cost optimization reviews',
    'Routine operational support',
    'Backup / snapshot checks',
    'Approved maintenance and troubleshooting',
    'Monthly reporting'
  ],
  scopeNote:
    'Plans are tailored to infrastructure size, environments, support expectations, and required response times. 24/7 support is not included unless explicitly agreed.',
  scaleNote:
    'Broader managed cloud operations can scale to $1,000–$2,000+/month depending on scope, multi-account topology, and operational SLA needs.'
};

export const HOW_WE_WORK_CONTENT: WorkStep[] = [
  {
    step: '01',
    title: 'DISCOVER',
    description: 'Understand your current systems — cloud, data and models — along with the pain points, priorities and constraints that matter.',
    outputs: ['Scope boundary definition', 'Read-only access provisioning', 'Inventory of active workloads'],
    systemState: 'Topological Mapping'
  },
  {
    step: '02',
    title: 'DIAGNOSE',
    description: 'Review infrastructure, monitoring, costs, and operational gaps.',
    outputs: ['CloudWatch alarm inspection', 'Cost anomaly scan', 'Backup verification check'],
    systemState: 'Deep System Audit'
  },
  {
    step: '03',
    title: 'PRIORITIZE',
    description: 'Separate urgent issues from optimization opportunities and nice-to-have improvements.',
    outputs: ['P0/P1 risk categorization', 'Action item roadmaps', 'Clear ROI & effort estimations'],
    systemState: 'Strategic Ranking'
  },
  {
    step: '04',
    title: 'IMPLEMENT',
    description: 'Make approved changes carefully and document what changed.',
    outputs: ['Maintenance window execution', 'Rollback safeguards', 'Updated operational runbooks'],
    systemState: 'Controlled Execution'
  },
  {
    step: '05',
    title: 'OPERATE',
    description: 'Continue monitoring, reviewing, optimizing, and reporting.',
    outputs: ['Monthly health scorecard', 'Alert triage & incident support', 'Continuous cost tracking'],
    systemState: 'Steady-State Stewardship'
  }
];

export const WHY_US_CONTENT = {
  headline: 'Cloud, data and AI. Delivered, then operated.',
  points: [
    {
      title: 'Advisory and execution in one team.',
      detail: 'A strategy deck does not run in production. We stay to build and operate what we recommend — cloud, data and AI — instead of handing over a report and leaving.'
    },
    {
      title: 'Cost awareness is part of ongoing operations.',
      detail: 'Resource efficiency is not a one-time gimmick; every maintenance task, scaling adjustment, and architecture tweak is performed with cost impact in mind.'
    },
    {
      title: 'Clear scope and documented changes.',
      detail: 'No mystery configurations. Every update, script, and policy change is tracked, approved, and clearly documented so your team maintains full ownership.'
    },
    {
      title: 'Designed for teams that do not need a full-time cloud engineer.',
      detail: 'Small engineering teams do not need a $180k/year in-house DevOps engineer just to manage basic cloud infrastructure and alerts. You get experienced operational care on demand.'
    },
    {
      title: 'Start small with a health check before moving into ongoing support.',
      detail: 'Low-risk starting point. Test our depth, communication, and technical rigor with a fixed-scope Cloud Health Check before deciding on ongoing support.'
    }
  ]
};

export const FAQ_CONTENT: FAQItem[] = [
  {
    question: 'Which cloud platforms and tools do you work across?',
    answer:
      'AWS, Microsoft Azure and Google Cloud for infrastructure and operations. Snowflake, Databricks and Amazon Redshift for warehouse and lakehouse work. Terraform, Kubernetes and standard CI tooling for delivery. The stack is chosen per engagement, not by vendor relationship.'
  },
  {
    question: 'Do I need to give you full AWS access?',
    answer:
      "Not necessarily. Access should be limited to what is required for the agreed scope, using appropriate permissions and the client's security practices."
  },
  {
    question: 'Can you reduce my AWS bill?',
    answer:
      'We can identify optimization opportunities, but savings depend on the actual environment. We do not promise a specific percentage before reviewing the infrastructure.'
  },
  {
    question: 'Do you provide 24/7 support?',
    answer:
      'Not by default. Support windows and response times are defined in the agreed service scope.'
  },
  {
    question: 'Can you manage production infrastructure?',
    answer:
      'Yes, where the required scope, access, change process, and responsibilities are clearly defined in advance.'
  },
  {
    question: 'Can we start with a small project?',
    answer:
      'Yes. The AWS Cloud Health Check is designed as a low-risk starting engagement.'
  },
  {
    question: 'Do you handle migrations?',
    answer:
      'Yes, migration and implementation support can be provided based on the workload and scope.'
  }
];

export const FINAL_CTA_CONTENT = {
  headline: "Let's make your stack easier to run.",
  subhead: "Tell us what you're running, what is hurting, and what you want to improve. We'll start with the smallest useful step.",
  primaryCta: 'Get an AWS Cloud Health Check',
  secondaryCta: 'Talk about ongoing cloud operations'
};

export const NAV_LINKS = [
  { label: 'Services',      href: '#services' },
  { label: 'Health Check',  href: '#health-check' },
  { label: 'How We Work',   href: '#how-we-work' },
  { label: 'Why Us',        href: '#why-us' },
  { label: 'FAQ',           href: '#faq' },
  { label: 'Contact',       href: '#contact' },
];
