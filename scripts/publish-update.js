'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const rootDir = path.resolve(__dirname, '..');
const outRoot = path.join(rootDir, 'dist');
const pkgPath = path.join(rootDir, 'package.json');
const updateZipPath = path.join(outRoot, 'app-update.zip');
const versionJsonPath = path.join(outRoot, 'version.json');

const GITHUB_OWNER = 'Thangnd265';
const GITHUB_REPO = 'social-hub-updates';
const GITHUB_SOURCE_REPO = 'social-hub';

function getGitHubToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN.trim();
  const res = spawnSync('git', ['credential', 'fill'], {
    input: 'protocol=https\nhost=github.com\n\n',
    encoding: 'utf8',
  });
  const m = String(res.stdout || '').match(/password=(.+)/);
  return m ? m[1].trim() : '';
}

async function ensureGitHubRepoExists(token, repoName = GITHUB_REPO, description = 'Social Hub Desktop App & OTA Auto-Update Channel') {
  if (!token) return false;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'SocialHub-Publisher',
  };
  const check = await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${repoName}`, {
    headers,
  });
  if (check.status === 200) return true;

  const create = await fetch('https://api.github.com/user/repos', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: repoName,
      description,
      private: false,
      auto_init: true,
    }),
  });
  return create.ok;
}

const CORE_UPDATE_FILES = [
  'package.json',
  'src/core.js',
  'src/main.js',
  'src/preload.js',
  'src/webview-preload.js',
  'src/ui/index.html',
  'src/ui/renderer.js',
  'src/ui/style.css',
];

function buildUpdateArtifacts(explicitBuildStamp) {
  fs.mkdirSync(outRoot, { recursive: true });
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const buildNum = Number(explicitBuildStamp) || Date.now();
  pkg.build = buildNum;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');

  const stagingDir = path.join(outRoot, 'app-update-staging');
  fs.rmSync(stagingDir, { recursive: true, force: true });
  fs.mkdirSync(stagingDir, { recursive: true });

  const inlineFiles = {};
  for (const relPath of CORE_UPDATE_FILES) {
    const absSrc = path.join(rootDir, relPath);
    if (fs.existsSync(absSrc)) {
      const content = fs.readFileSync(absSrc, 'utf8');
      inlineFiles[relPath] = content;
      const absDest = path.join(stagingDir, relPath);
      fs.mkdirSync(path.dirname(absDest), { recursive: true });
      fs.writeFileSync(absDest, content, 'utf8');
    }
  }

  if (fs.existsSync(updateZipPath)) {
    fs.rmSync(updateZipPath, { force: true });
  }
  execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory("${stagingDir}", "${updateZipPath}", [System.IO.Compression.CompressionLevel]::Optimal, $false)`,
    ],
    { stdio: 'inherit' }
  );
  fs.rmSync(stagingDir, { recursive: true, force: true });

  const versionManifest = {
    version: String(pkg.version || '1.0.0'),
    build: buildNum,
    updatedAt: new Date(buildNum).toISOString(),
    downloadUrl: `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/main/app-update.zip`,
    files: inlineFiles,
  };
  fs.writeFileSync(versionJsonPath, JSON.stringify(versionManifest, null, 2) + '\n', 'utf8');
  return versionManifest;
}

async function publishUpdateToGitHub(explicitBuildStamp) {
  const manifest = buildUpdateArtifacts(explicitBuildStamp);
  const token = getGitHubToken();
  if (!token) {
    console.warn('WARN: No GitHub credential found; created local dist/version.json & dist/app-update.zip only.');
    return manifest;
  }

  await ensureGitHubRepoExists(
    token,
    GITHUB_REPO,
    'Social Hub Desktop App — Full Source Code & OTA Auto-Update Channel'
  );
  await ensureGitHubRepoExists(
    token,
    GITHUB_SOURCE_REPO,
    'Social Hub — Multi-Service Social & Messenger Desktop Aggregator (Electron)'
  );

  const repoDir = path.join(os.tmpdir(), 'social-hub-updates-git');
  fs.rmSync(repoDir, { recursive: true, force: true });
  fs.mkdirSync(repoDir, { recursive: true });

  execFileSync('git', ['init', '-b', 'main'], { cwd: repoDir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', GITHUB_OWNER], { cwd: repoDir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'thang.nd2605@gmail.com'], {
    cwd: repoDir,
    stdio: 'ignore',
  });

  // Copy full source code
  const sourceDirs = ['src', 'scripts', 'test'];
  for (const dirName of sourceDirs) {
    const srcDir = path.join(rootDir, dirName);
    if (fs.existsSync(srcDir)) {
      fs.cpSync(srcDir, path.join(repoDir, dirName), { recursive: true });
    }
  }
  const sourceFiles = ['package.json', 'package-lock.json'];
  for (const fileName of sourceFiles) {
    const srcFile = path.join(rootDir, fileName);
    if (fs.existsSync(srcFile)) {
      fs.copyFileSync(srcFile, path.join(repoDir, fileName));
    }
  }

  // Copy OTA update artifacts
  fs.copyFileSync(versionJsonPath, path.join(repoDir, 'version.json'));
  fs.copyFileSync(updateZipPath, path.join(repoDir, 'app-update.zip'));
  fs.writeFileSync(path.join(repoDir, '.gitignore'), 'node_modules/\ndist/\n', 'utf8');
  fs.writeFileSync(
    path.join(repoDir, 'README.md'),
    [
      '# Social Hub — All-in-One Social & Messenger Desktop App',
      '',
      `- **Version**: \`${manifest.version}\``,
      `- **Build**: \`${manifest.build}\``,
      `- **Updated**: \`${manifest.updatedAt}\``,
      '',
      '## Features',
      '- Multi-service isolated tabs: **Zalo**, **Messenger**, **Facebook**, **Instagram**, **Threads**, **TikTok**, **YouTube**, **Locket**, **Google**',
      '- Built-in **Google Browser Toolbar** (Back, Forward, Home, Omnibox URL/Search bar)',
      '- Built-in **Adblock (uBlock Origin Lite)** + YouTube/Social ad-skipping engine',
      '- Built-in **PiP Video**, **Split View**, **PIN Lock**, **Screenshot Capture**, **System Tray**, and **GitHub OTA Auto-Update**',
      '',
      '## Development & Build Commands',
      '```bash',
      'npm install',
      'npm test              # Run unit tests',
      'npm start             # Launch Social Hub in development mode',
      'npm run build:exe     # Build SocialHub-Setup.exe & SocialHub-Portable.exe + publish OTA update',
      'npm run publish:update # Publish latest source & OTA update to GitHub',
      '```',
      '',
    ].join('\n'),
    'utf8'
  );

  execFileSync('git', ['add', '.'], { cwd: repoDir, stdio: 'ignore' });
  execFileSync(
    'git',
    ['commit', '-m', `Release v${manifest.version} (build ${manifest.build})`],
    { cwd: repoDir, stdio: 'ignore' }
  );

  for (const targetRepo of [GITHUB_REPO, GITHUB_SOURCE_REPO]) {
    execFileSync(
      'git',
      [
        'push',
        '--force',
        `https://github.com/${GITHUB_OWNER}/${targetRepo}.git`,
        'main:main',
      ],
      { cwd: repoDir, stdio: 'inherit' }
    );
    console.log(
      `PUBLISHED FULL SOURCE & OTA UPDATE -> https://github.com/${GITHUB_OWNER}/${targetRepo} (v${manifest.version}, build ${manifest.build})`
    );
  }

  fs.rmSync(repoDir, { recursive: true, force: true });
  return manifest;
}

if (require.main === module) {
  publishUpdateToGitHub().catch((err) => {
    console.error('Publish failed:', err);
    process.exit(1);
  });
}

module.exports = {
  buildUpdateArtifacts,
  publishUpdateToGitHub,
};
