/**
 * pwsh-shim — a Node SEA executable that pretends to be pwsh.exe.
 *
 * The WinPE has cmd.exe but no PowerShell. dsh-pwsh-local spawns
 *   pwsh -NoLogo -NoProfile -NonInteractive -Command <command>
 * so this shim accepts those flags and hands the command to cmd.exe.
 * chcp 65001 keeps the output UTF-8, otherwise Chinese comes back as GBK.
 */

const { spawnSync } = require('node:child_process')

const argv = process.argv.slice(2)
let command = ''
for (let i = 0; i < argv.length; i++) {
  const a = String(argv[i])
  if (/^-(c|command)$/i.test(a) || /^-command$/i.test(a)) {
    command = argv[i + 1] === undefined ? '' : String(argv[i + 1])
    break
  }
}
if (!command) {
  const rest = argv.filter((a) => !/^-(no)?logo$/i.test(a) && !/^-(no)?profile$/i.test(a) && !/^-(non)?interactive$/i.test(a))
  command = rest.join(' ')
}
if (!command) process.exit(0)

const full = 'chcp 65001 >nul & ' + command
const result = spawnSync('cmd.exe', ['/d', '/s', '/c', full], {
  stdio: 'inherit',
  windowsHide: true,
  env: process.env,
})
process.exit(result.status === null ? 1 : result.status)
