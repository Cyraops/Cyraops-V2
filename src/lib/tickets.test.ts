import test from "node:test";
import assert from "node:assert/strict";
import { parseTicketInstruction, type TicketPersona } from "./tickets";

/**
 * The parser is the whole feature: if it guesses wrong, a task lands on the wrong
 * desk. These cases are the phrasing a person actually types in chat.
 */

const people: TicketPersona[] = [
  { kind: "user", id: "u-akshat", name: "Akshat Verma", aliases: ["akshat", "akshatverma", "akshat.verma"] },
  { kind: "user", id: "u-tanveer", name: "Tanveer Singh", aliases: ["tanveer", "tanveersingh", "tanveer.singh"] },
  { kind: "user", id: "u-rakesh", name: "Rakesh Patel", aliases: ["rakesh", "rakeshpatel"] },
  { kind: "agent", id: "research", name: "Research Agent", aliases: ["research", "researchagent"] },
  { kind: "agent", id: "sales", name: "Sales Agent", aliases: ["sales", "salesagent"] },
];

const parse = (text: string) => parseTicketInstruction(text, people);

test("a message without the trigger is not a ticket", () => {
  assert.equal(parse("how are our deals looking?").isTicket, false);
  assert.equal(parse("").isTicket, false);
});

test("@tasks with a mention creates a ticket for that person", () => {
  const result = parse("@tasks Call Northwind back tomorrow @akshat");

  assert.equal(result.isTicket, true);
  assert.equal(result.title, "Call Northwind back tomorrow");
  assert.deepEqual(result.assignees.map((a) => a.id), ["u-akshat"]);
  assert.deepEqual(result.unmatched, []);
});

test("an agent can be named as an assignee", () => {
  const result = parse("@tasks research Northwind's stack and summarise @research");

  assert.equal(result.title, "research Northwind's stack and summarise");
  assert.deepEqual(result.assignees.map((a) => a.kind), ["agent"]);
  assert.equal(result.assignees[0].id, "research");
});

test("several assignees in one message are all kept, in order", () => {
  const result = parse("@tasks Draft the proposal @akshat @tanveer @research");

  assert.deepEqual(result.assignees.map((a) => a.id), ["u-akshat", "u-tanveer", "research"]);
  assert.equal(result.title, "Draft the proposal");
});

test("a person and an agent can share one ticket", () => {
  const result = parse("@tasks Send the pricing sheet @sales @tanveer");

  assert.deepEqual(result.assignees.map((a) => `${a.kind}:${a.id}`), ["agent:sales", "user:u-tanveer"]);
});

test("an unassigned instruction goes to nobody by name, not to a stranger", () => {
  const result = parse("@tasks Reorder the onboarding checklist");

  assert.equal(result.isTicket, true);
  assert.deepEqual(result.assignees, [], "the parser invents no owner");
  assert.equal(result.title, "Reorder the onboarding checklist");
});

test("a name it cannot match is reported instead of being dropped silently", () => {
  const result = parse("@tasks Prepare the demo @priya");

  assert.deepEqual(result.unmatched, ["@priya"]);
  assert.deepEqual(result.assignees, []);
});

test("names in prose still work when nobody is @mentioned", () => {
  const result = parse("@tasks ask Akshat to prepare the numbers");

  assert.deepEqual(result.assignees.map((a) => a.id), ["u-akshat"]);
});

test("a name inside a longer word is not a match", () => {
  // "Rakesh" contains "rakesh" but so does "Rakeshwaran" — only whole words count.
  const result = parse("@tasks Review the contract with Rakeshwaran");
  assert.deepEqual(result.assignees, []);
});

test("multi-line instructions keep their body", () => {
  const result = parse(`@tasks Prepare the Northwind proposal @akshat
Scope: three environments
Deadline: Friday`);

  assert.equal(result.title, "Prepare the Northwind proposal");
  assert.match(result.description, /Scope: three environments/);
  assert.match(result.description, /Deadline: Friday/);
  assert.ok(!result.description.includes("@tasks"));
});

test("the trigger works mid-sentence and case-insensitively", () => {
  const result = parse("hey @Tasks send the invoice @tanveer");
  assert.equal(result.isTicket, true);
  assert.deepEqual(result.assignees.map((a) => a.id), ["u-tanveer"]);
  assert.equal(result.title, "hey send the invoice");
});

test("@task (singular) also works", () => {
  const result = parse("@task Book the venue @akshat");
  assert.equal(result.isTicket, true);
  assert.equal(result.title, "Book the venue");
});

test("the trigger itself is never treated as an assignee", () => {
  const result = parse("@tasks Update the board");
  assert.deepEqual(result.assignees, []);
  assert.deepEqual(result.unmatched, []);
  assert.equal(result.title, "Update the board");
});

test("a very long instruction is trimmed to a usable title", () => {
  const result = parse(`@tasks ${"word ".repeat(80)}@akshat`);
  assert.ok(result.title.length <= 180, `title was ${result.title.length} characters`);
  assert.deepEqual(result.assignees.map((a) => a.id), ["u-akshat"]);
});
