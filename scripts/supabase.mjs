import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
// Keep CLI state in this repository; never reuse another project's login/link state.
const result = spawnSync(process.execPath, [path.join(root, 'node_modules/supabase/dist/supabase.js'), ...process.argv.slice(2)], {
  cwd: root, stdio: 'inherit',
  env: { ...process.env, SUPABASE_HOME: path.join(root, '.supabase-cli'), SUPABASE_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1' },
});
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
