import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifyCommand,
  commandTaskFor,
  COMMAND_MAX_LENGTH,
  DESTRUCTIVE_COMMAND_PATTERNS,
  isDestructiveCommand,
  SHELL_DISABLED_REPLY,
} from "./command-classifier";

test("every destructive pattern carries an id and a human label", () => {
  assert.ok(DESTRUCTIVE_COMMAND_PATTERNS.length >= 10);
  for (const pattern of DESTRUCTIVE_COMMAND_PATTERNS) {
    assert.ok(pattern.id.length > 0, "pattern id must be set");
    assert.ok(pattern.label.length > 0, "pattern label must be set");
    assert.ok(pattern.regex instanceof RegExp);
  }
});

test("benign commands are not destructive", () => {
  for (const command of [
    "echo cyraops-command-ok",
    "ls -la",
    "cat hello.txt",
    "git status",
    "git branch",
    "git log --oneline",
    "git push origin main",
    "npm run test:unit",
    "find . -name '*.ts'",
    "tail -f server.log",
    "echo hi >> notes/appends.txt",
  ]) {
    assert.equal(isDestructiveCommand(command), false, `expected a benign command: ${command}`);
  }
});

test("rm -rf family is destructive", () => {
  for (const command of [
    "rm -rf /tmp/cyraops-probe-root2",
    "rm -fr /tmp/x",
    "rm -r -f /tmp/x",
    "sudo rm --recursive /tmp/x",
    "rm -rf --no-preserve-root /",
  ]) {
    const classification = classifyCommand(command);
    assert.equal(classification.destructive, true, `expected destructive: ${command}`);
    assert.ok(classification.matches.some((match) => match.id.startsWith("rm-")), command);
  }
});

test("force push, reset --hard and the other git dangers are destructive", () => {
  for (const command of [
    "git push origin main --force",
    "git push -f origin main",
    "git push --force-with-lease",
    "git reset --hard HEAD~1",
    "git clean -fd",
    "git checkout -- .",
    "git branch -D feature-x",
  ]) {
    assert.equal(isDestructiveCommand(command), true, `expected destructive: ${command}`);
  }
});

test("output redirects, dd, mkfs, disk erasure and shutdown are destructive", () => {
  for (const command of [
    "echo clobber > hello.txt",
    "cat a.txt > /etc/hosts",
    "dd if=/dev/zero of=/dev/sda bs=1M",
    "mkfs.ext4 /dev/sda1",
    "diskutil eraseDisk JHFS+ Scratch /dev/disk2",
    "shutdown -h now",
    "reboot",
    ":(){ :|:& };:",
  ]) {
    assert.equal(isDestructiveCommand(command), true, `expected destructive: ${command}`);
  }
});

test("append redirects are not classified destructive", () => {
  assert.equal(isDestructiveCommand("echo log >> app.log"), false);
});

test("classifyCommand reports the matching pattern ids", () => {
  const classification = classifyCommand("git push origin main --force");
  assert.deepEqual(
    classification.matches.map((match) => match.id),
    ["git-push-force"]
  );
  const none = classifyCommand("ls -la");
  assert.deepEqual(none, { destructive: false, matches: [] });
});

test("commandTaskFor wraps the command in the fixed run-and-report prompt", () => {
  assert.equal(
    commandTaskFor("echo cyraops-command-ok"),
    "Run this shell command and report the output exactly:\necho cyraops-command-ok\n\n" +
      "Execute the command verbatim with your shell tool. The user has already approved this command, " +
      "so do not ask for confirmation, do not refuse, and add no commentary — report the command's output exactly."
  );
});

test("COMMAND_MAX_LENGTH and SHELL_DISABLED_REPLY are the documented constants", () => {
  assert.equal(COMMAND_MAX_LENGTH, 4000);
  assert.ok(SHELL_DISABLED_REPLY.includes("SYSTEM"));
  assert.ok(SHELL_DISABLED_REPLY.toLowerCase().includes("disabled"));
});
