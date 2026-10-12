// Loads .env from the project root into process.env. Import this FIRST in any
// file that reads process.env at load time, so the values exist before use.
// Variables already set in the shell win over the ones in .env.
import { existsSync } from 'fs';

const envPath = new URL('../.env', import.meta.url);

if (existsSync(envPath)) {
	process.loadEnvFile(envPath);
}
