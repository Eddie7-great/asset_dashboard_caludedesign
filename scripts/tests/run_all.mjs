#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const TEST_DIR = path.join(ROOT, 'scripts', 'tests')

function run(label, command, args) {
  console.log(`\n[${label}] ${command} ${args.join(' ')}`)
  const result = spawnSync(command, args, {
    cwd: ROOT,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    stdio: 'inherit',
    shell: false,
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status || 1)
}

function filesUnder(dir, predicate) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.vercel') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...filesUnder(full, predicate))
    else if (predicate(full)) out.push(full)
  }
  return out
}

const scriptFiles = filesUnder(ROOT, file => /\.(?:js|mjs)$/.test(file))
for (const file of scriptFiles.sort()) {
  run('syntax', process.execPath, ['--check', file])
}

const tsc = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc')
run('typecheck', process.execPath, [tsc, '--noEmit'])

const jsTests = fs.readdirSync(TEST_DIR)
  .filter(name => /^test_.*\.mjs$/.test(name))
  .sort()
for (const name of jsTests) run('node test', process.execPath, [path.join(TEST_DIR, name)])

const pythonTests = fs.readdirSync(TEST_DIR)
  .filter(name => /^test_.*\.py$/.test(name))
  .sort()
const pythonCandidates = process.env.PYTHON
  ? [process.env.PYTHON]
  : (process.platform === 'win32' ? ['python', 'py'] : ['python3', 'python'])
let python = null
for (const candidate of pythonCandidates) {
  const probeArgs = candidate === 'py' ? ['-3', '--version'] : ['--version']
  const probe = spawnSync(candidate, probeArgs, { cwd: ROOT, stdio: 'ignore', shell: false })
  if (!probe.error && probe.status === 0) { python = candidate; break }
}
if (!python && pythonTests.length) throw new Error('Python 실행 파일을 찾을 수 없습니다.')
for (const name of pythonTests) {
  const prefix = python === 'py' ? ['-3', '-X', 'utf8'] : ['-X', 'utf8']
  run('python test', python, [...prefix, path.join(TEST_DIR, name)])
}

console.log(`\nPASS: 문법·타입·Node ${jsTests.length}개·Python ${pythonTests.length}개 테스트`)
