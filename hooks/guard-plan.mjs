#!/usr/bin/env node
/**
 * PreToolUse on ExitPlanMode: a plan reaches the user with the section the
 * repository requires (`plan.requiredHeadings`), a double check for example.
 * Left to the user, that section was the second round trip of a plan: rejected
 * once only to ask for it.
 *
 * The plan is read from the tool's input, or from the file it names; with
 * neither, the hook stays out of the way.
 */
import { readFileSync } from "node:fs";
import { configFor, deny, readInput } from "../lib/hook.mjs";

const input = await readInput();
const { plan: config } = configFor(input);
if (config.requiredHeadings.length === 0) process.exit(0);

let plan = input.tool_input?.plan ?? "";
if (!plan && input.tool_input?.planFilePath) {
  try {
    plan = readFileSync(input.tool_input.planFilePath, "utf8");
  } catch {
    plan = "";
  }
}
if (!plan.trim()) process.exit(0);

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
const heading = new RegExp(`^#{1,6}[ \\t]*(?:${config.requiredHeadings.map(escape).join("|")})(?![\\p{L}\\p{N}_])`, "imu");
if (!heading.test(plan)) {
  const names = config.requiredHeadings.map((h) => `\`${h}\``).join(" or ");
  deny(
    `The plan has no section headed ${names} (stickler \`plan.requiredHeadings\`). Add it before the plan reaches the user, then call ExitPlanMode again.`,
  );
}
