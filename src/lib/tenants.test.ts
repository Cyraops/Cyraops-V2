import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { db } from "@/lib/db";
import { isTenantAdmin, memberContactWhere, memberTaskWhere, sharedProjectUserIds } from "./tenants";

/** A unique suffix so test rows never collide with other suites. */
const stamp = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

interface SeedUsers {
  owner: string;
  member: string;
  coMember: string;
  outsider: string;
}

async function seedUsers(suffix: string): Promise<SeedUsers> {
  const make = (name: string, role: "OWNER" | "MEMBER") =>
    db.user.create({
      data: { name: `${name} ${suffix}`, email: `${name}-${suffix}@tenant.test`, role, passwordHash: "x" },
    });
  const [owner, member, coMember, outsider] = await Promise.all([
    make("towner", "OWNER"),
    make("tmember", "MEMBER"),
    make("tcomember", "MEMBER"),
    make("toutside", "MEMBER"),
  ]);
  return { owner: owner.id, member: member.id, coMember: coMember.id, outsider: outsider.id };
}

describe("tenant scoping helpers (FIX 3)", () => {
  test("isTenantAdmin matches the app-wide admin pattern", () => {
    assert.equal(isTenantAdmin("OWNER"), true);
    assert.equal(isTenantAdmin("ADMIN"), true);
    assert.equal(isTenantAdmin("MEMBER"), false);
    assert.equal(isTenantAdmin(""), false);
  });

  test("memberTaskWhere returns the member's own rows and their projects' rows only", async () => {
    const s = stamp();
    const users = await seedUsers(s);
    try {
      const [sharedProject, foreignProject] = await Promise.all([
        db.project.create({ data: { name: `shared ${s}`, ownerId: users.owner, members: { create: [{ userId: users.member }, { userId: users.coMember }] } } }),
        db.project.create({ data: { name: `foreign ${s}`, ownerId: users.outsider } }),
      ]);
      const tasks = await Promise.all([
        db.task.create({ data: { title: `member-created ${s}`, projectId: foreignProject.id, creatorId: users.member } }),
        db.task.create({ data: { title: `member-assigned ${s}`, projectId: foreignProject.id, creatorId: users.owner, assigneeId: users.member } }),
        db.task.create({ data: { title: `shared-project ${s}`, projectId: sharedProject.id, creatorId: users.coMember } }),
        db.task.create({ data: { title: `outsider ${s}`, projectId: foreignProject.id, creatorId: users.outsider } }),
        db.task.create({ data: { title: `owner-project ${s}`, projectId: sharedProject.id, creatorId: users.owner } }),
      ]);

      const where = await memberTaskWhere(users.member);
      const visible = await db.task.findMany({ where, orderBy: { title: "asc" } });
      const titles = visible.map((task) => task.title).sort();

      assert.deepEqual(titles, [`member-assigned ${s}`, `member-created ${s}`, `owner-project ${s}`, `shared-project ${s}`].sort());
      assert.ok(!titles.includes(`outsider ${s}`), "a member must not see another workspace's tasks");
      assert.equal(tasks.length, 5);
    } finally {
      await db.task.deleteMany({ where: { OR: [{ title: { contains: s } }, { project: { name: { contains: s } } }] } }).catch(() => {});
      await db.projectMember.deleteMany({ where: { project: { name: { contains: s } } } }).catch(() => {});
      await db.project.deleteMany({ where: { name: { contains: s } } }).catch(() => {});
      await db.user.deleteMany({ where: { id: { in: [users.owner, users.member, users.coMember, users.outsider] } } }).catch(() => {});
    }
  });

  test("a member in no project sees only their own rows (fail-closed)", async () => {
    const s = stamp();
    const users = await seedUsers(s);
    try {
      const project = await db.project.create({ data: { name: `lonely ${s}`, ownerId: users.owner } });
      await db.task.create({ data: { title: `mine ${s}`, projectId: project.id, creatorId: users.member } });
      await db.task.create({ data: { title: `owners ${s}`, projectId: project.id, creatorId: users.owner } });

      const where = await memberTaskWhere(users.member);
      const visible = await db.task.findMany({ where });
      assert.deepEqual(visible.map((task) => task.title), [`mine ${s}`]);
    } finally {
      await db.task.deleteMany({ where: { project: { name: { contains: s } } } }).catch(() => {});
      await db.project.deleteMany({ where: { name: { contains: s } } }).catch(() => {});
      await db.user.deleteMany({ where: { id: { in: [users.owner, users.member, users.coMember, users.outsider] } } }).catch(() => {});
    }
  });

  test("sharedProjectUserIds covers self, project owners and co-members", async () => {
    const s = stamp();
    const users = await seedUsers(s);
    try {
      await db.project.create({
        data: { name: `team ${s}`, ownerId: users.owner, members: { create: [{ userId: users.member }, { userId: users.coMember }] } },
      });
      const ids = await sharedProjectUserIds(users.member);
      for (const expected of [users.member, users.owner, users.coMember]) {
        assert.ok(ids.includes(expected), `missing ${expected}`);
      }
      assert.ok(!ids.includes(users.outsider), "outsiders are not in the member's workspace");
    } finally {
      await db.projectMember.deleteMany({ where: { project: { name: { contains: s } } } }).catch(() => {});
      await db.project.deleteMany({ where: { name: { contains: s } } }).catch(() => {});
      await db.user.deleteMany({ where: { id: { in: [users.owner, users.member, users.coMember, users.outsider] } } }).catch(() => {});
    }
  });

  test("memberContactWhere scopes to contacts linked to the member's deals or leads", async () => {
    const s = stamp();
    const users = await seedUsers(s);
    const contactIds: string[] = [];
    try {
      const linked = await db.contact.create({ data: { firstName: `linked ${s}`, lastName: "C" } });
      const leadLinked = await db.contact.create({ data: { firstName: `leadlinked ${s}`, lastName: "C" } });
      const standalone = await db.contact.create({ data: { firstName: `standalone ${s}`, lastName: "C" } });
      const foreign = await db.contact.create({ data: { firstName: `foreign ${s}`, lastName: "C" } });
      contactIds.push(linked.id, leadLinked.id, standalone.id, foreign.id);

      await db.deal.create({ data: { title: `deal ${s}`, contactId: linked.id, ownerId: users.member } });
      await db.lead.create({ data: { title: `lead ${s}`, contactId: leadLinked.id, assignedToId: users.member } });
      await db.deal.create({ data: { title: `foreign deal ${s}`, contactId: foreign.id, ownerId: users.outsider } });

      const visible = await db.contact.findMany({ where: memberContactWhere(users.member) });
      const names = visible.map((contact) => contact.firstName).sort();
      assert.deepEqual(names, [`leadlinked ${s}`, `linked ${s}`].sort());
    } finally {
      await db.deal.deleteMany({ where: { title: { contains: s } } }).catch(() => {});
      await db.lead.deleteMany({ where: { title: { contains: s } } }).catch(() => {});
      await db.contact.deleteMany({ where: { id: { in: contactIds } } }).catch(() => {});
      await db.user.deleteMany({ where: { id: { in: [users.owner, users.member, users.coMember, users.outsider] } } }).catch(() => {});
    }
  });
});
