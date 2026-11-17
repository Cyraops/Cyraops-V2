import { db } from "../src/lib/db";

async function seedCommandCenter() {
  console.log("Seeding Cyraops Business Command Center data into company_os_dev...");

  const user = await db.user.findFirst({ where: { role: "OWNER" } });
  if (!user) {
    throw new Error("No owner user found in database");
  }

  // 1. Seed or update 13 IT Service Capabilities
  const capabilities = [
    {
      name: "Cloud Operations & Support",
      category: "Cloud & Infrastructure",
      description: "Day-to-day AWS/Azure cloud infrastructure monitoring, patching, backup verification, and incident management.",
      requiredExpertise: "AWS SysOps, Linux, CloudWatch, Terraform, Incident Response",
      minRequiredEngineers: 2,
      deliveryReadiness: "CONDITIONAL_PARTNER",
      verifiedProjectsCount: 2,
      portfolioEvidence: "Delivered 99.9% uptime SLA for SaaS client on AWS ECS & RDS.",
      notes: "Requires dedicated 24/7 on-call rotation to unlock tier-1 enterprise SLA contracts."
    },
    {
      name: "Cloud Migration",
      category: "Cloud & Infrastructure",
      description: "Lift-and-shift, re-platforming, and database migration from on-premise or co-lo to hyperscale cloud.",
      requiredExpertise: "AWS MGN, Azure Migrate, CloudEndure, Database Migration Service (DMS)",
      minRequiredEngineers: 2,
      deliveryReadiness: "NOT_READY",
      verifiedProjectsCount: 0,
      portfolioEvidence: null,
      notes: "Missing dedicated database migration specialist. Require external partner for large legacy migrations."
    },
    {
      name: "Cloud Architecture & Consulting",
      category: "Cloud & Infrastructure",
      description: "Well-Architected reviews, multi-account AWS Organizations landing zones, cost optimization, and resilience design.",
      requiredExpertise: "AWS Solutions Architect Professional, Multi-Account Strategy, Transit Gateway, VPC Peering",
      minRequiredEngineers: 1,
      deliveryReadiness: "PRODUCTION_READY",
      verifiedProjectsCount: 4,
      portfolioEvidence: "Designed multi-tier AWS landing zone with Control Tower and IAM Identity Center for enterprise client.",
      notes: "High demand capability, team is fully qualified."
    },
    {
      name: "DevOps Implementation",
      category: "DevOps & Automation",
      description: "Release engineering, branch strategy, environments provisioning, and developer productivity tooling.",
      requiredExpertise: "GitOps, Docker, Trunk-Based Development, Artifact Registries",
      minRequiredEngineers: 2,
      deliveryReadiness: "PRODUCTION_READY",
      verifiedProjectsCount: 5,
      portfolioEvidence: "Automated deployment lifecycle reducing release cycle from 3 days to 25 minutes.",
      notes: "Strong delivery capability."
    },
    {
      name: "CI/CD Pipeline Automation",
      category: "DevOps & Automation",
      description: "Design and maintenance of automated test, build, lint, and deployment pipelines.",
      requiredExpertise: "GitHub Actions, GitLab CI, ArgoCD, SonarQube, Semantic Versioning",
      minRequiredEngineers: 1,
      deliveryReadiness: "PRODUCTION_READY",
      verifiedProjectsCount: 6,
      portfolioEvidence: "Built GitHub Actions matrix pipelines with automated security scanning and container publishing.",
      notes: "Core strength."
    },
    {
      name: "Infrastructure as Code (Terraform / Pulumi)",
      category: "DevOps & Automation",
      description: "Declarative infrastructure automation, modular codebases, state management, and policy-as-code.",
      requiredExpertise: "Terraform 1.x, Terragrunt, TFLint, AWS Provider, State Locking & Remote Backends",
      minRequiredEngineers: 2,
      deliveryReadiness: "PRODUCTION_READY",
      verifiedProjectsCount: 7,
      portfolioEvidence: "100% Terraform coverage across 14 VPCs with automated plan reviews in PRs.",
      notes: "Primary engineering strength."
    },
    {
      name: "Linux System Administration",
      category: "Systems & Platforms",
      description: "Enterprise Linux administration, kernel optimization, systemd services, SSH hardening, and performance profiling.",
      requiredExpertise: "RHEL, Ubuntu Server, Bash Scripting, Performance Tuning, Security Hardening",
      minRequiredEngineers: 1,
      deliveryReadiness: "PRODUCTION_READY",
      verifiedProjectsCount: 8,
      portfolioEvidence: "Managed fleet of 80+ Linux servers with Ansible automated configuration.",
      notes: "Strong foundational competency."
    },
    {
      name: "Monitoring, Observability & APM",
      category: "Site Reliability",
      description: "Metrics, logs, traces, distributed tracing, dashboarding, and alerting.",
      requiredExpertise: "Prometheus, Grafana, Datadog, CloudWatch, OpenTelemetry, Alertmanager",
      minRequiredEngineers: 1,
      deliveryReadiness: "CONDITIONAL_PARTNER",
      verifiedProjectsCount: 2,
      portfolioEvidence: "Configured unified Grafana dashboard combining AWS CloudWatch metrics and synthetic uptime monitors.",
      notes: "Alerting is implemented, but 24/7 human incident response triage is missing."
    },
    {
      name: "Kubernetes & Container Orchestration",
      category: "Cloud Native",
      description: "Production Kubernetes cluster deployment, Helm chart packaging, ingress controllers, service meshes, and auto-scaling.",
      requiredExpertise: "Kubernetes CKA/CKS, Helm, EKS/GKE, Karpenter, Istio/Linkerd, Cert-Manager",
      minRequiredEngineers: 2,
      deliveryReadiness: "NOT_READY",
      verifiedProjectsCount: 0,
      portfolioEvidence: null,
      notes: "Team has theoretical container knowledge, but lacks verified multi-cluster production delivery experience. Critical gap for enterprise bids."
    },
    {
      name: "Database Administration & Optimization",
      category: "Data & Storage",
      description: "Relational and NoSQL database management, query optimization, indexing, point-in-time recovery, and replication.",
      requiredExpertise: "PostgreSQL, MySQL, Redis, DynamoDB, Query Profiling, Disaster Recovery",
      minRequiredEngineers: 1,
      deliveryReadiness: "CONDITIONAL_PARTNER",
      verifiedProjectsCount: 1,
      portfolioEvidence: "Migrated standalone PostgreSQL to AWS RDS Aurora Multi-AZ with zero downtime.",
      notes: "Competent on standard managed databases; complex sharding or high-throughput tuning requires external advisory."
    },
    {
      name: "Cloud Security & Compliance",
      category: "Security & Governance",
      description: "Cloud security posture management (CSPM), IAM least privilege, compliance frameworks (SOC 2, ISO 27001, HIPAA).",
      requiredExpertise: "AWS Security Hub, GuardDuty, IAM Policy Analysis, CIS Benchmarks, SOC 2 Type II Preparation",
      minRequiredEngineers: 1,
      deliveryReadiness: "NOT_READY",
      verifiedProjectsCount: 0,
      portfolioEvidence: null,
      notes: "No verified compliance certifications (e.g. CISSP, CCSP) on staff. Disqualifies Cyraops from regulated enterprise bids."
    },
    {
      name: "AI Integration & Automation",
      category: "AI & Emerging Tech",
      description: "Agentic workflow development, LLM API orchestration (DeepSeek), vector search, tool calling, and workflow automation.",
      requiredExpertise: "DeepSeek API, Agent Tool Calling, Vector Embeddings, Task Orchestration, TypeScript/Python",
      minRequiredEngineers: 1,
      deliveryReadiness: "PRODUCTION_READY",
      verifiedProjectsCount: 3,
      portfolioEvidence: "Built Cyraops autonomous agentic CRM with browser automation and durable task recovery.",
      notes: "Differentiating competitive advantage."
    },
    {
      name: "Custom Software Development",
      category: "Application Engineering",
      description: "Full-stack web applications, internal tools, microservices, and CRM/ERP integrations.",
      requiredExpertise: "Next.js, React, Node.js, TypeScript, REST & GraphQL APIs, Prisma ORM",
      minRequiredEngineers: 2,
      deliveryReadiness: "PRODUCTION_READY",
      verifiedProjectsCount: 5,
      portfolioEvidence: "Delivered multiple production SaaS and internal management web platforms.",
      notes: "Core engineering foundation."
    }
  ];

  for (const cap of capabilities) {
    await db.serviceCapability.upsert({
      where: { name: cap.name },
      update: cap,
      create: cap,
    });
  }
  console.log(`Synced ${capabilities.length} IT Service Capabilities.`);

  // 2. Seed Team Skills for Owner
  const skills = [
    { skillName: "AWS Cloud Architecture", category: "Cloud & Infrastructure", level: "EXPERT", yearsExperience: 5.5, verified: true, verifiedBy: "Management Audit", deliveryCount: 6, evidenceUrl: "https://aws.amazon.com/verification" },
    { skillName: "Terraform & IaC Automation", category: "DevOps & Automation", level: "EXPERT", yearsExperience: 4.5, verified: true, verifiedBy: "Management Audit", deliveryCount: 7, evidenceUrl: "https://github.com/cyraops/terraform-modules" },
    { skillName: "Linux Server Administration", category: "Systems & Platforms", level: "ADVANCED", yearsExperience: 6.0, verified: true, verifiedBy: "Management Audit", deliveryCount: 8, evidenceUrl: null },
    { skillName: "Full-Stack TypeScript & Next.js", category: "Application Engineering", level: "EXPERT", yearsExperience: 5.0, verified: true, verifiedBy: "Management Audit", deliveryCount: 5, evidenceUrl: null },
    { skillName: "Kubernetes & Containerization", category: "Cloud Native", level: "INTERMEDIATE", yearsExperience: 1.5, verified: false, verifiedBy: null, deliveryCount: 0, evidenceUrl: null },
    { skillName: "Database Administration (PostgreSQL)", category: "Data & Storage", level: "INTERMEDIATE", yearsExperience: 3.0, verified: true, verifiedBy: "Management Audit", deliveryCount: 2, evidenceUrl: null }
  ];

  for (const sk of skills) {
    const existing = await db.teamSkill.findFirst({
      where: { userId: user.id, skillName: sk.skillName }
    });
    if (existing) {
      await db.teamSkill.update({
        where: { id: existing.id },
        data: sk
      });
    } else {
      await db.teamSkill.create({
        data: { ...sk, userId: user.id }
      });
    }
  }
  console.log(`Synced ${skills.length} Team Skills.`);

  // 3. Seed Certifications
  const certs = [
    {
      name: "AWS Certified Solutions Architect – Professional",
      issuer: "Amazon Web Services",
      credentialId: "AWS-PSA-8849201",
      credentialUrl: "https://www.credly.com/org/amazon-web-services",
      issueDate: new Date("2023-04-15"),
      expiryDate: new Date("2026-04-15"),
      verified: true
    }
  ];

  for (const cert of certs) {
    const existing = await db.certification.findFirst({
      where: { userId: user.id, name: cert.name }
    });
    if (!existing) {
      await db.certification.create({
        data: { ...cert, userId: user.id }
      });
    }
  }

  // 4. Seed Business Weaknesses across 4 pillars
  const weaknesses = [
    {
      title: "Missing Verified Kubernetes & Multi-Cluster Production Delivery",
      category: "TECHNICAL",
      severity: "HIGH",
      evidence: "0 verified Kubernetes client engagements in portfolio. Team skill is self-declared (Intermediate) without CKA certification.",
      businessImpact: "Disqualifies Cyraops from high-value enterprise container migration contracts ($50k-$120k each).",
      opportunitiesAffected: JSON.stringify(["Global Logistics K8s Migration RFP ($75k)", "Fintech EKS Microservices Retainer ($6k/mo)"]),
      recommendedAction: "Mandate CKA certification for lead cloud engineer and execute 1 internal production reference architecture with Karpenter & Helm.",
      suggestedOwner: user.name,
      priority: "CRITICAL",
      targetDate: new Date(Date.now() + 30 * 86400000),
      resolved: false
    },
    {
      title: "No Formally Certified Cloud Security & Compliance Specialist",
      category: "TECHNICAL",
      severity: "HIGH",
      evidence: "Neither SOC 2 Type II readiness nor ISO 27001 auditor certification exists on the current roster.",
      businessImpact: "Regulated industry clients (Healthcare, FinTech) immediately reject proposals during vendor security due diligence.",
      opportunitiesAffected: JSON.stringify(["HealthTech AWS SOC2 Readiness Project ($35k)"]),
      recommendedAction: "Establish a subcontractor partnership agreement with an accredited security auditor for joint bid submissions.",
      suggestedOwner: user.name,
      priority: "HIGH",
      targetDate: new Date(Date.now() + 45 * 86400000),
      resolved: false
    },
    {
      title: "Absence of Fixed-Scope Discovery & Gating Engine for Inbound Requests",
      category: "SALES",
      severity: "CRITICAL",
      evidence: "Previous client inquiries were quoted on rough time & materials estimates without formal architectural scoping or gating.",
      businessImpact: "High risk of scope creep, delivery friction, under-quoting complex migrations, and lost margins.",
      opportunitiesAffected: JSON.stringify(["Legacy ERP Cloud Migration Inquiry"]),
      recommendedAction: "Mandate that all projects > $20k undergo the Cyraops Command Center Project Fit Assessment before submitting proposals.",
      suggestedOwner: user.name,
      priority: "CRITICAL",
      targetDate: new Date(Date.now() + 7 * 86400000),
      resolved: false
    },
    {
      title: "Lack of 24/7 Follow-the-Sun SLA Escalation & On-Call Rotation",
      category: "DELIVERY",
      severity: "HIGH",
      evidence: "Monitoring alerts go to email/Slack without guaranteed 15-minute response times or dedicated on-call paging.",
      businessImpact: "Prevents winning recurring Tier-1 Managed Cloud Operations retainers ($5k-$15k MRR).",
      opportunitiesAffected: JSON.stringify(["Managed AWS 24/7 SLA Contract"]),
      recommendedAction: "Integrate PagerDuty or Opsgenie with escalation tiers and define explicit on-call compensation / coverage.",
      suggestedOwner: user.name,
      priority: "HIGH",
      targetDate: new Date(Date.now() + 30 * 86400000),
      resolved: false
    },
    {
      title: "Undefined Change Order & Out-of-Scope Billing Mechanism in Client MSAs",
      category: "OPERATIONS",
      severity: "MEDIUM",
      evidence: "Contract template lacks explicit line-item change order triggers and hourly burst rates for customer delays.",
      businessImpact: "Average 15-20% margin leakage due to unbilled customer revisions and architectural churn.",
      opportunitiesAffected: JSON.stringify(["All custom software & DevOps engagements"]),
      recommendedAction: "Update standard Master Services Agreement (MSA) and Statement of Work (SOW) with gated milestone approvals and change order rates.",
      suggestedOwner: user.name,
      priority: "MEDIUM",
      targetDate: new Date(Date.now() + 21 * 86400000),
      resolved: false
    }
  ];

  for (const w of weaknesses) {
    const existing = await db.businessWeakness.findFirst({ where: { title: w.title } });
    if (existing) {
      await db.businessWeakness.update({ where: { id: existing.id }, data: w });
    } else {
      await db.businessWeakness.create({ data: w });
    }
  }
  console.log(`Synced ${weaknesses.length} Business Weaknesses.`);

  // 5. Seed Business Improvements (What We Need to Improve)
  const improvements = [
    {
      title: "Implement CKA / CKS Kubernetes Certification Program",
      businessReason: "Directly resolves high-severity weakness in container orchestration and unlocks enterprise Kubernetes bids.",
      expectedImpact: "Unlocks an estimated $120k in high-margin container migration and platform engineering pipeline.",
      estimatedEffort: "4-6 weeks",
      requiredResources: "Linux Foundation Exam vouchers + 40 hours dedicated lab study time",
      priority: "CRITICAL",
      ownerId: user.id,
      targetDate: new Date(Date.now() + 30 * 86400000),
      status: "IN_PROGRESS"
    },
    {
      title: "Deploy Standardized IT Project Evaluation Intake Workflow",
      businessReason: "Eliminates unvetted bids and ensures Cyraops only commits to contracts with >= 75% technical match.",
      expectedImpact: "Protects delivery margins above 35% and eliminates delivery default risks.",
      estimatedEffort: "1 week",
      requiredResources: "Cyraops Business Command Center Intake module",
      priority: "CRITICAL",
      ownerId: user.id,
      targetDate: new Date(Date.now() + 7 * 86400000),
      status: "PLANNED"
    },
    {
      title: "Establish 24/7 On-Call Escalation Rota (PagerDuty / Opsgenie)",
      businessReason: "Satisfies enterprise SLA requirements for managed cloud operations retainers.",
      expectedImpact: "Enables recurring revenue contracts with $5k-$15k monthly recurring revenue (MRR).",
      estimatedEffort: "2-3 weeks",
      requiredResources: "PagerDuty subscription ($34/user/mo) + secondary on-call engineer agreement",
      priority: "HIGH",
      ownerId: user.id,
      targetDate: new Date(Date.now() + 35 * 86400000),
      status: "PLANNED"
    },
    {
      title: "Standardize Master Services Agreement (MSA) with Milestone Gating",
      businessReason: "Stops 15-20% margin leakage caused by customer-driven scope expansion.",
      expectedImpact: "Recovers estimated $25k in annual billable work previously absorbed as free revisions.",
      estimatedEffort: "1-2 weeks",
      requiredResources: "Commercial legal counsel review ($1,200)",
      priority: "HIGH",
      ownerId: user.id,
      targetDate: new Date(Date.now() + 14 * 86400000),
      status: "PLANNED"
    }
  ];

  for (const imp of improvements) {
    const existing = await db.businessImprovement.findFirst({ where: { title: imp.title } });
    if (existing) {
      await db.businessImprovement.update({ where: { id: existing.id }, data: imp });
    } else {
      await db.businessImprovement.create({ data: imp });
    }
  }
  console.log(`Synced ${improvements.length} Business Improvements.`);

  // 6. Seed Project Fit Assessments (Decision Engine)
  const assessments = [
    {
      projectName: "Enterprise AWS Multi-Account Landing Zone & Terraform IaC",
      clientName: "Apex Financial Technologies",
      serviceCategory: "Infrastructure as Code (Terraform / Pulumi)",
      estimatedValue: 48000,
      recommendation: "GREEN",
      technicalFitScore: 92,
      deliveryRisk: "LOW",
      estimatedMarginPercent: 42,
      timelineFeasible: true,
      clientBudget: 50000,
      missingCapabilities: JSON.stringify([]),
      conditions: JSON.stringify([
        "Require client architecture team to approve IAM Identity Center mapping within first 10 days",
        "Milestone payments: 30% upfront, 40% on Staging IaC delivery, 30% on Prod signoff"
      ]),
      reasons: JSON.stringify([
        "Perfect capability match with verified AWS Solutions Architect and 7+ past Terraform engagements",
        "Client architecture aligns with standard Cyraops well-architected landing zone blueprint",
        "Healthy budget with 42% projected gross delivery margin"
      ]),
      status: "APPROVED",
      reviewedById: user.id,
      reviewedAt: new Date(),
      decisionNotes: "Strong strategic fit. Approved for formal proposal and Statement of Work issuance."
    },
    {
      projectName: "Legacy ERP to AWS Hybrid Cloud Migration",
      clientName: "Vanguard Industrial Supply",
      serviceCategory: "Cloud Migration",
      estimatedValue: 72000,
      recommendation: "AMBER",
      technicalFitScore: 64,
      deliveryRisk: "MEDIUM",
      estimatedMarginPercent: 28,
      timelineFeasible: true,
      clientBudget: 75000,
      missingCapabilities: JSON.stringify([
        "Missing dedicated Database Migration Specialist for legacy Oracle 11g to Aurora PostgreSQL",
        "No verified on-premise IPsec VPN tunnel failover track record"
      ]),
      conditions: JSON.stringify([
        "Engage certified external Oracle database migration contractor for Phase 2 data schema conversion",
        "Client must purchase vendor support agreement for legacy ERP software",
        "Add 20% risk contingency buffer into Statement of Work timeline"
      ]),
      reasons: JSON.stringify([
        "Core AWS landing zone and compute re-platforming are well within Cyraops expertise (75% match)",
        "Database layer carries schema conversion risk that requires external specialized advisory",
        "Economically viable provided database subcontractor cost is capped at $15k"
      ]),
      status: "PENDING_REVIEW",
      reviewedById: null,
      reviewedAt: null,
      decisionNotes: null
    },
    {
      projectName: "Baremetal OpenStack & Custom K8s 24/7 SLA Cluster Operations",
      clientName: "OmniTel Telecom Networks",
      serviceCategory: "Kubernetes & Container Orchestration",
      estimatedValue: 95000,
      recommendation: "RED",
      technicalFitScore: 28,
      deliveryRisk: "CRITICAL",
      estimatedMarginPercent: 12,
      timelineFeasible: false,
      clientBudget: 90000,
      missingCapabilities: JSON.stringify([
        "No baremetal OpenStack deployment experience",
        "No CKA/CKS certified Kubernetes engineers on team",
        "No 24/7 follow-the-sun on-call rotation with 15-minute response SLA"
      ]),
      conditions: JSON.stringify([
        "Do NOT bid under current operating posture. Would result in SLA default penalties and severe brand damage."
      ]),
      reasons: JSON.stringify([
        "Severe capability deficit: baremetal OpenStack and multi-tenant telecom Kubernetes require 4-5 dedicated specialists we do not have",
        "15-minute round-the-clock penalty-backed SLA will trigger breach damages within first 60 days",
        "Unacceptable delivery and financial risk"
      ]),
      status: "REJECTED",
      reviewedById: user.id,
      reviewedAt: new Date(),
      decisionNotes: "Rejected by executive directive. Out of scope for current company capabilities."
    }
  ];

  for (const a of assessments) {
    const existing = await db.projectFitAssessment.findFirst({ where: { projectName: a.projectName } });
    if (existing) {
      await db.projectFitAssessment.update({ where: { id: existing.id }, data: a });
    } else {
      await db.projectFitAssessment.create({ data: a });
    }
  }
  console.log(`Synced ${assessments.length} Project Fit Assessments.`);

  // 7. Seed pipeline deals and leads so sales intelligence has real data
  const existingCompany = await db.company.findFirst();
  let companyId = existingCompany?.id;
  if (!companyId) {
    const newCompany = await db.company.create({
      data: {
        name: "Apex Financial Technologies",
        domain: "apexfintech.example.com",
        industry: "Financial Services",
      }
    });
    companyId = newCompany.id;
  }

  const existingDealsCount = await db.deal.count();
  if (existingDealsCount === 0) {
    await db.deal.createMany({
      data: [
        {
          title: "Apex Multi-Account AWS Landing Zone",
          companyId,
          ownerId: user.id,
          value: 48000,
          stage: "PROPOSAL",
          probability: 80,
          expectedCloseDate: new Date(Date.now() + 20 * 86400000)
        },
        {
          title: "Vanguard Industrial Cloud Migration",
          companyId,
          ownerId: user.id,
          value: 72000,
          stage: "NEGOTIATION",
          probability: 60,
          expectedCloseDate: new Date(Date.now() + 35 * 86400000)
        },
        {
          title: "OmniTel Telecom Baremetal K8s 24/7 Operations",
          companyId,
          ownerId: user.id,
          value: 95000,
          stage: "CLOSED_LOST",
          notes: "LOST_REASON: Missing 24/7 SLA infrastructure and CKA/CKS certified Kubernetes staff",
          probability: 0,
          expectedCloseDate: new Date(Date.now() - 10 * 86400000)
        },
        {
          title: "HealthCore SOC 2 Cloud Remediation",
          companyId,
          ownerId: user.id,
          value: 35000,
          stage: "CLOSED_LOST",
          notes: "LOST_REASON: No certified SOC 2 / ISO 27001 auditor on staff",
          probability: 0,
          expectedCloseDate: new Date(Date.now() - 25 * 86400000)
        },
        {
          title: "Fintech DevOps CI/CD Retainer",
          companyId,
          ownerId: user.id,
          value: 36000,
          stage: "CLOSED_WON",
          probability: 100,
          expectedCloseDate: new Date(Date.now() - 5 * 86400000)
        }
      ]
    });
    console.log("Seeded sample deals for Sales Intelligence.");
  }

  // Also seed sample leads for lead conversion intelligence
  const existingLeadsCount = await db.lead.count();
  if (existingLeadsCount === 0) {
    await db.lead.createMany({
      data: [
        {
          title: "Senior VP of Eng at PayTech",
          companyName: "PayTech Global",
          email: "vp-eng@paytech.example.com",
          status: "QUALIFIED",
          score: 85,
          source: "WEBSITE_FORM",
          estimatedValue: 50000,
          assignedToId: user.id,
          notes: "Inbound request for Terraform automation and AWS ECS migration"
        },
        {
          title: "Director of Ops at DataStream",
          companyName: "DataStream Analytics",
          email: "ops@datastream.example.com",
          status: "CONTACTED",
          score: 65,
          source: "AI_RESEARCH_AGENT",
          estimatedValue: 40000,
          assignedToId: user.id,
          notes: "Follow-up scheduled on Observability & APM stack setup"
        },
        {
          title: "CTO at HealthBridge",
          companyName: "HealthBridge Solutions",
          email: "cto@healthbridge.example.com",
          status: "UNQUALIFIED",
          score: 20,
          source: "COLD_OUTREACH",
          estimatedValue: 15000,
          assignedToId: user.id,
          notes: "Disqualified: Requires on-premise mainframe 24/7 tape backup support"
        }
      ]
    });
    console.log("Seeded sample leads for Sales Intelligence.");
  }

  // 8. Seed internal project for CRM Tasks conversion
  const existingProject = await db.project.findFirst({ where: { name: "Internal IT Operations & Capability Readiness" } });
  if (!existingProject) {
    await db.project.create({
      data: {
        name: "Internal IT Operations & Capability Readiness",
        description: "Strategic improvements to company capabilities, certifications, and delivery readiness.",
        status: "ACTIVE",
        ownerId: user.id,
      }
    });
    console.log("Created Internal IT Operations project.");
  }

  console.log("✅ Seed completed successfully!");
}

seedCommandCenter()
  .catch((err) => {
    console.error("Seed error:", err);
    process.exit(1);
  })
  .finally(() => {
    process.exit(0);
  });
