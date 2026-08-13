const baseUrl = new URL(process.argv[2] ?? 'http://localhost:8799');
const checks = [
  ['Dashboard', '/'],
  ['Health', '/health'],
  ['Gateway OpenAPI', '/v1/openapi.json'],
  ['Management capabilities', '/management/v1/capabilities'],
  ['Skill manifest', '/skill.json'],
];

let failed = false;
for (const [name, path] of checks) {
  const url = new URL(path, baseUrl);
  try {
    const response = await fetch(url, { redirect: 'follow' });
    if (!response.ok) {
      failed = true;
      console.error(`FAIL ${name}: ${response.status} ${url}`);
    } else {
      console.log(`PASS ${name}: ${response.status} ${url}`);
    }
  } catch (error) {
    failed = true;
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (failed) process.exitCode = 1;
