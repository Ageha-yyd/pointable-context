import { runSyntheticRecoveryObservationReplays } from "./recovery-observation-replay.js";

process.stdout.write(`${JSON.stringify({
  schemaVersion: 1,
  prototypeOnly: true,
  humanEfficiencyEvidence: false,
  scenarios: runSyntheticRecoveryObservationReplays(),
}, null, 2)}\n`);
