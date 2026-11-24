/**
 * `stickler check <sections|drift-pairs>`: the docs-as-spec checks as one
 * command. Off when its key is empty; one line per failure, exit 1.
 */
import { checkDriftPairs } from "../check-drift-pairs.mjs";
import { checkSections } from "../check-sections.mjs";
import { loadConfig } from "../config.mjs";

const checks = {
  sections: {
    run: checkSections,
    off: (c) => c.docs.scanRoots.length === 0 && "sections: off, docs.scanRoots is empty",
    ok: "sections: every reference names a heading",
  },
  "drift-pairs": {
    run: checkDriftPairs,
    off: (c) => c.docs.unitRoots.length === 0 && "drift-pairs: off, docs.unitRoots is empty",
    ok: "drift-pairs: every unit has a pair or a reason",
  },
};

export default function check([name]) {
  const c = checks[name];
  if (!c) throw new Error(`usage: stickler check <${Object.keys(checks).join("|")}>`);
  const config = loadConfig();
  if (c.off(config)) return c.off(config);
  const failures = c.run(config);
  if (failures.length) throw new Error(`${name}\n${failures.join("\n")}`);
  return c.ok;
}
