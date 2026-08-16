import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';
import { copyFileSync, cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

function publishSkills() {
  return {
    name: 'publish-mygateway-skills',
    closeBundle() {
      const skillSource = resolve(__dirname, '../skills/mygateway-admin');
      const hostedRoot = resolve(__dirname, 'dist/skills');
      const manifest = JSON.parse(readFileSync(resolve(skillSource, 'skill.json'), 'utf8')) as {
        name: string;
        version: string;
      };
      mkdirSync(hostedRoot, { recursive: true });
      cpSync(skillSource, resolve(hostedRoot, 'mygateway-admin'), { recursive: true });
      copyFileSync(resolve(skillSource, 'SKILL.md'), resolve(__dirname, 'dist/skill.md'));
      copyFileSync(resolve(skillSource, 'skill.json'), resolve(__dirname, 'dist/skill.json'));
      writeFileSync(resolve(hostedRoot, 'index.json'), JSON.stringify({
        skills: [{
          name: manifest.name,
          version: manifest.version,
          skill_url: '/skill.md',
          api_version: 'v1',
        }],
      }, null, 2));
    },
  };
}

export default defineConfig({
  plugins: [solid(), tailwindcss(), publishSkills()],
  root: resolve(__dirname),
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
  },
});
