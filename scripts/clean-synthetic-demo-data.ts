import { db } from "../src/lib/db";

async function cleanSyntheticDemoData() {
  console.log("Starting data integrity cleanup on company_os_dev...");

  // Safety check: ensure we are not on production
  const dbUrl = process.env.DATABASE_URL || "";
  if (!dbUrl.includes("dev") && !dbUrl.includes("company_os_dev")) {
    throw new Error(`SAFETY ABORT: Refusing to clean database with URL: ${dbUrl}. Must be company_os_dev!`);
  }

  // 1. Delete synthetic ProjectFitAssessments
  const deletedAssessments = await db.projectFitAssessment.deleteMany();
  console.log(`Removed ${deletedAssessments.count} synthetic ProjectFitAssessment records.`);

  // 2. Delete synthetic Deals
  const deletedDeals = await db.deal.deleteMany();
  console.log(`Removed ${deletedDeals.count} synthetic Deal records.`);

  // 3. Delete synthetic Leads
  const deletedLeads = await db.lead.deleteMany();
  console.log(`Removed ${deletedLeads.count} synthetic Lead records.`);

  // 4. Delete synthetic Companies
  const deletedCompanies = await db.company.deleteMany({
    where: { name: "Apex Financial Technologies" }
  });
  console.log(`Removed ${deletedCompanies.count} synthetic Company records.`);

  // 5. Delete synthetic Tasks and Projects
  const deletedTasks = await db.task.deleteMany({
    where: { project: { name: "Internal IT Operations & Capability Readiness" } }
  });
  console.log(`Removed ${deletedTasks.count} synthetic Task records.`);

  const deletedProjects = await db.project.deleteMany({
    where: { name: "Internal IT Operations & Capability Readiness" }
  });
  console.log(`Removed ${deletedProjects.count} synthetic Project records.`);

  // 6. Delete synthetic BusinessWeakness & BusinessImprovement records
  const deletedWeaknesses = await db.businessWeakness.deleteMany();
  console.log(`Removed ${deletedWeaknesses.count} synthetic BusinessWeakness records.`);

  const deletedImprovements = await db.businessImprovement.deleteMany();
  console.log(`Removed ${deletedImprovements.count} synthetic BusinessImprovement records.`);

  // 7. Delete synthetic Certifications
  const deletedCerts = await db.certification.deleteMany({
    where: { credentialId: "AWS-PSA-8849201" }
  });
  console.log(`Removed ${deletedCerts.count} synthetic Certification records.`);

  // 8. Delete synthetic TeamSkills
  const deletedSkills = await db.teamSkill.deleteMany();
  console.log(`Removed ${deletedSkills.count} synthetic TeamSkill records.`);

  // 9. Reset ServiceCapabilities to truthful baseline:
  // 13 standard IT domains remain as structural catalog entries, but all verified deliveries = 0, readiness = NOT_READY
  const resetCaps = await db.serviceCapability.updateMany({
    data: {
      verifiedProjectsCount: 0,
      deliveryReadiness: "NOT_READY",
      portfolioEvidence: null,
      notes: "Baseline category catalog initialized. Awaiting documented and verified client deliveries."
    }
  });
  console.log(`Reset ${resetCaps.count} ServiceCapability records to truthful baseline (0 projects, NOT_READY).`);

  // 10. Audit preservation of genuine data
  const userCount = await db.user.count();
  const workspaceCount = await db.workspace.count();
  const sessionCount = await db.session.count();
  const activityCount = await db.activity.count();

  console.log("=== PRESERVATION AUDIT ===");
  console.log(`Genuine Users preserved: ${userCount}`);
  console.log(`Genuine Workspace preserved: ${workspaceCount}`);
  console.log(`Active Sessions preserved: ${sessionCount}`);
  console.log(`Genuine Activities preserved: ${activityCount}`);

  if (userCount === 0 || workspaceCount === 0) {
    throw new Error("FATAL: Genuine user or workspace record was corrupted!");
  }

  console.log("✅ Data integrity cleanup successfully completed. Database is clean and truthful.");
}

cleanSyntheticDemoData()
  .catch((err) => {
    console.error("Cleanup error:", err);
    process.exit(1);
  })
  .finally(() => {
    process.exit(0);
  });

